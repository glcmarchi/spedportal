import os
import time
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
import httpx

logger = logging.getLogger("spedportal.fedex")

FEDEX_BASE_URL = os.environ.get("FEDEX_BASE_URL", "https://apis-sandbox.fedex.com").rstrip("/")
FEDEX_CLIENT_ID = os.environ.get("FEDEX_CLIENT_ID", "")
FEDEX_CLIENT_SECRET = os.environ.get("FEDEX_CLIENT_SECRET", "")
FEDEX_DOC_URL = (
    "https://documentapi.prod.fedex.com"
    if "apis.fedex.com" in FEDEX_BASE_URL and "sandbox" not in FEDEX_BASE_URL
    else "https://documentapitest.prod.fedex.com/sandbox"
)

_TOKEN_CACHE: Dict[str, Any] = {"access_token": None, "expires_at": 0.0}

TRANSIT_MAP = {
    "ONE_DAY": 1, "TWO_DAYS": 2, "THREE_DAYS": 3, "FOUR_DAYS": 4,
    "FIVE_DAYS": 5, "SIX_DAYS": 6, "SEVEN_DAYS": 7, "EIGHT_DAYS": 8,
}

SERVICE_COMMIT_HINTS = {
    "FEDEX_FIRST": "Consegna mattutina urgente entro le 10:00",
    "FEDEX_FIRST_OVERNIGHT": "Consegna mattutina urgente entro le 08:30 / 10:00",
    "INTERNATIONAL_FIRST": "Consegna mattutina prioritaria entro le 10:00",
    "FEDEX_PRIORITY_EXPRESS": "Consegna espressa prioritaria entro le 12:00",
    "FEDEX_INTERNATIONAL_PRIORITY_EXPRESS": "Consegna espressa prioritaria entro le 12:00",
    "PRIORITY_OVERNIGHT": "Consegna espressa entro le 10:30 / 12:00",
    "FEDEX_PRIORITY": "Consegna espressa entro fine giornata lavorativa",
    "STANDARD_OVERNIGHT": "Consegna espressa entro fine giornata",
    "INTERNATIONAL_PRIORITY": "Consegna espressa prioritaria entro fine giornata",
    "FEDEX_INTERNATIONAL_PRIORITY": "Consegna espressa prioritaria entro fine giornata",
    "FEDEX_INTERNATIONAL_CONNECT_PLUS": "Consegna e-commerce internazionale programmata",
    "INTERNATIONAL_ECONOMY": "Consegna economica programmata",
    "FEDEX_REGIONAL_ECONOMY": "Consegna stradale programmata Europa",
}

FEDEX_STATUS_MAP = {
    "OC": "created",
    "AP": "created",
    "PU": "in_transit",
    "IT": "in_transit",
    "AR": "in_transit",
    "DP": "in_transit",
    "AF": "in_transit",
    "CC": "in_customs",
    "CD": "in_customs",
    "OD": "out_for_delivery",
    "DL": "delivered",
    "DE": "exception",
    "SE": "exception",
    "HL": "exception",
    "CA": "cancelled",
    "RS": "exception",
}


def resolve_fedex_packaging(parcel_type: str, parcels: List[Dict[str, Any]]) -> str:
    """Mappa in sicurezza la tipologia di imballaggio neutrale sul packagingType FedEx."""
    pt = (parcel_type or "pacco").lower().strip()
    max_w = max((float(p.get("weight", 1.0)) for p in parcels), default=1.0)
    if pt in ("busta", "documenti", "busta_documenti"):
        if max_w <= 0.5 and len(parcels) == 1:
            return "FEDEX_ENVELOPE"
        if max_w <= 2.5:
            return "FEDEX_PAK"
        return "YOUR_PACKAGING"
    if pt == "busta_imbottita":
        return "FEDEX_PAK" if max_w <= 9.0 else "YOUR_PACKAGING"
    return "YOUR_PACKAGING"


def is_fedex_configured() -> bool:
    return bool(FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET)


async def get_fedex_token(child_key: Optional[str] = None, child_secret: Optional[str] = None) -> str:
    if not is_fedex_configured():
        raise RuntimeError("FEDEX_CLIENT_ID o FEDEX_CLIENT_SECRET non configurati su Render")

    now = time.time()
    if not child_key and _TOKEN_CACHE["access_token"] and now < (_TOKEN_CACHE["expires_at"] - 60):
        return _TOKEN_CACHE["access_token"]

    form_data = {
        "grant_type": "csp_credentials" if (child_key and child_secret) else "client_credentials",
        "client_id": FEDEX_CLIENT_ID,
        "client_secret": FEDEX_CLIENT_SECRET,
    }
    if child_key and child_secret:
        form_data["child_Key"] = child_key
        form_data["child_secret"] = child_secret

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{FEDEX_BASE_URL}/oauth/token",
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            logger.error("FedEx OAuth error %s: %s", resp.status_code, resp.text)
            raise RuntimeError(f"Errore autenticazione FedEx ({resp.status_code})")
        body = resp.json()
        token = body["access_token"]
        expires_in = int(body.get("expires_in", 3600))
        if not child_key:
            _TOKEN_CACHE["access_token"] = token
            _TOKEN_CACHE["expires_at"] = now + expires_in
        return token


