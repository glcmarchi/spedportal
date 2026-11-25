from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone
import io, csv, base64, os
import httpx
import stripe
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib import colors as rl_colors
from server import db, require_admin, require_approved, now_iso, new_id, tenant_filter
from carriers.fedex import validate_fedex_postal

extra_router = APIRouter(prefix="/api")

class AddressBookEntry(BaseModel):
    label: Optional[str] = ""
    company_name: str
    address: str
    postal_code: str
    city: str
    province: Optional[str] = ""
    country: str = "IT"
    reference: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""

@extra_router.get("/addressbook")
async def list_addresses(user=Depends(require_approved)):
    return await db.addressbook.find(tenant_filter(user), {"_id": 0}).sort("company_name", 1).to_list(2000)

@extra_router.post("/addressbook")
async def create_address(entry: AddressBookEntry, user=Depends(require_approved)):
    data = entry.model_dump()
    data["province"] = (data.get("province") or "").strip().upper()[:2]
    data["country"] = (data.get("country") or "IT").strip().upper()[:2]
    doc = {"id": new_id(), "user_id": user["id"], "reseller_id": user.get("reseller_id"), **data, "created_at": now_iso()}
    await db.addressbook.insert_one(doc); doc.pop("_id", None)
    return doc

@extra_router.put("/addressbook/{aid}")
async def update_address(aid: str, entry: AddressBookEntry, user=Depends(require_approved)):
    data = entry.model_dump()
    data["province"] = (data.get("province") or "").strip().upper()[:2]
    data["country"] = (data.get("country") or "IT").strip().upper()[:2]
    r = await db.addressbook.update_one(tenant_filter(user, {"id": aid}), {"$set": data})
    if r.matched_count == 0: raise HTTPException(404, "Non trovato")
    return {"ok": True}

@extra_router.delete("/addressbook/{aid}")
async def delete_address(aid: str, user=Depends(require_approved)):
    await db.addressbook.delete_one(tenant_filter(user, {"id": aid}))
    return {"ok": True}

