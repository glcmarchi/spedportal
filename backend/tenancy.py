from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional, Dict
from server import db, get_current_user, hash_pw, new_id, now_iso, logger

super_router = APIRouter(prefix="/api/super")

DEFAULT_FEATURES = {
    "customs": True, "insurance": True, "prepaid": True, "manifests": True,
    "address_book": True, "parcels": True, "broadcasts": True,
    "premium_own_carriers": False,
}
DEFAULT_CARRIERS = ["brt", "gls", "dhl", "ups", "tnt", "poste"]

async def require_super_admin(user=Depends(get_current_user)):
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    return user

class ResellerInput(BaseModel):
    company_name: str
    slug: Optional[str] = None
    admin_email: EmailStr
    admin_password: Optional[str] = None
    plan: str = "basic"
    features: Optional[Dict[str, bool]] = None
    carrier_credentials: Optional[Dict[str, Dict[str, str]]] = None
    per_shipment_fee: float = 0.0
    active: bool = True

@super_router.post("/resellers")
async def create_reseller(inp: ResellerInput, _=Depends(require_super_admin)):
    if await db.resellers.find_one({"admin_email": inp.admin_email.lower()}):
        raise HTTPException(400, "Admin email già utilizzata")
    rid = new_id()
    slug = (inp.slug or inp.company_name.lower().replace(" ", "-"))
    features = {**DEFAULT_FEATURES, **(inp.features or {})}
    reseller = {
        "id": rid, "company_name": inp.company_name, "slug": slug,
        "admin_email": inp.admin_email.lower(), "plan": inp.plan,
        "features": features, "carrier_credentials": inp.carrier_credentials or {},
        "per_shipment_fee": inp.per_shipment_fee, "active": inp.active, "created_at": now_iso(),
    }
    await db.resellers.insert_one(reseller)
    pw = inp.admin_password or new_id()[:12]
    await db.users.insert_one({
        "id": new_id(), "email": inp.admin_email.lower(), "password": hash_pw(pw),
        "company_name": inp.company_name, "phone": "", "role": "reseller_admin",
        "reseller_id": rid, "status": "approved", "billing_type": "postpaid",
        "credit_balance": 0.0, "created_at": now_iso(),
    })
    reseller.pop("_id", None)
    return {"reseller": reseller, "admin_credentials": {"email": inp.admin_email, "password": pw}}

@super_router.get("/resellers")
async def list_resellers(_=Depends(require_super_admin)):
    items = await db.resellers.find({}, {"_id": 0}).to_list(1000)
    for r in items:
        r["user_count"] = await db.users.count_documents({"reseller_id": r["id"], "role": "user"})
        r["shipment_count"] = await db.shipments.count_documents({"reseller_id": r["id"]})
    return items

@super_router.patch("/resellers/{rid}")
async def update_reseller(rid: str, inp: ResellerInput, _=Depends(require_super_admin)):
    doc = inp.model_dump(exclude_unset=True)
    doc.pop("admin_email", None); doc.pop("admin_password", None)
    if "features" in doc and doc["features"]:
        doc["features"] = {**DEFAULT_FEATURES, **doc["features"]}
    r = await db.resellers.update_one({"id": rid}, {"$set": doc})
    if r.matched_count == 0:
        raise HTTPException(404, "Non trovato")
    return {"ok": True}

@super_router.get("/resellers/{rid}/billing")
async def reseller_billing(rid: str, _=Depends(require_super_admin)):
    res = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not res:
        raise HTTPException(404)
    ships = await db.shipments.find({"reseller_id": rid}, {"_id": 0, "cost": 1, "price": 1, "on_master_codes": 1}).to_list(10000)
    on_master = [s for s in ships if s.get("on_master_codes", True)]
    on_own = [s for s in ships if not s.get("on_master_codes", True)]
    due_standard = round(sum(s.get("cost", 0) for s in on_master), 2)
    due_premium = round(len(on_own) * (res.get("per_shipment_fee") or 0), 2)
    return {"reseller": res, "shipments_on_master": len(on_master), "shipments_on_own": len(on_own),
            "amount_due_standard": due_standard, "amount_due_premium": due_premium,
            "amount_due_total": round(due_standard + due_premium, 2)}

@super_router.get("/me/features")
async def my_features(user=Depends(get_current_user)):
    if user.get("role") == "super_admin":
        return {"features": {**DEFAULT_FEATURES, "premium_own_carriers": True}, "role": "super_admin"}
    rid = user.get("reseller_id")
    if not rid:
        return {"features": DEFAULT_FEATURES, "role": user.get("role")}
    res = await db.resellers.find_one({"id": rid}, {"_id": 0, "features": 1, "company_name": 1, "plan": 1})
    features = {**DEFAULT_FEATURES, **((res or {}).get("features") or {})}
    return {"features": features, "role": user.get("role"),
            "reseller": {"company_name": (res or {}).get("company_name", ""), "plan": (res or {}).get("plan", "basic")}}

async def bootstrap_multitenant():
    await db.users.update_one({"email": "admin@spedportal.it"}, {"$set": {"role": "super_admin", "reseller_id": None}})
    demo = await db.resellers.find_one({"company_name": "SpedPortal Demo"})
    if not demo:
        demo_id = new_id()
        await db.resellers.insert_one({
            "id": demo_id, "company_name": "SpedPortal Demo", "slug": "demo",
            "admin_email": "reseller@spedportal.it", "plan": "full",
            "features": {**DEFAULT_FEATURES, "premium_own_carriers": False},
            "carrier_credentials": {c: {"account": f"MASTER-{c.upper()}", "password": "***", "code": f"MST{c.upper()}001"} for c in DEFAULT_CARRIERS},
            "per_shipment_fee": 0.15, "active": True, "created_at": now_iso(),
        })
        if not await db.users.find_one({"email": "reseller@spedportal.it"}):
            await db.users.insert_one({
                "id": new_id(), "email": "reseller@spedportal.it", "password": hash_pw("Reseller@2026"),
                "company_name": "SpedPortal Demo", "phone": "", "role": "reseller_admin", "reseller_id": demo_id,
                "status": "approved", "billing_type": "postpaid", "credit_balance": 0.0, "created_at": now_iso(),
            })
        logger.info("Demo reseller seeded: reseller@spedportal.it / Reseller@2026")
    else:
        demo_id = demo["id"]
    for coll in ["users", "shipments", "invoices", "rate_tables", "addressbook",
                 "saved_parcels", "support_tickets", "broadcasts", "broadcast_reads",
                 "manifests", "ledger", "payment_transactions", "bank_transfers"]:
        c = db[coll]
        if coll == "users":
            await c.update_many({"role": {"$in": ["user", "reseller_admin"]}, "reseller_id": {"$exists": False}}, {"$set": {"reseller_id": demo_id}})
            await c.update_many({"role": "admin"}, {"$set": {"role": "reseller_admin", "reseller_id": demo_id}})
        else:
            await c.update_many({"reseller_id": {"$exists": False}}, {"$set": {"reseller_id": demo_id}})
    await db.shipments.update_many({"on_master_codes": {"$exists": False}}, {"$set": {"on_master_codes": True}})
