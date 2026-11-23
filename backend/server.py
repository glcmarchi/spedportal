from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, io, uuid, logging, random, string, hashlib
from pathlib import Path
from pydantic import BaseModel, EmailStr
from typing import List, Optional
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

class LoginInput(BaseModel):
    email: EmailStr
    password: str

class Address(BaseModel):
    company_name: str
    address: str
    postal_code: str
    city: str
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

class CustomsDocs(BaseModel):
    required: bool = False
    proforma_name: Optional[str] = ""
    dae_name: Optional[str] = ""

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

class UpdateUserInput(BaseModel):
    billing_type: Optional[str] = None
    rate_table_id: Optional[str] = None
    status: Optional[str] = None

class RateBand(BaseModel):
    zone: str
    min_weight: float
    max_weight: float
    markup_percent: float

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
            "customs": True, "insurance": True, "prepaid": True, "manifests": True,
            "address_book": True, "parcels": True, "broadcasts": True,
            "premium_own_carriers": True,
        }
    elif rid:
        res = await db.resellers.find_one({"id": rid}, {"_id": 0, "features": 1, "company_name": 1})
        user["features"] = (res or {}).get("features", {})
        user["reseller_name"] = (res or {}).get("company_name", "")
    return user

@api_router.get("/admin/users")
async def list_users(user=Depends(require_admin)):
    q = {"role": "user"}
    if user.get("role") == "reseller_admin":
        q["reseller_id"] = user["reseller_id"]
    return await db.users.find(q, {"_id": 0, "password": 0}).to_list(1000)

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

@api_router.get("/admin/rate-tables")
async def list_rate_tables(user=Depends(require_admin)):
    q = {} if user.get("role") == "super_admin" else {"reseller_id": user.get("reseller_id")}
    return await db.rate_tables.find(q, {"_id": 0}).to_list(500)

@api_router.post("/admin/rate-tables")
async def create_rate_table(inp: RateTableInput, user=Depends(require_admin)):
    doc = {"id": new_id(), "reseller_id": user.get("reseller_id"),
           "name": inp.name, "bands": [b.model_dump() for b in inp.bands],
           "created_at": now_iso()}
    await db.rate_tables.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/admin/rate-tables/{tid}")
async def update_rate_table(tid: str, inp: RateTableInput, user=Depends(require_admin)):
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
    {"id": "tnt", "name": "TNT (FedEx)", "logo": "TNT", "color": "#ff6600"},
    {"id": "poste", "name": "Poste Italiane", "logo": "PI", "color": "#003399"},
]

@api_router.get("/carriers")
async def list_carriers(_=Depends(require_approved)):
    return MOCK_CARRIERS

def _zone_of(sender: Address, recipient: Address) -> str:
    s = (sender.country or "IT").upper()
    r = (recipient.country or "IT").upper()
    if s == "IT" and r == "IT":
        try:
            fd = int((recipient.postal_code or "0")[0])
        except Exception:
            fd = 0
        zone = "A" if fd <= 3 else ("B" if fd <= 6 else "C")
        return f"NAZ-{zone}"
    return f"INT-{r}"

def _mock_carrier_cost(carrier_id: str, weight: float, zone: str, parcels_count: int) -> float:
    base_map = {"brt": 4.5, "gls": 4.8, "dhl": 12.0, "ups": 11.0, "tnt": 10.5, "poste": 5.2}
    base = base_map.get(carrier_id, 8.0)
    intl_mult = 2.4 if zone.startswith("INT") else 1.0
    cost = (base + weight * 0.85) * intl_mult * max(1, parcels_count) * 0.9
    seed = int(hashlib.md5((carrier_id + zone).encode()).hexdigest()[:4], 16) / 65535
    cost *= (0.9 + 0.25 * seed)
    return round(cost, 2)

async def _price_with_markup(user: dict, cost: float, weight: float, zone: str) -> float:
    default_markup = 20.0
    rate_table_id = user.get("rate_table_id")
    if rate_table_id:
        table = await db.rate_tables.find_one({"id": rate_table_id}, {"_id": 0})
        if table:
            for band in table.get("bands", []):
                if band["zone"] == zone and band["min_weight"] <= weight <= band["max_weight"]:
                    return round(cost * (1 + band["markup_percent"] / 100.0), 2)
    return round(cost * (1 + default_markup / 100.0), 2)

