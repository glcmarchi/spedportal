import os
import time
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
import httpx

logger = logging.getLogger("spedportal.fedex")

FEDEX_BASE_URL = os.environ.get("FEDEX_BASE_URL", "https://apis-sandbox.fedex.com").rstrip("/")
FEDEX_CLIENT_ID = os.environ.get("FEDEX_CLIENT_ID", "")
FEDEX_CLIENT_SECRET = os.environ.get("FEDEX_CLIENT_SECRET", "")

_TOKEN_CACHE: Dict[str, Any] = {"access_token": None, "expires_at": 0.0}

TRANSIT_MAP = {
    "ONE_DAY": 1, "TWO_DAYS": 2, "THREE_DAYS": 3, "FOUR_DAYS": 4,
    "FIVE_DAYS": 5, "SIX_DAYS": 6, "SEVEN_DAYS": 7, "EIGHT_DAYS": 8,
}

# Mappatura codici stato FedEx (latestStatusDetail.derivedCode / code) -> stati SpedPortal
FEDEX_STATUS_MAP = {
    "OC": "created",           # Order Created / Label Created
    "AP": "created",           # At Pickup
    "PU": "in_transit",        # Picked Up
    "IT": "in_transit",        # In Transit
    "AR": "in_transit",        # Arrived at FedEx location
    "DP": "in_transit",        # Departed FedEx location
    "AF": "in_transit",        # At local FedEx facility
    "CC": "in_customs",        # Cleared Customs
    "CD": "in_customs",        # Clearance Delay
    "OD": "out_for_delivery",  # Out for Delivery
    "DL": "delivered",         # Delivered
    "DE": "exception",         # Delivery Exception
    "SE": "exception",         # Shipment Exception
    "HL": "exception",         # Hold at Location
    "CA": "cancelled",         # Shipment Cancelled
    "RS": "exception",         # Return to Shipper
}


def is_fedex_configured() -> bool:
    return bool(FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET)


async def get_fedex_token(child_key: Optional[str] = None, child_secret: Optional[str] = None) -> str:
    """Ottiene o rinnova il Bearer Token OAuth 2.0 da FedEx (/oauth/token)."""
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


def _build_package_items(parcels: List[Dict[str, Any]], insured_value: float = 0.0) -> List[Dict[str, Any]]:
    items = []
    per_pkg_ins = round(insured_value / max(1, len(parcels)), 2) if insured_value > 0 else 0.0
    for idx, p in enumerate(parcels, start=1):
        entry: Dict[str, Any] = {
            "sequenceNumber": idx,
            "weight": {"units": "KG", "value": round(float(p["weight"]), 2)},
            "dimensions": {
                "length": max(1, int(round(float(p["length"])))),
                "width": max(1, int(round(float(p["width"])))),
                "height": max(1, int(round(float(p["height"])))),
                "units": "CM",
            },
        }
        if per_pkg_ins > 0:
            entry["declaredValue"] = {"amount": per_pkg_ins, "currency": "EUR"}
        items.append(entry)
    return items