@extra_router.get("/addressbook/template")
async def address_template(_=Depends(require_approved)):
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["label", "company_name", "address", "postal_code", "city", "province", "country", "reference", "email", "phone"])
    w.writerow(["Sede Milano", "Acme SRL", "Via Roma 1", "20121", "Milano", "MI", "IT", "Mario Rossi", "mario@acme.it", "+39 02 12345"])
    return StreamingResponse(io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=rubrica_template.csv"})

@extra_router.post("/addressbook/import")
async def import_addresses(file: UploadFile = File(...), user=Depends(require_approved)):
    data = (await file.read()).decode("utf-8-sig", errors="ignore")
    docs = []
    for row in csv.DictReader(io.StringIO(data)):
        if not row.get("company_name"): continue
        docs.append({
            "id": new_id(), "user_id": user["id"], "reseller_id": user.get("reseller_id"),
            "label": row.get("label", ""), "company_name": row["company_name"],
            "address": row.get("address", ""), "postal_code": row.get("postal_code", ""),
            "city": row.get("city", ""),
            "province": (row.get("province", "") or "").strip().upper()[:2],
            "country": (row.get("country", "IT") or "IT").upper()[:2],
            "reference": row.get("reference", ""), "email": row.get("email", ""),
            "phone": row.get("phone", ""), "created_at": now_iso(),
        })
    if docs: await db.addressbook.insert_many(docs)
    return {"imported": len(docs)}

class SavedParcel(BaseModel):
    name: str; length: float; width: float; height: float; weight: float; is_default: bool = False

@extra_router.get("/parcels")
async def list_parcels(user=Depends(require_approved)):
    return await db.saved_parcels.find(tenant_filter(user), {"_id": 0}).to_list(500)

@extra_router.post("/parcels")
async def create_parcel(p: SavedParcel, user=Depends(require_approved)):
    if p.is_default:
        await db.saved_parcels.update_many({"user_id": user["id"]}, {"$set": {"is_default": False}})
    doc = {"id": new_id(), "user_id": user["id"], "reseller_id": user.get("reseller_id"), **p.model_dump(), "created_at": now_iso()}
    await db.saved_parcels.insert_one(doc); doc.pop("_id", None)
    return doc

@extra_router.put("/parcels/{pid}")
async def update_parcel(pid: str, p: SavedParcel, user=Depends(require_approved)):
    if p.is_default:
        await db.saved_parcels.update_many({"user_id": user["id"]}, {"$set": {"is_default": False}})
    r = await db.saved_parcels.update_one(tenant_filter(user, {"id": pid}), {"$set": p.model_dump()})
    if r.matched_count == 0: raise HTTPException(404, "Non trovato")
    return {"ok": True}

@extra_router.delete("/parcels/{pid}")
async def delete_parcel(pid: str, user=Depends(require_approved)):
    await db.saved_parcels.delete_one(tenant_filter(user, {"id": pid}))
    return {"ok": True}

@extra_router.post("/support/tickets")
async def create_ticket(subject: str = Form(...), category: str = Form(...), description: str = Form(...),
                        attachments: List[UploadFile] = File(default=[]), user=Depends(require_approved)):
    if len(attachments) > 3: raise HTTPException(400, "Massimo 3 allegati")
    files = []
    for f in attachments[:3]:
        content = await f.read()
        if len(content) > 5 * 1024 * 1024: raise HTTPException(400, f"File troppo grande: {f.filename}")
        files.append({"filename": f.filename, "content_type": f.content_type, "size": len(content), "data_b64": base64.b64encode(content).decode()})
    doc = {"id": new_id(), "user_id": user["id"], "reseller_id": user.get("reseller_id"), "user_email": user["email"],
           "company_name": user.get("company_name", ""), "subject": subject, "category": category,
           "description": description, "attachments": files, "status": "open", "created_at": now_iso()}
    await db.support_tickets.insert_one(doc); doc.pop("_id", None)
    doc["attachments"] = [{k: v for k, v in a.items() if k != "data_b64"} for a in doc["attachments"]]
    return doc

@extra_router.get("/support/tickets")
async def list_tickets(user=Depends(require_approved)):
    return await db.support_tickets.find(tenant_filter(user), {"_id": 0, "attachments.data_b64": 0}).sort("created_at", -1).to_list(500)

class BroadcastInput(BaseModel):
    title: str; body: str; visible_from: Optional[str] = None; target_user_ids: Optional[List[str]] = None

@extra_router.post("/admin/broadcasts")
async def create_broadcast(inp: BroadcastInput, admin=Depends(require_admin)):
    doc = {"id": new_id(), "reseller_id": admin.get("reseller_id"), "title": inp.title, "body": inp.body,
           "visible_from": inp.visible_from or now_iso(), "target_user_ids": inp.target_user_ids or None, "created_at": now_iso()}
    await db.broadcasts.insert_one(doc); doc.pop("_id", None)
    return doc

@extra_router.get("/admin/broadcasts")
async def list_broadcasts(admin=Depends(require_admin)):
    q = {} if admin.get("role") == "super_admin" else {"reseller_id": admin.get("reseller_id")}
    return await db.broadcasts.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

@extra_router.get("/broadcasts")
async def my_broadcasts(user=Depends(require_approved)):
    now = now_iso()
    q = {"visible_from": {"$lte": now}, "$and": [{"$or": [{"reseller_id": user.get("reseller_id")}, {"reseller_id": None}]},
         {"$or": [{"target_user_ids": None}, {"target_user_ids": user["id"]}]}]}
    msgs = await db.broadcasts.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    reads = await db.broadcast_reads.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    read_ids = {r["broadcast_id"] for r in reads}
    for m in msgs: m["read"] = m["id"] in read_ids
    return msgs

@extra_router.post("/broadcasts/{bid}/read")
async def mark_broadcast_read(bid: str, user=Depends(require_approved)):
    await db.broadcast_reads.update_one({"user_id": user["id"], "broadcast_id": bid},
        {"$set": {"user_id": user["id"], "broadcast_id": bid, "read_at": now_iso()}}, upsert=True)
    return {"ok": True}

class ManifestInput(BaseModel):
    carrier_id: str; shipment_ids: List[str]

@extra_router.post("/manifests")
async def create_manifest(inp: ManifestInput, user=Depends(require_approved)):
    ships = await db.shipments.find({"id": {"$in": inp.shipment_ids}, "user_id": user["id"], "carrier_id": inp.carrier_id}, {"_id": 0}).to_list(1000)
    if not ships: raise HTTPException(400, "Nessuna spedizione valida per questo corriere")
    number = f"MAN-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{new_id()[:6].upper()}"
    doc = {"id": new_id(), "user_id": user["id"], "reseller_id": user.get("reseller_id"),
           "carrier_id": inp.carrier_id, "carrier_name": ships[0]["carrier_name"], "number": number,
           "shipment_ids": inp.shipment_ids, "total_parcels": sum(len(s["parcels"]) for s in ships),
           "total_weight": round(sum(s["billed_weight"] for s in ships), 2), "created_at": now_iso()}
    await db.manifests.insert_one(doc); doc.pop("_id", None)
    await db.shipments.update_many({"id": {"$in": inp.shipment_ids}}, {"$set": {"manifest_id": doc["id"]}})
    return doc

@extra_router.get("/manifests")
async def list_manifests(user=Depends(require_approved)):
    return await db.manifests.find(tenant_filter(user), {"_id": 0}).sort("created_at", -1).to_list(500)

@extra_router.get("/manifests/{mid}/pdf")
async def manifest_pdf(mid: str, user=Depends(require_approved)):
    m = await db.manifests.find_one(tenant_filter(user, {"id": mid}), {"_id": 0})
    if not m: raise HTTPException(404, "Non trovato")
    ships = await db.shipments.find({"id": {"$in": m["shipment_ids"]}}, {"_id": 0}).to_list(1000)
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=A4); W, H = A4
    c.setFillColor(rl_colors.HexColor("#0F172A")); c.rect(0, H - 25 * mm, W, 25 * mm, fill=1, stroke=0)
    c.setFillColor(rl_colors.HexColor("#EA580C")); c.rect(0, H - 25 * mm, 4 * mm, 25 * mm, fill=1, stroke=0)
    c.setFillColor(rl_colors.white); c.setFont("Helvetica-Bold", 18); c.drawString(15 * mm, H - 15 * mm, f"MANIFEST · {m['carrier_name']}")
    c.setFont("Helvetica", 10); c.drawString(15 * mm, H - 22 * mm, f"N. {m['number']} · {m['created_at'][:10]}")
    c.setFillColor(rl_colors.black); y = H - 40 * mm; c.setFont("Helvetica-Bold", 9)
    c.setFillColor(rl_colors.HexColor("#F1F5F9")); c.rect(15 * mm, y - 2, W - 30 * mm, 6 * mm, fill=1, stroke=0); c.setFillColor(rl_colors.black)
    c.drawString(17 * mm, y, "#"); c.drawString(24 * mm, y, "Tracking"); c.drawString(70 * mm, y, "Destinatario")
    c.drawString(130 * mm, y, "Città"); c.drawRightString(W - 17 * mm, y, "Peso kg"); y -= 6 * mm; c.setFont("Helvetica", 8)
    for i, s in enumerate(ships, 1):
        if y < 30 * mm: c.showPage(); y = H - 20 * mm
        c.drawString(17 * mm, y, str(i)); c.drawString(24 * mm, y, s.get("tracking_number", ""))
        c.drawString(70 * mm, y, s.get("recipient", {}).get("company_name", "")[:35])
        c.drawString(130 * mm, y, s.get("recipient", {}).get("city", "")[:20])
        c.drawRightString(W - 17 * mm, y, f"{s.get('billed_weight', 0):.2f}"); y -= 5 * mm
    y -= 5 * mm; c.setFont("Helvetica-Bold", 10)
    c.drawString(15 * mm, y, f"Totale colli: {m['total_parcels']}   Totale peso: {m['total_weight']:.2f} kg"); y -= 20 * mm
    c.setFont("Helvetica", 9); c.drawString(15 * mm, y, "Firma corriere: __________________________")
    c.drawString(110 * mm, y, "Firma mittente: __________________________")
    c.showPage(); c.save(); buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={m['number']}.pdf"})