@api_router.post("/shipments/quote")
async def quote_shipment(q: QuoteRequest, user=Depends(require_approved)):
    total_weight = sum(p.weight for p in q.parcels)
    vol_weight = sum((p.length * p.width * p.height) / 5000.0 for p in q.parcels)
    billed_weight = max(total_weight, vol_weight)
    zone = _zone_of(q.sender, q.recipient)
    quotes = []
    for c in MOCK_CARRIERS:
        cost = _mock_carrier_cost(c["id"], billed_weight, zone, len(q.parcels))
        service_extra = 0.0
        if q.services.insurance:
            service_extra += max(3.0, q.services.insurance_value * 0.008)
        if q.services.neutral_delivery:
            service_extra += 2.0
        if q.customs.required:
            cost += 8.0
        cost += service_extra
        price = await _price_with_markup(user, cost, billed_weight, zone)
        transit = 1 if zone.startswith("NAZ") else (3 if c["id"] in ["dhl", "ups", "tnt"] else 5)
        quotes.append({
            "carrier_id": c["id"], "carrier_name": c["name"], "color": c["color"],
            "cost": cost, "price": price, "transit_days": transit,
            "billed_weight": round(billed_weight, 2), "zone": zone,
        })
    quotes.sort(key=lambda x: x["price"])
    return {"quotes": quotes, "billed_weight": round(billed_weight, 2), "zone": zone}

def _tracking_number(carrier_id: str) -> str:
    return f"{carrier_id.upper()}{''.join(random.choices(string.digits, k=10))}"

@api_router.post("/shipments")
async def create_shipment(inp: CreateShipmentInput, user=Depends(require_approved)):
    quotes = await quote_shipment(inp.quote, user)
    chosen = next((q for q in quotes["quotes"] if q["carrier_id"] == inp.carrier_id), None)
    if not chosen:
        raise HTTPException(400, "Corriere non valido")
    price = chosen["price"]
    cost = chosen["cost"]
    if user.get("billing_type") == "prepaid":
        bal = user.get("credit_balance", 0.0)
        if bal < price:
            raise HTTPException(402, "Credito insufficiente. Ricarica il tuo saldo prepagato.")
    shipment = {
        "id": new_id(),
        "user_id": user["id"],
        "reseller_id": user.get("reseller_id"),
        "on_master_codes": True,
        "tracking_number": _tracking_number(inp.carrier_id),
        "carrier_id": inp.carrier_id,
        "carrier_name": chosen["carrier_name"],
        "sender": inp.quote.sender.model_dump(),
        "recipient": inp.quote.recipient.model_dump(),
        "parcel_type": inp.quote.parcel_type,
        "parcels": [p.model_dump() for p in inp.quote.parcels],
        "goods_description": inp.quote.goods_description,
        "customs": inp.quote.customs.model_dump(),
        "services": inp.quote.services.model_dump(),
        "billed_weight": chosen["billed_weight"],
        "zone": chosen["zone"],
        "cost": cost,
        "price": price,
        "status": "created",
        "tracking_events": [{"ts": now_iso(), "code": "created", "label": "Spedizione creata"}],
        "created_at": now_iso(),
    }
    await db.shipments.insert_one(shipment)
    if user.get("billing_type") == "prepaid":
        await db.users.update_one({"id": user["id"]}, {"$inc": {"credit_balance": -price}})
        await db.ledger.insert_one({
            "id": new_id(), "user_id": user["id"], "reseller_id": user.get("reseller_id"),
            "type": "shipment_charge", "amount": -price, "shipment_id": shipment["id"], "created_at": now_iso()
        })
    shipment.pop("_id", None)
    return shipment

@api_router.get("/shipments")
async def list_shipments(user=Depends(require_approved)):
    q = tenant_filter(user)
    ships = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for s in ships:
        s["status"] = _simulate_status(s)
    return ships

@api_router.get("/shipments/{sid}")
async def get_shipment(sid: str, user=Depends(require_approved)):
    q = tenant_filter(user, {"id": sid})
    s = await db.shipments.find_one(q, {"_id": 0})
    if not s:
        raise HTTPException(404, "Spedizione non trovata")
    s["status"] = _simulate_status(s)
    return s

