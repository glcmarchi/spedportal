from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional, Dict, Any
from server import db, get_current_user, hash_pw, new_id, now_iso, logger

super_router = APIRouter(prefix="/api/super")
reseller_router = APIRouter(prefix="/api/reseller")

DEFAULT_FEATURES = {
    "customs": True, "insurance": True, "prepaid": True, "manifests": True,
    "address_book": True, "parcels": True, "broadcasts": True,
    "premium_own_carriers": True,
}
DEFAULT_CARRIERS = ["brt", "gls", "dhl", "ups", "tnt", "poste"]

CARRIER_SCHEMAS = {
    "brt": {
        "name": "BRT",
        "auth_type": "credentials",
        "fields": [
            {"key": "user_id", "label": "UserID WebService", "type": "text", "required": True},
            {"key": "password", "label": "Password WebService", "type": "password", "required": True},
            {"key": "customer_code", "label": "Codice Cliente Mittente", "type": "text", "required": True},
            {"key": "depot_code", "label": "Depot Code (Filiale partenza)", "type": "text", "required": True},
        ],
    },
    "gls": {
        "name": "GLS Italy",
        "auth_type": "credentials",
        "fields": [
            {"key": "sede", "label": "Sigla Sede (es. MI)", "type": "text", "required": True},
            {"key": "customer_code", "label": "Codice Cliente", "type": "text", "required": True},
            {"key": "password", "label": "Password", "type": "password", "required": True},
            {"key": "contract_code", "label": "Codice Contratto", "type": "text", "required": True},
        ],
    },
    "dhl": {
        "name": "DHL Express",
        "auth_type": "credentials",
        "fields": [
            {"key": "api_key", "label": "MyDHL API Key", "type": "text", "required": True},
            {"key": "api_secret", "label": "MyDHL API Secret", "type": "password", "required": True},
            {"key": "account_number", "label": "Account Number (9 cifre)", "type": "text", "required": True},
        ],
    },
    "ups": {
        "name": "UPS",
        "auth_type": "account_link",
        "auth_note": "Inserisci solo il codice cliente UPS (6 caratteri) e clicca su Autentica Account per collegarlo tramite OAuth.",
        "fields": [
            {"key": "account_number", "label": "Codice Cliente UPS (Account Number)", "type": "text", "required": True},
            {"key": "postal_code", "label": "CAP Fatturazione (verifica)", "type": "text", "required": False},
        ],
    },
    "tnt": {
        "name": "FedEx / TNT",
        "auth_type": "account_link",
        "auth_note": "Inserisci solo il tuo Account Number FedEx/TNT (9 cifre) e avvia la verifica/autenticazione account.",
        "fields": [
            {"key": "account_number", "label": "Account Number FedEx / TNT", "type": "text", "required": True},
            {"key": "country_code", "label": "Nazione Contratto (es. IT)", "type": "text", "required": False},
        ],
    },
    "poste": {
        "name": "Poste Italiane / SDA",
        "auth_type": "credentials",
        "fields": [
            {"key": "client_id", "label": "Client ID", "type": "text", "required": True},
            {"key": "client_secret", "label": "Client Secret", "type": "password", "required": True},
            {"key": "cdc_code", "label": "Codice Centro di Costo (CDC)", "type": "text", "required": True},
        ],
    },
}

# Policy consentite: admin_only | reseller_only | disabled
DEFAULT_POLICIES = {c: "admin_only" for c in DEFAULT_CARRIERS}


async def require_super_admin(user=Depends(get_current_user)):
    if user.get("role") != "super_admin":
        raise HTTPException(403, "Super admin only")
    return user


async def require_reseller_admin(user=Depends(get_current_user)):
    if user.get("role") != "reseller_admin" or not user.get("reseller_id"):
        raise HTTPException(403, "Riservato all'amministratore del Reseller")
    return user