IT_PROV_PREFIX = {
    "00": "RM", "01": "VT", "02": "RI", "03": "FR", "04": "LT", "05": "TR", "06": "PG",
    "07": "SS", "08": "NU", "09": "CA", "10": "TO", "11": "AO", "12": "CN", "13": "VC",
    "14": "AT", "15": "AL", "16": "GE", "17": "SV", "18": "IM", "19": "SP", "20": "MI",
    "21": "VA", "22": "CO", "23": "SO", "24": "BG", "25": "BS", "26": "CR", "27": "PV",
    "28": "VB", "29": "PC", "30": "VE", "31": "TV", "32": "BL", "33": "UD", "34": "TS",
    "35": "PD", "36": "VI", "37": "VR", "38": "TN", "39": "BZ", "40": "BO", "41": "MO",
    "42": "RE", "43": "PR", "44": "FE", "45": "RO", "46": "MN", "47": "FC", "48": "RA",
    "50": "FI", "51": "PT", "52": "AR", "53": "SI", "54": "MS", "55": "LU", "56": "PI",
    "57": "LI", "58": "GR", "59": "PO", "60": "AN", "61": "PU", "62": "MC", "63": "AP",
    "64": "TE", "65": "PE", "66": "CH", "67": "AQ", "70": "BA", "71": "FG", "72": "BR",
    "73": "LE", "74": "TA", "75": "MT", "76": "BT", "80": "NA", "81": "CE", "82": "BN",
    "83": "AV", "84": "SA", "85": "PZ", "86": "CB", "87": "CS", "88": "CZ", "89": "RC",
    "90": "PA", "91": "TP", "92": "AG", "93": "CL", "94": "EN", "95": "CT", "96": "SR",
    "97": "RG", "98": "ME",
}

