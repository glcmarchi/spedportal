from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, io, uuid, logging, random, string, hashlib, base64
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt as pyjwt
import stripe
import httpx
from reportlab.lib.pagesizes import A4, A6
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib import colors as rl_colors
import openpyxl
from openpyxl.styles import Font, PatternFill

from carriers.fedex import (
    is_fedex_configured,
    get_fedex_rates,
    create_fedex_shipment,
    cancel_fedex_shipment,
    schedule_fedex_pickup,
    cancel_fedex_pickup,
    track_fedex_shipment,
    validate_fedex_address,
    get_fedex_transit_times,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'spedportal')]

JWT_SECRET = os.environ.get('JWT_SECRET', 'change-me-spedportal-2026')
JWT_ALG = "HS256"
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

app = FastAPI(title="SpedPortal API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spedportal")

EU_COUNTRIES = {
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
    "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
    "SI", "ES", "SE",
}
EUROPE_EXTRA_COUNTRIES = {"GB", "UK", "CH", "NO", "IS", "LI", "AL", "RS", "BA", "ME", "MK", "MD", "UA", "TR"}
NORTH_AMERICA_COUNTRIES = {"US", "CA", "MX"}
ALL_CARRIER_IDS = ["brt", "gls", "dhl", "ups", "tnt", "poste"]
VALID_BILLING_TYPES = ("instant", "prepaid", "postpaid")


def now_iso():
    return datetime.now(timezone.utc).isoformat()

def new_id():
    return str(uuid.uuid4())

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except Exception:
        return False

def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    if not creds:
        raise HTTPException(401, "Missing token")
    try:
        payload = pyjwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user

async def require_approved(user=Depends(get_current_user)):
    if user.get("role") == "user" and user.get("status") != "approved":
        raise HTTPException(403, "Account non ancora approvato")
    return user

async def require_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("reseller_admin", "super_admin", "admin"):
        raise HTTPException(403, "Admin only")
    return user

def tenant_filter(user, extra=None):
    f = dict(extra or {})
    role = user.get("role")
    if role == "super_admin":
        return f
    if role == "reseller_admin":
        f["reseller_id"] = user["reseller_id"]
        return f
    f["user_id"] = user["id"]
    return f


def _normalize_rule(raw: Any, fallback_flat: float = 0.0) -> Dict[str, Any]:
    if isinstance(raw, (int, float)):
        v = round(float(raw), 2)
        return {"mode": "flat", "flat": v, "domestic": v, "europe": v, "world": v}
    if isinstance(raw, dict):
        mode = "area" if raw.get("mode") == "area" else "flat"
        flat = round(float(raw.get("flat", fallback_flat) or 0.0), 2)
        return {
            "mode": mode,
            "flat": flat,
            "domestic": round(float(raw.get("domestic", flat) or 0.0), 2),
            "europe": round(float(raw.get("europe", flat) or 0.0), 2),
            "world": round(float(raw.get("world", flat) or 0.0), 2),
        }
    v = round(float(fallback_flat), 2)
    return {"mode": "flat", "flat": v, "domestic": v, "europe": v, "world": v}


def _eval_markup_rule(rule: Dict[str, Any], zone_macro: str) -> float:
    norm = _normalize_rule(rule, 0.0)
    if norm["mode"] == "flat":
        return norm["flat"]
    if zone_macro == "NAZ":
        return norm["domestic"]
    if zone_macro in ("UE", "EUR-EXTRA"):
        return norm["europe"]
    return norm["world"]


async def ensure_reseller_standard_rate_table(reseller_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not reseller_id:
        return None
    existing = await db.rate_tables.find_one({"reseller_id": reseller_id}, {"_id": 0})
    if existing:
        return existing
    doc = {
        "id": new_id(),
        "reseller_id": reseller_id,
        "name": "Listino Standard",
        "is_default": True,
        "carrier_markups": {cid: _normalize_rule(20.0) for cid in ALL_CARRIER_IDS},
        "created_at": now_iso(),
    }
    await db.rate_tables.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _validate_client_billing_allowed(reseller_id: Optional[str], requested_billing: str):
    """Un sub-cliente può avere modalità 'prepaid' SOLO se il Reseller ha modalità 'postpaid' (Fine Mese)."""
    if requested_billing != "prepaid":
        return
    if not reseller_id:
        return
    res = await db.resellers.find_one({"id": reseller_id}, {"_id": 0, "billing_type": 1})
    if (res or {}).get("billing_type") != "postpaid":
        raise HTTPException(
            400,
            "La modalità Prepagato per i sub-clienti è consentita solo ai Reseller con fatturazione a Fine Mese verso la piattaforma.",
        )


class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    company_name: str
    phone: Optional[str] = None
    reseller_slug: Optional[str] = None

class CreateClientInput(BaseModel):
    email: EmailStr
    password: str
    company_name: str
    phone: Optional[str] = ""
    address: Optional[str] = ""
    postal_code: Optional[str] = ""
    city: Optional[str] = ""
    province: Optional[str] = ""
    country: Optional[str] = "IT"
    billing_type: str = "instant"
    rate_table_id: Optional[str] = None
    allowed_carriers: Optional[List[str]] = None

class LoginInput(BaseModel):
    email: EmailStr
    password: str

class Address(BaseModel):
    company_name: str
    address: str
    postal_code: str
    city: str
    province: Optional[str] = ""
    country: str
    reference: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""

class Parcel(BaseModel):
    length: float
    width: float
    height: float
    weight: float

class OptionalServices(BaseModel):
    insurance: bool = False
    insurance_value: float = 0
    neutral_delivery: bool = False
    cod: bool = False
    cod_amount: float = 0
    saturday_delivery: bool = False
    residential_delivery: bool = False

class CustomsDocs(BaseModel):
    required: bool = False
    incoterms: str = "DAP"
    proforma_name: Optional[str] = ""
    proforma_base64: Optional[str] = ""
    dae_name: Optional[str] = ""
    dae_base64: Optional[str] = ""
    eori_number: Optional[str] = ""
    hs_code: Optional[str] = ""
    customs_value: float = 0
    customs_currency: str = "EUR"

class QuoteRequest(BaseModel):
    sender: Address
    recipient: Address
    shipment_category: str = "goods"
    parcel_type: str = "pacco"
    parcels: List[Parcel]
    goods_description: str = ""
    customs: CustomsDocs = CustomsDocs()
    services: OptionalServices = OptionalServices()

class CreateShipmentInput(BaseModel):
    quote: QuoteRequest
    carrier_id: str
    service_type: Optional[str] = ""
    expect_live: Optional[bool] = None
    origin_url: Optional[str] = ""

class ValidateAddressInput(BaseModel):
    carrier_id: str
    address: Address

class PickupRequestInput(BaseModel):
    pickup_date: str
    ready_time: str = "10:00"
    close_time: str = "18:00"
    remarks: Optional[str] = ""

class UpdateUserInput(BaseModel):
    company_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    country: Optional[str] = None
    billing_type: Optional[str] = None
    rate_table_id: Optional[str] = None
    allowed_carriers: Optional[List[str]] = None
    status: Optional[str] = None

class ClientTopUpInput(BaseModel):
    amount: float
    note: Optional[str] = ""

class RateTableInput(BaseModel):
    name: str
    carrier_markups: Dict[str, Any] = {}
    default_rule: Optional[Dict[str, Any]] = None

class TopUpRequest(BaseModel):
    package_id: str
    origin_url: str

class TestEmailInput(BaseModel):
    to: EmailStr

CREDIT_PACKAGES = {
    "credit_100": {"name": "Ricarica €100", "amount": 100.0},
    "credit_500": {"name": "Ricarica €500", "amount": 500.0},
    "credit_1000": {"name": "Ricarica €1000", "amount": 1000.0},
    "credit_2500": {"name": "Ricarica €2500", "amount": 2500.0},
}

@api_router.post("/auth/register")
async def register(inp: RegisterInput):
    existing = await db.users.find_one({"email": inp.email.lower()})
    if existing:
        raise HTTPException(400, "Email già registrata")
    reseller = None
    if inp.reseller_slug:
        reseller = await db.resellers.find_one({"slug": inp.reseller_slug.lower(), "active": True})
    if not reseller:
        reseller = await db.resellers.find_one({"active": True})
    reseller_id = reseller["id"] if reseller else None
    std_rt = await ensure_reseller_standard_rate_table(reseller_id)
    user = {
        "id": new_id(),
        "email": inp.email.lower(),
        "password": hash_pw(inp.password),
        "company_name": inp.company_name,
        "phone": inp.phone or "",
        "address": "",
        "postal_code": "",
        "city": "",
        "province": "",
        "country": "IT",
        "role": "user",
        "reseller_id": reseller_id,
        "status": "pending",
        "billing_type": "instant",
        "rate_table_id": std_rt["id"] if std_rt else None,
        "allowed_carriers": list(ALL_CARRIER_IDS),
        "credit_balance": 0.0,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    try:
        await send_email(to=user["email"], subject="SpedPortal · Richiesta ricevuta",
                         html=tpl_registration(user["company_name"]))
        notif_to = await get_reseller_notification_email(reseller_id)
        if notif_to:
            await send_email(
                to=notif_to,
                subject=f"SpedPortal · Nuovo cliente registrato ({user['company_name']})",
                html=tpl_new_client_admin_alert(user["company_name"], user["email"], user.get("phone", "")),
            )
    except Exception:
        pass
    return {"ok": True, "message": "Registrazione ricevuta. In attesa di approvazione admin."}

@api_router.post("/auth/login")
async def login(inp: LoginInput):
    user = await db.users.find_one({"email": inp.email.lower()})
    if not user or not verify_pw(inp.password, user["password"]):
        raise HTTPException(401, "Credenziali non valide")
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"], "role": user["role"],
            "reseller_id": user.get("reseller_id"),
            "status": user.get("status", "pending"),
            "company_name": user.get("company_name", ""),
            "billing_type": user.get("billing_type", "instant"),
            "credit_balance": user.get("credit_balance", 0.0),
        },
    }