def _headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-locale": "it_IT",
        "x-customer-transaction-id": str(uuid.uuid4()),
    }


def _extract_fedex_error(resp: httpx.Response, default_msg: str) -> str:
    try:
        data = resp.json()
        errs = data.get("errors") or []
        if errs:
            code = errs[0].get("code", "")
            msg = errs[0].get("message", default_msg)
            return f"{msg} [{code}]" if code else msg
    except Exception:
        pass
    return f"{default_msg} (HTTP {resp.status_code})"


async def validate_fedex_postal(country_code: str, postal_code: str, state_code: str = "") -> Optional[Dict[str, Any]]:
    if not is_fedex_configured() or not postal_code:
        return None
    token = await get_fedex_token()
    ship_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cc = (country_code or "IT").upper().strip()
    payload: Dict[str, Any] = {
        "carrierCode": "FDXE",
        "countryCode": cc,
        "postalCode": str(postal_code).strip().upper(),
        "shipDate": ship_date,
        "stateOrProvinceCode": (state_code or "").strip().upper()[:2],
        "checkForMismatch": False,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{FEDEX_BASE_URL}/country/v1/postal/validate",
                json=payload,
                headers=_headers(token),
            )
            if resp.status_code != 200:
                return {"valid": False, "error": "CAP non riconosciuto per la nazione selezionata"}
            out = (resp.json().get("output") or {})
            return {
                "valid": True,
                "cleaned_postal_code": out.get("cleanedPostalCode") or postal_code,
                "province": (out.get("stateOrProvinceCode") or "")[:2].upper(),
                "city_initials": out.get("cityFirstInitials") or "",
            }
    except Exception as e:
        logger.warning("FedEx Postal Validation fallback: %s", e)
        return None


async def validate_fedex_address(addr: Dict[str, Any]) -> Dict[str, Any]:
    if not is_fedex_configured():
        return {"supported": False}
    token = await get_fedex_token()
    cc = (addr.get("country") or "IT").upper().strip()
    address_block: Dict[str, Any] = {
        "streetLines": _split_street(addr.get("address", "")),
        "city": (addr.get("city") or "")[:35],
        "postalCode": str(addr.get("postal_code", "")).strip(),
        "countryCode": cc,
    }
    prov = (addr.get("province") or "").strip().upper()
    if prov and cc in ("IT", "US", "CA", "AU"):
        address_block["stateOrProvinceCode"] = prov[:2]

    payload = {
        "validateAddressControlParameters": {"includeResolutionTokens": True},
        "addressesToValidate": [{"address": address_block}],
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{FEDEX_BASE_URL}/address/v1/addresses/resolve",
                json=payload,
                headers=_headers(token),
            )
            if resp.status_code != 200:
                return {"supported": False}
            resolved_list = ((resp.json().get("output") or {}).get("resolvedAddresses")) or []
            if not resolved_list:
                return {"supported": False}
            ra = resolved_list[0]
            attrs = ra.get("attributes") or {}
            if attrs.get("CountrySupported") is False:
                return {"supported": False}
            classification = (ra.get("classification") or "UNKNOWN").upper()
            msgs = [m.get("message") for m in (ra.get("customerMessage") or []) if isinstance(m, dict) and m.get("message")]
            return {
                "supported": True,
                "resolved": bool(attrs.get("Resolved", True)),
                "matched": bool(attrs.get("Matched", True)),
                "classification": classification,
                "is_residential": classification == "RESIDENTIAL",
                "normalized_street": ", ".join(ra.get("streetLinesToken") or []),
                "normalized_city": ra.get("city") or addr.get("city", ""),
                "normalized_province": ra.get("stateOrProvinceCode") or prov,
                "messages": msgs,
            }
    except Exception as e:
        logger.warning("FedEx Address Validation error: %s", e)
        return {"supported": False}