def _simulate_status(s: dict) -> str:
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
                 f"{s['sender']['postal_code']} {s['sender']['city']} {s['sender']['country']}"]:
        c.drawString(6 * mm, y, line[:60]); y -= 4 * mm
    y -= 3 * mm
    c.setFont("Helvetica-Bold", 10); c.drawString(6 * mm, y, "DESTINATARIO"); y -= 5 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(6 * mm, y, s["recipient"]["company_name"][:40]); y -= 5 * mm
    c.setFont("Helvetica", 10)
    c.drawString(6 * mm, y, s["recipient"]["address"][:50]); y -= 4 * mm
    c.drawString(6 * mm, y, f"{s['recipient']['postal_code']} {s['recipient']['city']}"); y -= 4 * mm
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
    q = tenant_filter(user)
    ships = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Spedizioni"
    headers = ["Data", "Tracking", "Corriere", "Mittente", "Destinatario", "Città", "Nazione",
               "Colli", "Peso (kg)", "Zona", "Prezzo (€)", "Stato"]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F172A")
    for s in ships:
        ws.append([
            s.get("created_at", ""), s.get("tracking_number", ""), s.get("carrier_name", ""),
            s.get("sender", {}).get("company_name", ""),
            s.get("recipient", {}).get("company_name", ""),
            s.get("recipient", {}).get("city", ""),
            s.get("recipient", {}).get("country", ""),
            len(s.get("parcels", [])), s.get("billed_weight", 0),
            s.get("zone", ""), s.get("price", 0), _simulate_status(s),
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
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password": 0})
    ledger = await db.ledger.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"balance": u.get("credit_balance", 0.0), "ledger": ledger,
            "billing_type": u.get("billing_type", "postpaid")}

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
    if rec.get("payment_status") != "paid" and stripe.api_key:
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                result = await db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {"status": "completed", "payment_status": "paid", "updated_at": now_iso()}},
                )
                if result.modified_count > 0:
                    amount = rec.get("amount", 0.0)
                    await db.users.update_one({"id": rec["user_id"]}, {"$inc": {"credit_balance": amount}})
                    await db.ledger.insert_one({
                        "id": new_id(), "user_id": rec["user_id"], "reseller_id": rec.get("reseller_id"),
                        "type": "topup", "amount": amount, "session_id": session_id, "created_at": now_iso()
                    })
                rec = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        except Exception as e:
            logger.exception("Stripe status error: %s", e)
    return {"session_id": rec["session_id"], "status": rec["status"],
            "payment_status": rec["payment_status"], "amount": rec.get("amount", 0)}

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
                await db.users.update_one({"id": rec["user_id"]}, {"$inc": {"credit_balance": rec["amount"]}})
                await db.ledger.insert_one({
                    "id": new_id(), "user_id": rec["user_id"], "reseller_id": rec.get("reseller_id"),
                    "type": "topup", "amount": rec["amount"], "session_id": obj["id"], "created_at": now_iso()
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
    ships = await db.shipments.find({"user_id": user_id, "invoice_id": {"$exists": False}}, {"_id": 0}).to_list(1000)
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
    ships = await db.shipments.find({"id": {"$in": inv["shipment_ids"]}}, {"_id": 0}).to_list(1000)
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
    if await db.rate_tables.count_documents({}) == 0:
        demo = await db.resellers.find_one({"company_name": "SpedPortal Demo"})
        await db.rate_tables.insert_one({
            "id": new_id(), "reseller_id": demo["id"] if demo else None, "name": "Listino Standard",
            "bands": [
                {"zone": "NAZ-A", "min_weight": 0, "max_weight": 999, "markup_percent": 20},
                {"zone": "NAZ-B", "min_weight": 0, "max_weight": 999, "markup_percent": 25},
                {"zone": "NAZ-C", "min_weight": 0, "max_weight": 999, "markup_percent": 30},
                {"zone": "INT-FR", "min_weight": 0, "max_weight": 3, "markup_percent": 50},
                {"zone": "INT-FR", "min_weight": 3, "max_weight": 10, "markup_percent": 80},
                {"zone": "INT-DE", "min_weight": 0, "max_weight": 10, "markup_percent": 55},
            ],
            "created_at": now_iso(),
        })

@api_router.get("/")
async def root():
    return {"service": "SpedPortal API", "status": "ok"}

app.include_router(api_router)
from extras import extra_router
from mail import mail_router, send_email, tpl_registration, tpl_approved, FRONTEND_URL
from tenancy import super_router, bootstrap_multitenant
app.include_router(extra_router)
app.include_router(mail_router)
app.include_router(super_router)

app.add_middleware(
    CORSMiddleware, allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"], allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