@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    rid = user.get("reseller_id")
    if user.get("role") == "super_admin":
        user["features"] = {
            "address_book": True, "manifests": True, "parcels": True,
            "sub_clients": True, "rate_tables": True, "broadcasts": True,
            "client_prepaid": True, "client_billing": True,
        }
        user["enabled_surcharges"] = {
            "insurance": True, "cod": True, "saturday_delivery": True,
            "neutral_delivery": True, "residential_delivery": True,
        }
        user["allow_ddp"] = True
        user["can_manage_own_carriers"] = True
    elif rid:
        res = await db.resellers.find_one({"id": rid}, {"_id": 0})
        res_billing = (res or {}).get("billing_type", "prepaid")
        feats = dict((res or {}).get("features", {}))
        if res_billing != "postpaid":
            feats["client_prepaid"] = False
        user["features"] = feats
        user["enabled_surcharges"] = (res or {}).get("enabled_surcharges") or {
            "insurance": True, "cod": True, "saturday_delivery": True,
            "neutral_delivery": True, "residential_delivery": True,
        }
        user["allow_ddp"] = bool((res or {}).get("allow_ddp", False))
        user["reseller_name"] = (res or {}).get("company_name", "")
        user["reseller_slug"] = (res or {}).get("slug", "")
        user["reseller_plan"] = (res or {}).get("plan", "basic")
        user["reseller_billing_type"] = res_billing

        if user.get("role") == "user":
            user["reseller_address"] = {
                "company_name": user.get("company_name", ""),
                "address": user.get("address", ""),
                "postal_code": user.get("postal_code", ""),
                "city": user.get("city", ""),
                "province": user.get("province", ""),
                "country": user.get("country", "IT"),
                "phone": user.get("phone", ""),
                "email": user.get("email", ""),
            }
        else:
            user["reseller_address"] = {
                "company_name": (res or {}).get("company_name", ""),
                "address": (res or {}).get("address", ""),
                "postal_code": (res or {}).get("postal_code", ""),
                "city": (res or {}).get("city", ""),
                "province": (res or {}).get("province", ""),
                "country": (res or {}).get("country", "IT"),
                "phone": (res or {}).get("phone", ""),
                "email": (res or {}).get("admin_email", user.get("email", "")),
            }
        if user.get("role") == "reseller_admin":
            user["billing_type"] = res_billing
            user["credit_balance"] = float((res or {}).get("credit_balance") or user.get("credit_balance") or 0.0)
        policies = (res or {}).get("carrier_policies") or {}
        user["can_manage_own_carriers"] = any(p in ("reseller_only", "hybrid") for p in policies.values())
    return user

@api_router.post("/super/test-email")
async def super_test_email(inp: TestEmailInput, user=Depends(get_current_user)):
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    api_key = os.environ.get("RESEND_API_KEY", "")
    from_addr = os.environ.get("EMAIL_FROM", "SpedPortal <onboarding@resend.dev>")
    if not api_key:
        return {"ok": False, "error": "RESEND_API_KEY non impostata su Render"}
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "from": from_addr,
                    "to": [inp.to],
                    "subject": "SpedPortal · Test Invio Email",
                    "html": "<p>Test invio email da SpedPortal riuscito correttamente.</p>",
                },
            )
            if r.status_code not in (200, 201):
                return {"ok": False, "status_code": r.status_code, "error": r.text}
            return {"ok": True, "id": r.json().get("id")}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@api_router.get("/admin/users")
async def list_users(user=Depends(require_admin)):
    q = {"role": "user"}
    rid = user.get("reseller_id")
    if user.get("role") == "reseller_admin":
        q["reseller_id"] = rid
    std_rt = await ensure_reseller_standard_rate_table(rid)
    items = await db.users.find(q, {"_id": 0, "password": 0}).to_list(1000)
    for it in items:
        if "allowed_carriers" not in it or it["allowed_carriers"] is None:
            it["allowed_carriers"] = list(ALL_CARRIER_IDS)
        if not it.get("rate_table_id") and std_rt:
            it["rate_table_id"] = std_rt["id"]
    return items