IE_EIRCODE_AREAS = {
    "D01": ["Dublin 1", "Dublin"], "D02": ["Dublin 2", "Dublin"], "D03": ["Dublin 3", "Dublin"],
    "D04": ["Dublin 4", "Dublin"], "D05": ["Dublin 5", "Dublin"], "D06": ["Dublin 6", "Dublin"],
    "D07": ["Dublin 7", "Dublin"], "D08": ["Dublin 8", "Dublin"], "D09": ["Dublin 9", "Dublin"],
    "D10": ["Dublin 10", "Dublin"], "D11": ["Dublin 11", "Dublin"], "D12": ["Dublin 12", "Dublin"],
    "D13": ["Dublin 13", "Dublin"], "D14": ["Dublin 14", "Dublin"], "D15": ["Dublin 15", "Dublin"],
    "D16": ["Dublin 16", "Dublin"], "D17": ["Dublin 17", "Dublin"], "D18": ["Dublin 18", "Dublin"],
    "D20": ["Dublin 20", "Dublin"], "D22": ["Dublin 22", "Dublin"], "D24": ["Dublin 24", "Dublin"],
    "A94": ["Blackrock", "Dublin"], "A96": ["Dun Laoghaire", "Dublin"], "A98": ["Bray"],
    "T12": ["Cork"], "T23": ["Cork"], "V94": ["Limerick"], "H91": ["Galway"], "X91": ["Waterford"],
}

def _it_province_from_cap(cap: str) -> str:
    if len(cap) < 5 or not cap.isdigit():
        return ""
    p3 = cap[:3]
    if p3 == "209": return "MB"
    if p3 == "239": return "LC"
    if p3 == "269": return "LO"
    if p3 == "139": return "BI"
    if p3 == "479": return "RN"
    if p3 == "639": return "FM"
    if p3 == "861": return "IS"
    if p3 in ("889", "888"): return "KR"
    if p3 == "899": return "VV"
    if p3 == "090": return "SU"
    return IT_PROV_PREFIX.get(cap[:2], "")