def _normalize_policy(pol: str) -> str:
    if pol == "hybrid":
        return "reseller_only"
    if pol in ("admin_only", "reseller_only", "disabled"):
        return pol
    return "admin_only"


def _validate_carrier_payload(carrier_id: str, values: Dict[str, Any]):
    schema = CARRIER_SCHEMAS.get(carrier_id)
    if not schema:
        raise HTTPException(400, f"Corriere non supportato: {carrier_id}")
    for f in schema["fields"]:
        if f.get("required") and not str(values.get(f["key"], "")).strip():
            raise HTTPException(400, f"Campo obbligatorio mancante per {schema['name']}: {f['label']}")


def _extract_primary_code(carrier_id: str, values: Dict[str, Any]) -> str:
    for k in ("account_number", "customer_code", "cdc_code", "user_id", "client_id"):
        if values.get(k):
            return str(values[k]).strip()
    return f"CFG-{carrier_id.upper()}"


class ResellerInput(BaseModel):
    company_name: str
    slug: Optional[str] = None
    admin_email: EmailStr
    admin_password: Optional[str] = None
    plan: str = "basic"
    features: Optional[Dict[str, bool]] = None
    carrier_policies: Optional[Dict[str, str]] = None  # admin_only | reseller_only | disabled
    carrier_credentials: Optional[Dict[str, Dict[str, Any]]] = None
    per_shipment_fee: float = 0.0
    active: bool = True


class CarrierCredsSave(BaseModel):
    values: Dict[str, Any]


# --- ENDPOINT SCHEMI CORRIERI ---
@super_router.get("/carrier-schemas")
async def get_carrier_schemas_super(_=Depends(require_super_admin)):
    return CARRIER_SCHEMAS


@reseller_router.get("/carrier-schemas")
async def get_carrier_schemas_reseller(_=Depends(get_current_user)):
    return CARRIER_SCHEMAS


# --- CODICI MASTER DEL SUPER ADMIN ---
@super_router.get("/master-carriers")
async def list_master_carriers(_=Depends(require_super_admin)):
    doc = await db.system_settings.find_one({"id": "master_carriers"}, {"_id": 0})
    carriers = (doc or {}).get("carriers", {})
    return {"schemas": CARRIER_SCHEMAS, "carriers": carriers}


@super_router.put("/master-carriers/{carrier_id}")
async def save_master_carrier(carrier_id: str, inp: CarrierCredsSave, _=Depends(require_super_admin)):
    _validate_carrier_payload(carrier_id, inp.values)
    schema = CARRIER_SCHEMAS[carrier_id]
    status = "verified" if schema["auth_type"] == "credentials" else "pending_auth"
    entry = {
        "values": inp.values,
        "primary_code": _extract_primary_code(carrier_id, inp.values),
        "auth_type": schema["auth_type"],
        "status": status,
        "updated_at": now_iso(),
    }
    await db.system_settings.update_one(
        {"id": "master_carriers"},
        {"$set": {f"carriers.{carrier_id}": entry}},
        upsert=True,
    )
    return {"ok": True, "carrier": entry}


@super_router.post("/master-carriers/{carrier_id}/authenticate")
async def authenticate_master_carrier(carrier_id: str, _=Depends(require_super_admin)):
    doc = await db.system_settings.find_one({"id": "master_carriers"}, {"_id": 0})
    entry = ((doc or {}).get("carriers") or {}).get(carrier_id)
    if not entry or not entry.get("values"):
        raise HTTPException(400, "Salva prima il codice cliente da autenticare")
    _validate_carrier_payload(carrier_id, entry["values"])
    await db.system_settings.update_one(
        {"id": "master_carriers"},
        {"$set": {
            f"carriers.{carrier_id}.status": "verified",
            f"carriers.{carrier_id}.authenticated_at": now_iso(),
        }},
    )
    return {"ok": True, "status": "verified"}