@api_router.post("/admin/users")
async def create_client_user(inp: CreateClientInput, admin=Depends(require_admin)):
    if await db.users.find_one({"email": inp.email.lower()}):
        raise HTTPException(400, "Email già registrata")
    rid = admin.get("reseller_id")
    if not rid:
        demo = await db.resellers.find_one({"active": True})
        rid = demo["id"] if demo else None
    b_type = inp.billing_type if inp.billing_type in VALID_BILLING_TYPES else "instant"
    await _validate_client_billing_allowed(rid, b_type)
    std_rt = await ensure_reseller_standard_rate_table(rid)
    rt_id = inp.rate_table_id if inp.rate_table_id else (std_rt["id"] if std_rt else None)
    doc = {
        "id": new_id(),
        "email": inp.email.lower(),
        "password": hash_pw(inp.password),
        "company_name": inp.company_name,
        "phone": inp.phone or "",
        "address": inp.address or "",
        "postal_code": inp.postal_code or "",
        "city": inp.city or "",
        "province": (inp.province or "").strip().upper()[:2],
        "country": (inp.country or "IT").strip().upper()[:2],
        "role": "user",
        "reseller_id": rid,
        "status": "approved",
        "billing_type": b_type,
        "rate_table_id": rt_id,
        "allowed_carriers": inp.allowed_carriers if inp.allowed_carriers is not None else list(ALL_CARRIER_IDS),
        "credit_balance": 0.0,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("password", None)
    return doc

@api_router.patch("/admin/users/{user_id}")
async def update_user(user_id: str, inp: UpdateUserInput, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "Utente non trovato")
    if target.get("role") in ("super_admin", "reseller_admin"):
        raise HTTPException(403, "Non puoi modificare questo account")
    if admin.get("role") == "reseller_admin" and target.get("reseller_id") != admin.get("reseller_id"):
        raise HTTPException(403, "Non puoi gestire utenti di altri reseller")
    update = inp.model_dump(exclude_unset=True)
    if not update:
        raise HTTPException(400, "Nessun campo da aggiornare")
    if "billing_type" in update:
        if update["billing_type"] not in VALID_BILLING_TYPES:
            raise HTTPException(400, "Modalità di pagamento non valida")
        await _validate_client_billing_allowed(target.get("reseller_id"), update["billing_type"])
    if "province" in update:
        update["province"] = (update["province"] or "").strip().upper()[:2]
    if "country" in update:
        update["country"] = (update["country"] or "IT").strip().upper()[:2]
    r = await db.users.update_one({"id": user_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(500, "Aggiornamento fallito")
    if update.get("status") == "approved":
        u = await db.users.find_one({"id": user_id})
        if u and not u.get("welcome_email_sent"):
            try:
                await send_email(to=u["email"], subject="SpedPortal · Il tuo account è attivo",
                                 html=tpl_approved(u.get("company_name", ""), u["email"], f"{FRONTEND_URL}/login"))
                await db.users.update_one({"id": user_id}, {"$set": {"welcome_email_sent": True}})
            except Exception:
                pass
    return {"ok": True}

@api_router.post("/admin/users/{user_id}/topup")
async def admin_topup_client(user_id: str, inp: ClientTopUpInput, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id, "role": "user"})
    if not target:
        raise HTTPException(404, "Cliente non trovato")
    if admin.get("role") == "reseller_admin" and target.get("reseller_id") != admin.get("reseller_id"):
        raise HTTPException(403, "Cliente di altro reseller")
    await _validate_client_billing_allowed(target.get("reseller_id"), "prepaid")
    amount = round(float(inp.amount), 2)
    if amount == 0:
        raise HTTPException(400, "Importo non valido")
    await db.users.update_one({"id": user_id}, {"$inc": {"credit_balance": amount}})
    await db.ledger.insert_one({
        "id": new_id(),
        "user_id": user_id,
        "reseller_id": target.get("reseller_id"),
        "type": "reseller_topup" if amount > 0 else "reseller_adjustment",
        "amount": amount,
        "note": inp.note or "Accredito manuale agenzia",
        "created_at": now_iso(),
    })
    updated = await db.users.find_one({"id": user_id}, {"_id": 0})
    return {"ok": True, "credit_balance": round(float(updated.get("credit_balance") or 0.0), 2)}

@api_router.get("/admin/users-ledger")
async def admin_users_ledger(user_id: Optional[str] = None, admin=Depends(require_admin)):
    q: Dict[str, Any] = {}
    if admin.get("role") == "reseller_admin":
        q["reseller_id"] = admin.get("reseller_id")
    if user_id and user_id != "all":
        q["user_id"] = user_id
    entries = await db.ledger.find(q, {"_id": 0}).sort("created_at", -1).limit(300).to_list(300)
    u_ids = list({e["user_id"] for e in entries if e.get("user_id")})
    users_map = {}
    if u_ids:
        u_docs = await db.users.find({"id": {"$in": u_ids}}, {"_id": 0, "id": 1, "company_name": 1}).to_list(500)
        users_map = {u["id"]: u.get("company_name", "") for u in u_docs}
    for e in entries:
        e["company_name"] = users_map.get(e.get("user_id"), "")
    return entries


def _normalize_rate_table_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    raw_cm = doc.get("carrier_markups") or {}
    norm_cm = {}
    for cid in ALL_CARRIER_IDS:
        if cid in raw_cm and raw_cm[cid] is not None:
            norm_cm[cid] = _normalize_rule(raw_cm[cid], 20.0)
        else:
            bands = doc.get("bands") or []
            if bands:
                by_z = {b.get("zone"): float(b.get("markup_percent", 20.0)) for b in bands}
                dom = by_z.get("NAZ", 20.0)
                eur = by_z.get("UE", dom)
                wld = by_z.get("WORLD", eur)
                if dom == eur == wld:
                    norm_cm[cid] = {"mode": "flat", "flat": dom, "domestic": dom, "europe": eur, "world": wld}
                else:
                    norm_cm[cid] = {"mode": "area", "flat": dom, "domestic": dom, "europe": eur, "world": wld}
            else:
                norm_cm[cid] = _normalize_rule(20.0)
    doc["carrier_markups"] = norm_cm
    return doc


@api_router.get("/admin/rate-tables")
async def list_rate_tables(user=Depends(require_admin)):
    rid = user.get("reseller_id")
    if rid:
        await ensure_reseller_standard_rate_table(rid)
    q = {} if user.get("role") == "super_admin" else {"reseller_id": rid}
    rows = await db.rate_tables.find(q, {"_id": 0}).to_list(500)
    return [_normalize_rate_table_doc(r) for r in rows]

@api_router.post("/admin/rate-tables")
async def create_rate_table(inp: RateTableInput, user=Depends(require_admin)):
    clean_cm = {cid: _normalize_rule(inp.carrier_markups.get(cid, 20.0), 20.0) for cid in ALL_CARRIER_IDS}
    doc = {
        "id": new_id(),
        "reseller_id": user.get("reseller_id"),
        "name": inp.name,
        "carrier_markups": clean_cm,
        "created_at": now_iso(),
    }
    await db.rate_tables.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/admin/rate-tables/{tid}")
async def update_rate_table(tid: str, inp: RateTableInput, user=Depends(require_admin)):
    clean_cm = {cid: _normalize_rule(inp.carrier_markups.get(cid, 20.0), 20.0) for cid in ALL_CARRIER_IDS}
    q = {"id": tid} if user.get("role") == "super_admin" else {"id": tid, "reseller_id": user.get("reseller_id")}
    r = await db.rate_tables.update_one(q, {"$set": {"name": inp.name, "carrier_markups": clean_cm}})
    if r.matched_count == 0:
        raise HTTPException(404, "Profilo margini non trovato")
    return {"ok": True}

@api_router.delete("/admin/rate-tables/{tid}")
async def delete_rate_table(tid: str, user=Depends(require_admin)):
    q = {"id": tid} if user.get("role") == "super_admin" else {"id": tid, "reseller_id": user.get("reseller_id")}
    count = await db.rate_tables.count_documents({"reseller_id": user.get("reseller_id")}) if user.get("reseller_id") else 2
    if count <= 1:
        raise HTTPException(400, "Deve rimanere almeno un profilo margini per l'agenzia")
    await db.rate_tables.delete_one(q)
    return {"ok": True}

MOCK_CARRIERS = [
    {"id": "brt", "name": "BRT", "logo": "BRT", "color": "#c8102e"},
    {"id": "gls", "name": "GLS", "logo": "GLS", "color": "#003366"},
    {"id": "dhl", "name": "DHL Express", "logo": "DHL", "color": "#ffcc00"},
    {"id": "ups", "name": "UPS", "logo": "UPS", "color": "#5c3317"},
    {"id": "tnt", "name": "FedEx / TNT", "logo": "FDX", "color": "#4d148c"},
    {"id": "poste", "name": "Poste Italiane", "logo": "PI", "color": "#003399"},
]

@api_router.get("/carriers")
async def list_carriers(_=Depends(require_approved)):
    return MOCK_CARRIERS

def _zone_of(sender: Address, recipient: Address) -> dict:
    s = (sender.country or "IT").upper()
    r = (recipient.country or "IT").upper()
    if s == "IT" and r == "IT":
        try:
            fd = int((recipient.postal_code or "0")[0])
        except Exception:
            fd = 0
        sub = "NAZ-A" if fd <= 3 else ("NAZ-B" if fd <= 6 else "NAZ-C")
        return {"macro": "NAZ", "sub": sub, "is_extra_eu": False}
    if r in EU_COUNTRIES:
        return {"macro": "UE", "sub": f"INT-{r}", "is_extra_eu": False}
    if r in EUROPE_EXTRA_COUNTRIES:
        return {"macro": "EUR-EXTRA", "sub": f"INT-{r}", "is_extra_eu": True}
    if r in NORTH_AMERICA_COUNTRIES:
        return {"macro": "USA-CA", "sub": f"INT-{r}", "is_extra_eu": True}
    return {"macro": "WORLD", "sub": f"INT-{r}", "is_extra_eu": True}

def _mock_carrier_breakdown(
    carrier_id: str,
    weight: float,
    zone_info: dict,
    parcels_count: int,
    services: OptionalServices,
    customs: CustomsDocs,
    is_extra_eu: bool,
) -> dict:
    base_map = {"brt": 4.5, "gls": 4.8, "dhl": 12.0, "ups": 11.0, "tnt": 10.5, "poste": 5.2}
    base = base_map.get(carrier_id, 8.0)
    mult = {"NAZ": 1.0, "UE": 1.9, "EUR-EXTRA": 2.3, "USA-CA": 2.8, "WORLD": 3.4}.get(zone_info["macro"], 2.0)
    freight = (base + weight * 0.85) * mult * max(1, parcels_count) * 0.85
    seed = int(hashlib.md5((carrier_id + zone_info["sub"]).encode()).hexdigest()[:4], 16) / 65535
    freight = round(freight * (0.9 + 0.25 * seed), 2)

    surcharge_items = []
    fuel = round(freight * 0.11, 2)
    surcharge_items.append({"type": "FUEL", "label": "Supplemento Carburante (Fuel)", "amount": fuel})
    if services.insurance:
        ins = round(max(3.5, services.insurance_value * 0.008), 2)
        surcharge_items.append({"type": "INSURANCE", "label": "Assicurazione", "amount": ins})
    if services.cod:
        cod_fee = round(max(4.0, services.cod_amount * 0.015), 2)
        surcharge_items.append({"type": "COD", "label": "Contrassegno (COD)", "amount": cod_fee})
    if services.saturday_delivery:
        surcharge_items.append({"type": "SATURDAY", "label": "Consegna al Sabato", "amount": 8.50})
    if services.residential_delivery:
        surcharge_items.append({"type": "RESIDENTIAL", "label": "Consegna Indirizzo Privato", "amount": 2.80})
    if services.neutral_delivery:
        surcharge_items.append({"type": "NEUTRAL", "label": "Consegna Neutra", "amount": 2.00})
    if is_extra_eu:
        surcharge_items.append({"type": "CUSTOMS", "label": "Oneri Sdoganamento Export", "amount": 8.00})
        if (customs.incoterms or "DAP").upper() == "DDP":
            surcharge_items.append({"type": "DDP", "label": "Gestione Resa DDP (Dazi Mittente)", "amount": 15.00})

    surcharges_total = round(sum(x["amount"] for x in surcharge_items), 2)
    return {
        "base_freight": freight,
        "surcharges_total": surcharges_total,
        "surcharge_items": surcharge_items,
        "total_cost": round(freight + surcharges_total, 2),
    }


async def _reseller_markup_for_carrier(user: dict, carrier_id: str, zone_macro: str) -> float:
    if user.get("role") in ("reseller_admin", "super_admin", "admin"):
        return 0.0

    rid = user.get("reseller_id")
    rate_table_id = user.get("rate_table_id")
    table = None
    if rate_table_id:
        table = await db.rate_tables.find_one({"id": rate_table_id}, {"_id": 0})
    if not table and rid:
        table = await ensure_reseller_standard_rate_table(rid)
    if table:
        norm = _normalize_rate_table_doc(table)
        rule = (norm.get("carrier_markups") or {}).get(carrier_id)
        if rule:
            return _eval_markup_rule(rule, zone_macro)
    return 20.0


async def _resolve_tenant_carrier_options(user: dict, zone_macro: str = "NAZ") -> dict:
    rid = user.get("reseller_id")
    master_doc = await db.system_settings.find_one({"id": "master_carriers"}, {"_id": 0})
    master_carriers = (master_doc or {}).get("carriers") or {}

    user_allowed = None
    if user.get("role") == "user" and user.get("allowed_carriers") is not None:
        user_allowed = set(user.get("allowed_carriers") or [])

    if not rid:
        out = {}
        for c in MOCK_CARRIERS:
            cid = c["id"]
            m = master_carriers.get(cid) or {}
            if m.get("status") == "verified":
                out[cid] = {
                    "owner": "admin",
                    "code": m.get("primary_code", ""),
                    "admin_markup_percent": 0.0,
                    "platform_fee": 0.0,
                }
        return out

    res = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not res:
        return {}
    policies = res.get("carrier_policies") or {}
    custom_markups = res.get("admin_carrier_markups") or {}
    own_creds = res.get("carrier_credentials") or {}
    fee_admin = round(float(res.get("fee_on_admin_codes") or 0.0), 2)
    fee_own = round(float(res.get("per_shipment_fee") or 0.0), 2)
    out = {}

    for c in MOCK_CARRIERS:
        cid = c["id"]
        if user_allowed is not None and cid not in user_allowed:
            continue
        pol = policies.get(cid, "admin_only")
        if pol == "hybrid":
            pol = "reseller_only"
        if pol == "disabled":
            continue

        if pol == "admin_only":
            m = master_carriers.get(cid) or {}
            if m.get("status") == "verified":
                override = custom_markups.get(cid)
                if override is not None:
                    admin_mk = _eval_markup_rule(override, zone_macro)
                else:
                    master_rule = m.get("default_markup_rule") if m.get("default_markup_rule") is not None else float(m.get("default_markup_percent", 0.0))
                    admin_mk = _eval_markup_rule(master_rule, zone_macro)
                out[cid] = {
                    "owner": "admin",
                    "code": m.get("primary_code", ""),
                    "admin_markup_percent": round(admin_mk, 2),
                    "platform_fee": fee_admin,
                }
        elif pol == "reseller_only":
            o = own_creds.get(cid) or {}
            if o.get("status") == "verified":
                out[cid] = {
                    "owner": "reseller",
                    "code": o.get("primary_code", ""),
                    "admin_markup_percent": 0.0,
                    "platform_fee": fee_own,
                }
    return out


async def _ensure_ddp_allowed(q: QuoteRequest, user: dict):
    if (q.customs.incoterms or "DAP").upper() != "DDP":
        return
    if user.get("role") == "super_admin":
        return
    rid = user.get("reseller_id")
    res = await db.resellers.find_one({"id": rid}, {"_id": 0, "allow_ddp": 1}) if rid else None
    if not (res or {}).get("allow_ddp", False):
        raise HTTPException(403, "La resa doganale DDP non è abilitata per questo account. Utilizza DAP oppure contatta l'amministratore.")


def _build_quote_option(
    cid: str,
    carrier_label: str,
    color: str,
    service_type: str,
    is_live: bool,
    carrier_cost: float,
    raw_freight: float,
    raw_surcharge_items: List[Dict[str, Any]],
    transit: int,
    commit_hint: str,
    billed_weight: float,
    zone_macro: str,
    opt: dict,
    reseller_mk_pct: float,
) -> dict:
    """Calcolo Opzione B:
    - Il ricarico % Reseller si applica solo al trasporto (nolo + supplementi),
      mentre la Commissione Piattaforma (platform_fee) viene aggiunta netta senza ulteriore ricarico.
    """
    admin_mk_pct = opt["admin_markup_percent"] if opt["owner"] == "admin" else 0.0
    mult_admin = 1 + admin_mk_pct / 100.0
    platform_fee = round(float(opt.get("platform_fee") or 0.0), 2)

    reseller_base_freight = round(raw_freight * mult_admin, 2)
    reseller_surcharge_items = [
        {**item, "amount": round(item["amount"] * mult_admin, 2)}
        for item in raw_surcharge_items
    ]
    reseller_surcharges_total = round(sum(x["amount"] for x in reseller_surcharge_items), 2)
    reseller_transport_cost = round(reseller_base_freight + reseller_surcharges_total, 2)

    # Costo totale sostenuto dal Reseller (trasporto + Commissione Piattaforma)
    reseller_cost = round(reseller_transport_cost + platform_fee, 2)

    # Opzione B: ricarico % Reseller solo sul trasporto + Commissione Piattaforma netta
    client_price = round(reseller_transport_cost * (1 + reseller_mk_pct / 100.0) + platform_fee, 2)

    return {
        "option_key": f"{cid}:{service_type}",
        "carrier_id": cid,
        "carrier_name": carrier_label,
        "color": color,
        "service_type": service_type,
        "is_live": is_live,
        "carrier_cost": carrier_cost,
        "admin_markup_percent": admin_mk_pct,
        "reseller_base_freight": reseller_base_freight,
        "reseller_surcharges_total": reseller_surcharges_total,
        "reseller_surcharge_items": reseller_surcharge_items,
        "reseller_transport_cost": reseller_transport_cost,
        "platform_fee": platform_fee,
        "reseller_cost": reseller_cost,
        "reseller_markup_percent": reseller_mk_pct,
        "cost": reseller_cost,
        "price": client_price,
        "transit_days": transit,
        "commit_hint": commit_hint,
        "billed_weight": round(billed_weight, 2),
        "zone": zone_macro,
        "contract_owner": opt["owner"],
    }


async def _compute_quotes_internal(q: QuoteRequest, user: dict) -> dict:
    await _ensure_ddp_allowed(q, user)
    total_weight = sum(p.weight for p in q.parcels)
    vol_weight = sum((p.length * p.width * p.height) / 5000.0 for p in q.parcels)
    billed_weight = max(total_weight, vol_weight)
    zone_info = _zone_of(q.sender, q.recipient)
    is_docs = q.shipment_category == "documents" or q.parcel_type in ("documenti", "busta_documenti")
    customs_needed = zone_info["is_extra_eu"] and not is_docs
    options = await _resolve_tenant_carrier_options(user, zone_info["macro"])

    quotes = []
    warnings = []

    for c in MOCK_CARRIERS:
        cid = c["id"]
        opt = options.get(cid)
        if not opt:
            continue

        reseller_mk_pct = await _reseller_markup_for_carrier(user, cid, zone_info["macro"])

        if cid == "tnt":
            if not is_fedex_configured() or not opt["code"]:
                continue
            try:
                live_fedex_list = await get_fedex_rates(
                    account_number=opt["code"],
                    sender=q.sender.model_dump(),
                    recipient=q.recipient.model_dump(),
                    parcels=[p.model_dump() for p in q.parcels],
                    parcel_type=q.parcel_type,
                    customs_required=customs_needed,
                    incoterms=q.customs.incoterms,
                    customs_value=q.customs.customs_value,
                    customs_currency=q.customs.customs_currency,
                    hs_code=q.customs.hs_code or "",
                    goods_description=q.goods_description,
                    insured_value=q.services.insurance_value if q.services.insurance else 0.0,
                    saturday_delivery=q.services.saturday_delivery,
                    residential_delivery=q.services.residential_delivery,
                    cod_amount=q.services.cod_amount if q.services.cod else 0.0,
                )
            except Exception as e:
                logger.warning("FedEx Rate API non ha restituito tariffe: %s", e)
                warnings.append(f"FedEx: {e}")
                continue

            for fx in live_fedex_list:
                carrier_cost = fx["carrier_cost"]
                raw_freight = fx["base_charge"]
                raw_surcharge_items = list(fx["surcharge_list"])
                if q.services.neutral_delivery:
                    raw_surcharge_items.append({"type": "NEUTRAL", "label": "Consegna Neutra", "amount": 2.00})
                    carrier_cost = round(carrier_cost + 2.00, 2)
                if customs_needed and (q.customs.incoterms or "DAP").upper() == "DDP":
                    raw_surcharge_items.append({"type": "DDP", "label": "Gestione Resa DDP (Dazi Mittente)", "amount": 15.00})
                    carrier_cost = round(carrier_cost + 15.00, 2)

                quotes.append(
                    _build_quote_option(
                        cid=cid,
                        carrier_label=fx["service_name"],
                        color=c["color"],
                        service_type=fx["service_type"],
                        is_live=True,
                        carrier_cost=carrier_cost,
                        raw_freight=raw_freight,
                        raw_surcharge_items=raw_surcharge_items,
                        transit=fx["transit_days"],
                        commit_hint=fx.get("commit_hint", ""),
                        billed_weight=billed_weight,
                        zone_macro=zone_info["macro"],
                        opt=opt,
                        reseller_mk_pct=reseller_mk_pct,
                    )
                )
        else:
            bk = _mock_carrier_breakdown(cid, billed_weight, zone_info, len(q.parcels), q.services, q.customs, customs_needed)
            transit = 1 if zone_info["macro"] == "NAZ" else (3 if cid in ["dhl", "ups"] else 5)
            hint = "Consegna standard entro fine giornata"
            quotes.append(
                _build_quote_option(
                    cid=cid,
                    carrier_label=c["name"],
                    color=c["color"],
                    service_type="STANDARD",
                    is_live=False,
                    carrier_cost=bk["total_cost"],
                    raw_freight=bk["base_freight"],
                    raw_surcharge_items=bk["surcharge_items"],
                    transit=transit,
                    commit_hint=hint,
                    billed_weight=billed_weight,
                    zone_macro=zone_info["macro"],
                    opt=opt,
                    reseller_mk_pct=reseller_mk_pct,
                )
            )

    quotes.sort(key=lambda x: x["price"])
    return {
        "quotes": quotes,
        "warnings": warnings,
        "billed_weight": round(billed_weight, 2),
        "zone": zone_info["macro"],
        "is_extra_eu": customs_needed,
    }


@api_router.post("/shipments/quote")
async def quote_shipment(q: QuoteRequest, user=Depends(require_approved)):
    full = await _compute_quotes_internal(q, user)
    role = user.get("role")
    if role == "user":
        sanitized = [
            {
                "option_key": item["option_key"],
                "carrier_id": item["carrier_id"],
                "carrier_name": item["carrier_name"],
                "service_type": item["service_type"],
                "color": item["color"],
                "price": item["price"],
                "transit_days": item["transit_days"],
                "commit_hint": item.get("commit_hint", ""),
                "billed_weight": item["billed_weight"],
                "zone": item["zone"],
            }
            for item in full["quotes"]
        ]
        return {
            "quotes": sanitized,
            "warnings": full["warnings"],
            "billed_weight": full["billed_weight"],
            "zone": full["zone"],
            "is_extra_eu": full["is_extra_eu"],
        }
    return full


@api_router.post("/shipments/transit-times")
async def check_transit_times(q: QuoteRequest, _=Depends(require_approved)):
    items = await get_fedex_transit_times(
        sender=q.sender.model_dump(),
        recipient=q.recipient.model_dump(),
        parcels=[p.model_dump() for p in q.parcels],
    )
    return {"services": items}


@api_router.post("/shipments/validate-address")
async def validate_shipment_address(inp: ValidateAddressInput, _=Depends(require_approved)):
    if inp.carrier_id != "tnt" or not is_fedex_configured():
        return {"supported": False}
    return await validate_fedex_address(inp.address.model_dump())


def _tracking_number(carrier_id: str) -> str:
    return f"{carrier_id.upper()}{''.join(random.choices(string.digits, k=10))}"


async def _issue_single_shipment_invoice(shipment: dict) -> dict:
    """Emette in automatico una ricevuta/fattura per una spedizione pagata istantaneamente."""
    existing = await db.invoices.find_one({"shipment_ids": shipment["id"]}, {"_id": 0})
    if existing:
        return existing
    total = round(float(shipment.get("price") or 0.0), 2)
    vat = round(total * 0.22, 2)
    grand = round(total + vat, 2)
    inv_num = f"FT-{datetime.now(timezone.utc).strftime('%Y%m')}-{random.randint(1000,9999)}"
    inv = {
        "id": new_id(),
        "user_id": shipment["user_id"],
        "reseller_id": shipment.get("reseller_id"),
        "invoice_number": inv_num,
        "shipment_ids": [shipment["id"]],
        "total": total,
        "vat": vat,
        "grand_total": grand,
        "payment_mode": "instant",
        "created_at": now_iso(),
        "status": "paid",
    }
    await db.invoices.insert_one(inv)
    await db.shipments.update_one({"id": shipment["id"]}, {"$set": {"invoice_id": inv["id"]}})
    inv.pop("_id", None)
    return inv


async def _dispatch_shipment_to_carrier_and_bill(shipment: dict, user_doc: dict) -> dict:
    """Esegue la chiamata al corriere, genera etichetta e registra addebiti su wallet/ledger."""
    if shipment.get("status") != "awaiting_payment" and shipment.get("tracking_number"):
        return shipment

    cid = shipment["carrier_id"]
    code_used = shipment.get("carrier_code_used", "")
    source = shipment.get("contract_owner", "admin")
    applied_fee = round(float(shipment.get("applied_fee") or 0.0), 2)
    reseller_transport = round(float(shipment.get("reseller_transport_cost") or shipment.get("reseller_cost") or 0.0), 2)
    price = round(float(shipment.get("price") or 0.0), 2)
    rid = shipment.get("reseller_id")
    creator_role = shipment.get("created_by_role", user_doc.get("role", "user"))
    creator_name = shipment.get("user_company_name", user_doc.get("company_name", ""))
    customs_needed = bool((shipment.get("customs") or {}).get("required", False))

    tracking_num = _tracking_number(cid)
    label_b64 = ""
    is_live_shipment = False
    paperless_ok = False
    fallback_paper = customs_needed

    etd_docs = shipment.pop("_pending_etd_docs", None) or []

    if cid == "tnt":
        if not is_fedex_configured() or not code_used:
            raise HTTPException(400, "Credenziali FedEx non configurate")
        try:
            c_info = shipment.get("customs") or {}
            s_info = shipment.get("services") or {}
            fx_ship = await create_fedex_shipment(
                account_number=code_used,
                sender=shipment["sender"],
                recipient=shipment["recipient"],
                parcels=shipment["parcels"],
                service_type=shipment.get("service_type") or "INTERNATIONAL_PRIORITY",
                parcel_type=shipment.get("parcel_type", "pacco"),
                goods_description=shipment.get("goods_description", ""),
                customs_required=customs_needed,
                incoterms=c_info.get("incoterms", "DAP"),
                customs_value=float(c_info.get("customs_value") or 0.0),
                customs_currency=c_info.get("customs_currency", "EUR"),
                hs_code=c_info.get("hs_code", ""),
                etd_docs=etd_docs,
                insured_value=float(s_info.get("insurance_value") or 0.0) if s_info.get("insurance") else 0.0,
                saturday_delivery=bool(s_info.get("saturday_delivery", False)),
                residential_delivery=bool(s_info.get("residential_delivery", False)),
                cod_amount=float(s_info.get("cod_amount") or 0.0) if s_info.get("cod") else 0.0,
            )
            if fx_ship.get("tracking_number"):
                tracking_num = fx_ship["tracking_number"]
            label_b64 = fx_ship.get("label_pdf_base64", "")
            is_live_shipment = True
            paperless_ok = bool(fx_ship.get("paperless_ok", False))
            fallback_paper = bool(fx_ship.get("fallback_paper", False))
        except Exception as e:
            raise HTTPException(502, str(e))

    customs_saved = dict(shipment.get("customs") or {})
    customs_saved["paperless_ok"] = paperless_ok
    customs_saved["fallback_paper"] = fallback_paper

    updates = {
        "tracking_number": tracking_num,
        "label_pdf_base64": label_b64,
        "is_live": is_live_shipment,
        "customs": customs_saved,
        "status": "created",
        "tracking_events": [
            {
                "ts": now_iso(),
                "code": "created",
                "label": "Spedizione creata / Etichetta generata",
                "location": (shipment.get("sender") or {}).get("city", ""),
            }
        ],
    }
    await db.shipments.update_one(
        {"id": shipment["id"]},
        {"$set": updates, "$unset": {"_pending_etd_docs": ""}},
    )
    shipment.update(updates)

    if creator_role == "user" and user_doc.get("billing_type") == "prepaid":
        await db.users.update_one({"id": user_doc["id"]}, {"$inc": {"credit_balance": -price}})
        await db.ledger.insert_one({
            "id": new_id(), "user_id": user_doc["id"], "reseller_id": rid,
            "type": "shipment_charge", "amount": -price,
            "note": f"Spedizione {tracking_num} ({shipment['carrier_name']})",
            "shipment_id": shipment["id"], "created_at": now_iso(),
        })

    # Addebito Wallet Reseller (trasporto + Commissione Piattaforma se codici Admin; solo Commissione Piattaforma se codici propri)
    reseller_doc = await db.resellers.find_one({"id": rid}) if rid else None
    admin_charge_to_reseller = round(reseller_transport + applied_fee, 2) if source == "admin" else applied_fee
    if reseller_doc and reseller_doc.get("billing_type") == "prepaid" and admin_charge_to_reseller > 0:
        origin_tag = f"Sub-cliente {creator_name}" if creator_role == "user" else "Spedizione Reseller"
        fee_note = f" · incl. Comm. Piattaforma €{applied_fee:.2f}" if applied_fee > 0 else ""
        await db.resellers.update_one({"id": rid}, {"$inc": {"credit_balance": -admin_charge_to_reseller}})
        await db.users.update_many({"reseller_id": rid, "role": "reseller_admin"}, {"$inc": {"credit_balance": -admin_charge_to_reseller}})
        await db.reseller_ledger.insert_one({
            "id": new_id(), "reseller_id": rid, "shipment_id": shipment["id"],
            "created_by_role": creator_role,
            "client_company_name": creator_name if creator_role == "user" else "",
            "type": "shipment_charge" if source == "admin" else "label_fee",
            "amount": -admin_charge_to_reseller,
            "note": f"{origin_tag} · {tracking_num} ({shipment['carrier_name']}){fee_note}",
            "created_at": now_iso(),
        })

    return shipment


def _effective_user_billing_mode(user: dict, reseller_doc: Optional[dict]) -> str:
    if user.get("role") == "super_admin":
        return "postpaid"
    if user.get("role") == "reseller_admin":
        return (reseller_doc or {}).get("billing_type") or user.get("billing_type") or "prepaid"
    return user.get("billing_type") or "instant"


@api_router.post("/shipments")
async def create_shipment(inp: CreateShipmentInput, user=Depends(require_approved)):
    full_quotes = await _compute_quotes_internal(inp.quote, user)
    matching = [q for q in full_quotes["quotes"] if q["carrier_id"] == inp.carrier_id]
    chosen = None
    if inp.service_type:
        chosen = next((q for q in matching if q.get("service_type") == inp.service_type), None)
    if not chosen and matching:
        chosen = matching[0]
    if not chosen:
        raise HTTPException(400, "Servizio corriere non disponibile o non più quotabile per questa tratta")

    zone_info = _zone_of(inp.quote.sender, inp.quote.recipient)
    options = await _resolve_tenant_carrier_options(user, zone_info["macro"])
    opt = options.get(inp.carrier_id)
    if not opt:
        raise HTTPException(400, "Configurazione corriere non trovata")

    source = opt["owner"]
    code_used = opt["code"]
    applied_fee = round(float(chosen.get("platform_fee") or 0.0), 2)

    carrier_cost = chosen["carrier_cost"]
    reseller_transport_cost = chosen["reseller_transport_cost"]
    reseller_cost = chosen["reseller_cost"]
    price = chosen["price"]
    admin_charge_to_reseller = round(reseller_transport_cost + applied_fee, 2) if source == "admin" else applied_fee

    rid = user.get("reseller_id")
    reseller_doc = await db.resellers.find_one({"id": rid}) if rid else None
    billing_mode = _effective_user_billing_mode(user, reseller_doc)

    if user.get("role") == "user" and billing_mode == "prepaid":
        bal = float(user.get("credit_balance") or 0.0)
        if bal < price:
            raise HTTPException(402, "Credito insufficiente. Ricarica il tuo saldo prepagato.")

    if reseller_doc and reseller_doc.get("billing_type") == "prepaid" and admin_charge_to_reseller > 0:
        res_bal = float(reseller_doc.get("credit_balance") or 0.0)
        if res_bal < admin_charge_to_reseller:
            if user.get("role") == "reseller_admin":
                raise HTTPException(402, f"Credito piattaforma insufficiente (€ {res_bal:.2f}). Ricarica il tuo Wallet.")
            raise HTTPException(402, "Servizio temporaneamente sospeso per credito agenzia esaurito.")

    etd_docs = []
    if full_quotes["is_extra_eu"]:
        if inp.quote.customs.proforma_base64:
            etd_docs.append({
                "doc_type": "PRO_FORMA_INVOICE",
                "content_type": "application/pdf",
                "base64": inp.quote.customs.proforma_base64,
            })
        if inp.quote.customs.dae_base64:
            etd_docs.append({
                "doc_type": "OTHER",
                "content_type": "application/pdf",
                "base64": inp.quote.customs.dae_base64,
            })

    customs_saved = inp.quote.customs.model_dump(exclude={"proforma_base64", "dae_base64"})
    customs_saved["required"] = full_quotes["is_extra_eu"]

    creator_role = user.get("role", "user")
    creator_name = user.get("company_name", "")

    shipment = {
        "id": new_id(),
        "user_id": user["id"],
        "user_company_name": creator_name,
        "created_by_role": creator_role,
        "reseller_id": rid,
        "on_master_codes": (source == "admin"),
        "contract_owner": source,
        "carrier_code_used": code_used,
        "applied_fee": applied_fee,
        "is_live": False,
        "tracking_number": "",
        "carrier_id": inp.carrier_id,
        "carrier_name": chosen["carrier_name"],
        "service_type": chosen.get("service_type", ""),
        "label_pdf_base64": "",
        "sender": inp.quote.sender.model_dump(),
        "recipient": inp.quote.recipient.model_dump(),
        "shipment_category": inp.quote.shipment_category,
        "parcel_type": inp.quote.parcel_type,
        "parcels": [p.model_dump() for p in inp.quote.parcels],
        "goods_description": inp.quote.goods_description,
        "customs": customs_saved,
        "services": inp.quote.services.model_dump(),
        "billed_weight": chosen["billed_weight"],
        "zone": chosen["zone"],
        "carrier_cost": carrier_cost,
        "admin_markup_percent": chosen["admin_markup_percent"],
        "reseller_base_freight": chosen["reseller_base_freight"],
        "reseller_surcharges_total": chosen["reseller_surcharges_total"],
        "reseller_surcharge_items": chosen["reseller_surcharge_items"],
        "reseller_transport_cost": reseller_transport_cost,
        "platform_fee": applied_fee,
        "reseller_cost": reseller_cost,
        "reseller_markup_percent": chosen["reseller_markup_percent"],
        "cost": reseller_cost,
        "price": price,
        "payment_mode": billing_mode,
        "status": "awaiting_payment",
        "tracking_events": [],
        "_pending_etd_docs": etd_docs,
        "created_at": now_iso(),
    }
    await db.shipments.insert_one(shipment)

    if billing_mode == "instant":
        if not stripe.api_key:
            raise HTTPException(400, "Gateway di pagamento istantaneo (Stripe) non configurato su Render")
        origin = (inp.origin_url or FRONTEND_URL).rstrip("/")
        success_url = f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{origin}/payment/cancel"
        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                line_items=[{
                    "price_data": {
                        "currency": "eur",
                        "product_data": {
                            "name": f"Spedizione {chosen['carrier_name']} ({inp.quote.sender.city} → {inp.quote.recipient.city})",
                        },
                        "unit_amount": int(round(price * 100)),
                    },
                    "quantity": 1,
                }],
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={
                    "kind": "shipment_instant",
                    "shipment_id": shipment["id"],
                    "user_id": user["id"],
                    "amount": str(price),
                },
            )
        except Exception as e:
            raise HTTPException(500, f"Errore creazione sessione pagamento: {e}")

        await db.payment_transactions.insert_one({
            "session_id": session.id,
            "kind": "shipment_instant",
            "shipment_id": shipment["id"],
            "user_id": user["id"],
            "reseller_id": rid,
            "amount": price,
            "currency": "eur",
            "status": "initiated",
            "payment_status": "pending",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
        shipment.pop("_id", None)
        shipment.pop("label_pdf_base64", None)
        shipment.pop("_pending_etd_docs", None)
        return {
            "requires_payment": True,
            "checkout_url": session.url,
            "session_id": session.id,
            "shipment": _sanitize_shipment_for_role(shipment, creator_role),
        }

    shipment = await _dispatch_shipment_to_carrier_and_bill(shipment, user)
    shipment.pop("_id", None)
    shipment.pop("label_pdf_base64", None)
    return _sanitize_shipment_for_role(shipment, creator_role)


def _sanitize_shipment_for_role(s: dict, role: str) -> dict:
    if role == "user":
        for secret_k in (
            "cost", "carrier_cost", "reseller_cost", "reseller_transport_cost",
            "platform_fee", "applied_fee",
            "reseller_base_freight", "reseller_surcharges_total", "reseller_surcharge_items",
            "admin_markup_percent", "reseller_markup_percent",
        ):
            s.pop(secret_k, None)
    return s


async def _sync_live_tracking(s: dict) -> dict:
    if s.get("status") in ("delivered", "cancelled", "awaiting_payment"):
        return s

    if s.get("carrier_id") != "tnt" or not is_fedex_configured():
        if not s.get("is_live"):
            s["status"] = _simulate_status(s)
        return s

    live = await track_fedex_shipment(s.get("tracking_number", ""))
    if live:
        updates: Dict[str, Any] = {
            "status": live["status"],
            "tracking_last_sync": now_iso(),
        }
        if live.get("events"):
            updates["tracking_events"] = live["events"]
        if live.get("estimated_delivery"):
            updates["estimated_delivery"] = live["estimated_delivery"]
        if live.get("actual_delivery"):
            updates["actual_delivery"] = live["actual_delivery"]
        if live.get("signed_by"):
            updates["signed_by"] = live["signed_by"]
        await db.shipments.update_one({"id": s["id"]}, {"$set": updates})
        s.update(updates)
    return s


@api_router.get("/shipments")
async def list_shipments(user=Depends(require_approved)):
    q = tenant_filter(user, {"status": {"$ne": "awaiting_payment"}})
    proj = {"_id": 0, "label_pdf_base64": 0, "_pending_etd_docs": 0}
    if user.get("role") == "user":
        proj.update({
            "cost": 0, "carrier_cost": 0, "reseller_cost": 0, "reseller_transport_cost": 0,
            "platform_fee": 0, "applied_fee": 0,
            "reseller_base_freight": 0, "reseller_surcharges_total": 0, "reseller_surcharge_items": 0,
            "admin_markup_percent": 0, "reseller_markup_percent": 0,
        })
    ships = await db.shipments.find(q, proj).sort("created_at", -1).to_list(1000)

    user_ids = list({s.get("user_id") for s in ships if s.get("user_id")})
    users_info: Dict[str, Dict[str, Any]] = {}
    if user_ids:
        u_docs = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "role": 1, "company_name": 1}).to_list(1000)
        users_info = {u["id"]: u for u in u_docs}

    for s in ships:
        u_rec = users_info.get(s.get("user_id"))
        if u_rec:
            s["created_by_role"] = u_rec.get("role", s.get("created_by_role", "user"))
            if not s.get("user_company_name"):
                s["user_company_name"] = u_rec.get("company_name", "")
        if s.get("status") != "cancelled" and not s.get("is_live"):
            s["status"] = _simulate_status(s)
    return ships


@api_router.get("/shipments/{sid}")
async def get_shipment(sid: str, user=Depends(require_approved)):
    q = tenant_filter(user, {"id": sid})
    proj = {"_id": 0, "label_pdf_base64": 0, "_pending_etd_docs": 0}
    s = await db.shipments.find_one(q, proj)
    if not s:
        raise HTTPException(404, "Spedizione non trovata")
    u_rec = await db.users.find_one({"id": s.get("user_id")}, {"_id": 0, "role": 1, "company_name": 1})
    if u_rec:
        s["created_by_role"] = u_rec.get("role", s.get("created_by_role", "user"))
        if not s.get("user_company_name"):
            s["user_company_name"] = u_rec.get("company_name", "")
    s = await _sync_live_tracking(s)
    return _sanitize_shipment_for_role(s, user.get("role", "user"))


@api_router.post("/shipments/{sid}/track/refresh")
async def refresh_shipment_tracking(sid: str, user=Depends(require_approved)):
    q = tenant_filter(user, {"id": sid})
    proj = {"_id": 0, "label_pdf_base64": 0, "_pending_etd_docs": 0}
    s = await db.shipments.find_one(q, proj)
    if not s:
        raise HTTPException(404, "Spedizione non trovata")
    s = await _sync_live_tracking(s)
    return _sanitize_shipment_for_role(s, user.get("role", "user"))


@api_router.post("/shipments/{sid}/pickup")
async def book_shipment_pickup(sid: str, inp: PickupRequestInput, user=Depends(require_approved)):
    q = tenant_filter(user, {"id": sid})
    s = await db.shipments.find_one(q, {"_id": 0, "label_pdf_base64": 0})
    if not s:
        raise HTTPException(404, "Spedizione non trovata")

    current_status = s.get("status") if (s.get("is_live") or s.get("status") == "cancelled") else _simulate_status(s)
    if current_status == "cancelled":
        raise HTTPException(400, "Impossibile prenotare un ritiro per una spedizione annullata")
    if s.get("pickup", {}).get("status") == "scheduled":
        raise HTTPException(400, "Esiste già un ritiro attivo per questa spedizione")

    total_weight = sum(float(p.get("weight", 1)) for p in (s.get("parcels") or []))
    pkg_count = len(s.get("parcels") or []) or 1

    if s.get("carrier_id") == "tnt" and s.get("is_live") and is_fedex_configured():
        try:
            pk = await schedule_fedex_pickup(
                account_number=s.get("carrier_code_used", ""),
                sender=s.get("sender") or {},
                recipient_country=(s.get("recipient") or {}).get("country", "IT"),
                tracking_number=s.get("tracking_number", ""),
                package_count=pkg_count,
                total_weight=total_weight,
                pickup_date=inp.pickup_date,
                ready_time=inp.ready_time,
                close_time=inp.close_time,
                remarks=inp.remarks or "",
            )
            pickup_doc = {
                "status": "scheduled",
                "confirmation_code": pk["confirmation_code"],
                "location": pk.get("location", ""),
                "scheduled_date": inp.pickup_date,
                "ready_time": inp.ready_time,
                "close_time": inp.close_time,
                "remarks": inp.remarks or "",
                "created_at": now_iso(),
            }
        except Exception as e:
            raise HTTPException(502, str(e))
    else:
        pickup_doc = {
            "status": "scheduled",
            "confirmation_code": f"PK{random.randint(100000, 999999)}",
            "location": "",
            "scheduled_date": inp.pickup_date,
            "ready_time": inp.ready_time,
            "close_time": inp.close_time,
            "remarks": inp.remarks or "",
            "created_at": now_iso(),
        }

    ev = {
        "ts": now_iso(),
        "code": "pickup_scheduled",
        "label": f"Ritiro prenotato per il {inp.pickup_date} ({inp.ready_time}-{inp.close_time}) · Cod. {pickup_doc['confirmation_code']}",
        "location": (s.get("sender") or {}).get("city", ""),
    }
    await db.shipments.update_one(
        {"id": sid},
        {"$set": {"pickup": pickup_doc}, "$push": {"tracking_events": ev}},
    )
    updated = await db.shipments.find_one({"id": sid}, {"_id": 0, "label_pdf_base64": 0})
    return _sanitize_shipment_for_role(updated, user.get("role", "user"))


@api_router.post("/shipments/{sid}/pickup/cancel")
async def cancel_shipment_pickup(sid: str, user=Depends(require_approved)):
    q = tenant_filter(user, {"id": sid})
    s = await db.shipments.find_one(q, {"_id": 0, "label_pdf_base64": 0})
    if not s:
        raise HTTPException(404, "Spedizione non trovata")

    pk = s.get("pickup") or {}
    if pk.get("status") != "scheduled":
        raise HTTPException(400, "Nessun ritiro attivo da annullare")

    if s.get("carrier_id") == "tnt" and s.get("is_live") and is_fedex_configured():
        try:
            await cancel_fedex_pickup(
                account_number=s.get("carrier_code_used", ""),
                confirmation_code=pk.get("confirmation_code", ""),
                scheduled_date=pk.get("scheduled_date", ""),
                location=pk.get("location", ""),
            )
        except Exception as e:
            raise HTTPException(502, str(e))

    ev = {
        "ts": now_iso(),
        "code": "pickup_cancelled",
        "label": f"Ritiro {pk.get('confirmation_code', '')} annullato",
        "location": (s.get("sender") or {}).get("city", ""),
    }
    await db.shipments.update_one(
        {"id": sid},
        {
            "$set": {"pickup.status": "cancelled", "pickup.cancelled_at": now_iso()},
            "$push": {"tracking_events": ev},
        },
    )
    updated = await db.shipments.find_one({"id": sid}, {"_id": 0, "label_pdf_base64": 0})
    return _sanitize_shipment_for_role(updated, user.get("role", "user"))


@api_router.post("/shipments/{sid}/cancel")
async def cancel_shipment(sid: str, user=Depends(require_approved)):
    q = tenant_filter(user, {"id": sid})
    s = await db.shipments.find_one(q, {"_id": 0, "label_pdf_base64": 0})
    if not s:
        raise HTTPException(404, "Spedizione non trovata")

    current_status = s.get("status") if (s.get("is_live") or s.get("status") == "cancelled") else _simulate_status(s)
    if current_status == "cancelled":
        raise HTTPException(400, "Spedizione già annullata")
    if current_status != "created":
        raise HTTPException(400, "Impossibile annullare: la spedizione è già stata affidata al corriere")

    if s.get("carrier_id") == "tnt" and s.get("is_live") and is_fedex_configured():
        account_num = s.get("carrier_code_used", "")
        sender_country = (s.get("sender") or {}).get("country", "IT")
        try:
            await cancel_fedex_shipment(
                account_number=account_num,
                tracking_number=s.get("tracking_number", ""),
                sender_country_code=sender_country,
            )
        except Exception as e:
            raise HTTPException(502, str(e))

    actor_role = user.get("role", "user")
    actor_label = (
        "Annullata dall'Agenzia (Reseller)"
        if actor_role == "reseller_admin"
        else ("Annullata dall'Amministratore" if actor_role == "super_admin" else "Annullata dal Cliente")
    )

    cancel_event = {
        "ts": now_iso(),
        "code": "cancelled",
        "label": f"Spedizione annullata prima del ritiro · {actor_label}",
        "location": (s.get("sender") or {}).get("city", ""),
    }
    await db.shipments.update_one(
        {"id": sid},
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": now_iso(),
                "cancelled_by_role": actor_role,
                "cancelled_by_name": user.get("company_name", ""),
            },
            "$push": {"tracking_events": cancel_event},
        },
    )

    owner_user = await db.users.find_one({"id": s["user_id"]})
    if owner_user and owner_user.get("role") == "user" and owner_user.get("billing_type") == "prepaid":
        refund_amount = float(s.get("price") or 0.0)
        if refund_amount > 0:
            await db.users.update_one({"id": s["user_id"]}, {"$inc": {"credit_balance": refund_amount}})
            await db.ledger.insert_one({
                "id": new_id(), "user_id": s["user_id"], "reseller_id": s.get("reseller_id"),
                "type": "shipment_refund", "amount": refund_amount,
                "note": f"Rimborso annullamento {s.get('tracking_number', '')} ({actor_label})",
                "shipment_id": sid, "created_at": now_iso(),
            })

    rid = s.get("reseller_id")
    reseller_doc = await db.resellers.find_one({"id": rid}) if rid else None
    if reseller_doc and reseller_doc.get("billing_type") == "prepaid":
        owner_contract = s.get("contract_owner", "admin" if s.get("on_master_codes", True) else "reseller")
        res_transport = float(s.get("reseller_transport_cost") or s.get("reseller_cost") or 0.0)
        fee_paid = float(s.get("applied_fee") or 0.0)
        res_refund = round(res_transport + fee_paid, 2) if owner_contract == "admin" else fee_paid
        if res_refund > 0:
            await db.resellers.update_one({"id": rid}, {"$inc": {"credit_balance": res_refund}})
            await db.users.update_many({"reseller_id": rid, "role": "reseller_admin"}, {"$inc": {"credit_balance": res_refund}})
            await db.reseller_ledger.insert_one({
                "id": new_id(), "reseller_id": rid, "shipment_id": sid,
                "created_by_role": s.get("created_by_role", "user"),
                "client_company_name": s.get("user_company_name", "") if s.get("created_by_role") == "user" else "",
                "type": "shipment_refund", "amount": res_refund,
                "note": f"Rimborso annullamento {s.get('tracking_number', '')}",
                "created_at": now_iso(),
            })

    updated = await db.shipments.find_one({"id": sid}, {"_id": 0, "label_pdf_base64": 0})
    return _sanitize_shipment_for_role(updated, user.get("role", "user"))


