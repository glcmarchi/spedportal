import os, logging, secrets
from html import escape
import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
from server import db, require_admin, hash_pw, new_id, now_iso

logger = logging.getLogger("spedportal.mail")
mail_router = APIRouter(prefix="/api")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "SpedPortal <onboarding@resend.dev>")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")


async def send_email(*, to: str, subject: str, html: str):
    if not to:
        return None
    if not RESEND_API_KEY:
        logger.info("[EMAIL MOCK -> %s] Subject: %s", to, subject)
        return "mock-email-id"
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": EMAIL_FROM, "to": [to], "subject": subject, "html": html},
            )
        r.raise_for_status()
        return r.json().get("id")
    except Exception as e:
        logger.error("Email send error to %s: %s", to, e)
        return None


async def get_reseller_notification_email(reseller_id: str | None) -> str:
    if reseller_id:
        res = await db.resellers.find_one({"id": reseller_id}, {"_id": 0, "notification_email": 1, "admin_email": 1})
        if res:
            return (res.get("notification_email") or res.get("admin_email") or "").strip()
    doc = await db.system_settings.find_one({"id": "platform_profile"}, {"_id": 0, "notification_email": 1})
    return (doc or {}).get("notification_email") or "admin@spedportal.it"


async def get_super_notification_email() -> str:
    doc = await db.system_settings.find_one({"id": "platform_profile"}, {"_id": 0, "notification_email": 1})
    return (doc or {}).get("notification_email") or "admin@spedportal.it"


def _wrap(inner_html: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;">'
        '<div style="background:#0f172a;color:#fff;padding:20px;"><b>SpedPortal</b></div>'
        f'<div style="padding:24px;line-height:1.5;color:#1e293b;">{inner_html}</div>'
        '</div>'
    )


def tpl_registration(name: str):
    return _wrap(
        f"<h2>Abbiamo ricevuto la tua richiesta</h2>"
        f"<p>Ciao <b>{escape(name)}</b>, la tua registrazione è stata ricevuta. "
        f"Il team sta verificando il tuo account e riceverai conferma appena sarà attivo.</p>"
    )


def tpl_new_client_admin_alert(company_name: str, client_email: str, phone: str = ""):
    return _wrap(
        f"<h2>Nuova registrazione Sub-Cliente</h2>"
        f"<p>Un nuovo cliente ha richiesto l'attivazione sul tuo portale:</p>"
        f"<ul>"
        f"<li><b>Azienda:</b> {escape(company_name)}</li>"
        f"<li><b>Email:</b> {escape(client_email)}</li>"
        f"<li><b>Telefono:</b> {escape(phone or '-')}</li>"
        f"</ul>"
        f"<p>Accedi alla sezione <b>Sub-Clienti</b> della tua console per approvare l'account e assegnare i margini.</p>"
    )


def tpl_approved(name: str, email: str, login_url: str):
    return _wrap(
        f"<h2>Benvenuto in SpedPortal, {escape(name)}!</h2>"
        f"<p>Il tuo account è attivo per <b>{escape(email)}</b>.</p>"
        f"<p><a href='{escape(login_url)}' style='display:inline-block;background:#ea580c;color:#fff;padding:10px 18px;text-decoration:none;font-weight:bold;'>Accedi alla Console →</a></p>"
    )


def tpl_reset(name: str, reset_url: str):
    return _wrap(
        f"<h2>Reimposta la tua password</h2>"
        f"<p>Ciao <b>{escape(name)}</b>, abbiamo ricevuto una richiesta di reset password per il tuo account.</p>"
        f"<p><a href='{escape(reset_url)}' style='display:inline-block;background:#ea580c;color:#fff;padding:10px 18px;text-decoration:none;font-weight:bold;'>Imposta Nuova Password →</a></p>"
        f"<p style='font-size:12px;color:#64748b;'>Il link è valido per 1 ora. Se non hai richiesto tu il reset, ignora questa email.</p>"
    )


class ForgotPwInput(BaseModel):
    email: EmailStr


class ResetPwInput(BaseModel):
    token: str
    new_password: str


@mail_router.post("/auth/forgot-password")
async def forgot_password(inp: ForgotPwInput):
    user = await db.users.find_one({"email": inp.email.lower()})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_resets.insert_one({
            "id": new_id(), "user_id": user["id"], "token": token,
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "used": False, "created_at": now_iso(),
        })
        url = f"{FRONTEND_URL}/reset-password?token={token}"
        logger.info("Reset password link for %s: %s", user["email"], url)
        await send_email(
            to=user["email"],
            subject="SpedPortal · Reset password",
            html=tpl_reset(user.get("company_name", ""), url),
        )
    return {"ok": True}


@mail_router.post("/auth/reset-password")
async def reset_password(inp: ResetPwInput):
    rec = await db.password_resets.find_one({"token": inp.token, "used": False}, {"_id": 0})
    if not rec:
        raise HTTPException(400, "Token non valido")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(400, "Token scaduto")
    if len(inp.new_password) < 6:
        raise HTTPException(400, "Password troppo corta (min 6 caratteri)")
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password": hash_pw(inp.new_password)}})
    await db.password_resets.update_one({"token": inp.token}, {"$set": {"used": True}})
    return {"ok": True}


@mail_router.post("/admin/users/{uid}/resend-approval")
async def resend_approval(uid: str, admin=Depends(require_admin)):
    q = {"id": uid}
    if admin.get("role") == "reseller_admin":
        q["reseller_id"] = admin.get("reseller_id")
    u = await db.users.find_one(q)
    if not u:
        raise HTTPException(404, "Utente non trovato")
    await send_email(
        to=u["email"],
        subject="SpedPortal · Il tuo account è attivo",
        html=tpl_approved(u.get("company_name", ""), u["email"], f"{FRONTEND_URL}/login"),
    )
    return {"ok": True}