@extra_router.get("/geo/lookup")
async def geo_lookup(country: str = "IT", cap: str = ""):
    country = (country or "IT").upper().strip()
    cap = (cap or "").strip().upper()
    if not cap:
        return {"country": country, "cap": cap, "city": None, "cities": [], "province": None, "valid": True}

    it_prov = _it_province_from_cap(cap) if country == "IT" else ""
    cities_set = []
    ext_prov = ""
    valid = True

    fx_postal = await validate_fedex_postal(country, cap, it_prov)
    if fx_postal is not None:
        valid = fx_postal.get("valid", True)
        if fx_postal.get("cleaned_postal_code"):
            cap = fx_postal["cleaned_postal_code"]
        if fx_postal.get("province") and country in ("IT", "US", "CA", "AU"):
            ext_prov = fx_postal["province"]

    if country == "IE":
        routing_key = cap.replace(" ", "")[:3]
        if routing_key in IE_EIRCODE_AREAS:
            cities_set.extend(IE_EIRCODE_AREAS[routing_key])

    try:
        zippo_cc = "gb" if country == "UK" else country.lower()
        query_cap = cap.split("-")[0].strip() if country in ("US", "PL") else cap
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(f"https://api.zippopotam.us/{zippo_cc}/{query_cap}")
            if r.status_code == 200:
                places = r.json().get("places") or []
                for p in places:
                    pname = (p.get("place name") or "").strip()
                    if pname and pname not in cities_set:
                        cities_set.append(pname)
                    if not ext_prov and country in ("US", "CA", "AU"):
                        ext_prov = (p.get("state abbreviation") or "")[:2].upper()
    except Exception:
        pass

    # Ordina alfabeticamente le località trovate per quel CAP
    cities_sorted = sorted(cities_set, key=lambda x: x.lower())
    primary_city = cities_sorted[0] if cities_sorted else None
    final_prov = (it_prov or ext_prov) if country in ("IT", "US", "CA", "AU") else ""

    return {
        "country": country,
        "cap": cap,
        "city": primary_city,
        "cities": cities_sorted,
        "province": final_prov or None,
        "valid": valid,
    }

class CustomTopUpInput(BaseModel):
    amount: float = Field(gt=0, le=100000); method: str; origin_url: str

@extra_router.post("/wallet/topup-custom")
async def custom_topup(inp: CustomTopUpInput, user=Depends(require_approved)):
    stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if inp.method == "bonifico":
        doc = {"id": new_id(), "user_id": user["id"], "reseller_id": user.get("reseller_id"), "amount": inp.amount,
               "method": "bonifico", "status": "pending", "created_at": now_iso(),
               "instructions": {"beneficiario": "SpedPortal S.r.l.", "iban": "IT60 X054 2811 1010 0000 0123 456",
                                "banca": "Banca Demo S.p.A.", "causale": f"Ricarica {user['id'][:8]} — €{inp.amount:.2f}"}}
        await db.bank_transfers.insert_one(doc); doc.pop("_id", None)
        return doc
    if not stripe.api_key: raise HTTPException(400, "Chiave Stripe non configurata in backend/.env")
    pm = ["card"] if inp.method == "card" else ["paypal"]
    try:
        session = stripe.checkout.Session.create(
            mode="payment", payment_method_types=pm,
            line_items=[{"price_data": {"currency": "eur", "product_data": {"name": "Ricarica credito SpedPortal"}, "unit_amount": int(inp.amount * 100)}, "quantity": 1}],
            success_url=f"{inp.origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}", cancel_url=f"{inp.origin_url}/payment/cancel",
            metadata={"user_id": user["id"], "amount": str(inp.amount), "method": inp.method},
        )
    except Exception as e:
        raise HTTPException(500, f"Errore Stripe: {e}")
    await db.payment_transactions.insert_one({
        "session_id": session.id, "user_id": user["id"], "reseller_id": user.get("reseller_id"),
        "package_id": "custom", "amount": inp.amount, "currency": "eur", "status": "initiated",
        "payment_status": "pending", "method": inp.method, "created_at": now_iso(), "updated_at": now_iso(),
    })
    return {"checkout_url": session.url, "session_id": session.id}
