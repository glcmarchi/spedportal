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
    billing_type: str = "postpaid"
    rate_table_id: Optional[str] = None

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

class ValidateAddressInput(BaseModel):
    carrier_id: str
    address: Address

class PickupRequestInput(BaseModel):
    pickup_date: str
    ready_time: str = "10:00"
    close_time: str = "18:00"
    remarks: Optional[str] = ""

class UpdateUserInput(BaseModel):
    billing_type: Optional[str] = None
    rate_table_id: Optional[str] = None
    status: Optional[str] = None

class RateBand(BaseModel):
    zone: str
    min_weight: float = Field(ge=0)
    max_weight: float = Field(gt=0)
    markup_percent: float = Field(ge=0)

class RateTableInput(BaseModel):
    name: str
    bands: List[RateBand]

class TopUpRequest(BaseModel):
    package_id: str
    origin_url: str

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
    user = {
        "id": new_id(),
        "email": inp.email.lower(),
        "password": hash_pw(inp.password),
        "company_name": inp.company_name,
        "phone": inp.phone or "",
        "role": "user",
        "reseller_id": reseller_id,
        "status": "pending",
        "billing_type": "postpaid",
        "rate_table_id": None,
        "credit_balance": 0.0,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    try:
        await send_email(to=user["email"], subject="SpedPortal · Richiesta ricevuta",
                         html=tpl_registration(user["company_name"]))
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
            "billing_type": user.get("billing_type", "postpaid"),
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
        user["features"] = (res or {}).get("features", {})
        user["enabled_surcharges"] = (res or {}).get("enabled_surcharges") or {
            "insurance": True, "cod": True, "saturday_delivery": True,
            "neutral_delivery": True, "residential_delivery": True,
        }
        user["allow_ddp"] = bool((res or {}).get("allow_ddp", False))
        user["reseller_name"] = (res or {}).get("company_name", "")
        user["reseller_slug"] = (res or {}).get("slug", "")
        user["reseller_plan"] = (res or {}).get("plan", "basic")
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
            user["billing_type"] = (res or {}).get("billing_type", user.get("billing_type", "prepaid"))
            user["credit_balance"] = float((res or {}).get("credit_balance") or user.get("credit_balance") or 0.0)
        policies = (res or {}).get("carrier_policies") or {}
        user["can_manage_own_carriers"] = any(p in ("reseller_only", "hybrid") for p in policies.values())
    return user

@api_router.get("/admin/users")
async def list_users(user=Depends(require_admin)):
    q = {"role": "user"}
    if user.get("role") == "reseller_admin":
        q["reseller_id"] = user["reseller_id"]
    return await db.users.find(q, {"_id": 0, "password": 0}).to_list(1000)

@api_router.post("/admin/users")
async def create_client_user(inp: CreateClientInput, admin=Depends(require_admin)):
    if await db.users.find_one({"email": inp.email.lower()}):
        raise HTTPException(400, "Email già registrata")
    rid = admin.get("reseller_id")
    if not rid:
        demo = await db.resellers.find_one({"active": True})
        rid = demo["id"] if demo else None
    doc = {
        "id": new_id(),
        "email": inp.email.lower(),
        "password": hash_pw(inp.password),
        "company_name": inp.company_name,
        "phone": inp.phone or "",
        "role": "user",
        "reseller_id": rid,
        "status": "approved",
        "billing_type": inp.billing_type if inp.billing_type in ("prepaid", "postpaid") else "postpaid",
        "rate_table_id": inp.rate_table_id,
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

def _validate_bands(bands: List[RateBand]):
    for b in bands:
        if b.min_weight < 0:
            raise HTTPException(400, "Il peso minimo non può essere negativo")
        if b.max_weight <= b.min_weight:
            raise HTTPException(400, "Il peso massimo deve essere maggiore del peso minimo")

@api_router.get("/admin/rate-tables")
async def list_rate_tables(user=Depends(require_admin)):
    q = {} if user.get("role") == "super_admin" else {"reseller_id": user.get("reseller_id")}
    return await db.rate_tables.find(q, {"_id": 0}).to_list(500)

@api_router.post("/admin/rate-tables")
async def create_rate_table(inp: RateTableInput, user=Depends(require_admin)):
    _validate_bands(inp.bands)
    doc = {"id": new_id(), "reseller_id": user.get("reseller_id"),
           "name": inp.name, "bands": [b.model_dump() for b in inp.bands],
           "created_at": now_iso()}
    await db.rate_tables.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/admin/rate-tables/{tid}")
async def update_rate_table(tid: str, inp: RateTableInput, user=Depends(require_admin)):
    _validate_bands(inp.bands)
    q = {"id": tid} if user.get("role") == "super_admin" else {"id": tid, "reseller_id": user.get("reseller_id")}
    r = await db.rate_tables.update_one(q, {"$set": {
        "name": inp.name, "bands": [b.model_dump() for b in inp.bands]
    }})
    if r.matched_count == 0:
        raise HTTPException(404, "Listino non trovato")
    return {"ok": True}

@api_router.delete("/admin/rate-tables/{tid}")
async def delete_rate_table(tid: str, user=Depends(require_admin)):
    q = {"id": tid} if user.get("role") == "super_admin" else {"id": tid, "reseller_id": user.get("reseller_id")}
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
        ins = round(max(3.5,
