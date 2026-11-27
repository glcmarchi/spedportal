import os
import time
import httpx
from fastapi import APIRouter
from typing import Dict, Any

health_router = APIRouter(prefix="/api/health", tags=["Health & Diagnostics"])


def get_database():
    """
    Risolve il database MongoDB in modo lazy all'esecuzione della richiesta.
    Evita qualsiasi potenziale blocco di import circolare tra server.py e health.py.
    """
    import server
    return getattr(server, "db", None)


@health_router.api_route("", methods=["GET", "HEAD"], summary="Liveness Probe Rapido")
async def liveness_check():
    """
    Check rapido per UptimeRobot, Render e monitor esterni.
    Supporta nativamente sia chiamate GET che HEAD restituendo 200 OK.
    """
    start_time = time.time()
    db_status = "down"
    
    db = get_database()
    if db is not None:
        try:
            await db.command("ping")
            db_status = "operational"
        except Exception as e:
            db_status = f"unhealthy: {str(e)}"
    else:
        db_status = "database_reference_not_found"

    total_latency_ms = round((time.time() - start_time) * 1000, 2)
    overall_status = "operational" if db_status == "operational" else "degraded"

    return {
        "status": overall_status,
        "environment": os.getenv("ENVIRONMENT", "prod"),
        "latency_ms": total_latency_ms,
        "database": db_status,
    }


@health_router.get("/deep", summary="Diagnostica Approfondita")
async def deep_diagnostic_check():
    """
    Diagnostica completa per il pannello Super Admin di SpedPortal.
    Misura le latenze di MongoDB, FedEx, servizio CAP (Zippopotam) e servizio Email (Resend).
    """
    results: Dict[str, Any] = {}
    is_degraded = False

    # 1. Test Connessione MongoDB Atlas
    t0 = time.time()
    db = get_database()
    if db is not None:
        try:
            await db.command("ping")
            results["database"] = {
                "status": "operational",
                "latency_ms": round((time.time() - t0) * 1000, 2),
            }
        except Exception as e:
            is_degraded = True
            results["database"] = {
                "status": "down",
                "error": str(e),
                "latency_ms": round((time.time() - t0) * 1000, 2),
            }
    else:
        is_degraded = True
        results["database"] = {
            "status": "down",
            "error": "Istanza database non inizializzata",
            "latency_ms": round((time.time() - t0) * 1000, 2),
        }

    # 2. Test Connettore FedEx (Handshake endpoint OAuth)
    t0 = time.time()
    fedex_base_url = os.getenv("FEDEX_BASE_URL", "https://apis-sandbox.fedex.com").rstrip("/")
    fedex_mode = "production" if ("apis.fedex.com" in fedex_base_url and "sandbox" not in fedex_base_url) else "sandbox"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(
                f"{fedex_base_url}/oauth/token",
                data={"grant_type": "client_credentials"},
            )
            # 200, 400, 401 indicano che i server FedEx rispondono regolarmente alla connessione
            if resp.status_code in [200, 400, 401]:
                results["fedex_carrier"] = {
                    "status": "operational",
                    "mode": fedex_mode,
                    "latency_ms": round((time.time() - t0) * 1000, 2),
                    "http_status": resp.status_code,
                }
            else:
                is_degraded = True
                results["fedex_carrier"] = {
                    "status": "degraded",
                    "mode": fedex_mode,
                    "http_status": resp.status_code,
                    "latency_ms": round((time.time() - t0) * 1000, 2),
                }
    except Exception as e:
        is_degraded = True
        results["fedex_carrier"] = {
            "status": "unreachable",
            "mode": fedex_mode,
            "error": str(e),
            "latency_ms": round((time.time() - t0) * 1000, 2),
        }

    # 3. Test Lookup Territoriale CAP (Zippopotam)
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get("https://api.zippopotam.us/IT/20121")
            results["geo_service"] = {
                "status": "operational" if resp.status_code == 200 else "degraded",
                "latency_ms": round((time.time() - t0) * 1000, 2),
            }
    except Exception as e:
        results["geo_service"] = {
            "status": "down",
            "error": str(e),
            "latency_ms": round((time.time() - t0) * 1000, 2),
        }

    # 4. Test Servizio Notifiche / Email (Resend)
    t0 = time.time()
    resend_api_key = os.getenv("RESEND_API_KEY", "")
    if not resend_api_key:
        results["email_service"] = {
            "status": "not_configured",
            "message": "RESEND_API_KEY non impostata",
        }
    else:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(
                    "https://api.resend.com/domains",
                    headers={"Authorization": f"Bearer {resend_api_key}"},
                )
                results["email_service"] = {
                    "status": "operational" if resp.status_code in [200, 401, 403] else "degraded",
                    "latency_ms": round((time.time() - t0) * 1000, 2),
                    "http_status": resp.status_code,
                }
        except Exception as e:
            results["email_service"] = {
                "status": "unreachable",
                "error": str(e),
                "latency_ms": round((time.time() - t0) * 1000, 2),
            }

    return {
        "status": "operational" if not is_degraded else "degraded",
        "environment": os.getenv("ENVIRONMENT", "prod"),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "services": results,
    }