def _simulate_status(s: dict) -> str:
    if s.get("status") in ("cancelled", "awaiting_payment"):
        return s["status"]
    try:
        created = datetime.fromisoformat(s["created_at"])
    except Exception:
        return "created"
    age_min = (datetime.now(timezone.utc) - created).total_seconds() / 60.0
    seed = int(hashlib.md5(s["id"].encode()).hexdigest()[:2], 16) % 4
    if s.get("customs", {}).get("required") and 5 < age_min < 60 and seed == 0:
        return "in_customs"
    if age_min < 2:
        return "created"
    if age_min < 15:
        return "in_transit"
    if age_min < 60:
        return "out_for_delivery" if seed >= 2 else "in_transit"
    return "delivered"

@api_router.get("/shipments/{sid}/label")
async def download_label(sid: str, user=Depends(require_approved)):
    q = tenant_filter(user, {"id": sid})
    s = await db.shipments.find_one(q, {"_id": 0})
    if not s:
        raise HTTPException(404, "Spedizione non trovata")

    if s.get("label_pdf_base64"):
        pdf_bytes = base64.b64decode(s["label_pdf_base64"])
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=label-{s['tracking_number']}.pdf"},
        )

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A6)
    w, h = A6
    c.setFillColor(rl_colors.HexColor("#0F172A"))
    c.rect(0, h - 20 * mm, w, 20 * mm, fill=1, stroke=0)
    c.setFillColor(rl_colors.white)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(6 * mm, h - 12 * mm, f"{s['carrier_name']}")
    c.setFont("Helvetica", 9)
    c.drawRightString(w - 6 * mm, h - 12 * mm, s["tracking_number"])
    c.setFillColor(rl_colors.black)
    y = h - 30 * mm
    c.setFont("Helvetica-Bold", 8); c.drawString(6 * mm, y, "MITTENTE"); y -= 4 * mm
    c.setFont("Helvetica", 9)
    for line in [s["sender"]["company_name"], s["sender"]["address"],
                 f"{s['sender']['postal_code']} {s['sender']['city']} {s['sender'].get('province', '')} {s['sender']['country']}"]:
        c.drawString(6 * mm, y, line[:60]); y -= 4 * mm
    y -= 3 * mm
    c.setFont("Helvetica-Bold", 10); c.drawString(6 * mm, y, "DESTINATARIO"); y -= 5 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(6 * mm, y, s["recipient"]["company_name"][:40]); y -= 5 * mm
    c.setFont("Helvetica", 10)
    c.drawString(6 * mm, y, s["recipient"]["address"][:50]); y -= 4 * mm
    c.drawString(6 * mm, y, f"{s['recipient']['postal_code']} {s['recipient']['city']} {s['recipient'].get('province', '')}"); y -= 4 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(6 * mm, y, s["recipient"]["country"]); y -= 8 * mm
    c.setFont("Courier-Bold", 12)
    c.drawString(6 * mm, 12 * mm, "||| |||| || ||| |||| ||| ||||")
    c.drawString(6 * mm, 7 * mm, s["tracking_number"])
    c.setFont("Helvetica", 7)
    c.drawRightString(w - 6 * mm, 5 * mm, f"Peso: {s['billed_weight']} kg  Colli: {len(s['parcels'])}")
    c.showPage(); c.save()
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=label-{s['tracking_number']}.pdf"})

