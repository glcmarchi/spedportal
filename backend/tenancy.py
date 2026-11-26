from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from typing import Optional, Dict, Any
import io
import openpyxl
from openpyxl.styles import Font, PatternFill
from server import db, get_current_user, hash_pw, new_id, now_iso, logger

super_router = APIRouter(prefix="/api/super")
reseller_router = APIRouter(prefix="/api/reseller")

DEFAULT_FEATURES = {
    "address_book": True,
    "manifests": True,
    "parcels": False,
    "sub_clients": False,
    "rate_tables": False,
    "broadcasts": False,
    "client_prepaid": False,
    "client_billing": False,
}

DEFAULT_SURCHARGES = {
    "insurance": True,
    "cod": True,
    "saturday_delivery": True,
    "neutral_delivery": True,
    "residential_delivery": True,
}

PLAN_PRESETS = {
    "basic": {
        "address_book": True, "manifests": True, "parcels": False,
        "sub_clients": False, "rate_tables": False, "broadcasts": False,
        "client_prepaid": False, "client_billing": False,
    },
    "full": {
        "address_book": True, "manifests": True, "parcels": True,
        "sub_clients": False, "rate_tables": False, "broadcasts": False,
        "client_prepaid": False, "client_billing": False,
    },
    "premium": {
        "address_book": True, "manifests": True, "parcels": True,
        "sub_clients": True, "rate_tables": True, "broadcasts": True,
        "client_prepaid": True, "client_billing": True,
    },
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
        "auth_note": "Inserisci il codice cliente UPS (6 caratteri) e clicca su Autentica Account.",
        "fields": [
            {"key": "account_number", "label": "Codice Cliente UPS (Account Number)", "type": "text", "required": True},
            {"key": "postal_code", "label": "CAP Fatturazione (verifica)", "type": "text", "required": False},
        ],
    },
    "tnt": {
        "name": "FedEx / TNT",
        "auth_type": "account_link",
        "auth_note": "Inserisci il tuo Account Number FedEx/TNT (9 cifre) e avvia la verifica/autenticazione account.",
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

DEFAULT_POLICIES = {c: "admin_only" for c in DEFAULT_CARRIERS}


def normalize_markup_rule(raw: Any, fallback_flat: float = 0.0) -> Dict[str, Any]:
    if isinstance(raw, (int, float)):
        val = round(float(raw), 2)
        return {"mode": "flat", "flat": val, "domestic": val, "europe": val, "world": val}
    if isinstance(raw, dict):
        mode = raw.get("mode", "flat")
        flat = round(float(raw.get("flat", fallback_flat) or 0.0), 2)
        dom = round(float(raw.get("domestic", flat) or 0.0), 2)
        eur = round(float(raw.get("europe", flat) or 0.0), 2)
        wld = round(float(raw.get("world", flat) or 0.0), 2)
        return {
            "mode": "area" if mode == "area" else "flat",
            "flat": flat,
            "domestic": dom,
            "europe": eur,
            "world": wld,
        }
    val = round(float(fallback_flat), 2)
    return {"mode": "flat", "flat": val, "domestic": val, "europe": val, "world": val}


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
    notification_email: Optional[str] = ""
    admin_password: Optional[str] = None
    address: Optional[str] = ""
    postal_code: Optional[str] = ""
    city: Optional[str] = ""
    province: Optional[str] = ""
    country: Optional[str] = "IT"
    phone: Optional[str] = ""
    plan: str = "basic"
    billing_type: str = "prepaid"
    allow_ddp: bool = False
    features: Optional[Dict[str, bool]] = None
    enabled_surcharges: Optional[Dict[str, bool]] = None
    carrier_policies: Optional[Dict[str, str]] = None
    admin_carrier_markups: Optional[Dict[str, Any]] = None
    carrier_credentials: Optional[Dict[str, Dict[str, Any]]] = None
    fee_on_admin_codes: float = 0.0
    per_shipment_fee: float = 0.0
    active: bool = True


class ResellerProfileUpdate(BaseModel):
    notification_email: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None


class SuperSettingsUpdate(BaseModel):
    notification_email: Optional[str] = None


class ResellerTopUpInput(BaseModel):
    amount: float
    note: Optional[str] = ""


class CarrierCredsSave(BaseModel):
    values: Dict[str, Any]
    default_markup_percent: Optional[float] = None
    default_markup_rule: Optional[Dict[str, Any]] = None


@super_router.get("/settings")
async def get_super_settings(_=Depends(require_super_admin)):
    doc = await db.system_settings.find_one({"id": "platform_profile"}, {"_id": 0})
    return {"notification_email": (doc or {}).get("notification_email", "admin@spedportal.it")}


@super_router.put("/settings")
async def update_super_settings(inp: SuperSettingsUpdate, _=Depends(require_super_admin)):
    await db.system_settings.update_one(
        {"id": "platform_profile"},
        {"$set": {"notification_email": (inp.notification_email or "").strip().lower(), "updated_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@super_router.get("/carrier-schemas")
async def get_carrier_schemas_super(_=Depends(require_super_admin)):
    return CARRIER_SCHEMAS


@reseller_router.get("/carrier-schemas")
async def get_carrier_schemas_reseller(_=Depends(get_current_user)):
    return CARRIER_SCHEMAS


@reseller_router.get("/profile")
async def get_reseller_profile(user=Depends(require_reseller_admin)):
    res = await db.resellers.find_one({"id": user["reseller_id"]}, {"_id": 0})
    if not res:
        raise HTTPException(404)
    return {
        "company_name": res.get("company_name", ""),
        "admin_email": res.get("admin_email", ""),
        "notification_email": res.get("notification_email") or res.get("admin_email", ""),
        "address": res.get("address", ""),
        "postal_code": res.get("postal_code", ""),
        "city": res.get("city", ""),
        "province": res.get("province", ""),
        "country": res.get("country", "IT"),
        "phone": res.get("phone", ""),
    }


@reseller_router.put("/profile")
async def update_reseller_profile(inp: ResellerProfileUpdate, user=Depends(require_reseller_admin)):
    update = inp.model_dump(exclude_unset=True)
    if "notification_email" in update:
        update["notification_email"] = (update["notification_email"] or "").strip().lower()
    if "province" in update:
        update["province"] = (update["province"] or "").strip().upper()[:2]
    if "country" in update:
        update["country"] = (update["country"] or "IT").strip().upper()[:2]
    await db.resellers.update_one({"id": user["reseller_id"]}, {"$set": update})
    return {"ok": True}


@super_router.get("/master-carriers")
async def list_master_carriers(_=Depends(require_super_admin)):
    doc = await db.system_settings.find_one({"id": "master_carriers"}, {"_id": 0})
    carriers = (doc or {}).get("carriers", {})
    for cid, cdata in carriers.items():
        cdata["default_markup_rule"] = normalize_markup_rule(
            cdata.get("default_markup_rule"),
            cdata.get("default_markup_percent", 5.0),
        )
    return {"schemas": CARRIER_SCHEMAS, "carriers": carriers}


@super_router.put("/master-carriers/{carrier_id}")
async def save_master_carrier(carrier_id: str, inp: CarrierCredsSave, _=Depends(require_super_admin)):
    _validate_carrier_payload(carrier_id, inp.values)
    schema = CARRIER_SCHEMAS[carrier_id]
    existing_doc = await db.system_settings.find_one({"id": "master_carriers"}, {"_id": 0})
    existing_entry = ((existing_doc or {}).get("carriers") or {}).get(carrier_id) or {}

    status = existing_entry.get("status") if existing_entry.get("status") == "verified" else (
        "verified" if schema["auth_type"] == "credentials" else "pending_auth"
    )
    if inp.default_markup_rule is not None:
        rule = normalize_markup_rule(inp.default_markup_rule, 5.0)
    elif inp.default_markup_percent is not None:
        rule = normalize_markup_rule(inp.default_markup_percent, 5.0)
    else:
        rule = normalize_markup_rule(existing_entry.get("default_markup_rule"), existing_entry.get("default_markup_percent", 5.0))

    entry = {
        "values": inp.values,
        "primary_code": _extract_primary_code(carrier_id, inp.values),
        "auth_type": schema["auth_type"],
        "status": status,
        "default_markup_percent": rule["flat"],
        "default_markup_rule": rule,
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


def _clean_admin_markups(raw_map: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = {}
    for k, v in (raw_map or {}).items():
        if v is None or v == "":
            out[k] = None
        else:
            out[k] = normalize_markup_rule(v, 0.0)
    return out


@super_router.post("/resellers")
async def create_reseller(inp: ResellerInput, _=Depends(require_super_admin)):
    if await db.resellers.find_one({"admin_email": inp.admin_email.lower()}):
        raise HTTPException(400, "Admin email già utilizzata")
    rid = new_id()
    slug = (inp.slug or inp.company_name.lower().replace(" ", "-"))
    b_type = inp.billing_type if inp.billing_type in ("prepaid", "postpaid", "instant") else "prepaid"
    preset = PLAN_PRESETS.get(inp.plan, DEFAULT_FEATURES)
    features = {**DEFAULT_FEATURES, **preset, **(inp.features or {})}
    if b_type != "postpaid":
        features["client_prepaid"] = False
    surcharges = {**DEFAULT_SURCHARGES, **(inp.enabled_surcharges or {})}
    raw_pol = {**DEFAULT_POLICIES, **(inp.carrier_policies or {})}
    policies = {k: _normalize_policy(v) for k, v in raw_pol.items()}
    markups = _clean_admin_markups(inp.admin_carrier_markups)
    notif_email = (inp.notification_email or "").strip().lower() or inp.admin_email.lower()
    reseller = {
        "id": rid, "company_name": inp.company_name, "slug": slug,
        "admin_email": inp.admin_email.lower(),
        "notification_email": notif_email,
        "address": inp.address or "",
        "postal_code": inp.postal_code or "",
        "city": inp.city or "",
        "province": (inp.province or "").strip().upper()[:2],
        "country": (inp.country or "IT").strip().upper()[:2],
        "phone": inp.phone or "",
        "plan": inp.plan,
        "billing_type": b_type,
        "allow_ddp": bool(inp.allow_ddp),
        "credit_balance": 0.0,
        "features": features,
        "enabled_surcharges": surcharges,
        "carrier_policies": policies,
        "admin_carrier_markups": markups,
        "carrier_credentials": inp.carrier_credentials or {},
        "fee_on_admin_codes": round(float(inp.fee_on_admin_codes or 0.0), 2),
        "per_shipment_fee": round(float(inp.per_shipment_fee or 0.0), 2),
        "active": inp.active,
        "created_at": now_iso(),
    }
    await db.resellers.insert_one(reseller)
    pw = inp.admin_password or new_id()[:12]
    await db.users.insert_one({
        "id": new_id(), "email": inp.admin_email.lower(), "password": hash_pw(pw),
        "company_name": inp.company_name, "phone": inp.phone or "", "role": "reseller_admin",
        "reseller_id": rid, "status": "approved", "billing_type": b_type,
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
        r["admin_carrier_markups"] = _clean_admin_markups(r.get("admin_carrier_markups"))
        r["enabled_surcharges"] = {**DEFAULT_SURCHARGES, **(r.get("enabled_surcharges") or {})}
        r["notification_email"] = r.get("notification_email") or r.get("admin_email", "")
        r["billing_type"] = r.get("billing_type") or "prepaid"
        if r["billing_type"] != "postpaid" and r.get("features"):
            r["features"]["client_prepaid"] = False
        r["allow_ddp"] = bool(r.get("allow_ddp", False))
        r["credit_balance"] = float(r.get("credit_balance") or 0.0)
        r["fee_on_admin_codes"] = float(r.get("fee_on_admin_codes") or 0.0)
        r["per_shipment_fee"] = float(r.get("per_shipment_fee") or 0.0)
        r["user_count"] = await db.users.count_documents({"reseller_id": r["id"], "role": "user"})
        r["shipment_count"] = await db.shipments.count_documents({"reseller_id": r["id"], "status": {"$nin": ["cancelled", "awaiting_payment"]}})
    return items


@super_router.patch("/resellers/{rid}")
async def update_reseller(rid: str, inp: ResellerInput, _=Depends(require_super_admin)):
    existing = await db.resellers.find_one({"id": rid})
    if not existing:
        raise HTTPException(404, "Non trovato")
    doc = inp.model_dump(exclude_unset=True)
    doc.pop("admin_email", None)
    doc.pop("admin_password", None)
    if "billing_type" in doc and doc["billing_type"] not in ("prepaid", "postpaid", "instant"):
        doc["billing_type"] = "prepaid"
    eff_billing = doc.get("billing_type") or existing.get("billing_type") or "prepaid"
    if "notification_email" in doc:
        doc["notification_email"] = (doc["notification_email"] or "").strip().lower()
    if "province" in doc:
        doc["province"] = (doc["province"] or "").strip().upper()[:2]
    if "country" in doc:
        doc["country"] = (doc["country"] or "IT").strip().upper()[:2]
    if "fee_on_admin_codes" in doc:
        doc["fee_on_admin_codes"] = round(float(doc["fee_on_admin_codes"] or 0.0), 2)
    if "per_shipment_fee" in doc:
        doc["per_shipment_fee"] = round(float(doc["per_shipment_fee"] or 0.0), 2)
    if "features" in doc and doc["features"]:
        feats = {**DEFAULT_FEATURES, **doc["features"]}
        if eff_billing != "postpaid":
            feats["client_prepaid"] = False
        doc["features"] = feats
    if "enabled_surcharges" in doc and doc["enabled_surcharges"]:
        doc["enabled_surcharges"] = {**DEFAULT_SURCHARGES, **doc["enabled_surcharges"]}
    if "carrier_policies" in doc and doc["carrier_policies"]:
        merged = {**DEFAULT_POLICIES, **(existing.get("carrier_policies") or {}), **doc["carrier_policies"]}
        doc["carrier_policies"] = {k: _normalize_policy(v) for k, v in merged.items()}
    if "admin_carrier_markups" in doc and doc["admin_carrier_markups"] is not None:
        doc["admin_carrier_markups"] = _clean_admin_markups(doc["admin_carrier_markups"])
    await db.resellers.update_one({"id": rid}, {"$set": doc})

    if eff_billing != "postpaid":
        await db.users.update_many(
            {"reseller_id": rid, "role": "user", "billing_type": "prepaid"},
            {"$set": {"billing_type": "instant"}},
        )

    user_sync = {}
    if "billing_type" in doc:
        user_sync["billing_type"] = doc["billing_type"]
    if "company_name" in doc:
        user_sync["company_name"] = doc["company_name"]
    if "phone" in doc:
        user_sync["phone"] = doc["phone"]
    if user_sync:
        await db.users.update_many({"reseller_id": rid, "role": "reseller_admin"}, {"$set": user_sync})
    return {"ok": True}


@super_router.post("/resellers/{rid}/topup")
async def super_topup_reseller(rid: str, inp: ResellerTopUpInput, _=Depends(require_super_admin)):
    res = await db.resellers.find_one({"id": rid})
    if not res:
        raise HTTPException(404, "Reseller non trovato")
    amount = round(float(inp.amount), 2)
    if amount == 0:
        raise HTTPException(400, "Importo non valido")
    await db.resellers.update_one({"id": rid}, {"$inc": {"credit_balance": amount}})
    await db.users.update_many(
        {"reseller_id": rid, "role": "reseller_admin"},
        {"$inc": {"credit_balance": amount}},
    )
    await db.reseller_ledger.insert_one({
        "id": new_id(),
        "reseller_id": rid,
        "type": "admin_topup" if amount > 0 else "admin_adjustment",
        "amount": amount,
        "note": inp.note or "Accredito manuale Super Admin",
        "created_at": now_iso(),
    })
    updated = await db.resellers.find_one({"id": rid}, {"_id": 0})
    return {"ok": True, "credit_balance": round(float(updated.get("credit_balance") or 0.0), 2)}


async def _compute_reseller_accounting_data(rid: str, date_from: Optional[str] = None, date_to: Optional[str] = None) -> Dict[str, Any]:
    res = await db.resellers.find_one({"id": rid}, {"_id": 0})
    if not res:
        raise HTTPException(404, "Reseller non trovato")

    q: Dict[str, Any] = {"reseller_id": rid, "status": {"$nin": ["cancelled", "awaiting_payment"]}}
    if date_from or date_to:
        dt_q: Dict[str, Any] = {}
        if date_from:
            dt_q["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            dt_q["$lte"] = f"{date_to}T23:59:59.999999"
        q["created_at"] = dt_q

    ships = await db.shipments.find(
        q,
        {"_id": 0, "id": 1, "created_at": 1, "tracking_number": 1, "carrier_id": 1,
         "carrier_name": 1, "user_id": 1, "user_company_name": 1, "created_by_role": 1,
         "cost": 1, "carrier_cost": 1, "reseller_cost": 1, "reseller_transport_cost": 1,
         "admin_markup_percent": 1, "price": 1, "on_master_codes": 1,
         "contract_owner": 1, "carrier_code_used": 1, "applied_fee": 1}
    ).sort("created_at", -1).to_list(10000)

    # Risoluzione dinamica utenti
    u_ids = list({s.get("user_id") for s in ships if s.get("user_id")})
    u_docs = await db.users.find({"id": {"$in": u_ids}}, {"_id": 0, "id": 1, "role": 1, "company_name": 1, "billing_type": 1}).to_list(1000) if u_ids else []
    u_map = {u["id"]: u for u in u_docs}

    fee_admin_def = float(res.get("fee_on_admin_codes") or 0.0)
    fee_own_def = float(res.get("per_shipment_fee") or 0.0)

    on_master = []
    on_own = []
    by_origin: Dict[str, Dict[str, Any]] = {}

    for s in ships:
        u_info = u_map.get(s.get("user_id")) or {}
        c_role = u_info.get("role") or s.get("created_by_role", "user")
        c_name = u_info.get("company_name") or s.get("user_company_name") or ("Reseller" if c_role != "user" else "Sub-cliente")
        s["created_by_role"] = c_role
        s["user_company_name"] = c_name

        owner = s.get("contract_owner", "admin" if s.get("on_master_codes", True) else "reseller")
        raw_cost = float(s.get("carrier_cost", s.get("cost", 0)) or 0.0)
        if owner == "admin":
            on_master.append(s)
            fee_val = float(s.get("applied_fee") if s.get("applied_fee") is not None else fee_admin_def)
            if "reseller_transport_cost" in s and s["reseller_transport_cost"] is not None:
                trans_val = float(s["reseller_transport_cost"])
            else:
                # Retrocompatibilità record precedenti
                rc = float(s.get("reseller_cost", s.get("cost", 0)) or 0.0)
                trans_val = rc
            admin_due_ship = round(trans_val + fee_val, 2)
        else:
            on_own.append(s)
            fee_val = float(s.get("applied_fee") if s.get("applied_fee") is not None else fee_own_def)
            trans_val = 0.0
            admin_due_ship = round(fee_val, 2)

        s["_calc_raw_cost"] = round(raw_cost, 2)
        s["_calc_transport_due"] = round(trans_val, 2)
        s["_calc_fee_due"] = round(fee_val, 2)
        s["_calc_admin_due"] = admin_due_ship

        grp_key = "DIRECT_RESELLER" if c_role != "user" else f"CLIENT:{s.get('user_id')}"
        if grp_key not in by_origin:
            by_origin[grp_key] = {
                "group_key": grp_key,
                "is_reseller_direct": c_role != "user",
                "company_name": f"{res.get('company_name')} (Spedizioni Dirette)" if c_role != "user" else c_name,
                "client_billing_type": "reseller" if c_role != "user" else (u_info.get("billing_type") or "instant"),
                "shipments_count": 0,
                "master_count": 0,
                "own_count": 0,
                "transport_due": 0.0,
                "fees_due": 0.0,
                "total_due": 0.0,
            }
        g = by_origin[grp_key]
        g["shipments_count"] += 1
        if owner == "admin":
            g["master_count"] += 1
        else:
            g["own_count"] += 1
        g["transport_due"] = round(g["transport_due"] + trans_val, 2)
        g["fees_due"] = round(g["fees_due"] + fee_val, 2)
        g["total_due"] = round(g["total_due"] + admin_due_ship, 2)

    raw_carrier_cost_master = round(sum(s["_calc_raw_cost"] for s in on_master), 2)
    transport_due_master = round(sum(s["_calc_transport_due"] for s in on_master), 2)
    fees_due_master = round(sum(s["_calc_fee_due"] for s in on_master), 2)
    fees_due_own = round(sum(s["_calc_fee_due"] for s in on_own), 2)
    admin_margin_earned = round(transport_due_master - raw_carrier_cost_master, 2)
    amount_due_total = round(transport_due_master + fees_due_master + fees_due_own, 2)

    ledger = await db.reseller_ledger.find({"reseller_id": rid}, {"_id": 0}).sort("created_at", -1).limit(30).to_list(30)

    breakdown = sorted(by_origin.values(), key=lambda x: (0 if x["is_reseller_direct"] else 1, -x["total_due"]))

    return {
        "reseller": res,
        "shipments_total": len(ships),
        "shipments_on_master": len(on_master),
        "shipments_on_own": len(on_own),
        "raw_carrier_cost_master": raw_carrier_cost_master,
        "admin_margin_earned": admin_margin_earned,
        "amount_due_standard": transport_due_master,
        "fees_due_master": fees_due_master,
        "amount_due_premium": fees_due_own,
        "fees_due_total": round(fees_due_master + fees_due_own, 2),
        "amount_due_total": amount_due_total,
        "breakdown_by_origin": breakdown,
        "recent_shipments": ships[:100],
        "ledger": ledger,
    }


@super_router.get("/resellers/{rid}/billing")
async def reseller_billing(rid: str, date_from: Optional[str] = None, date_to: Optional[str] = None, _=Depends(require_super_admin)):
    return await _compute_reseller_accounting_data(rid, date_from, date_to)


@super_router.get("/resellers/{rid}/billing/export")
async def export_reseller_billing_xlsx(rid: str, date_from: Optional[str] = None, date_to: Optional[str] = None, _=Depends(require_super_admin)):
    data = await _compute_reseller_accounting_data(rid, date_from, date_to)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Riepilogo Contabile"
    ws.append(["Origine / Sub-Cliente", "N. Spedizioni", "Su Codici Admin", "Su Codici Reseller", "Trasporto (€)", "Commissioni Piattaforma (€)", "Totale Imponibile (€)"])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F172A")
    for row in data["breakdown_by_origin"]:
        ws.append([
            row["company_name"], row["shipments_count"], row["master_count"], row["own_count"],
            row["transport_due"], row["fees_due"], row["total_due"],
        ])
    ws.append([])
    ws.append(["TOTALE COMPLESSIVO", data["shipments_total"], data["shipments_on_master"], data["shipments_on_own"],
               data["amount_due_standard"], data["fees_due_total"], data["amount_due_total"]])

    ws2 = wb.create_sheet("Dettaglio Spedizioni")
    ws2.append(["Data", "Tracking", "Origine", "Corriere", "Contratto", "Costo API (€)", "Trasporto Addebitato (€)", "Commissione Piattaforma (€)", "Totale Addebito Reseller (€)"])
    for cell in ws2[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0F172A")
    for s in data["recent_shipments"]:
        owner = s.get("contract_owner", "admin" if s.get("on_master_codes", True) else "reseller")
        ws2.append([
            (s.get("created_at") or "")[:10],
            s.get("tracking_number", ""),
            s.get("user_company_name", ""),
            s.get("carrier_name", ""),
            "Admin" if owner == "admin" else "Reseller",
            s["_calc_raw_cost"],
            s["_calc_transport_due"],
            s["_calc_fee_due"],
            s["_calc_admin_due"],
        ])

    buf = io.BytesIO()
    wb.save(buf); buf.seek(0)
    slug = data["reseller"].get("slug") or rid[:8]
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=contabilita-{slug}.xlsx"},
    )


@reseller_router.get("/accounting")
async def reseller_subclients_accounting(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    client_id: Optional[str] = None,
    user=Depends(require_reseller_admin),
):
    """Contabilità e monitoraggio economico del Reseller verso i propri Sub-Clienti."""
    rid = user["reseller_id"]
    q: Dict[str, Any] = {
        "reseller_id": rid,
        "status": {"$nin": ["cancelled", "awaiting_payment"]},
    }
    if client_id and client_id != "all":
        q["user_id"] = client_id
    if date_from or date_to:
        dt_q: Dict[str, Any] = {}
        if date_from:
            dt_q["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            dt_q["$lte"] = f"{date_to}T23:59:59.999999"
        q["created_at"] = dt_q

    ships = await db.shipments.find(
        q,
        {"_id": 0, "id": 1, "created_at": 1, "tracking_number": 1, "carrier_name": 1,
         "user_id": 1, "user_company_name": 1, "created_by_role": 1,
         "cost": 1, "reseller_cost": 1, "reseller_transport_cost": 1, "applied_fee": 1,
         "price": 1, "invoice_id": 1, "contract_owner": 1, "on_master_codes": 1}
    ).sort("created_at", -1).to_list(10000)

    u_docs = await db.users.find(
        {"reseller_id": rid, "role": "user"},
        {"_id": 0, "id": 1, "company_name": 1, "billing_type": 1, "credit_balance": 1},
    ).to_list(1000)
    u_map = {u["id"]: u for u in u_docs}

    by_client: Dict[str, Dict[str, Any]] = {}
    client_ships = []

    for s in ships:
        u_info = u_map.get(s.get("user_id"))
        if not u_info and s.get("created_by_role") != "user":
            continue
        uid = s.get("user_id")
        cname = (u_info or {}).get("company_name") or s.get("user_company_name") or "Sub-cliente"
        btype = (u_info or {}).get("billing_type") or "instant"
        res_cost = round(float(s.get("reseller_cost") or s.get("cost") or 0.0), 2)
        fee_val = round(float(s.get("applied_fee") or 0.0), 2)
        price_val = round(float(s.get("price") or 0.0), 2)
        margin_val = round(price_val - res_cost, 2)

        s["user_company_name"] = cname
        s["_reseller_cost"] = res_cost
        s["_applied_fee"] = fee_val
        s["_margin"] = margin_val
        client_ships.append(s)

        if uid not in by_client:
            by_client[uid] = {
                "user_id": uid,
                "company_name": cname,
                "billing_type": btype,
                "shipments_count": 0,
                "unbilled_count": 0,
                "unbilled_amount": 0.0,
                "reseller_cost_total": 0.0,
                "fees_total": 0.0,
                "client_price_total": 0.0,
                "margin_total": 0.0,
            }
        c = by_client[uid]
        c["shipments_count"] += 1
        c["reseller_cost_total"] = round(c["reseller_cost_total"] + res_cost, 2)
        c["fees_total"] = round(c["fees_total"] + fee_val, 2)
        c["client_price_total"] = round(c["client_price_total"] + price_val, 2)
        c["margin_total"] = round(c["margin_total"] + margin_val, 2)
        if not s.get("invoice_id") and btype == "postpaid":
            c["unbilled_count"] += 1
            c["unbilled_amount"] = round(c["unbilled_amount"] + price_val, 2)

    clients_summary = sorted(by_client.values(), key=lambda x: -x["client_price_total"])
    return {
        "clients_summary": clients_summary,
        "shipments": client_ships[:200],
        "totals": {
            "shipments_count": len(client_ships),
            "reseller_cost_total": round(sum(x["_reseller_cost"] for x in client_ships), 2),
            "fees_total": round(sum(x["_applied_fee"] for x in client_ships), 2),
            "client_price_total": round(sum(float(x.get("price") or 0.0) for x in client_ships), 2),
            "margin_total": round(sum(x["_margin"] for x in client_ships), 2),
        },
    }


@super_router.get("/me/features")
async def my_features(user=Depends(get_current_user)):
    if user.get("role") == "super_admin":
        all_true = {k: True for k in DEFAULT_FEATURES}
        return {"features": all_true, "enabled_surcharges": DEFAULT_SURCHARGES, "allow_ddp": True, "role": "super_admin"}
    rid = user.get("reseller_id")
    if not rid:
        return {"features": DEFAULT_FEATURES, "enabled_surcharges": DEFAULT_SURCHARGES, "allow_ddp": False, "role": user.get("role")}
    res = await db.resellers.find_one({"id": rid}, {"_id": 0})
    res_billing = (res or {}).get("billing_type", "prepaid")
    features = {**DEFAULT_FEATURES, **((res or {}).get("features") or {})}
    if res_billing != "postpaid":
        features["client_prepaid"] = False
    surcharges = {**DEFAULT_SURCHARGES, **((res or {}).get("enabled_surcharges") or {})}
    policies = {k: _normalize_policy(v) for k, v in {**DEFAULT_POLICIES, **((res or {}).get("carrier_policies") or {})}.items()}
    can_manage_own = any(p == "reseller_only" for p in policies.values())
    return {
        "features": features,
        "enabled_surcharges": surcharges,
        "allow_ddp": bool((res or {}).get("allow_ddp", False)),
        "can_manage_own_carriers": can_manage_own,
        "role": user.get("role"),
        "reseller": {
            "company_name": (res or {}).get("company_name", ""),
            "slug": (res or {}).get("slug", ""),
            "plan": (res or {}).get("plan", "basic"),
            "billing_type": res_billing,
            "credit_balance": float((res or {}).get("credit_balance") or 0.0),
        },
    }


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
            "policy": pol,
            "can_configure_own": (pol == "reseller_only"),
            "own_config": own,
        })
    return {
        "carriers": items,
        "fee_on_admin_codes": float(res.get("fee_on_admin_codes") or 0.0),
        "per_shipment_fee": float(res.get("per_shipment_fee") or 0.0),
    }


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
                "brt": {"values": {"user_id": "MASTER_BRT", "password": "***", "customer_code": "1029384", "depot_code": "102"}, "primary_code": "1029384", "auth_type": "credentials", "status": "verified", "default_markup_percent": 6.0, "default_markup_rule": normalize_markup_rule(6.0), "updated_at": now_iso()},
                "gls": {"values": {"sede": "MI", "customer_code": "998877", "password": "***", "contract_code": "GLS-MST01"}, "primary_code": "998877", "auth_type": "credentials", "status": "verified", "default_markup_percent": 6.0, "default_markup_rule": normalize_markup_rule(6.0), "updated_at": now_iso()},
                "dhl": {"values": {"api_key": "DHL_KEY_MST", "api_secret": "***", "account_number": "123456789"}, "primary_code": "123456789", "auth_type": "credentials", "status": "verified", "default_markup_percent": 5.0, "default_markup_rule": normalize_markup_rule(5.0), "updated_at": now_iso()},
                "ups": {"values": {"account_number": "A1B2C3", "postal_code": "20100"}, "primary_code": "A1B2C3", "auth_type": "account_link", "status": "verified", "default_markup_percent": 5.0, "default_markup_rule": normalize_markup_rule(5.0), "updated_at": now_iso()},
                "tnt": {"values": {"account_number": "987654321", "country_code": "IT"}, "primary_code": "987654321", "auth_type": "account_link", "status": "verified", "default_markup_percent": 5.0, "default_markup_rule": normalize_markup_rule(5.0), "updated_at": now_iso()},
                "poste": {"values": {"client_id": "PI_MST_ID", "client_secret": "***", "cdc_code": "CDC001"}, "primary_code": "CDC001", "auth_type": "credentials", "status": "verified", "default_markup_percent": 8.0, "default_markup_rule": normalize_markup_rule(8.0), "updated_at": now_iso()},
            }
        })

    demo = await db.resellers.find_one({"company_name": "SpedPortal Demo"})
    if not demo:
        demo_id = new_id()
        await db.resellers.insert_one({
            "id": demo_id, "company_name": "SpedPortal Demo", "slug": "demo",
            "admin_email": "reseller@spedportal.it",
            "notification_email": "reseller@spedportal.it",
            "address": "Via Monte Napoleone 10", "postal_code": "20121", "city": "Milano", "province": "MI", "country": "IT", "phone": "0212345678",
            "plan": "premium",
            "billing_type": "prepaid", "allow_ddp": False, "credit_balance": 500.0,
            "features": {**PLAN_PRESETS["premium"], "client_prepaid": False},
            "enabled_surcharges": {**DEFAULT_SURCHARGES},
            "carrier_policies": {
                "brt": "admin_only", "gls": "admin_only", "dhl": "admin_only",
                "ups": "reseller_only", "tnt": "admin_only", "poste": "admin_only"
            },
            "admin_carrier_markups": {},
            "carrier_credentials": {},
            "fee_on_admin_codes": 0.25,
            "per_shipment_fee": 0.15,
            "active": True,
            "created_at": now_iso(),
        })
        if not await db.users.find_one({"email": "reseller@spedportal.it"}):
            await db.users.insert_one({
                "id": new_id(), "email": "reseller@spedportal.it", "password": hash_pw("Reseller@2026"),
                "company_name": "SpedPortal Demo", "phone": "0212345678", "role": "reseller_admin", "reseller_id": demo_id,
                "status": "approved", "billing_type": "prepaid", "credit_balance": 500.0, "created_at": now_iso(),
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
