import os
import time
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Dict, Any

# Se usi una funzione di get_current_user o get_super_admin per proteggere il check approfondito:
# from auth import get_current_super_admin 

# Importa l'istanza del client o database MongoDB dal tuo modulo database (es. db.py)
from database import db  # oppure dal modulo dove definisci il client Motor / PyMongo

router = APIRouter(prefix="/api/health", tags=["Health & Diagnostics"])


@router.get("", summary="Liveness Probe (Veloce)")
async def liveness_check():
    """
    Check rapido per UptimeRobot / Render:
    Verifica solo che il processo FastAPI sia vivo e che MongoDB risponda al ping.
    Non consuma chiamate esterne ai corrieri.
    """
    start_time = time.time()
    db_status = "down"
    try:
        # Comando ping standard di MongoDB
        await db.command("ping")
        db_status = "operational"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    total_latency_ms = round((time.time() - start_time) * 1000, 2)
    overall_status = "operational" if db_status == "operational" else "degraded"

    return {
        "status": overall_status,
        "environment": os.getenv("ENVIRONMENT", "dev"),
        "latency_ms": total_latency_ms,
        "database": db_status
    }


@router.get("/deep", summary="Diagnostica Approfondita & Stato Corrieri")
async def deep_diagnostic_check():
    """
    Diagnostica completa per la Dashboard Super Admin:
    Misura le latenze e la disponibilità di DB, FedEx, Servizi Geo ed Email.
    """
    results: Dict[str, Any] = {}
    is_degraded = False

    # 1. Test MongoDB Atlas
    t0 = time.time()
    try:
        await db.command("ping")
        results["database"] = {
            "status": "operational",
            "latency_ms": round((time.time() - t0) * 1000, 2)
        }
    except Exception as e:
        is_degraded = True
        results["database"] = {
            "status": "down",
            "error": str(e),
            "latency_ms": round((time.time() - t0) * 1000, 2)
        }

    # 2. Test Connettore FedEx (OAuth Reachability / Sandbox)
    t0 = time.time()
    fedex_mode = os.getenv("FEDEX_ENVIRONMENT", "sandbox").lower()
    fedex_base_url = (
        "https://apis-sandbox.fedex.com" 
        if fedex_mode == "sandbox" 
        else "https://apis.fedex.com"
    )
    try:
        # Ping all'endpoint OAuth per verificare raggiungibilità e handshake SSL
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(
                f"{fedex_base_url}/oauth/token",
                data={"grant_type": "client_credentials"}
            )
            # 401 è normale qui (non abbiamo inviato credenziali segrete): dimostra che l'API risponde
            if resp.status_code in [200, 400, 401]:
                results["fedex_carrier"] = {
                    "status": "operational",
                    "mode": fedex_mode,
                    "latency_ms": round((time.time() - t0) * 1000, 2),
                    "http_status": resp.status_code
                }
            else:
                is_degraded = True
                results["fedex_carrier"] = {
                    "status": "degraded",
                    "mode": fedex_mode,
                    "http_status": resp.status_code,
                    "latency_ms": round((time.time() - t0) * 1000, 2)
                }
    except Exception as e:
        is_degraded = True
        results["fedex_carrier"] = {
            "status": "unreachable",
            "mode": fedex_mode,
            "error": str(e),
            "latency_ms": round((time.time() - t0) * 1000, 2)
        }

    # 3. Test Servizio Lookup Geo / CAP (Zippopotam)
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            # Query di test rapida su un CAP italiano
            resp = await client.get("[suspicious link removed]")
            if resp.status_code == 200:
                results["geo_service"] = {
                    "status": "operational",
                    "provider": "zippopotam",
                    "latency_ms": round((time.time() - t0) * 1000, 2)
                }
            else:
                results["geo_service"] = {
                    "status": "degraded",
                    "http_status": resp.status_code,
                    "latency_ms": round((time.time() - t0) * 1000, 2)
                }
    except Exception as e:
        # Se Zippopotam è down non blocca le spedizioni, segnaliamo degraded
        results["geo_service"] = {
            "status": "down",
            "error": str(e),
            "latency_ms": round((time.time() - t0) * 1000, 2)
        }

    # 4. Test Servizio Notifiche / Email (Sender / Resend)
    t0 = time.time()
    sender_api_key = os.getenv("SENDER_API_KEY") or os.getenv("RESEND_API_KEY")
    if not sender_api_key:
        results["email_service"] = {
            "status": "not_configured",
            "message": "Nessuna API Key impostata in ENV"
        }
    else:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                # Test reachability delle API Sender (es. https://api.sender.net/v1/)
                resp = await client.get("https://api.sender.net/v1/subscribers", headers={
                    "Authorization": f"Bearer {sender_api_key}",
                    "Accept": "application/json"
                })
                # Se autentica o risponde entro il timeout, il servizio è up
                results["email_service"] = {
                    "status": "operational" if resp.status_code in [200, 401] else "degraded",
                    "latency_ms": round((time.time() - t0) * 1000, 2),
                    "http_status": resp.status_code
                }
        except Exception as e:
            results["email_service"] = {
                "status": "unreachable",
                "error": str(e),
                "latency_ms": round((time.time() - t0) * 1000, 2)
            }

    overall_status = "operational" if not is_degraded else "degraded"

    return {
        "status": overall_status,
        "environment": os.getenv("ENVIRONMENT", "dev"),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "services": results
    }