@api_router.get("/shipments/export/xlsx")
async def export_shipments(user=Depends(require_approved)):
    q = tenant_filter(user, {"status": {"$ne": "awaiting_payment"}})
    ships = await db.shipments.find(q, {"_id": 0, "label_pdf_base64": 0}).sort("created_at", -1).to_list(5000)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Spedizioni"
    headers = ["Data", "Tracking", "Corriere", "Origine", "Contratto", "Codice Usato", "Mittente", "Destinatario", "Città", "Prov.", "Nazione",
               "Colli", "Peso (kg)", "Zona", "Prezzo (€)", "Stato"]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F172A")
    for s in ships:
        owner = s.get("contract_owner", "admin" if s.get("on_master_codes", True) else "reseller")
        st = s.get("status") if (s.get("is_live") or s.get("status") == "cancelled") else _simulate_status(s)
        origin = s.get("user_company_name", "Cliente") if s.get("created_by_role") == "user" else "Reseller"
        ws.append([
            s.get("created_at", ""), s.get("tracking_number", ""), s.get("carrier_name", ""),
            origin,
            "Piattaforma" if owner == "admin" else "Proprio",
            s.get("carrier_code_used", ""),
            s.get("sender", {}).get("company_name", ""),
            s.get("recipient", {}).get("company_name", ""),
            s.get("recipient", {}).get("city", ""),
            s.get("recipient", {}).get("province", ""),
            s.get("recipient", {}).get("country", ""),
            len(s.get("parcels", [])), s.get("billed_weight", 0),
            s.get("zone", ""), s.get("price", 0), st,
        ])
    for i, _ in enumerate(ws.columns, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = 18
    buf = io.BytesIO()
    wb.save(buf); buf.seek(0)
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=spedizioni.xlsx"})

@api_router.get("/wallet/balance")
async def wallet_balance(user=Depends(require_approved)):
    if user.get("role") == "reseller_admin" and user.get("reseller_id"):
        res = await db.resellers.find_one({"id": user["reseller_id"]}, {"_id": 0})
        ledger = await db.reseller_ledger.find({"reseller_id": user["reseller_id"]}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)

        ship_ids = list({m.get("shipment_id") for m in ledger if m.get("shipment_id")})
        ship_map: Dict[str, Dict[str, Any]] = {}
        if ship_ids:
            s_docs = await db.shipments.find(
                {"id": {"$in": ship_ids}},
                {"_id": 0, "id": 1, "user_id": 1, "created_by_role": 1, "user_company_name": 1},
            ).to_list(500)
            u_ids = list({x.get("user_id") for x in s_docs if x.get("user_id")})
            u_docs = await db.users.find({"id": {"$in": u_ids}}, {"_id": 0, "id": 1, "role": 1, "company_name": 1}).to_list(500) if u_ids else []
            u_map = {u["id"]: u for u in u_docs}
            for x in s_docs:
                u_info = u_map.get(x.get("user_id")) or {}
                ship_map[x["id"]] = {
                    "role": u_info.get("role") or x.get("created_by_role", "user"),
                    "company_name": u_info.get("company_name") or x.get("user_company_name", ""),
                }

        for m in ledger:
            sid = m.get("shipment_id")
            if sid and sid in ship_map:
                m["created_by_role"] = ship_map[sid]["role"]
                if ship_map[sid]["role"] == "user":
                    m["client_company_name"] = ship_map[sid]["company_name"]

        return {
            "balance": float((res or {}).get("credit_balance") or 0.0),
            "ledger": ledger,
            "billing_type": (res or {}).get("billing_type", "prepaid"),
        }
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password": 0})
    ledger = await db.ledger.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"balance": u.get("credit_balance", 0.0), "ledger": ledger,
            "billing_type": u.get("billing_type", "instant")}