# --- GESTIONE RESELLER DAL SUPER ADMIN ---
@super_router.post("/resellers")
async def create_reseller(inp: ResellerInput, _=Depends(require_super_admin)):
    if await db.resellers.find_one({"admin_email": inp.admin_email.lower()}):
        raise HTTPException(400, "Admin email già utilizzata")
    rid = new_id()
    slug = (inp.slug or inp.company_name.lower().replace(" ", "-"))
    features = {**DEFAULT_FEATURES, **(inp.features or {})}
    raw_pol = {**DEFAULT_POLICIES, **(inp.carrier_policies or {})}
    policies = {k: _normalize_policy(v) for k, v in raw_pol.items()}
    reseller = {
        "id": rid, "company_name": inp.company_name, "slug": slug,
        "admin_email": inp.admin_email.lower(), "plan": inp.plan,
        "features": features,
        "carrier_policies": policies,
        "carrier_credentials": inp.carrier_credentials or {},
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
        raw_pol = {**DEFAULT_POLICIES, **(r.get("carrier_policies") or {})}
        r["carrier_policies"] = {k: _normalize_policy(v) for k, v in raw_pol.items()}
        r["user_count"] = await db.users.count_documents({"reseller_id": r["id"], "role": "user"})
        r["shipment_count"] = await db.shipments.count_documents({"reseller_id": r["id"]})
    return items


@super_router.patch("/resellers/{rid}")
async def update_reseller(rid: str, inp: ResellerInput, _=Depends(require_super_admin)):
    existing = await db.resellers.find_one({"id": rid})
    if not existing:
        raise HTTPException(404, "Non trovato")
    doc = inp.model_dump(exclude_unset=True)
    doc.pop("admin_email", None)
    doc.pop("admin_password", None)
    if "features" in doc and doc["features"]:
        doc["features"] = {**DEFAULT_FEATURES, **doc["features"]}
    if "carrier_policies" in doc and doc["carrier_policies"]:
        merged = {**DEFAULT_POLICIES, **(existing.get("carrier_policies") or {}), **doc["carrier_policies"]}
        doc["carrier_policies"] = {k: _normalize_policy(v) for k, v in merged.items()}
    await db.resellers.update_one({"id": rid}, {"$set": doc})
    return {"ok": True}


@super_router.get("/resellers/{rid}/billing")
async def reseller_billing(rid: str, _=Depends(require_super_admin)):
    res = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not res:
        raise HTTPException(404)
    ships = await db.shipments.find(
        {"reseller_id": rid},
        {"_id": 0, "id": 1, "created_at": 1, "tracking_number": 1, "carrier_id": 1,
         "carrier_name": 1, "cost": 1, "price": 1, "on_master_codes": 1,
         "contract_owner": 1, "carrier_code_used": 1, "applied_fee": 1}
    ).sort("created_at", -1).to_list(10000)
    on_master = [s for s in ships if s.get("contract_owner", "admin" if s.get("on_master_codes", True) else "reseller") == "admin"]
    on_own = [s for s in ships if s.get("contract_owner", "admin" if s.get("on_master_codes", True) else "reseller") == "reseller"]
    due_standard = round(sum(s.get("cost", 0) for s in on_master), 2)
    fee_unit = float(res.get("per_shipment_fee") or 0)
    due_premium = round(sum(s.get("applied_fee", fee_unit) for s in on_own), 2)
    return {
        "reseller": res,
        "shipments_on_master": len(on_master),
        "shipments_on_own": len(on_own),
        "amount_due_standard": due_standard,
        "amount_due_premium": due_premium,
        "amount_due_total": round(due_standard + due_premium, 2),
        "recent_shipments": ships[:30],
    }


@super_router.get("/me/features")
async def my_features(user=Depends(get_current_user)):
    if user.get("role") == "super_admin":
        return {"features": {**DEFAULT_FEATURES, "premium_own_carriers": True}, "role": "super_admin"}
    rid = user.get("reseller_id")
    if not rid:
        return {"features": DEFAULT_FEATURES, "role": user.get("role")}
    res = await db.resellers.find_one({"id": rid}, {"_id": 0, "features": 1, "company_name": 1, "plan": 1, "carrier_policies": 1})
    features = {**DEFAULT_FEATURES, **((res or {}).get("features") or {})}
    policies = {k: _normalize_policy(v) for k, v in {**DEFAULT_POLICIES, **((res or {}).get("carrier_policies") or {})}.items()}
    can_manage_own = any(p == "reseller_only" for p in policies.values())
    return {
        "features": features,
        "can_manage_own_carriers": can_manage_own,
        "role": user.get("role"),
        "reseller": {"company_name": (res or {}).get("company_name", ""), "plan": (res or {}).get("plan", "basic")},
    }


# --- PORTALE RESELLER: CONFIGURAZIONE PROPRI CODICI CORRIERE ---
@reseller_router.get("/carriers")
async def reseller_list_carriers(user=Depends(require_reseller_admin)):
    res = await db.resellers.find_one({"id": user["reseller_id"]}, {"_id": 0})
    if not res:
        raise HTTPException(404, "Reseller non trovato")
    raw_pol = {**DEFAULT_POLICIES, **(res.get("carrier_policies") or {})}
    policies = {k: _normalize_policy(v) for k, v in raw_pol.items()}
    own_creds = res.get("carrier_credentials") or {}

    items = []
    for cid in DEFAULT_CARRIERS:
        pol = policies.get(cid, "admin_only")
        if pol == "disabled":
            continue
        schema = CARRIER_SCHEMAS[cid]
        own = own_creds.get(cid) or {}
        items.append({
            "carrier_id": cid,
            "name": schema["name"],
            "auth_type": schema["auth_type"],
            "auth_note": schema.get("auth_note", ""),
            "fields": schema["fields"],
            "policy": pol,  # admin_only | reseller_only
            "can_configure_own": (pol == "reseller_only"),
            "own_config": own,
        })
    return {"carriers": items, "per_shipment_fee": res.get("per_shipment_fee", 0.0)}


@reseller_router.put("/carriers/{carrier_id}")
async def reseller_save_carrier(carrier_id: str, inp: CarrierCredsSave, user=Depends(require_reseller_admin)):
    res = await db.resellers.find_one({"id": user["reseller_id"]})
    if not res:
        raise HTTPException(404)
    policies = {k: _normalize_policy(v) for k, v in {**DEFAULT_POLICIES, **(res.get("carrier_policies") or {})}.items()}
    if policies.get(carrier_id) != "reseller_only":
        raise HTTPException(403, "L'amministratore non ha abilitato l'uso di codici propri per questo corriere")

    _validate_carrier_payload(carrier_id, inp.values)
    schema = CARRIER_SCHEMAS[carrier_id]
    status = "verified" if schema["auth_type"] == "credentials" else "pending_auth"
    entry = {
        "values": inp.values,
        "primary_code": _extract_primary_code(carrier_id, inp.values),
        "auth_type": schema["auth_type"],
        "status": status,
        "updated_at": now_iso(),
    }
    await db.resellers.update_one(
        {"id": user["reseller_id"]},
        {"$set": {f"carrier_credentials.{carrier_id}": entry}},
    )
    return {"ok": True, "config": entry}


@reseller_router.post("/carriers/{carrier_id}/authenticate")
async def reseller_authenticate_carrier(carrier_id: str, user=Depends(require_reseller_admin)):
    res = await db.resellers.find_one({"id": user["reseller_id"]})
    if not res:
        raise HTTPException(404)
    policies = {k: _normalize_policy(v) for k, v in {**DEFAULT_POLICIES, **(res.get("carrier_policies") or {})}.items()}
    if policies.get(carrier_id) != "reseller_only":
        raise HTTPException(403, "Operazione non consentita su questo corriere")
    own = (res.get("carrier_credentials") or {}).get(carrier_id)
    if not own or not own.get("values"):
        raise HTTPException(400, "Inserisci e salva prima il codice cliente da autenticare")
    _validate_carrier_payload(carrier_id, own["values"])
    await db.resellers.update_one(
        {"id": user["reseller_id"]},
        {"$set": {
            f"carrier_credentials.{carrier_id}.status": "verified",
            f"carrier_credentials.{carrier_id}.authenticated_at": now_iso(),
        }},
    )
    return {"ok": True, "status": "verified"}


async def bootstrap_multitenant():
    await db.users.update_one({"email": "admin@spedportal.it"}, {"$set": {"role": "super_admin", "reseller_id": None}})

    master_doc = await db.system_settings.find_one({"id": "master_carriers"})
    if not master_doc:
        await db.system_settings.insert_one({
            "id": "master_carriers",
            "carriers": {
                "brt": {"values": {"user_id": "MASTER_BRT", "password": "***", "customer_code": "1029384", "depot_code": "102"}, "primary_code": "1029384", "auth_type": "credentials", "status": "verified", "updated_at": now_iso()},
                "gls": {"values": {"sede": "MI", "customer_code": "998877", "password": "***", "contract_code": "GLS-MST01"}, "primary_code": "998877", "auth_type": "credentials", "status": "verified", "updated_at": now_iso()},
                "dhl": {"values": {"api_key": "DHL_KEY_MST", "api_secret": "***", "account_number": "123456789"}, "primary_code": "123456789", "auth_type": "credentials", "status": "verified", "updated_at": now_iso()},
                "ups": {"values": {"account_number": "A1B2C3", "postal_code": "20100"}, "primary_code": "A1B2C3", "auth_type": "account_link", "status": "verified", "updated_at": now_iso()},
                "tnt": {"values": {"account_number": "987654321", "country_code": "IT"}, "primary_code": "987654321", "auth_type": "account_link", "status": "verified", "updated_at": now_iso()},
                "poste": {"values": {"client_id": "PI_MST_ID", "client_secret": "***", "cdc_code": "CDC001"}, "primary_code": "CDC001", "auth_type": "credentials", "status": "verified", "updated_at": now_iso()},
            }
        })

    demo = await db.resellers.find_one({"company_name": "SpedPortal Demo"})
    if not demo:
        demo_id = new_id()
        await db.resellers.insert_one({
            "id": demo_id, "company_name": "SpedPortal Demo", "slug": "demo",
            "admin_email": "reseller@spedportal.it", "plan": "full",
            "features": {**DEFAULT_FEATURES, "premium_own_carriers": True},
            "carrier_policies": {
                "brt": "admin_only", "gls": "admin_only", "dhl": "admin_only",
                "ups": "reseller_only", "tnt": "admin_only", "poste": "admin_only"
            },
            "carrier_credentials": {},
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
        if demo.get("carrier_policies"):
            cleaned = {k: _normalize_policy(v) for k, v in demo["carrier_policies"].items()}
            await db.resellers.update_one({"id": demo_id}, {"$set": {"carrier_policies": cleaned}})

    for coll in ["users", "shipments", "invoices", "rate_tables", "addressbook",
                 "saved_parcels", "support_tickets", "broadcasts", "broadcast_reads",
                 "manifests", "ledger", "payment_transactions", "bank_transfers"]:
        c = db[coll]
        if coll == "users":
            await c.update_many({"role": {"$in": ["user", "reseller_admin"]}, "reseller_id": {"$exists": False}}, {"$set": {"reseller_id": demo_id}})
            await c.update_many({"role": "admin"}, {"$set": {"role": "reseller_admin", "reseller_id": demo_id}})
        else:
            await c.update_many({"reseller_id": {"$exists": False}}, {"$set": {"reseller_id": demo_id}})
    await db.shipments.update_many({"on_master_codes": {"$exists": False}}, {"$set": {"on_master_codes": True, "contract_owner": "admin"}})