def _extract_net_charge(rated_details: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Estrae nolo base + supplementi (escluse tasse/IVA) preferendo la tariffa contrattuale ACCOUNT."""
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
    base = float(chosen.get("totalBaseCharge") or 0.0)
    surcharges = float(srd.get("totalSurcharges") or 0.0)
    net = float(chosen.get("totalNetFedExCharge") or chosen.get("totalNetCharge") or (base + surcharges))
    currency = chosen.get("currency") or srd.get("currency") or "EUR"

    fx = srd.get("currencyExchangeRate") or {}
    if currency != "EUR" and fx.get("intoCurrency") == "EUR" and fx.get("rate"):
        rate = float(fx["rate"])
        net = round(net * rate, 2)
        base = round(base * rate, 2)
        surcharges = round(surcharges * rate, 2)
        currency = "EUR"

    return {
        "net_charge": round(net, 2),
        "base_charge": round(base, 2),
        "surcharges": round(surcharges, 2),
        "currency": currency,
        "surcharge_list": srd.get("surCharges") or [],
    }


async def get_fedex_rates(
    account_number: str,
    sender: Dict[str, Any],
    recipient: Dict[str, Any],
    parcels: List[Dict[str, Any]],
    parcel_type: str = "pacco",
    customs_required: bool = False,
    goods_description: str = "",
    insured_value: float = 0.0,
) -> List[Dict[str, Any]]:
    """Chiama POST /rate/v1/rates/quotes e restituisce i servizi disponibili con costi reali."""
    token = await get_fedex_token()
    ship_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s_country = (sender.get("country") or "IT").upper()
    r_country = (recipient.get("country") or "IT").upper()
    is_intl = s_country != r_country

    requested_shipment: Dict[str, Any] = {
        "shipper": {
            "address": {
                "postalCode": str(sender.get("postal_code", "")).strip(),
                "countryCode": s_country,
                "city": sender.get("city", ""),
            }
        },
        "recipient": {
            "address": {
                "postalCode": str(recipient.get("postal_code", "")).strip(),
                "countryCode": r_country,
                "city": recipient.get("city", ""),
            }
        },
        "shipDateStamp": ship_date,
        "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
        "packagingType": "FEDEX_ENVELOPE" if parcel_type in ("busta", "documenti") else "YOUR_PACKAGING",
        "rateRequestType": ["ACCOUNT", "LIST"],
        "preferredCurrency": "EUR",
        "requestedPackageLineItems": _build_package_items(parcels, insured_value),
    }

    if is_intl or customs_required:
        total_w = round(sum(float(p["weight"]) for p in parcels), 2)
        requested_shipment["customsClearanceDetail"] = {
            "dutiesPayment": {"paymentType": "SENDER"},
            "commodities": [
                {
                    "description": (goods_description or "Commercial Goods")[:400],
                    "quantity": 1,
                    "quantityUnits": "PCS",
                    "weight": {"units": "KG", "value": max(0.1, total_w)},
                    "customsValue": {"amount": max(1.0, insured_value or 50.0), "currency": "EUR"},
                }
            ],
        }

    payload = {
        "accountNumber": {"value": str(account_number).strip()},
        "rateRequestControlParameters": {
            "returnTransitTimes": True,
            "rateSortOrder": "COMMITASCENDING",
        },
        "requestedShipment": requested_shipment,
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        resp = await client.post(
            f"{FEDEX_BASE_URL}/rate/v1/rates/quotes",
            json=payload,
            headers=_headers(token),
        )
        if resp.status_code != 200:
            logger.warning("FedEx Rate API %s: %s", resp.status_code, resp.text[:500])
            raise RuntimeError(f"FedEx Rate API error {resp.status_code}")

        data = resp.json()
        details = ((data.get("output") or {}).get("rateReplyDetails")) or []
        results = []
        for item in details:
            rated = item.get("ratedShipmentDetails") or []
            parsed = _extract_net_charge(rated)
            if parsed["net_charge"] <= 0:
                continue
            commit = item.get("commit") or {}
            td_obj = commit.get("transitDays") or {}
            op_detail = item.get("operationalDetail") or {}
            td_code = td_obj.get("minimumTransitTime") or op_detail.get("transitTime") or ""
            transit_days = TRANSIT_MAP.get(td_code, 2 if not is_intl else 3)

            results.append({
                "service_type": item.get("serviceType", ""),
                "service_name": item.get("serviceName") or item.get("serviceType", "FedEx"),
                "carrier_cost": parsed["net_charge"],
                "base_charge": parsed["base_charge"],
                "surcharges": parsed["surcharges"],
                "surcharge_list": parsed["surcharge_list"],
                "currency": parsed["currency"],
                "transit_days": transit_days,
            })
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
    insured_value: float = 0.0,
) -> Dict[str, Any]:
    """Chiama POST /ship/v1/shipments e restituisce tracking_number reale ed etichetta PDF in Base64."""
    token = await get_fedex_token()
    ship_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    s_country = (sender.get("country") or "IT").upper()
    r_country = (recipient.get("country") or "IT").upper()
    is_intl = s_country != r_country
    total_w = round(sum(float(p["weight"]) for p in parcels), 2)

    requested_shipment: Dict[str, Any] = {
        "shipDatestamp": ship_date,
        "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
        "serviceType": service_type,
        "packagingType": "FEDEX_ENVELOPE" if parcel_type in ("busta", "documenti") else "YOUR_PACKAGING",
        "totalWeight": max(0.1, total_w),
        "shipper": {
            "address": {
                "streetLines": _split_street(sender.get("address", "")),
                "city": (sender.get("city") or "")[:35],
                "postalCode": str(sender.get("postal_code", "")).strip(),
                "countryCode": s_country,
            },
            "contact": {
                "personName": (sender.get("reference") or sender.get("company_name") or "Mittente")[:35],
                "companyName": (sender.get("company_name") or "")[:35],
                "phoneNumber": "".join(ch for ch in (sender.get("phone") or "0200000000") if ch.isdigit())[:15] or "0200000000",
                "emailAddress": (sender.get("email") or "")[:80],
            },
        },
        "recipients": [
            {
                "address": {
                    "streetLines": _split_street(recipient.get("address", "")),
                    "city": (recipient.get("city") or "")[:35],
                    "postalCode": str(recipient.get("postal_code", "")).strip(),
                    "countryCode": r_country,
                },
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
        "requestedPackageLineItems": _build_package_items(parcels, insured_value),
    }

    if is_intl or customs_required:
        requested_shipment["customsClearanceDetail"] = {
            "dutiesPayment": {
                "paymentType": "SENDER",
                "payor": {"responsibleParty": {"accountNumber": {"value": str(account_number).strip()}}},
            },
            "commercialInvoice": {"shipmentPurpose": "SOLD"},
            "commodities": [
                {
                    "description": (goods_description or "Commercial Goods")[:400],
                    "countryOfManufacture": s_country,
                    "quantity": 1,
                    "quantityUnits": "PCS",
                    "weight": {"units": "KG", "value": max(0.1, total_w)},
                    "customsValue": {"amount": max(1.0, insured_value or 50.0), "currency": "EUR"},
                }
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
            err_msg = "Errore creazione spedizione FedEx"
            try:
                errs = resp.json().get("errors") or []
                if errs:
                    err_msg = f"FedEx: {errs[0].get('message', err_msg)}"
            except Exception:
                pass
            raise RuntimeError(err_msg)

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
        }


async def track_fedex_shipment(tracking_number: str) -> Optional[Dict[str, Any]]:
    """Chiama POST /track/v1/trackingnumbers (Basic Integrated Visibility) per stato ed eventi reali."""
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