@api_router.get("/wallet/packages")
async def wallet_packages(_=Depends(require_approved)):
    return [{"id": k, **v} for k, v in CREDIT_PACKAGES.items()]

@api_router.post("/wallet/topup")
async def wallet_topup(inp: TopUpRequest, user=Depends(require_approved)):
    if not stripe.api_key:
        raise HTTPException(400, "Chiave Stripe non configurata in backend/.env")
    pkg = CREDIT_PACKAGES.get(inp.package_id)
    if not pkg:
        raise HTTPException(400, "Pacchetto non valido")
    success_url = f"{inp.origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{inp.origin_url}/payment/cancel"
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{"price_data": {"currency": "eur", "product_data": {"name": pkg["name"]}, "unit_amount": int(pkg["amount"] * 100)}, "quantity": 1}],
            success_url=success_url, cancel_url=cancel_url,
            metadata={"user_id": user["id"], "package_id": inp.package_id, "amount": str(pkg["amount"])},
        )
    except Exception as e:
        raise HTTPException(500, f"Errore Stripe: {e}")
    await db.payment_transactions.insert_one({
        "session_id": session.id, "user_id": user["id"], "reseller_id": user.get("reseller_id"),
        "package_id": inp.package_id, "amount": pkg["amount"], "currency": "eur",
        "status": "initiated", "payment_status": "pending",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"checkout_url": session.url, "session_id": session.id}

@api_router.get("/payments/status/{session_id}")
async def payment_status(session_id: str, user=Depends(get_current_user)):
    rec = await db.payment_transactions.find_one({"session_id": session_id, "user_id": user["id"]}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Transazione non trovata")

    kind = rec.get("kind", "wallet_topup")

    if rec.get("payment_status") != "paid" and stripe.api_key:
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                result = await db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso()}},
                )
                if result.modified_count > 0:
                    if kind == "shipment_instant" and rec.get("shipment_id"):
                        ship = await db.shipments.find_one({"id": rec["shipment_id"]})
                        owner = await db.users.find_one({"id": rec["user_id"]})
                        if ship and owner:
                            ship = await _dispatch_shipment_to_carrier_and_bill(ship, owner)
                            await _issue_single_shipment_invoice(ship)
                    else:
                        amount = rec.get("amount", 0.0)
                        u_doc = await db.users.find_one({"id": rec["user_id"]})
                        if u_doc and u_doc.get("role") == "reseller_admin" and u_doc.get("reseller_id"):
                            await db.resellers.update_one({"id": u_doc["reseller_id"]}, {"$inc": {"credit_balance": amount}})
                            await db.users.update_many({"reseller_id": u_doc["reseller_id"], "role": "reseller_admin"}, {"$inc": {"credit_balance": amount}})
                            await db.reseller_ledger.insert_one({
                                "id": new_id(), "reseller_id": u_doc["reseller_id"],
                                "type": "stripe_topup", "amount": amount, "note": "Ricarica online", "created_at": now_iso()
                            })
                        else:
                            await db.users.update_one({"id": rec["user_id"]}, {"$inc": {"credit_balance": amount}})
                            await db.ledger.insert_one({
                                "id": new_id(), "user_id": rec["user_id"], "reseller_id": rec.get("reseller_id"),
                                "type": "topup", "amount": amount, "note": "Ricarica online", "session_id": session_id, "created_at": now_iso()
                            })
                rec = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Stripe status error: %s", e)

    resp_payload: Dict[str, Any] = {
        "session_id": rec["session_id"],
        "kind": kind,
        "status": rec["status"],
        "payment_status": rec["payment_status"],
        "amount": rec.get("amount", 0),
    }
    if kind == "shipment_instant" and rec.get("shipment_id"):
        ship = await db.shipments.find_one({"id": rec["shipment_id"]}, {"_id": 0, "label_pdf_base64": 0, "_pending_etd_docs": 0})
        if ship:
            resp_payload["shipment"] = _sanitize_shipment_for_role(ship, user.get("role", "user"))
    return resp_payload