async def get_fedex_transit_times(
    sender: Dict[str, Any],
    recipient: Dict[str, Any],
    parcels: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not is_fedex_configured():
        return []
    token = await get_fedex_token()
    ship_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s_country = (sender.get("country") or "IT").upper()
    r_country = (recipient.get("country") or "IT").upper()

    req_ship: Dict[str, Any] = {
        "shipper": {"address": _addr_obj(sender, False)},
        "recipients": [{"address": _addr_obj(recipient, False)}],
        "shipDatestamp": ship_date,
        "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
        "packagingType": "YOUR_PACKAGING",
        "requestedPackageLineItems": _build_package_items(parcels, 0.0, False),
    }
    if s_country != r_country:
        total_w = round(sum(float(p["weight"]) for p in parcels), 2)
        req_ship["customsClearanceDetail"] = {
            "commodities": [{
                "description": "Commercial Goods",
                "numberOfPieces": max(1, len(parcels)),
                "weight": {"units": "KG", "value": max(0.1, total_w)},
                "customsValue": {"amount": 50.0, "currency": "EUR"},
            }]
        }

    payload = {
        "requestedShipment": req_ship,
        "carrierCodes": ["FDXE"],
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{FEDEX_BASE_URL}/availability/v1/transittimes",
                json=payload,
                headers=_headers(token),
            )
            if resp.status_code != 200:
                return []
            tt_list = ((resp.json().get("output") or {}).get("transitTimes")) or []
            out = []
            for block in tt_list:
                for d in block.get("transitTimeDetails") or []:
                    commit = d.get("commit") or {}
                    td = commit.get("transitDays") or {}
                    dd = commit.get("dateDetail") or {}
                    out.append({
                        "service_type": d.get("serviceType", ""),
                        "service_name": d.get("serviceName", ""),
                        "transit_days": TRANSIT_MAP.get(td.get("minimumTransitTime", ""), 2),
                        "delivery_day": dd.get("day", ""),
                        "delivery_time": dd.get("time", ""),
                        "cutoff_time": commit.get("cutOffTime", ""),
                    })
            return out
    except Exception:
        return []


async def upload_fedex_etd_documents(
    origin_country: str,
    destination_country: str,
    documents: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not is_fedex_configured() or not documents:
        return {"uploaded": [], "paperless_ok": False, "fallback_paper": True}

    token = await get_fedex_token()
    meta_list = []
    for idx, d in enumerate(documents, start=1):
        b64 = d.get("base64") or ""
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        if not b64:
            continue
        meta_list.append({
            "fileReferenceId": f"DOC_{idx}_{uuid.uuid4().hex[:6]}",
            "contentType": d.get("content_type") or "application/pdf",
            "shipDocumentType": d.get("doc_type") or "PRO_FORMA_INVOICE",
            "fileContentBase64": b64,
        })

    if not meta_list:
        return {"uploaded": [], "paperless_ok": False, "fallback_paper": True}

    payload = {
        "workflowName": "ETDPreshipment",
        "carrierCode": "FDXE",
        "originCountryCode": (origin_country or "IT").upper(),
        "destinationCountryCode": (destination_country or "CH").upper(),
        "metaData": meta_list,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{FEDEX_DOC_URL}/documents/v1/etds/encodedmultiupload",
                json=payload,
                headers=_headers(token),
            )
            if resp.status_code not in (200, 201):
                logger.warning("FedEx ETD upload %s: %s", resp.status_code, resp.text[:500])
                return {"uploaded": [], "paperless_ok": False, "fallback_paper": True}

            data = resp.json()
            doc_resps = ((data.get("output") or {}).get("documentResponses")) or []
            uploaded = []
            for dr in doc_resps:
                md = dr.get("metaData") or {}
                if md.get("docId"):
                    uploaded.append({
                        "doc_id": md["docId"],
                        "doc_type": md.get("documentType") or "PRO",
                    })
            return {
                "uploaded": uploaded,
                "paperless_ok": len(uploaded) > 0,
                "fallback_paper": len(uploaded) == 0,
            }
    except Exception as e:
        logger.warning("FedEx ETD upload exception: %s", e)
        return {"uploaded": [], "paperless_ok": False, "fallback_paper": True}


def _build_package_items(
    parcels: List[Dict[str, Any]],
    insured_value: float = 0.0,
    is_envelope: bool = False,
) -> List[Dict[str, Any]]:
    items = []
    per_pkg_ins = round(insured_value / max(1, len(parcels)), 2) if insured_value > 0 else 0.0
    for idx, p in enumerate(parcels, start=1):
        entry: Dict[str, Any] = {
            "sequenceNumber": idx,
            "weight": {"units": "KG", "value": round(max(0.1, float(p["weight"])), 2)},
        }
        if not is_envelope:
            entry["dimensions"] = {
                "length": max(1, int(round(float(p["length"])))),
                "width": max(1, int(round(float(p["width"])))),
                "height": max(1, int(round(float(p["height"])))),
                "units": "CM",
            }
        if per_pkg_ins > 0:
            entry["declaredValue"] = {"amount": per_pkg_ins, "currency": "EUR"}
        items.append(entry)
    return items


def _extract_net_charge(rated_details: List[Dict[str, Any]]) -> Dict[str, Any]:
    chosen = None
    for preferred in ("ACCOUNT", "PREFERRED_CURRENCY", "PREFERRED_INCENTIVE", "LIST"):
        chosen = next((r for r in rated_details if r.get("rateType") == preferred), None)
        if chosen:
            break
    if not chosen and rated_details:
        chosen = rated_details[0]
    if not chosen:
        return {"net_charge": 0.0, "base_charge": 0.0, "surcharges": 0.0, "currency": "EUR", "surcharge_list": []}

    srd = chosen.get("shipmentRateDetail") or {}
    base = float(chosen.get("totalBaseCharge") or srd.get("totalBaseCharge") or 0.0)
    surcharges = float(srd.get("totalSurcharges") or 0.0)
    net = float(chosen.get("totalNetFedExCharge") or chosen.get("totalNetCharge") or (base + surcharges))
    currency = chosen.get("currency") or srd.get("currency") or "EUR"

    fx = srd.get("currencyExchangeRate") or {}
    rate = 1.0
    if currency != "EUR" and fx.get("intoCurrency") == "EUR" and fx.get("rate"):
        rate = float(fx["rate"])
        net = round(net * rate, 2)
        base = round(base * rate, 2)
        surcharges = round(surcharges * rate, 2)
        currency = "EUR"

    agg_surcharges: Dict[str, Dict[str, Any]] = {}

    def _collect(sc_list: List[Dict[str, Any]]):
        for sc in sc_list or []:
            amt = round(float(sc.get("amount") or 0.0) * rate, 2)
            if amt <= 0:
                continue
            sc_type = sc.get("type") or sc.get("surchargeType") or "SURCHARGE"
            sc_label = sc.get("description") or sc.get("name") or sc_type
            key = f"{sc_type}:{sc_label}"
            if key in agg_surcharges:
                agg_surcharges[key]["amount"] = round(agg_surcharges[key]["amount"] + amt, 2)
            else:
                agg_surcharges[key] = {"type": sc_type, "label": sc_label, "amount": amt}

    _collect(srd.get("surCharges") or [])
    for rpd in chosen.get("ratedPackageDetails") or []:
        prd = rpd.get("packageRateDetail") or {}
        _collect(prd.get("surCharges") or [])

    clean_surcharges = list(agg_surcharges.values())
    sum_items = round(sum(x["amount"] for x in clean_surcharges), 2)

    implied_surcharges = round(max(surcharges, net - base), 2)
    diff = round(implied_surcharges - sum_items, 2)
    if diff > 0.01:
        clean_surcharges.append({
            "type": "OTHER_SURCHARGES",
            "label": "Altri supplementi / Area remota / Diritti",
            "amount": diff,
        })
        sum_items = round(sum_items + diff, 2)

    final_base = round(max(0.0, net - sum_items), 2) if sum_items > 0 else round(net, 2)

    return {
        "net_charge": round(net, 2),
        "base_charge": final_base,
        "surcharges": sum_items,
        "currency": currency,
        "surcharge_list": clean_surcharges,
    }


def _addr_obj(addr: Dict[str, Any], residential: bool = False) -> Dict[str, Any]:
    cc = (addr.get("country") or "IT").upper()
    out: Dict[str, Any] = {
        "postalCode": str(addr.get("postal_code", "")).strip(),
        "countryCode": cc,
        "city": (addr.get("city") or "")[:35],
        "residential": bool(residential),
    }
    prov = (addr.get("province") or "").strip().upper()
    if prov and cc in ("IT", "US", "CA", "AU"):
        out["stateOrProvinceCode"] = prov[:2]
    return out


def _build_commodity_item(
    goods_description: str,
    origin_country: str,
    total_weight: float,
    pkg_count: int,
    customs_value: float,
    currency: str = "EUR",
    hs_code: str = "",
) -> Dict[str, Any]:
    val = round(max(1.0, float(customs_value or 50.0)), 2)
    curr = (currency or "EUR").upper()
    item: Dict[str, Any] = {
        "description": (goods_description or "Commercial Goods Sample")[:400],
        "countryOfManufacture": origin_country,
        "numberOfPieces": max(1, int(pkg_count)),
        "quantity": 1,
        "quantityUnits": "PCS",
        "weight": {"units": "KG", "value": max(0.1, total_weight)},
        "unitPrice": {"amount": val, "currency": curr},
        "customsValue": {"amount": val, "currency": curr},
    }
    clean_hs = "".join(ch for ch in (hs_code or "") if ch.isdigit())
    if len(clean_hs) >= 6:
        item["harmonizedCode"] = clean_hs[:10]
    return item


async def get_fedex_rates(
    account_number: str,
    sender: Dict[str, Any],
    recipient: Dict[str, Any],
    parcels: List[Dict[str, Any]],
    parcel_type: str = "pacco",
    customs_required: bool = False,
    incoterms: str = "DAP",
    customs_value: float = 0.0,
    customs_currency: str = "EUR",
    hs_code: str = "",
    goods_description: str = "",
    insured_value: float = 0.0,
    saturday_delivery: bool = False,
    residential_delivery: bool = False,
    cod_amount: float = 0.0,
) -> List[Dict[str, Any]]:
    token = await get_fedex_token()
    ship_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s_country = (sender.get("country") or "IT").upper()
    r_country = (recipient.get("country") or "IT").upper()
    is_intl = s_country != r_country
    pkg_type = resolve_fedex_packaging(parcel_type, parcels)
    is_env = pkg_type == "FEDEX_ENVELOPE"

    requested_shipment: Dict[str, Any] = {
        "shipper": {"address": _addr_obj(sender, False)},
        "recipient": {"address": _addr_obj(recipient, residential_delivery)},
        "shipDateStamp": ship_date,
        "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
        "packagingType": pkg_type,
        "rateRequestType": ["ACCOUNT", "LIST"],
        "preferredCurrency": "EUR",
        "requestedPackageLineItems": _build_package_items(parcels, insured_value, is_env),
    }

    special_types = []
    special_block: Dict[str, Any] = {}
    if saturday_delivery:
        special_types.append("SATURDAY_DELIVERY")
    if cod_amount > 0:
        special_types.append("COD")
        special_block["shipmentCODDetail"] = {
            "codCollectionType": "ANY",
            "codCollectionAmount": {"amount": round(float(cod_amount), 2), "currency": "EUR"},
        }
    if special_types:
        special_block["specialServiceTypes"] = special_types
        requested_shipment["shipmentSpecialServices"] = special_block

    if is_intl or customs_required:
        total_w = round(sum(float(p["weight"]) for p in parcels), 2)
        val = round(max(1.0, float(customs_value or insured_value or 50.0)), 2)
        curr = (customs_currency or "EUR").upper()
        comm: Dict[str, Any] = {
            "description": (goods_description or "Documents" if parcel_type == "documenti" else "Commercial Goods")[:400],
            "quantity": 1,
            "quantityUnits": "PCS",
            "weight": {"units": "KG", "value": max(0.1, total_w)},
            "customsValue": {"amount": val, "currency": curr},
        }
        clean_hs = "".join(ch for ch in (hs_code or "") if ch.isdigit())
        if len(clean_hs) >= 6:
            comm["harmonizedCode"] = clean_hs[:10]

        requested_shipment["customsClearanceDetail"] = {
            "dutiesPayment": {"paymentType": "SENDER"},
            "commodities": [comm],
        }

    payload = {
        "accountNumber": {"value": str(account_number).strip()},
        "rateRequestControlParameters": {
            "returnTransitTimes": True,
        },
        "requestedShipment": requested_shipment,
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = None
        for attempt in range(2):
            resp = await client.post(
                f"{FEDEX_BASE_URL}/rate/v1/rates/quotes",
                json=payload,
                headers=_headers(token),
            )
            if resp.status_code == 200:
                break
            if resp.status_code >= 500 and attempt == 0:
                await asyncio.sleep(1.0)
                continue
            break

        if resp is None or resp.status_code != 200:
            detail = _extract_fedex_error(resp, "Errore Rate API") if resp is not None else "Nessuna risposta da FedEx"
            logger.warning("FedEx Rate API %s: %s", resp.status_code if resp else "ERR", resp.text[:700] if resp else "")
            raise RuntimeError(detail)

        data = resp.json()
        details = ((data.get("output") or {}).get("rateReplyDetails")) or []
        if not details:
            alerts = ((data.get("output") or {}).get("alerts")) or []
            alert_msg = alerts[0].get("message") if alerts else "Nessun servizio disponibile per la combinazione selezionata"
            raise RuntimeError(alert_msg)

        results = []
        for item in details:
            rated = item.get("ratedShipmentDetails") or []
            parsed = _extract_net_charge(rated)
            if parsed["net_charge"] <= 0:
                continue
            svc_type = (item.get("serviceType") or "").upper()
            commit = item.get("commit") or {}
            td_obj = commit.get("transitDays") or {}
            dd_obj = commit.get("dateDetail") or {}
            op_detail = item.get("operationalDetail") or {}
            td_code = td_obj.get("minimumTransitTime") or op_detail.get("transitTime") or ""
            transit_days = TRANSIT_MAP.get(td_code, 2 if not is_intl else 3)

            commit_time = (dd_obj.get("time") or op_detail.get("commitTime") or "").strip()
            if commit_time and len(commit_time) >= 5:
                commit_hint = f"Consegna entro le {commit_time[:5]}"
            else:
                commit_hint = SERVICE_COMMIT_HINTS.get(svc_type, "Consegna programmata")

            results.append({
                "service_type": svc_type,
                "service_name": item.get("serviceName") or svc_type or "FedEx",
                "carrier_cost": parsed["net_charge"],
                "base_charge": parsed["base_charge"],
                "surcharges": parsed["surcharges"],
                "surcharge_list": parsed["surcharge_list"],
                "currency": parsed["currency"],
                "transit_days": transit_days,
                "commit_hint": commit_hint,
            })
        if not results:
            raise RuntimeError("FedEx ha restituito servizi senza tariffa associata")
        return results


def _split_street(addr: str) -> List[str]:
    clean = (addr or "").strip()
    if len(clean) <= 35:
        return [clean or "Via Roma 1"]
    return [clean[:35], clean[35:70]]


async def create_fedex_shipment(
    account_number: str,
    sender: Dict[str, Any],
    recipient: Dict[str, Any],
    parcels: List[Dict[str, Any]],
    service_type: str,
    parcel_type: str = "pacco",
    goods_description: str = "",
    customs_required: bool = False,
    incoterms: str = "DAP",
    customs_value: float = 0.0,
    customs_currency: str = "EUR",
    hs_code: str = "",
    etd_docs: Optional[List[Dict[str, Any]]] = None,
    insured_value: float = 0.0,
    saturday_delivery: bool = False,
    residential_delivery: bool = False,
    cod_amount: float = 0.0,
) -> Dict[str, Any]:
    token = await get_fedex_token()
    ship_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s_country = (sender.get("country") or "IT").upper()
    r_country = (recipient.get("country") or "IT").upper()
    total_w = round(sum(float(p["weight"]) for p in parcels), 2)
    pkg_type = resolve_fedex_packaging(parcel_type, parcels)
    is_env = pkg_type == "FEDEX_ENVELOPE"

    shipper_addr = {
        "streetLines": _split_street(sender.get("address", "")),
        **_addr_obj(sender, False),
    }
    recipient_addr = {
        "streetLines": _split_street(recipient.get("address", "")),
        **_addr_obj(recipient, residential_delivery),
    }

    requested_shipment: Dict[str, Any] = {
        "shipDatestamp": ship_date,
        "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
        "serviceType": service_type,
        "packagingType": pkg_type,
        "totalWeight": max(0.1, total_w),
        "shipper": {
            "address": shipper_addr,
            "contact": {
                "personName": (sender.get("reference") or sender.get("company_name") or "Mittente")[:35],
                "companyName": (sender.get("company_name") or "")[:35],
                "phoneNumber": "".join(ch for ch in (sender.get("phone") or "0200000000") if ch.isdigit())[:15] or "0200000000",
                "emailAddress": (sender.get("email") or "")[:80],
            },
        },
        "recipients": [
            {
                "address": recipient_addr,
                "contact": {
                    "personName": (recipient.get("reference") or recipient.get("company_name") or "Destinatario")[:35],
                    "companyName": (recipient.get("company_name") or "")[:35],
                    "phoneNumber": "".join(ch for ch in (recipient.get("phone") or "0200000000") if ch.isdigit())[:15] or "0200000000",
                    "emailAddress": (recipient.get("email") or "")[:80],
                },
            }
        ],
        "shippingChargesPayment": {
            "paymentType": "SENDER",
            "payor": {"responsibleParty": {"accountNumber": {"value": str(account_number).strip()}}},
        },
        "labelSpecification": {
            "labelFormatType": "COMMON2D",
            "imageType": "PDF",
            "labelStockType": "PAPER_4X6",
        },
        "requestedPackageLineItems": _build_package_items(parcels, insured_value, is_env),
    }

    special_types = []
    special_block: Dict[str, Any] = {}
    if saturday_delivery:
        special_types.append("SATURDAY_DELIVERY")
    if cod_amount > 0:
        special_types.append("COD")
        special_block["shipmentCODDetail"] = {
            "codCollectionType": "ANY",
            "codCollectionAmount": {"amount": round(float(cod_amount), 2), "currency": "EUR"},
        }

    etd_result = {"uploaded": [], "paperless_ok": False, "fallback_paper": False}
    if customs_required and etd_docs:
        etd_result = await upload_fedex_etd_documents(s_country, r_country, etd_docs)
        if etd_result["paperless_ok"]:
            special_types.append("ELECTRONIC_TRADE_DOCUMENTS")
            special_block["etdDetail"] = {
                "attachedDocuments": [
                    {
                        "documentType": item["doc_type"],
                        "documentId": item["doc_id"],
                    }
                    for item in etd_result["uploaded"]
                ]
            }

    if special_types:
        special_block["specialServiceTypes"] = special_types
        requested_shipment["shipmentSpecialServices"] = special_block

    if customs_required:
        duties_payor = "SENDER" if (incoterms or "DAP").upper() == "DDP" else "RECIPIENT"
        duties_block: Dict[str, Any] = {"paymentType": duties_payor}
        if duties_payor == "SENDER":
            duties_block["payor"] = {"responsibleParty": {"accountNumber": {"value": str(account_number).strip()}}}

        requested_shipment["customsClearanceDetail"] = {
            "dutiesPayment": duties_block,
            "commercialInvoice": {"shipmentPurpose": "SOLD"},
            "commodities": [
                _build_commodity_item(
                    goods_description=goods_description,
                    origin_country=s_country,
                    total_weight=total_w,
                    pkg_count=len(parcels),
                    customs_value=customs_value or insured_value or 50.0,
                    currency=customs_currency,
                    hs_code=hs_code,
                )
            ],
        }

    payload = {
        "labelResponseOptions": "LABEL",
        "accountNumber": {"value": str(account_number).strip()},
        "requestedShipment": requested_shipment,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{FEDEX_BASE_URL}/ship/v1/shipments",
            json=payload,
            headers=_headers(token),
        )
        if resp.status_code != 200:
            logger.error("FedEx Ship API %s: %s", resp.status_code, resp.text[:800])
            err_msg = _extract_fedex_error(resp, "Errore creazione spedizione FedEx")
            raise RuntimeError(f"FedEx: {err_msg}")

        data = resp.json()
        tx_ships = ((data.get("output") or {}).get("transactionShipments")) or []
        if not tx_ships:
            raise RuntimeError("Risposta FedEx Ship vuota")
        tx = tx_ships[0]
        tracking = tx.get("masterTrackingNumber") or ""
        label_b64 = ""

        for p_resp in tx.get("pieceResponses") or []:
            if not tracking and p_resp.get("trackingNumber"):
                tracking = p_resp["trackingNumber"]
            for doc in p_resp.get("packageDocuments") or []:
                if doc.get("encodedLabel"):
                    label_b64 = doc["encodedLabel"]
                    break
            if label_b64:
                break

        if not label_b64:
            for doc in tx.get("shipmentDocuments") or []:
                if doc.get("encodedLabel"):
                    label_b64 = doc["encodedLabel"]
                    break

        return {
            "tracking_number": tracking,
            "service_type": tx.get("serviceType", service_type),
            "service_name": tx.get("serviceName", "FedEx"),
            "label_pdf_base64": label_b64,
            "paperless_ok": etd_result["paperless_ok"],
            "fallback_paper": customs_required and not etd_result["paperless_ok"],
        }


async def cancel_fedex_shipment(
    account_number: str,
    tracking_number: str,
    sender_country_code: str = "IT",
) -> Dict[str, Any]:
    token = await get_fedex_token()
    payload = {
        "accountNumber": {"value": str(account_number).strip()},
        "trackingNumber": str(tracking_number).strip(),
        "senderCountryCode": (sender_country_code or "IT").upper(),
        "deletionControl": "DELETE_ALL_PACKAGES",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.put(
            f"{FEDEX_BASE_URL}/ship/v1/shipments/cancel",
            json=payload,
            headers=_headers(token),
        )
        if resp.status_code != 200:
            logger.error("FedEx Cancel API %s: %s", resp.status_code, resp.text[:600])
            err_msg = _extract_fedex_error(resp, "Errore annullamento spedizione FedEx")
            raise RuntimeError(f"FedEx: {err_msg}")

        data = resp.json()
        out = data.get("output") or {}
        return {
            "cancelled": bool(out.get("cancelledShipment", True)),
            "message": out.get("message", "Shipment cancelled"),
        }


async def schedule_fedex_pickup(
    account_number: str,
    sender: Dict[str, Any],
    recipient_country: str,
    tracking_number: str,
    package_count: int,
    total_weight: float,
    pickup_date: str,
    ready_time: str = "10:00",
    close_time: str = "18:00",
    remarks: str = "",
) -> Dict[str, Any]:
    token = await get_fedex_token()
    s_country = (sender.get("country") or "IT").upper()
    r_country = (recipient_country or "IT").upper()
    is_intl = s_country != r_country

    ready_hhmmss = ready_time if len(ready_time) == 8 else f"{ready_time}:00"
    close_hhmmss = close_time if len(close_time) == 8 else f"{close_time}:00"
    ready_ts = f"{pickup_date}T{ready_hhmmss}Z"

    phone_digits = "".join(ch for ch in (sender.get("phone") or "0200000000") if ch.isdigit())
    if len(phone_digits) < 8:
        phone_digits = phone_digits.ljust(10, "0")

    pickup_addr: Dict[str, Any] = {
        "streetLines": _split_street(sender.get("address", "")),
        "city": (sender.get("city") or "")[:35],
        "postalCode": str(sender.get("postal_code", "")).strip(),
        "countryCode": s_country,
        "residential": False,
    }
    prov = (sender.get("province") or "").strip().upper()
    if prov and s_country in ("IT", "US", "CA", "AU"):
        pickup_addr["stateOrProvinceCode"] = prov[:2]

    payload: Dict[str, Any] = {
        "associatedAccountNumber": {"value": str(account_number).strip()},
        "carrierCode": "FDXE",
        "countryRelationships": "INTERNATIONAL" if is_intl else "DOMESTIC",
        "packageCount": max(1, int(package_count)),
        "totalWeight": {"units": "KG", "value": round(max(0.5, float(total_weight)), 2)},
        "trackingNumber": str(tracking_number).strip(),
        "originDetail": {
            "pickupAddressType": "SHIPPER",
            "pickupLocation": {
                "contact": {
                    "companyName": (sender.get("company_name") or "Mittente")[:35],
                    "personName": (sender.get("reference") or sender.get("company_name") or "Mittente")[:35],
                    "phoneNumber": phone_digits[:13],
                },
                "address": pickup_addr,
            },
            "readyDateTimestamp": ready_ts,
            "customerCloseTime": close_hhmmss,
            "packageLocation": "FRONT",
        },
    }
    if remarks:
        payload["remarks"] = remarks.strip()[:60]

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(
            f"{FEDEX_BASE_URL}/pickup/v1/pickups",
            json=payload,
            headers=_headers(token),
        )
        if resp.status_code != 200:
            logger.error("FedEx Pickup API %s: %s", resp.status_code, resp.text[:800])
            err_msg = _extract_fedex_error(resp, "Errore prenotazione ritiro FedEx")
            raise RuntimeError(f"FedEx: {err_msg}")

        data = resp.json()
        out = data.get("output") or {}
        return {
            "confirmation_code": str(out.get("pickupConfirmationCode") or ""),
            "location": str(out.get("location") or ""),
            "scheduled_date": pickup_date,
            "ready_time": ready_time,
            "close_time": close_time,
            "remarks": remarks,
        }


async def cancel_fedex_pickup(
    account_number: str,
    confirmation_code: str,
    scheduled_date: str,
    location: str = "",
) -> Dict[str, Any]:
    token = await get_fedex_token()
    payload: Dict[str, Any] = {
        "associatedAccountNumber": {"value": str(account_number).strip()},
        "pickupConfirmationCode": str(confirmation_code).strip(),
        "carrierCode": "FDXE",
        "scheduledDate": scheduled_date,
    }
    if location:
        payload["location"] = location

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.put(
            f"{FEDEX_BASE_URL}/pickup/v1/pickups/cancel",
            json=payload,
            headers=_headers(token),
        )
        if resp.status_code != 200:
            logger.error("FedEx Cancel Pickup %s: %s", resp.status_code, resp.text[:600])
            err_msg = _extract_fedex_error(resp, "Errore annullamento ritiro FedEx")
            raise RuntimeError(f"FedEx: {err_msg}")

        data = resp.json()
        out = data.get("output") or {}
        return {
            "cancelled": True,
            "message": out.get("cancelConfirmationMessage", "Ritiro annullato"),
        }


async def track_fedex_shipment(tracking_number: str) -> Optional[Dict[str, Any]]:
    if not is_fedex_configured() or not tracking_number:
        return None
    token = await get_fedex_token()
    payload = {
        "includeDetailedScans": True,
        "trackingInfo": [
            {
                "trackingNumberInfo": {
                    "trackingNumber": str(tracking_number).strip()
                }
            }
        ],
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{FEDEX_BASE_URL}/track/v1/trackingnumbers",
            json=payload,
            headers=_headers(token),
        )
        if resp.status_code != 200:
            logger.warning("FedEx Track API %s: %s", resp.status_code, resp.text[:400])
            return None

        data = resp.json()
        complete = ((data.get("output") or {}).get("completeTrackResults")) or []
        if not complete:
            return None
        track_results = complete[0].get("trackResults") or []
        if not track_results:
            return None
        tr = track_results[0]

        if tr.get("error"):
            logger.info("FedEx Track notice for %s: %s", tracking_number, tr["error"].get("message"))
            return None

        latest = tr.get("latestStatusDetail") or {}
        raw_code = (latest.get("derivedCode") or latest.get("code") or "").upper()
        mapped_status = FEDEX_STATUS_MAP.get(raw_code, "in_transit" if raw_code else "created")
        status_label = latest.get("statusByLocale") or latest.get("description") or ""

        events = []
        for ev in tr.get("scanEvents") or []:
            loc = ev.get("scanLocation") or {}
            city = loc.get("city") or ""
            country = loc.get("countryCode") or ""
            place = ", ".join([x for x in (city, country) if x])
            desc = ev.get("eventDescription") or ev.get("derivedStatus") or ""
            if ev.get("exceptionDescription"):
                desc = f"{desc} — {ev['exceptionDescription']}"
            events.append({
                "ts": ev.get("date") or "",
                "code": (ev.get("derivedStatusCode") or ev.get("eventType") or "").lower(),
                "label": desc,
                "location": place,
            })

        estimated_delivery = None
        actual_delivery = None
        for dt in tr.get("dateAndTimes") or []:
            if dt.get("type") == "ACTUAL_DELIVERY":
                actual_delivery = dt.get("dateTime")
            elif dt.get("type") in ("ESTIMATED_DELIVERY", "COMMITMENT") and not estimated_delivery:
                estimated_delivery = dt.get("dateTime")

        delivery_details = tr.get("deliveryDetails") or {}
        signed_by = delivery_details.get("signedByName") or delivery_details.get("receivedByName") or ""

        return {
            "status": mapped_status,
            "raw_code": raw_code,
            "status_label": status_label,
            "events": events,
            "estimated_delivery": estimated_delivery,
            "actual_delivery": actual_delivery,
            "signed_by": signed_by,
        }
