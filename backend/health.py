import os
import time
import httpx
from fastapi import APIRouter
from typing import Dict, Any

from server import db

health_router = APIRouter(prefix="/api/health", tags=["Health & Diagnostics"])

@health_router.get("", summary="Liveness Probe Rapido")
async def liveness_check():
    start_time = time.time()
    db_status = "down"
    try:
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

@health_router.get("/deep", summary="Diagnostica Approfondita")
async def deep_diagnostic_check():
    results: Dict[str, Any] = {}
    is_degraded = False

    # 1. MongoDB Atlas Ping
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

    # 2. FedEx Reachability
    t0 = time.time()
    fedex_mode = os.getenv("FEDEX_ENVIRONMENT", "sandbox").lower()
    fedex_base_url = "https://apis-sandbox.fedex.com" if fedex_mode == "sandbox" else "https://apis.fedex.com"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(f"{fedex_base_url}/oauth/token", data={"grant_type": "client_credentials"})
            if resp.status_code in :
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

    # 3. Geo Lookup (Zippopotam)
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get("[suspicious link removed]")
            results["geo_service"] = {
                "status": "operational" if resp.status_code == 200 else "degraded",
                "latency_ms": round((time.time() - t0) * 1000, 2)
            }
    except Exception as e:
        results["geo_service"] = {
            "status": "down",
            "error": str(e),
            "latency_ms": round((time.time() - t0) * 1000, 2)
        }

    return {
        "status": "operational" if not is_degraded else "degraded",
        "environment": os.getenv("ENVIRONMENT", "dev"),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "services": results
    }