@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Invalid signature")
    obj = event["data"]["object"]
    if event["type"] == "checkout.session.completed":
        result = await db.payment_transactions.update_one(
            {"session_id": obj["id"], "payment_status": {"$ne": "paid"}},
            {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso()}}
        )
        if result.modified_count > 0:
            rec = await db.payment_transactions.find_one({"session_id": obj["id"]})
            if rec:
                if rec.get("kind") == "shipment_instant" and rec.get("shipment_id"):
                    ship = await db.shipments.find_one({"id": rec["shipment_id"]})
                    owner = await db.users.find_one({"id": rec["user_id"]})
                    if ship and owner:
                        ship = await _dispatch_shipment_to_carrier_and_bill(ship, owner)
                        await _issue_single_shipment_invoice(ship)
                else:
                    await db.users.update_one({"id": rec["user_id"]}, {"$inc": {"credit_balance": rec["amount"]}})
                    await db.ledger.insert_one({
                        "id": new_id(), "user_id": rec["user_id"], "reseller_id": rec.get("reseller_id"),
                        "type": "topup", "amount": rec["amount"], "note": "Ricarica online", "session_id": obj["id"], "created_at": now_iso()
                    })
    return {"status": "ok"}

@api_router.get("/invoices")
async def list_invoices(user=Depends(require_approved)):
    return await db.invoices.find(tenant_filter(user), {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.post("/admin/invoices/generate/{user_id}")
async def generate_invoice(user_id: str, admin=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "Utente non trovato")
    if admin.get("role") == "reseller_admin" and target.get("reseller_id") != admin.get("reseller_id"):
        raise HTTPException(403, "Utente di altro reseller")
    ships = await db.shipments.find(
        {"user_id": user_id, "invoice_id": {"$exists": False}, "status": {"$nin": ["cancelled", "awaiting_payment"]}},
        {"_id": 0, "label_pdf_base64": 0}
    ).to_list(1000)
    if not ships:
        raise HTTPException(400, "Nessuna spedizione da fatturare")
    total = sum(s["price"] for s in ships)
    invoice_number = f"FT-{datetime.now(timezone.utc).strftime('%Y%m')}-{random.randint(1000,9999)}"
    invoice = {
        "id": new_id(), "user_id": user_id, "reseller_id": target.get("reseller_id"),
        "invoice_number": invoice_number, "shipment_ids": [s["id"] for s in ships],
        "total": round(total, 2), "vat": round(total * 0.22, 2), "grand_total": round(total * 1.22, 2),
        "created_at": now_iso(), "status": "issued",
    }
    await db.invoices.insert_one(invoice)
    await db.shipments.update_many({"id": {"$in": [s["id"] for s in ships]}}, {"$set": {"invoice_id": invoice["id"]}})
    invoice.pop("_id", None)
    return invoice

@api_router.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, user=Depends(require_approved)):
    inv = await db.invoices.find_one(tenant_filter(user, {"id": iid}), {"_id": 0})
    if not inv:
        raise HTTPException(404, "Fattura non trovata")
    ships = await db.shipments.find({"id": {"$in": inv["shipment_ids"]}}, {"_id": 0, "label_pdf_base64": 0}).to_list(1000)
    u = await db.users.find_one({"id": inv["user_id"]}, {"_id": 0, "password": 0})
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    c.setFillColor(rl_colors.HexColor("#0F172A")); c.rect(0, H - 30 * mm, W, 30 * mm, fill=1, stroke=0)
    c.setFillColor(rl_colors.HexColor("#EA580C")); c.rect(0, H - 30 * mm, 4 * mm, 30 * mm, fill=1, stroke=0)
    c.setFillColor(rl_colors.white); c.setFont("Helvetica-Bold", 20); c.drawString(15 * mm, H - 15 * mm, "FATTURA")
    c.setFont("Helvetica", 11); c.drawString(15 * mm, H - 22 * mm, f"N. {inv['invoice_number']}")
    c.drawRightString(W - 15 * mm, H - 15 * mm, "SpedPortal S.r.l.")
    c.setFont("Helvetica", 9); c.drawRightString(W - 15 * mm, H - 22 * mm, f"Data: {inv['created_at'][:10]}")
    c.setFillColor(rl_colors.black); y = H - 45 * mm
    c.setFont("Helvetica-Bold", 10); c.drawString(15 * mm, y, "Cliente:"); y -= 5 * mm
    c.setFont("Helvetica", 10); c.drawString(15 * mm, y, (u or {}).get("company_name", "")); y -= 4 * mm
    c.drawString(15 * mm, y, (u or {}).get("email", "")); y -= 10 * mm
    c.setFont("Helvetica-Bold", 9); c.setFillColor(rl_colors.HexColor("#F1F5F9"))
    c.rect(15 * mm, y - 2, W - 30 * mm, 6 * mm, fill=1, stroke=0); c.setFillColor(rl_colors.black)
    c.drawString(17 * mm, y, "Data"); c.drawString(38 * mm, y, "Tracking"); c.drawString(72 * mm, y, "Corriere")
    c.drawString(100 * mm, y, "Destinatario"); c.drawRightString(W - 17 * mm, y, "Prezzo €"); y -= 6 * mm
    c.setFont("Helvetica", 8)
    for s in ships:
        if y < 40 * mm:
            c.showPage(); y = H - 20 * mm
        c.drawString(17 * mm, y, s.get("created_at", "")[:10])
        c.drawString(38 * mm, y, s.get("tracking_number", ""))
        c.drawString(72 * mm, y, s.get("carrier_name", "")[:14])
        c.drawString(100 * mm, y, s.get("recipient", {}).get("company_name", "")[:28])
        c.drawRightString(W - 17 * mm, y, f"{s.get('price', 0):.2f}"); y -= 5 * mm
    y -= 4 * mm; c.setFont("Helvetica-Bold", 10)
    c.drawRightString(W - 40 * mm, y, "Imponibile:"); c.drawRightString(W - 17 * mm, y, f"€ {inv['total']:.2f}"); y -= 5 * mm
    c.drawRightString(W - 40 * mm, y, "IVA 22%:"); c.drawRightString(W - 17 * mm, y, f"€ {inv['vat']:.2f}"); y -= 5 * mm
    c.setFont("Helvetica-Bold", 12); c.setFillColor(rl_colors.HexColor("#EA580C"))
    c.drawRightString(W - 40 * mm, y, "TOTALE:"); c.drawRightString(W - 17 * mm, y, f"€ {inv['grand_total']:.2f}")
    c.showPage(); c.save(); buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={inv['invoice_number']}.pdf"})

@app.on_event("startup")
async def bootstrap():
    admin = await db.users.find_one({"email": "admin@spedportal.it"})
    if not admin:
        await db.users.insert_one({
            "id": new_id(), "email": "admin@spedportal.it", "password": hash_pw("Admin@2026"),
            "company_name": "SpedPortal Admin", "phone": "", "role": "super_admin",
            "reseller_id": None, "status": "approved", "billing_type": "postpaid",
            "rate_table_id": None, "credit_balance": 0.0, "created_at": now_iso(),
        })
        logger.info("Super Admin seeded: admin@spedportal.it / Admin@2026")
    await bootstrap_multitenant()
    all_resellers = await db.resellers.find({}, {"_id": 0, "id": 1}).to_list(1000)
    for r in all_resellers:
        await ensure_reseller_standard_rate_table(r["id"])

@api_router.get("/")
async def root():
    return {"service": "SpedPortal API", "status": "ok", "fedex_live": is_fedex_configured()}

app.include_router(api_router)
from extras import extra_router
from mail import (
    mail_router, send_email, tpl_registration, tpl_approved,
    tpl_new_client_admin_alert, get_reseller_notification_email, FRONTEND_URL,
)
from tenancy import super_router, reseller_router, bootstrap_multitenant
app.include_router(extra_router)
app.include_router(mail_router)
app.include_router(super_router)
app.include_router(reseller_router)

app.add_middleware(
    CORSMiddleware, allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"], allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
