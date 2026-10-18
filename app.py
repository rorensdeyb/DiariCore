"""
DiariCore — Flask app serving static HTML/CSS/JS and JSON API for auth.
Deploy on Railway with PostgreSQL (DATABASE_URL). Local dev uses SQLite.
"""

import hashlib
import html
import os
import json
import time
import uuid
import random
import secrets
import urllib.parse
import io
import urllib.request
from datetime import date, datetime, timedelta, timezone

import pyotp
import segno
from flask import Flask, Response, jsonify, redirect, request, send_from_directory, abort, session, stream_with_context
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash

import auth_security as authsec
import db
import input_security as insec
import password_policy
import space_nlp
import push_service
import push_scheduler
import hf_speech

ENTRY_WORD_MAX = int(os.environ.get("ENTRY_WORD_MAX", "300"))


def _entry_word_count(text: str) -> int:
    t = (text or "").strip()
    if not t:
        return 0
    return len(t.split())


INSIGHT_TEMPLATES = {
    "anxious": [
        "Your anxiety spikes when {k} shows up in what you write.",
        "You often feel anxious on days when your entries mention {k}.",
        "Themes like {k} keep appearing alongside anxious emotions in your journal.",
    ],
    "happy": [
        "{k} seems to be a recurring bright spot when you're feeling happy.",
        "Your happiest entries often touch on {k}.",
        "Joy in your diary frequently lines up with mentions of {k}.",
    ],
    "sad": [
        "Sad days in your journal often cluster around {k}.",
        "When you're low, {k} tends to show up in your writing.",
        "Heavy emotions and mentions of {k} often appear together for you.",
    ],
    "angry": [
        "Frustration in your entries often centers on {k}.",
        "You sound angriest when {k} is on your mind.",
        "Irritation shows up a lot alongside topics like {k}.",
    ],
    "neutral": [
        "Even balanced days still note {k} fairly often.",
        "Neutral emotions in your diary still reference {k} regularly.",
        "When you're steady, {k} still appears as a quiet theme.",
    ],
}

STRESS_TRIGGER_TEMPLATES = [
    "You tend to feel more stressed when {tag} comes up.",
    "Stress often shows up alongside mentions of {tag}.",
    "When {tag} is on your mind, your emotional tone leans more tense.",
    "Mentions of {tag} frequently appear in your tougher days.",
    "{tag} seems to be a common theme when you're feeling overwhelmed.",
    "Your stress-related entries often include {tag}.",
    "You often sound more pressured when you write about {tag}.",
    "{tag} is a recurring topic on days that feel heavy.",
    "When {tag} appears, your emotional tone is more likely to dip into stress.",
    "Your stress trigger pattern points to {tag} as a frequent factor.",
    "Your journal suggests {tag} is linked to your stressful moments.",
    "Hard days often include {tag} in what you write.",
]

HAPPINESS_TRIGGER_TEMPLATES = [
    "Your emotional tone improves when you mention {tag}.",
    "{tag} often shows up in your happiest entries.",
    "You seem to feel lighter when {tag} is part of your day.",
    "Positive entries frequently include {tag}.",
    "{tag} looks like a consistent source of joy for you.",
    "You often sound more hopeful when you write about {tag}.",
    "When {tag} appears, your emotional tone trends more positive.",
    "{tag} seems to be a bright spot in your recent entries.",
    "Your happiest moments often connect to {tag}.",
    "You tend to feel better on days that include {tag}.",
    "{tag} shows up a lot when you're in a good place.",
    "Your journal points to {tag} as a recurring emotion booster.",
]

STRESS_COUNT_JUSTIFICATION_TEMPLATES = [
    "{count} of your stress-related entries include {tag}.",
    "{tag} appears in {count} entries that were detected as stress emotions.",
    "Across your stressed days, {tag} showed up {count} times.",
    "{count} stressed entries mention {tag}, which is why it ranks at the top.",
]

HAPPINESS_COUNT_JUSTIFICATION_TEMPLATES = [
    "{count} of your happy entries include {tag}.",
    "{tag} appears in {count} entries detected as happy.",
    "In your positive days, {tag} showed up {count} times.",
    "{count} happy entries mention {tag}, which is why it ranks at the top.",
]


def _pick_template(templates: list[str], *, tag: str) -> str:
    safe_tag = _to_title_case(tag) if tag else "that topic"
    pool = templates or ["{tag} keeps showing up in your entries."]
    return random.choice(pool).format(tag=safe_tag)

def _pick_count_template(templates: list[str], *, tag: str, count: int) -> str:
    safe_tag = _to_title_case(tag) if tag else "that topic"
    safe_count = max(0, int(count or 0))
    pool = templates or ["{count} entries include {tag}."]
    return random.choice(pool).format(tag=safe_tag, count=safe_count)


def _random_insight_line(emotion: str, top_keyword: str) -> str:
    emo = (emotion or "neutral").lower()
    k = (top_keyword or "").strip() or "these themes"
    templates = INSIGHT_TEMPLATES.get(emo) or INSIGHT_TEMPLATES["neutral"]
    return random.choice(templates).format(k=k)


def _to_title_case(text: str) -> str:
    s = str(text or "").strip()
    return " ".join(p[:1].upper() + p[1:] if p else "" for p in s.split(" "))


def _trigger_query_user_id():
    uid = session.get("user_id")
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return None
    return uid if uid > 0 else None


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
#
# Uploads must live somewhere persistent across deploys (Railway volume, etc).
# If `UPLOADS_DIR` is not set, we fall back to the local container path.
#
UPLOADS_DIR = os.environ.get("UPLOADS_DIR") or os.path.join(STATIC_DIR, "img", "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)


def _cleanup_removed_entry_uploads(old_urls: list[str], new_urls: list[str]) -> None:
    """Remove files under UPLOADS_DIR that were dropped from an entry's image list."""
    old_set = {str(u).strip() for u in (old_urls or []) if isinstance(u, str) and str(u).strip()}
    new_set = {str(u).strip() for u in (new_urls or []) if isinstance(u, str) and str(u).strip()}
    uploads_root = os.path.normpath(UPLOADS_DIR)
    for url in old_set - new_set:
        if not url.startswith("/uploads/"):
            continue
        fname = url[len("/uploads/") :].replace("\\", "/")
        if not fname or ".." in fname or "/" in fname:
            continue
        abs_path = os.path.normpath(os.path.join(UPLOADS_DIR, fname))
        if not abs_path.startswith(uploads_root + os.sep) and abs_path != uploads_root:
            continue
        if os.path.isfile(abs_path):
            try:
                os.remove(abs_path)
            except OSError:
                pass


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.config["JSON_SORT_KEYS"] = False
app.secret_key = os.environ.get("SECRET_KEY", "diaricore-dev-secret")


@app.after_request
def _api_no_cache_headers(response):
    """Prevent browsers from serving stale JSON for cross-device refresh."""
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=14)
if os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("FLASK_ENV") == "production":
    app.config["SESSION_COOKIE_SECURE"] = True
    if app.secret_key == "diaricore-dev-secret":
        app.logger.warning(
            "SECRET_KEY is not set in the environment. Set a long random SECRET_KEY in Railway Variables."
        )

_RATE_LOGIN = (60, 900.0)
_RATE_REGISTER = (8, 3600.0)
_RATE_OTP = (10, 900.0)
_RATE_FORGOT = (30, 3600.0)
_RATE_ANALYZE = (40, 60.0)
_RATE_UPLOAD = (25, 60.0)


def _json_auth_error(message: str, status: int = 401):
    return jsonify({"success": False, "error": message}), status


def _configured_admin_email() -> str:
    return (os.environ.get("DIARI_ADMIN_EMAIL") or "").strip().lower()


def _user_is_configured_admin(user_row: dict) -> bool:
    admin_email = _configured_admin_email()
    if not admin_email or not user_row:
        return False
    user_email = (user_row.get("email") or "").strip().lower()
    return bool(user_email) and user_email == admin_email


def _session_is_admin() -> bool:
    """True when the current session may use the admin surface.

    Re-checks the live DB user against DIARI_ADMIN_EMAIL instead of trusting the
    flag stamped at login time, so a still-valid cookie keeps admin access even
    if the variable was added/changed after login, or the session was created by
    an older deploy.
    """
    if session.get("is_admin"):
        return True
    uid = session.get("user_id")
    if uid is None:
        return False
    try:
        user_row = db.get_user_by_id(int(uid))
    except Exception:
        return False
    if _user_is_configured_admin(user_row):
        session["is_admin"] = True
        return True
    return False


def _establish_user_session(user_id: int) -> str:
    session["user_id"] = int(user_id)
    token = secrets.token_urlsafe(32)
    session["csrf_token"] = token
    session.permanent = True
    return token


def _require_authenticated_user(*, check_csrf: bool = True):
    uid = session.get("user_id")
    if uid is None:
        return None, _json_auth_error("Please sign in again.", 401)
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return None, _json_auth_error("Please sign in again.", 401)
    if uid <= 0:
        return None, _json_auth_error("Please sign in again.", 401)
    if check_csrf and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        csrf_err = authsec.validate_csrf(request, session)
        if csrf_err:
            return None, _json_auth_error(csrf_err, 403)
    return uid, None


def _login_success_payload(user_row: dict, **extra):
    csrf = _establish_user_session(int(user_row["id"]))
    try:
        db.record_user_login(int(user_row["id"]))
    except Exception:
        pass
    if _user_is_configured_admin(user_row):
        session["is_admin"] = True
    else:
        session.pop("is_admin", None)
    out = {k: v for k, v in user_row.items() if k != "password_hash"}
    payload = {"success": True, "user": serialize_user(out), "csrfToken": csrf}
    payload.update(extra)
    return jsonify(payload), 200


def _content_security_policy() -> str:
    """Allow self-hosted app + CDNs used by templates and on-device voice (Transformers)."""
    return (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline' 'wasm-unsafe-eval'; "
        "style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co; "
        "worker-src 'self' blob: https://cdn.jsdelivr.net; "
        "media-src 'self' blob:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'self'"
    )


@app.after_request
def _apply_security_headers(response):
    """Lightweight headers; no per-request DB or session work."""
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if os.environ.get("DIARI_DISABLE_CSP", "").lower() not in ("1", "true", "yes"):
        response.headers.setdefault("Content-Security-Policy", _content_security_policy())
    return response


def _generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def _otp_email_html(title: str, nickname: str, intro: str, code: str, expiry_note: str, extra_note: str = "") -> str:
    """Branded DiariCore OTP email (email-client-safe: tables + inline styles only)."""
    safe_name = html.escape(nickname or "there")
    safe_title = html.escape(title)
    safe_code = html.escape(code)
    extra_row = (
        f"<p style='margin: 14px 0 0; font-size: 13px; line-height: 1.6; color: #55665D;'>{extra_note}</p>"
        if extra_note else ""
    )
    return f"""<html><body style='margin: 0; padding: 0; background-color: #EDF2EC;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background-color: #EDF2EC; padding: 28px 12px;'>
<tr><td align='center'>
<table role='presentation' width='560' cellpadding='0' cellspacing='0' style='max-width: 560px; width: 100%;'>
<tr><td align='center' style='background-color: #3D6849; border-radius: 14px 14px 0 0; padding: 26px 24px 22px;'>
<div style='font-family: Arial, Helvetica, sans-serif; font-size: 24px; font-weight: bold; color: #FFFFFF; letter-spacing: 0.5px;'>&#x1F4D6; DiariCore</div>
<div style='font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #C9DCCF; margin-top: 6px; letter-spacing: 1.5px;'>MINDFUL JOURNALING</div>
</td></tr>
<tr><td style='background-color: #FFFFFF; border-radius: 0 0 14px 14px; padding: 30px 32px 26px; border: 1px solid #DEE7DD; border-top: none;'>
<h2 style='font-family: Arial, Helvetica, sans-serif; font-size: 20px; color: #2F3E36; margin: 0 0 12px;'>{safe_title}</h2>
<p style='font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #3D4A42; margin: 0 0 8px;'>Hello {safe_name},</p>
<p style='font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #3D4A42; margin: 0 0 18px;'>{intro}</p>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0'><tr><td align='center' style='background-color: #EBF3EE; border: 1.5px dashed #7FA88F; border-radius: 10px; padding: 18px 12px;'>
<div style='font-family: Arial, Helvetica, sans-serif; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2F3E36;'>{safe_code}</div>
</td></tr></table>
<p style='font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.6; color: #7D8A84; margin: 18px 0 0;'>{expiry_note}</p>
{extra_row}
</td></tr>
<tr><td align='center' style='padding: 16px 12px 0;'>
<p style='font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.6; color: #9AA79E; margin: 0;'>If you did not request this email, you can safely ignore it.<br>DiariCore &bull; your private space for reflection and growth.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _send_otp_email(email: str, otp_code: str, nickname: str) -> bool:
    api_key = os.environ.get("BREVO_API_KEY") or db.get_system_setting("brevo_api_key")
    sender_email = os.environ.get("BREVO_SENDER_EMAIL") or db.get_system_setting("brevo_sender_email")
    sender_name = os.environ.get("BREVO_SENDER_NAME") or db.get_system_setting("brevo_sender_name", "DiariCore")
    enable_notifications = (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true"

    if not enable_notifications:
        print(f"[OTP DISABLED] Email notifications disabled. OTP for {email}: {otp_code}")
        return True

    if not api_key or not sender_email:
        print(f"[OTP DEV MODE] {email} -> {otp_code}")
        return True

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": email, "name": nickname or email.split("@")[0]}],
        "subject": "DiariCore verification code",
        "htmlContent": _otp_email_html(
            "Verify your DiariCore account",
            nickname,
            "Your verification code is:",
            otp_code,
            "This code expires in 10 minutes.",
        ),
        "textContent": f"Your DiariCore verification code is {otp_code}. It expires in 10 minutes.",
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except Exception:
        return False


def _send_password_reset_email(email: str, reset_code: str, nickname: str) -> bool:
    api_key = os.environ.get("BREVO_API_KEY") or db.get_system_setting("brevo_api_key")
    sender_email = os.environ.get("BREVO_SENDER_EMAIL") or db.get_system_setting("brevo_sender_email")
    sender_name = os.environ.get("BREVO_SENDER_NAME") or db.get_system_setting("brevo_sender_name", "DiariCore")
    enable_notifications = (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true"

    if not enable_notifications:
        print(f"[PASSWORD RESET DISABLED] OTP for {email}: {reset_code}")
        return True

    if not api_key or not sender_email:
        print(f"[PASSWORD RESET DEV MODE] {email} -> {reset_code}")
        return True

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": email, "name": nickname or email.split("@")[0]}],
        "subject": "DiariCore password reset code",
        "htmlContent": _otp_email_html(
            "Reset your DiariCore password",
            nickname,
            "Use this code to reset your password:",
            reset_code,
            "This code expires in 10 minutes.",
        ),
        "textContent": f"Your DiariCore password reset code is {reset_code}. It expires in 10 minutes.",
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except Exception:
        return False


def _send_login_totp_recovery_email(email: str, recovery_code: str, nickname: str) -> bool:
    """Email a one-time code used to disable TOTP when the user cannot access their authenticator app."""
    api_key = os.environ.get("BREVO_API_KEY") or db.get_system_setting("brevo_api_key")
    sender_email = os.environ.get("BREVO_SENDER_EMAIL") or db.get_system_setting("brevo_sender_email")
    sender_name = os.environ.get("BREVO_SENDER_NAME") or db.get_system_setting("brevo_sender_name", "DiariCore")
    enable_notifications = (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true"

    if not enable_notifications:
        print(f"[TOTP RECOVERY EMAIL DISABLED] {email} -> {recovery_code}")
        return True

    if not api_key or not sender_email:
        print(f"[TOTP RECOVERY DEV MODE] {email} -> {recovery_code}")
        return True

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": email, "name": nickname or email.split("@")[0]}],
        "subject": "DiariCore sign-in — authenticator recovery code",
        "htmlContent": _otp_email_html(
            "Authenticator recovery",
            nickname,
            "Someone started sign-in to DiariCore and asked to recover access without an authenticator app code."
            " If this was you, enter this one-time code on the website:",
            recovery_code,
            "This code expires in 15 minutes. If you did not request this, you can ignore this email and your"
            " password still protects your account.",
            "<strong>Note:</strong> using this code will turn off authenticator sign-in for your account until"
            " you enable it again in Profile.",
        ),
        "textContent": (
            f"DiariCore authenticator recovery code: {recovery_code}. Expires in 15 minutes. "
            "Using it turns off authenticator sign-in until you set it up again in Profile."
        ),
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except Exception:
        return False


def _parse_db_datetime(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        dt = val
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    s = str(val).strip()
    if not s:
        return None
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _serialize_value(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def entry_created_at_iso_utc(created_at):
    """
    Journal entries must expose `date` as an absolute instant (UTC + Z).
    Naive datetimes from Postgres TIMESTAMP (no tz) / SQLite are treated as UTC wall time
    so browsers do not mis-read them as *local* and shift the calendar day.
    """
    if created_at is None:
        return ""
    if isinstance(created_at, datetime):
        dt = created_at
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(created_at, date):
        dt = datetime.combine(created_at, datetime.min.time(), tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    s = str(created_at).strip()
    if not s:
        return s
    norm = s.replace(" ", "T", 1)
    parse_s = norm[:-1] + "+00:00" if norm.endswith("Z") or norm.endswith("z") else norm
    try:
        dt = datetime.fromisoformat(parse_s)
    except ValueError:
        return s
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _truthy_db_flag(v) -> bool:
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return int(v) != 0
    s = str(v).strip().lower()
    return s in ("1", "true", "t", "yes", "on")


def _normalize_totp_code(raw) -> str:
    return "".join(c for c in str(raw or "") if c.isdigit())


def _verify_totp_code(secret: str, code: str) -> bool:
    s = (secret or "").strip()
    digits = _normalize_totp_code(code)
    if not s or len(digits) != 6:
        return False
    return bool(pyotp.TOTP(s).verify(digits, valid_window=1))


def _totp_qr_data_uri(otpauth_url: str) -> str:
    buf = io.BytesIO()
    segno.make(otpauth_url).save(buf, kind="svg", scale=3, border=1, xmldecl=False)
    svg = buf.getvalue().decode("utf-8")
    return "data:image/svg+xml;charset=utf-8," + urllib.parse.quote(svg)


def serialize_user(row):
    if not row:
        return None
    out = {}
    for k, v in row.items():
        if k in ("password_hash", "totp_secret", "totp_setup_secret", "totp_setup_expires"):
            continue
        out[k] = _serialize_value(v)
    # camelCase for frontend localStorage parity
    mapped = {
        "id": out.get("id"),
        "nickname": out.get("nickname"),
        "email": out.get("email"),
        "firstName": out.get("first_name"),
        "lastName": out.get("last_name"),
        "fullName": f"{out.get('first_name') or ''} {out.get('last_name') or ''}".strip(),
        "gender": out.get("gender"),
        "birthday": out.get("birthday"),
        "createdAt": out.get("created_at"),
        "totpEnabled": _truthy_db_flag(out.get("totp_enabled")),
    }
    av = out.get("avatar_data_url")
    if isinstance(av, str) and av.strip():
        mapped["avatarDataUrl"] = av.strip()
    else:
        mapped["avatarDataUrl"] = None
    # Cross-device appearance (stored in DB; see /api/user/ui-preferences)
    _ALLOWED_UI_PALETTES = {f"theme-{i}" for i in range(1, 11)}
    prefs = {}
    ui_raw = out.get("ui_preferences_json")
    if isinstance(ui_raw, str) and ui_raw.strip():
        try:
            parsed = json.loads(ui_raw)
            if isinstance(parsed, dict):
                prefs = parsed
        except Exception:
            prefs = {}
    t = prefs.get("theme")
    if t in ("light", "dark"):
        mapped["uiTheme"] = t
    pid = prefs.get("paletteId")
    if isinstance(pid, str) and pid in _ALLOWED_UI_PALETTES:
        mapped["uiPaletteId"] = pid
    if _user_is_configured_admin(row):
        mapped["isAdmin"] = True
    return mapped


def serialize_entry(row):
    if not row:
        return None
    tags = []
    tags_raw = row.get("tags_json")
    if tags_raw:
        try:
            parsed = json.loads(tags_raw)
            if isinstance(parsed, list):
                tags = parsed
        except Exception:
            tags = []
    created_at = row.get("created_at")
    entry_dt_raw = row.get("entry_datetime_utc")
    date_value = entry_created_at_iso_utc(entry_dt_raw) if entry_dt_raw else entry_created_at_iso_utc(created_at)
    emotion_label = (row.get("emotion_label") or "neutral").lower()
    all_probs = {}
    probs_raw = row.get("all_probs_json")
    if probs_raw:
        try:
            parsed = json.loads(probs_raw)
            if isinstance(parsed, dict):
                all_probs = parsed
        except Exception:
            all_probs = {}
    image_urls = []
    image_raw = row.get("image_urls_json")
    if image_raw:
        try:
            parsed = json.loads(image_raw)
            if isinstance(parsed, list):
                image_urls = [str(x) for x in parsed if isinstance(x, str)]
        except Exception:
            image_urls = []
    return {
        "id": row.get("id"),
        "userId": row.get("user_id"),
        "text": row.get("text_content") or "",
        "title": row.get("title") or "",
        "tags": tags,
        "imageUrls": image_urls,
        "date": date_value,
        "createdAt": entry_created_at_iso_utc(created_at),
        "updatedAt": entry_created_at_iso_utc(row.get("updated_at")) if row.get("updated_at") else None,
        "sentimentLabel": (row.get("sentiment_label") or "neutral").lower(),
        "sentimentScore": float(row.get("sentiment_score") or 0.5),
        "emotionLabel": emotion_label,
        "emotionScore": float(row.get("emotion_score") or 0.5),
        "all_probs": all_probs,
        # Keep existing UI compatibility
        "feeling": emotion_label,
    }


def _parse_ph_local_to_utc_iso(local_dt: str) -> str | None:
    s = str(local_dt or "").strip()
    if not s:
        return None
    # Expect datetime-local format like "2026-05-12T17:30"
    try:
        naive = datetime.fromisoformat(s)
    except ValueError:
        return None
    ph_tz = timezone(timedelta(hours=8))
    aware = naive.replace(tzinfo=ph_tz)
    return aware.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _allowed_image_extension(filename: str) -> bool:
    ext = os.path.splitext(str(filename or ""))[1].lower()
    return ext in {
        ".jpg",
        ".jpeg",
        ".jfif",
        ".png",
        ".webp",
        ".gif",
        ".bmp",
        ".tif",
        ".tiff",
        ".avif",
        ".heic",
        ".heif",
    }


@app.before_request
def ensure_db():
    """Lazy init once per process."""
    if not getattr(app, "_db_ready", False):
        db.init_db()
        app._db_ready = True
    # Fallback if gunicorn post_fork did not run — only attempt once per worker (avoid per-request overhead).
    if not getattr(app, "_push_scheduler_bootstrapped", False):
        app._push_scheduler_bootstrapped = True
        try:
            push_scheduler.start(worker_id=os.getpid())
        except Exception:
            pass


@app.before_request
def refresh_admin_session():
    """Re-derive admin rights for admin routes so they survive redeploys that
    changed DIARI_ADMIN_EMAIL or rotated SECRET_KEY. Cheap: only admin paths
    touch the DB, and the result is cached back into the session."""
    path = request.path
    if not (path == "/admin" or path.startswith("/admin.") or path.startswith("/api/admin")):
        return None
    if not session.get("is_admin"):
        _session_is_admin()
    return None


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "database": "postgres" if db.USE_POSTGRES else "sqlite"})


def _validated_registration_privacy_agreed_at(raw):
    """Client sends ISO8601 timestamp when user accepts the signup privacy modal."""
    if not isinstance(raw, str):
        return None, "You must confirm the Privacy Notice before creating an account."
    s = raw.strip()
    if not s:
        return None, "You must confirm the Privacy Notice before creating an account."
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None, "Invalid privacy consent. Please try again."
    now = datetime.now(timezone.utc)
    if dt > now + timedelta(minutes=15):
        return None, "Invalid privacy consent. Please try again."
    return dt, None


@app.route("/api/register", methods=["POST"])
def api_register():
    rl = authsec.rate_limit_check(request, "register", _RATE_REGISTER[0], _RATE_REGISTER[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""

    ok_nick, nickname, err_nick = insec.validate_nickname(data.get("nickname") or "")
    if not ok_nick:
        return jsonify({"success": False, "field": "nickname", "error": err_nick or "Invalid username."}), 400
    ok_email, email, err_email = insec.validate_email(data.get("email") or "")
    if not ok_email:
        return jsonify({"success": False, "field": "signUpEmail", "error": err_email or "Invalid email."}), 400
    ok_fn, first_name, err_fn = insec.validate_person_name(data.get("firstName") or "", "First name")
    if not ok_fn:
        return jsonify({"success": False, "field": "firstName", "error": err_fn or "Invalid first name."}), 400
    ok_ln, last_name, err_ln = insec.validate_person_name(data.get("lastName") or "", "Last name")
    if not ok_ln:
        return jsonify({"success": False, "field": "lastName", "error": err_ln or "Invalid last name."}), 400
    ok_gender, gender, err_gender = insec.validate_gender(data.get("gender") or "")
    if not ok_gender:
        return jsonify({"success": False, "field": "gender", "error": err_gender or "Invalid gender."}), 400
    ok_bd, birthday, err_bd = insec.validate_birthday(data.get("birthday") or "")
    if not ok_bd:
        return jsonify({"success": False, "field": "birthday", "error": err_bd or "Invalid date of birth."}), 400
    if not password:
        return jsonify({"success": False, "field": "signUpPassword", "error": "Password is required."}), 400
    ok_pw, field_pw, msg_pw = password_policy.validate_new_password(
        password,
        nickname=nickname,
        email=email,
        first_name=first_name,
        last_name=last_name,
    )
    if not ok_pw:
        return jsonify({"success": False, "field": field_pw or "signUpPassword", "error": msg_pw}), 400

    privacy_dt, privacy_err = _validated_registration_privacy_agreed_at(data.get("privacyAgreedAt"))
    if privacy_err:
        return jsonify({"success": False, "error": privacy_err}), 400

    otp_code = _generate_otp()
    otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    if not db.store_pending_registration(
        nickname=nickname,
        email=email,
        password=password,
        first_name=first_name,
        last_name=last_name,
        gender=gender,
        birthday=birthday,
        otp_code=otp_code,
        otp_expires_at=otp_expires_at,
        privacy_agreed_at=privacy_dt,
    ):
        return jsonify({"success": False, "error": "Could not start verification. Please try again."}), 500

    if not _send_otp_email(email, otp_code, nickname):
        return jsonify({"success": False, "error": "Failed to send verification code. Please try again."}), 500

    return jsonify({"success": True, "message": "Verification code sent to your email.", "email": email}), 200


@app.route("/api/register/verify", methods=["POST"])
def api_register_verify():
    rl = authsec.rate_limit_check(request, "register_verify", _RATE_OTP[0], _RATE_OTP[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    otp_code = (data.get("otpCode") or "").strip()
    if not email or not otp_code:
        return jsonify({"success": False, "error": "Email and verification code are required."}), 400

    pending = db.get_pending_registration(email)
    if not pending:
        return jsonify({"success": False, "error": "No pending registration found. Please sign up again."}), 404

    expires_raw = pending.get("otp_expires_at")
    try:
        if isinstance(expires_raw, str):
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        else:
            expires_at = expires_raw
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    if datetime.now(timezone.utc) > expires_at:
        return jsonify({"success": False, "error": "Invalid or expired verification code. Please try again."}), 400

    if pending.get("otp_code") != otp_code:
        return jsonify({"success": False, "error": "Invalid or expired verification code. Please try again."}), 400

    created, payload = db.create_user_from_pending(pending)
    if not created:
        field_id, message = payload
        if field_id:
            return jsonify({"success": False, "field": field_id, "error": message}), 409
        return jsonify({"success": False, "error": message}), 400

    db.delete_pending_registration(email)
    csrf = _establish_user_session(int(payload["id"]))
    
    # Set admin session if the user's email matches DIARI_ADMIN_EMAIL
    if _user_is_configured_admin(payload):
        session["is_admin"] = True
    else:
        session.pop("is_admin", None)
    
    return jsonify(
        {"success": True, "user": serialize_user(payload), "csrfToken": csrf}
    ), 201


@app.route("/api/register/resend", methods=["POST"])
def api_register_resend():
    rl = authsec.rate_limit_check(request, "register_resend", _RATE_OTP[0], _RATE_OTP[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"success": False, "error": "Email is required."}), 400

    is_locked, rem_sec, limit_msg = authsec.record_otp_resend(authsec.FLOW_REGISTER_RESEND, db.get_login_lockout_key(email))
    if is_locked:
        return jsonify({"success": False, "error": limit_msg, "retryAfterSeconds": rem_sec}), 429

    pending = db.get_pending_registration(email)
    if not pending:
        return jsonify({"success": False, "error": "No pending registration found."}), 404

    otp_code = _generate_otp()
    otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    if not db.update_pending_otp(email, otp_code, otp_expires_at):
        return jsonify({"success": False, "error": "Could not refresh verification code."}), 500

    if not _send_otp_email(email, otp_code, pending.get("nickname") or ""):
        return jsonify({"success": False, "error": "Failed to resend verification code."}), 500

    return jsonify({"success": True, "message": "Verification code resent."}), 200


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    username = insec.strip_null_bytes((data.get("username") or data.get("email") or "").strip())
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"success": False, "error": "Username and password are required."}), 400

    # 15-minute lockout check (5 failed attempts)
    is_locked, remaining_sec, lock_msg = authsec.check_login_lockout(request, username)
    if is_locked:
        return jsonify({
            "success": False,
            "error": lock_msg,
            "locked": True,
            "retryAfter": remaining_sec,
            "lockoutSeconds": remaining_sec,
        }), 429

    rl = authsec.rate_limit_check(request, "login", _RATE_LOGIN[0], _RATE_LOGIN[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429

    ok, result, fail_reason = db.verify_login(username, password)
    if not ok:
        # Only real accounts with a wrong password build up the failed-attempt
        # counter. Unknown usernames/emails get the plain message and no attempt
        # is recorded, so the "attempts remaining" text never appears for them.
        if fail_reason == "bad_password":
            is_locked_now, rem_sec, attempts_left, fail_msg = authsec.record_login_failure(request, username)
            if is_locked_now:
                return jsonify({
                    "success": False,
                    "error": fail_msg,
                    "locked": True,
                    "retryAfter": rem_sec,
                    "lockoutSeconds": rem_sec,
                }), 429
            return jsonify({
                "success": False,
                "error": fail_msg,
                "attemptsLeft": attempts_left,
                "maxAttempts": authsec.MAX_LOGIN_ATTEMPTS,
            }), 401
        return jsonify({"success": False, "error": result}), 401

    # Login succeeded: clear failed attempt tracker for input, username, and email
    authsec.clear_login_failures(request, username)
    if isinstance(result, dict):
        if result.get("username"):
            authsec.clear_login_failures(request, str(result["username"]))
        if result.get("email"):
            authsec.clear_login_failures(request, str(result["email"]))

    session.pop("is_admin", None)

    if _truthy_db_flag(result.get("totp_enabled")) and (result.get("totp_secret") or "").strip():
        token = db.create_login_totp_challenge(int(result["id"]))
        if not token:
            return jsonify({"success": False, "error": "Could not start two-factor sign-in. Please try again."}), 500
        return jsonify({"success": True, "requiresTwoFactor": True, "challengeToken": token}), 200

    return _login_success_payload(result)


@app.route("/api/login/totp", methods=["POST"])
def api_login_totp():
    rl = authsec.rate_limit_check(request, "login_totp", _RATE_LOGIN[0], _RATE_LOGIN[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    data = request.get_json(silent=True) or {}
    challenge_token = (data.get("challengeToken") or "").strip()
    code = data.get("code") or ""
    if not challenge_token or not code:
        return jsonify({"success": False, "error": "Verification code is required."}), 400

    user_id = db.peek_login_totp_challenge_user_id(challenge_token)
    if not user_id:
        return jsonify({"success": False, "error": "This sign-in step expired. Please sign in again."}), 401

    user = db.get_user_by_id(user_id)
    if not user or not _truthy_db_flag(user.get("totp_enabled")):
        db.delete_login_totp_challenge(challenge_token)
        return jsonify({"success": False, "error": "Two-factor authentication is not active for this account."}), 400

    secret = (user.get("totp_secret") or "").strip()
    if not secret or not _verify_totp_code(secret, code):
        return jsonify({"success": False, "error": "Invalid authentication code."}), 401

    db.delete_login_totp_recovery_otp_for_challenge(challenge_token)
    db.delete_login_totp_challenge(challenge_token)
    return _login_success_payload(user)


@app.route("/api/login/totp/recovery/request", methods=["POST"])
def api_login_totp_recovery_request():
    rl = authsec.rate_limit_check(request, "login_recovery", _RATE_OTP[0], _RATE_OTP[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    """Email a 6-digit recovery code for the pending TOTP login challenge (lost authenticator)."""
    data = request.get_json(silent=True) or {}
    challenge_token = (data.get("challengeToken") or "").strip()
    if len(challenge_token) < 8:
        return jsonify({"success": False, "error": "Unable to send recovery email."}), 400

    user_id = db.peek_login_totp_challenge_user_id(challenge_token)
    if not user_id:
        return jsonify({"success": False, "error": "Unable to send recovery email."}), 400

    is_locked, rem_sec, limit_msg = authsec.record_otp_resend(authsec.FLOW_LOGIN_RECOVERY, f"user:{user_id}")
    if is_locked:
        return jsonify({"success": False, "error": limit_msg, "retryAfterSeconds": rem_sec}), 429

    user = db.get_user_by_id(user_id)
    if not user or not _truthy_db_flag(user.get("totp_enabled")):
        return jsonify({"success": False, "error": "Unable to send recovery email."}), 400

    row = db.get_login_totp_recovery_otp_row(challenge_token)
    if row and row.get("created_at"):
        cre = _parse_db_datetime(row.get("created_at"))
        if cre:
            elapsed = (datetime.now(timezone.utc) - cre).total_seconds()
            if elapsed < 55:
                retry = max(1, int(55 - elapsed) + 1)
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "Please wait a minute before requesting another code.",
                            "retryAfterSeconds": retry,
                        }
                    ),
                    429,
                )

    code = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    if not db.upsert_login_totp_recovery_otp(challenge_token, user_id, code, expires_at):
        return jsonify({"success": False, "error": "Could not start recovery."}), 500

    email_to = (user.get("email") or "").strip()
    if not email_to:
        db.delete_login_totp_recovery_otp_for_challenge(challenge_token)
        return jsonify({"success": False, "error": "Unable to send recovery email."}), 500

    if not _send_login_totp_recovery_email(email_to, code, user.get("nickname") or ""):
        db.delete_login_totp_recovery_otp_for_challenge(challenge_token)
        return jsonify({"success": False, "error": "Could not send email. Try again later."}), 500

    return jsonify({"success": True, "message": "If this account has a valid sign-in in progress, a code was sent."}), 200


@app.route("/api/login/totp/recovery/verify", methods=["POST"])
def api_login_totp_recovery_verify():
    """Verify email recovery code, disable TOTP, and complete login (same session as normal TOTP verify)."""
    data = request.get_json(silent=True) or {}
    challenge_token = (data.get("challengeToken") or "").strip()
    code = _normalize_totp_code(data.get("code") or "")
    if len(challenge_token) < 8 or len(code) != 6:
        return jsonify({"success": False, "error": "Invalid or expired recovery code."}), 400

    user_id = db.peek_login_totp_challenge_user_id(challenge_token)
    if not user_id:
        return jsonify({"success": False, "error": "This sign-in step expired. Please sign in again."}), 401

    row = db.get_login_totp_recovery_otp_row(challenge_token)
    if not row:
        return jsonify({"success": False, "error": "Invalid or expired recovery code."}), 400

    exp = _parse_db_datetime(row.get("expires_at"))
    if exp is None or datetime.now(timezone.utc) > exp:
        db.delete_login_totp_recovery_otp_for_challenge(challenge_token)
        return jsonify({"success": False, "error": "Invalid or expired recovery code."}), 401

    stored = (row.get("code") or "").strip()
    if len(stored) != 6 or not secrets.compare_digest(stored, code):
        return jsonify({"success": False, "error": "Invalid or expired recovery code."}), 401

    user = db.get_user_by_id(user_id)
    if not user or not _truthy_db_flag(user.get("totp_enabled")):
        db.delete_login_totp_recovery_otp_for_challenge(challenge_token)
        db.delete_login_totp_challenge(challenge_token)
        return jsonify({"success": False, "error": "Two-factor authentication is not active for this account."}), 400

    if not db.disable_totp_for_user(user_id):
        return jsonify({"success": False, "error": "Could not complete recovery. Try again."}), 500

    db.delete_login_totp_recovery_otp_for_challenge(challenge_token)
    db.delete_login_totp_challenge(challenge_token)
    user_after = db.get_user_by_id(user_id)
    if not user_after:
        return jsonify({"success": False, "error": "Recovery failed."}), 500
    return _login_success_payload(user_after, totpWasReset=True)


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user_id", None)
    session.pop("csrf_token", None)
    session.pop("is_admin", None)
    return jsonify({"success": True}), 200


@app.route("/api/user/totp/setup", methods=["POST"])
def api_user_totp_setup():
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    password = data.get("password") or ""
    if not password:
        return jsonify({"success": False, "error": "Password is required."}), 400

    if not db.verify_user_password_by_id(user_id, password):
        return jsonify({"success": False, "error": "Incorrect password."}), 401

    user = db.get_user_by_id(user_id)
    if not user:
        return jsonify({"success": False, "error": "User not found."}), 404
    if _truthy_db_flag(user.get("totp_enabled")) and (user.get("totp_secret") or "").strip():
        return jsonify({"success": False, "error": "Two-factor authentication is already enabled."}), 400

    secret = pyotp.random_base32()
    if not db.set_totp_setup_pending(user_id, secret):
        return jsonify({"success": False, "error": "Could not start authenticator setup."}), 500

    label = (user.get("email") or user.get("nickname") or str(user_id)).strip()
    otpauth_url = pyotp.TOTP(secret).provisioning_uri(name=label, issuer_name="DiariCore")
    return jsonify(
        {
            "success": True,
            "otpauthUrl": otpauth_url,
            "qrDataUri": _totp_qr_data_uri(otpauth_url),
            "totpSecret": secret,
        }
    ), 200


@app.route("/api/user/totp/confirm", methods=["POST"])
def api_user_totp_confirm():
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    code = data.get("code") or ""

    pending = db.get_totp_setup_pending_secret(user_id)
    if not pending:
        return jsonify({"success": False, "error": "No pending authenticator setup. Start setup again."}), 400

    if not _verify_totp_code(pending, code):
        return jsonify({"success": False, "error": "Invalid code. Check the time on your phone and try again."}), 400

    if not db.commit_totp_secret_enabled(user_id, pending):
        return jsonify({"success": False, "error": "Could not enable two-factor authentication."}), 500

    row = db.get_user_by_id(user_id)
    return jsonify({"success": True, "user": serialize_user(row)}), 200


@app.route("/api/user/totp/disable", methods=["POST"])
def api_user_totp_disable():
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    password = data.get("password") or ""
    code = data.get("code") or ""
    if not password or not code:
        return jsonify({"success": False, "error": "Password and authenticator code are required."}), 400

    if not db.verify_user_password_by_id(user_id, password):
        return jsonify({"success": False, "error": "Incorrect password."}), 401

    user = db.get_user_by_id(user_id)
    if not user or not _truthy_db_flag(user.get("totp_enabled")):
        return jsonify({"success": False, "error": "Two-factor authentication is not enabled."}), 400

    secret = (user.get("totp_secret") or "").strip()
    if not secret or not _verify_totp_code(secret, code):
        return jsonify({"success": False, "error": "Invalid authentication code."}), 401

    if not db.disable_totp_for_user(user_id):
        return jsonify({"success": False, "error": "Could not disable two-factor authentication."}), 500

    row = db.get_user_by_id(user_id)
    return jsonify({"success": True, "user": serialize_user(row)}), 200


@app.route("/api/user/me", methods=["GET"])
def api_user_me():
    """Return the signed-in user's profile for cross-device refresh sync."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    row = db.get_user_by_id(user_id)
    if not row:
        return jsonify({"success": False, "error": "User not found."}), 404
    resp = jsonify({"success": True, "user": serialize_user(row)})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200


def _compute_sync_revision(user_id: int, user_row: dict, entry_rows: list) -> str:
    """Changes whenever profile, theme, or any entry is created/updated/deleted."""
    entry_bits = []
    for r in sorted(entry_rows or [], key=lambda x: int(x.get("id") or 0)):
        entry_bits.append(
            f"{r.get('id')}:{r.get('updated_at') or r.get('created_at') or ''}"
        )
    entries_fp = hashlib.sha256("|".join(entry_bits).encode("utf-8", errors="ignore")).hexdigest()[:20]
    profile_bits = "|".join(
        str(user_row.get(k) or "")
        for k in (
            "nickname",
            "email",
            "first_name",
            "last_name",
            "gender",
            "birthday",
            "ui_preferences_json",
        )
    )
    av = user_row.get("avatar_data_url") or ""
    if isinstance(av, str) and av:
        profile_bits += "|" + hashlib.sha256(av.encode("utf-8", errors="ignore")).hexdigest()[:24]
    profile_hash = hashlib.sha256(profile_bits.encode("utf-8", errors="ignore")).hexdigest()[:16]
    return f"{user_id}:{len(entry_rows or [])}:{entries_fp}:{profile_hash}"


@app.route("/api/sync/check", methods=["GET"])
def api_sync_check():
    """Lightweight poll: revision only (live cross-device sync)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    row = db.get_user_by_id(user_id)
    if not row:
        return jsonify({"success": False, "error": "User not found."}), 404
    stamp_rows = db.get_journal_entry_sync_stamps(user_id)
    resp = jsonify(
        {
            "success": True,
            "serverTime": datetime.now(timezone.utc).isoformat(),
            "syncRevision": _compute_sync_revision(user_id, row, stamp_rows),
            "entriesCount": len(stamp_rows),
        }
    )
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200


@app.route("/api/sync/state", methods=["GET"])
def api_sync_state():
    """Single pull: current user profile + all journal entries (cross-device refresh)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    row = db.get_user_by_id(user_id)
    if not row:
        return jsonify({"success": False, "error": "User not found."}), 404
    rows = db.get_journal_entries_by_user(user_id)
    resp = jsonify(
        {
            "success": True,
            "serverTime": datetime.now(timezone.utc).isoformat(),
            "syncRevision": _compute_sync_revision(user_id, row, rows),
            "user": serialize_user(row),
            "entries": [serialize_entry(r) for r in rows],
        }
    )
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200


@app.route("/api/sync/stream", methods=["GET"])
def api_sync_stream():
    """Server-sent events: notifies browsers when DB revision changes (live cross-device sync)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err

    def generate():
        last_rev = None
        heartbeats = 0
        while True:
            row = db.get_user_by_id(user_id)
            if not row:
                yield 'event: error\ndata: {"error":"not_found"}\n\n'
                break
            stamp_rows = db.get_journal_entry_sync_stamps(user_id)
            rev = _compute_sync_revision(user_id, row, stamp_rows)
            if rev != last_rev:
                last_rev = rev
                heartbeats = 0
                payload = json.dumps(
                    {
                        "syncRevision": rev,
                        "serverTime": datetime.now(timezone.utc).isoformat(),
                        "entriesCount": len(stamp_rows),
                    }
                )
                yield f"data: {payload}\n\n"
            else:
                heartbeats += 1
                if heartbeats >= 4:
                    heartbeats = 0
                    yield ": ping\n\n"
            time.sleep(5)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/user/avatar", methods=["POST"])
def api_user_avatar():
    """Save or clear the signed-in user's profile photo (data URL stored server-side)."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err

    raw = data.get("avatarDataUrl")
    if raw is None:
        avatar = None
    elif isinstance(raw, str):
        s = raw.strip()
        if not s:
            avatar = None
        elif len(s) > 1_200_000:
            return jsonify({"success": False, "error": "Image data is too large."}), 400
        elif not s.startswith("data:image/"):
            return jsonify({"success": False, "error": "avatarDataUrl must be a data:image/… URL."}), 400
        else:
            avatar = s
    else:
        return jsonify({"success": False, "error": "Invalid avatarDataUrl."}), 400

    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404

    if not db.update_user_avatar_data_url(user_id, avatar):
        return jsonify({"success": False, "error": "Could not save profile photo."}), 500

    row = db.get_user_by_id(user_id)
    return jsonify({"success": True, "user": serialize_user(row)}), 200


_ALLOWED_UI_PALETTES = frozenset(f"theme-{i}" for i in range(1, 11))


@app.route("/api/user/ui-preferences", methods=["POST"])
def api_user_ui_preferences():
    """Persist light/dark theme and accent palette for cross-device sync."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404

    theme = data.get("uiTheme")
    if isinstance(theme, str):
        theme = theme.strip().lower()
        if theme == "":
            theme = None
    else:
        theme = None
    if theme is not None and theme not in ("light", "dark"):
        return jsonify({"success": False, "error": "uiTheme must be light or dark."}), 400

    palette = data.get("uiPaletteId")
    if isinstance(palette, str):
        palette = palette.strip()
        if palette == "":
            palette = None
    else:
        palette = None
    if palette is not None and palette not in _ALLOWED_UI_PALETTES:
        return jsonify({"success": False, "error": "Invalid uiPaletteId."}), 400

    if theme is None and palette is None:
        return jsonify({"success": False, "error": "Provide uiTheme and/or uiPaletteId."}), 400

    if not db.update_user_ui_preferences(user_id, theme, palette):
        return jsonify({"success": False, "error": "Could not save preferences."}), 500

    row = db.get_user_by_id(user_id)
    return jsonify({"success": True, "user": serialize_user(row)}), 200


@app.route("/api/user/profile", methods=["POST"])
def api_user_profile_update():
    """Persist personal information (name, username, email, gender, birthday) for the given user."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err

    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404

    ok_fn, first_name, err_fn = insec.validate_person_name(data.get("firstName") or "", "First name", required=False)
    if not ok_fn:
        return jsonify({"success": False, "field": "firstName", "error": err_fn or "Invalid first name."}), 400
    ok_ln, last_name, err_ln = insec.validate_person_name(data.get("lastName") or "", "Last name", required=False)
    if not ok_ln:
        return jsonify({"success": False, "field": "lastName", "error": err_ln or "Invalid last name."}), 400
    ok_nick, nickname, err_nick = insec.validate_nickname(data.get("nickname") or "")
    if not ok_nick:
        return jsonify({"success": False, "field": "nickname", "error": err_nick or "Invalid username."}), 400
    ok_email, email, err_email = insec.validate_email(data.get("email") or "")
    if not ok_email:
        return jsonify({"success": False, "field": "email", "error": err_email or "Invalid email."}), 400
    gender_raw = (data.get("gender") or "").strip()
    if gender_raw:
        ok_gender, gender, err_gender = insec.validate_gender(gender_raw)
        if not ok_gender:
            return jsonify({"success": False, "field": "gender", "error": err_gender or "Invalid gender."}), 400
    else:
        gender = None
    birthday_raw = (data.get("birthday") or "").strip()
    if birthday_raw:
        ok_bd, birthday, err_bd = insec.validate_birthday(birthday_raw)
        if not ok_bd:
            return jsonify({"success": False, "field": "birthday", "error": err_bd or "Invalid date of birth."}), 400
    else:
        birthday = None

    ok, field_key, err_msg = db.update_user_profile(
        user_id,
        first_name,
        last_name,
        nickname,
        email,
        gender,
        birthday,
    )
    if not ok:
        field_map = {"nickname": "profileFieldNickname", "email": "profileFieldEmail"}
        return (
            jsonify(
                {
                    "success": False,
                    "field": field_map.get(field_key or ""),
                    "error": err_msg or "Could not save profile.",
                }
            ),
            400,
        )

    row = db.get_user_by_id(user_id)
    return jsonify({"success": True, "user": serialize_user(row)}), 200


def _send_profile_email_change_otp_email(new_email: str, code: str, nickname: str) -> bool:
    """Email OTP to the *new* address before saving a profile email change."""
    api_key = os.environ.get("BREVO_API_KEY") or db.get_system_setting("brevo_api_key")
    sender_email = os.environ.get("BREVO_SENDER_EMAIL") or db.get_system_setting("brevo_sender_email")
    sender_name = os.environ.get("BREVO_SENDER_NAME") or db.get_system_setting("brevo_sender_name", "DiariCore")
    enable_notifications = (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true"

    if not enable_notifications:
        print(f"[PROFILE EMAIL CHANGE DISABLED] OTP for {new_email}: {code}")
        return True

    if not api_key or not sender_email:
        print(f"[PROFILE EMAIL CHANGE DEV MODE] {new_email} -> {code}")
        return True

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": new_email, "name": nickname or new_email.split("@")[0]}],
        "subject": "DiariCore — verify your new email",
        "htmlContent": _otp_email_html(
            "Confirm your new email",
            nickname,
            "Use this code to confirm updating your DiariCore account email to this address:",
            code,
            "This code expires in 10 minutes. If you did not request this, ignore this email.",
        ),
        "textContent": (
            f"Your DiariCore email verification code is {code}. It expires in 10 minutes. "
            "If you did not request an email change, ignore this message."
        ),
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except Exception:
        return False


def _profile_personal_field_error_response(field_key: str | None, err_msg: str):
    field_map = {"nickname": "profileFieldNickname", "email": "profileFieldEmail"}
    return (
        jsonify(
            {
                "success": False,
                "field": field_map.get(field_key or ""),
                "error": err_msg or "Could not save profile.",
            }
        ),
        400,
    )


@app.route("/api/user/profile/email-change-request", methods=["POST"])
def api_user_profile_email_change_request():
    """When email changes: validate, store pending profile JSON + OTP, email code to the new address."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err

    user = db.get_user_by_id(user_id)
    if not user:
        return jsonify({"success": False, "error": "User not found."}), 404

    first_name = (data.get("firstName") or "").strip()
    last_name = (data.get("lastName") or "").strip()
    nickname = (data.get("nickname") or "").strip()
    email = (data.get("email") or "").strip()
    gender = (data.get("gender") or "").strip() or None
    birthday = (data.get("birthday") or "").strip() or None

    new_email_norm = email.lower().strip()
    old_email_norm = (user.get("email") or "").strip().lower()
    if new_email_norm == old_email_norm:
        return jsonify({"success": False, "error": "Email address is unchanged."}), 400

    if not first_name or not last_name:
        return _profile_personal_field_error_response(None, "First and last name are required.")
    if not nickname or len(nickname) < 4 or len(nickname) > 64:
        return _profile_personal_field_error_response("nickname", "Username must be between 4 and 64 characters.")
    if not email or "@" not in email:
        return _profile_personal_field_error_response("email", "A valid email is required.")

    other_email = db.get_user_by_email(new_email_norm)
    if other_email and int(other_email.get("id") or 0) != user_id:
        return _profile_personal_field_error_response("email", "Email already exists.")

    other_nick = db.get_user_by_nickname(nickname)
    if other_nick and int(other_nick.get("id") or 0) != user_id:
        return _profile_personal_field_error_response("nickname", "Username already exists.")

    pending = {
        "firstName": first_name,
        "lastName": last_name,
        "nickname": nickname,
        "email": new_email_norm,
        "gender": gender,
        "birthday": birthday,
    }
    try:
        pending_json = json.dumps(pending, separators=(",", ":"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Invalid profile data."}), 400

    otp_code = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    if not db.store_user_profile_email_change_challenge(user_id, otp_code, expires_at, pending_json):
        return jsonify({"success": False, "error": "Could not start email verification. Please try again."}), 500

    if not _send_profile_email_change_otp_email(new_email_norm, otp_code, user.get("nickname") or ""):
        db.delete_user_profile_email_change_challenge(user_id)
        return jsonify({"success": False, "error": "Failed to send verification code. Please try again."}), 500

    return jsonify(
        {
            "success": True,
            "message": "We sent a 6-digit code to your new email address. Enter it to save your profile.",
        }
    ), 200


@app.route("/api/user/profile/email-change-resend", methods=["POST"])
def api_user_profile_email_change_resend():
    """Resend OTP for a pending profile email change (same pending fields)."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err

    is_locked, rem_sec, limit_msg = authsec.record_otp_resend(authsec.FLOW_EMAIL_CHANGE, f"user:{user_id}")
    if is_locked:
        return jsonify({"success": False, "error": limit_msg, "retryAfterSeconds": rem_sec}), 429

    user = db.get_user_by_id(user_id)
    if not user:
        return jsonify({"success": False, "error": "User not found."}), 404

    row = db.get_user_profile_email_change_challenge(user_id)
    if not row:
        return jsonify({"success": False, "error": "No pending email change. Save your profile again."}), 400

    pending_json = row.get("pending_payload") or ""
    try:
        pending = json.loads(pending_json)
        new_email = (pending.get("email") or "").strip().lower()
    except Exception:
        db.delete_user_profile_email_change_challenge(user_id)
        return jsonify({"success": False, "error": "Pending change was invalid. Please try again."}), 400

    if not new_email or "@" not in new_email:
        db.delete_user_profile_email_change_challenge(user_id)
        return jsonify({"success": False, "error": "Pending change was invalid. Please try again."}), 400

    otp_code = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    if not db.store_user_profile_email_change_challenge(user_id, otp_code, expires_at, pending_json):
        return jsonify({"success": False, "error": "Could not resend code. Please try again."}), 500

    if not _send_profile_email_change_otp_email(new_email, otp_code, user.get("nickname") or ""):
        return jsonify({"success": False, "error": "Failed to send verification code. Please try again."}), 500

    return jsonify({"success": True, "message": "A new code was sent to your new email address."}), 200


@app.route("/api/user/profile/email-change-confirm", methods=["POST"])
def api_user_profile_email_change_confirm():
    """Verify email OTP and apply the stored profile update (including new email)."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err

    code = (data.get("code") or "").strip()
    if not code or len(code) != 6 or not code.isdigit():
        return jsonify({"success": False, "error": "Please enter the 6-digit code from your email."}), 400

    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404

    row = db.get_user_profile_email_change_challenge(user_id)
    if not row:
        return jsonify({"success": False, "error": "No pending email change. Request a new code from Personal Information."}), 400

    expires_raw = row.get("expires_at")
    try:
        if isinstance(expires_raw, str):
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        else:
            expires_at = expires_raw
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    if datetime.now(timezone.utc) > expires_at or (row.get("otp_code") or "") != code:
        return jsonify({"success": False, "error": "Invalid or expired verification code."}), 400

    try:
        pending = json.loads(row.get("pending_payload") or "{}")
    except Exception:
        db.delete_user_profile_email_change_challenge(user_id)
        return jsonify({"success": False, "error": "Pending change was invalid. Please try again."}), 400

    first_name = (pending.get("firstName") or "").strip()
    last_name = (pending.get("lastName") or "").strip()
    nickname = (pending.get("nickname") or "").strip()
    email = (pending.get("email") or "").strip()
    gender = (pending.get("gender") or "").strip() or None
    birthday = (pending.get("birthday") or "").strip() or None

    ok, field_key, err_msg = db.update_user_profile(
        user_id,
        first_name,
        last_name,
        nickname,
        email,
        gender,
        birthday,
    )
    if not ok:
        db.delete_user_profile_email_change_challenge(user_id)
        return _profile_personal_field_error_response(field_key, err_msg or "Could not save profile.")

    db.delete_user_profile_email_change_challenge(user_id)
    row_user = db.get_user_by_id(user_id)
    return jsonify({"success": True, "user": serialize_user(row_user)}), 200


def _send_profile_password_change_email(email: str, code: str, nickname: str) -> bool:
    """Email OTP before applying a password change from Profile → Security."""
    api_key = os.environ.get("BREVO_API_KEY") or db.get_system_setting("brevo_api_key")
    sender_email = os.environ.get("BREVO_SENDER_EMAIL") or db.get_system_setting("brevo_sender_email")
    sender_name = os.environ.get("BREVO_SENDER_NAME") or db.get_system_setting("brevo_sender_name", "DiariCore")
    enable_notifications = (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true"

    if not enable_notifications:
        print(f"[PROFILE PASSWORD CHANGE DISABLED] OTP for {email}: {code}")
        return True

    if not api_key or not sender_email:
        print(f"[PROFILE PASSWORD CHANGE DEV MODE] {email} -> {code}")
        return True

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": email, "name": nickname or email.split("@")[0]}],
        "subject": "DiariCore — confirm password change",
        "htmlContent": _otp_email_html(
            "Confirm your password change",
            nickname,
            "Someone requested to change the password on your DiariCore account. Enter this code to confirm:",
            code,
            "This code expires in 10 minutes. If you did not request this, ignore this email.",
        ),
        "textContent": (
            f"Your DiariCore password change confirmation code is {code}. It expires in 10 minutes. "
            "If you did not request a password change, ignore this email."
        ),
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15):
            return True
    except Exception:
        return False


def _profile_pw_field(api_field: str | None) -> str:
    if api_field == "signUpPassword":
        return "profileSecNewPassword"
    return api_field or "profileSecNewPassword"


@app.route("/api/user/password/change-request", methods=["POST"])
def api_user_password_change_request():
    """Verify current password and policy, then email a 6-digit OTP (logged-in profile flow)."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    current_password = data.get("currentPassword") or ""
    new_password = data.get("newPassword") or ""
    confirm_password = data.get("confirmPassword") or ""
    if not current_password or not new_password or not confirm_password:
        return jsonify({"success": False, "error": "Current password, new password, and confirmation are required."}), 400
    if new_password != confirm_password:
        return jsonify({"success": False, "error": "New password and confirmation do not match."}), 400

    is_locked, rem_sec, limit_msg = authsec.record_otp_resend(authsec.FLOW_PASSWORD_CHANGE, f"user:{user_id}")
    if is_locked:
        return jsonify({"success": False, "error": limit_msg, "retryAfterSeconds": rem_sec}), 429

    user = db.get_user_by_id(user_id)
    if not user:
        return jsonify({"success": False, "error": "User not found."}), 404

    if not db.verify_user_password_by_id(user_id, current_password):
        return jsonify({"success": False, "error": "Current password is incorrect."}), 401

    if check_password_hash(user.get("password_hash") or "", new_password):
        return jsonify({"success": False, "error": "Please choose a password different from your current one."}), 400

    ok_pw, field_pw, msg_pw = password_policy.validate_new_password_for_user_row(new_password, user)
    if not ok_pw:
        return jsonify({"success": False, "field": _profile_pw_field(field_pw), "error": msg_pw}), 400

    otp_code = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    if not db.store_user_password_change_challenge(user_id, otp_code, expires_at):
        return jsonify({"success": False, "error": "Could not start password change. Please try again."}), 500

    email = (user.get("email") or "").strip()
    if not email:
        db.delete_user_password_change_challenge(user_id)
        return jsonify({"success": False, "error": "Your account has no email address on file."}), 400

    if not _send_profile_password_change_email(email, otp_code, user.get("nickname") or ""):
        db.delete_user_password_change_challenge(user_id)
        return jsonify({"success": False, "error": "Failed to send verification code. Please try again."}), 500

    return jsonify({"success": True, "message": "Verification code sent to your email."}), 200


@app.route("/api/user/password/change-confirm", methods=["POST"])
def api_user_password_change_confirm():
    """Confirm email OTP and apply the new password."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    current_password = data.get("currentPassword") or ""
    new_password = data.get("newPassword") or ""
    confirm_password = data.get("confirmPassword") or ""
    code = (data.get("code") or "").strip()
    if not current_password or not new_password or not confirm_password:
        return jsonify({"success": False, "error": "Current password, new password, and confirmation are required."}), 400
    if new_password != confirm_password:
        return jsonify({"success": False, "error": "New password and confirmation do not match."}), 400
    if not code or len(code) != 6 or not code.isdigit():
        return jsonify({"success": False, "error": "Please enter the 6-digit code from your email."}), 400

    user = db.get_user_by_id(user_id)
    if not user:
        return jsonify({"success": False, "error": "User not found."}), 404

    if not db.verify_user_password_by_id(user_id, current_password):
        return jsonify({"success": False, "error": "Current password is incorrect."}), 401

    if check_password_hash(user.get("password_hash") or "", new_password):
        return jsonify({"success": False, "error": "Please choose a password different from your current one."}), 400

    ok_pw, field_pw, msg_pw = password_policy.validate_new_password_for_user_row(new_password, user)
    if not ok_pw:
        return jsonify({"success": False, "field": _profile_pw_field(field_pw), "error": msg_pw}), 400

    row = db.get_user_password_change_challenge(user_id)
    if not row:
        return jsonify({"success": False, "error": "No pending password change. Request a new code from Security."}), 400

    expires_raw = row.get("expires_at")
    try:
        if isinstance(expires_raw, str):
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        else:
            expires_at = expires_raw
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    if datetime.now(timezone.utc) > expires_at or (row.get("otp_code") or "") != code:
        return jsonify({"success": False, "error": "Invalid or expired verification code."}), 400

    if not db.update_user_password_by_id(user_id, new_password):
        return jsonify({"success": False, "error": "Could not update password. Please try again."}), 500

    db.delete_user_password_change_challenge(user_id)
    return jsonify({"success": True, "message": "Password changed successfully."}), 200


@app.route("/api/password/forgot", methods=["POST"])
def api_password_forgot():
    rl = authsec.rate_limit_check(request, "forgot", _RATE_FORGOT[0], _RATE_FORGOT[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    data = request.get_json(silent=True) or {}
    ok_email, email, err_email = insec.validate_email((data.get("identifier") or data.get("email") or ""))
    if not ok_email:
        return jsonify({"success": False, "error": err_email or "Please enter a valid email."}), 400
    email = email.lower()

    is_locked, rem_sec, limit_msg = authsec.record_otp_resend(authsec.FLOW_FORGOT, db.get_login_lockout_key(email))
    if is_locked:
        return jsonify({"success": False, "error": limit_msg, "retryAfterSeconds": rem_sec}), 429

    user = db.get_user_by_email(email)
    if not user:
        return jsonify({"success": False, "error": "This email doesn’t appear to be associated with any account yet."}), 404

    reset_code = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    if not db.store_password_reset(user["email"], reset_code, expires_at):
        return jsonify({"success": False, "error": "Could not start password reset. Please try again."}), 500

    if not _send_password_reset_email(user["email"], reset_code, user.get("nickname") or ""):
        return jsonify({"success": False, "error": "Failed to send reset code. Please try again."}), 500

    return jsonify({"success": True, "message": "Reset code sent. Check your email."}), 200


@app.route("/api/password/reset", methods=["POST"])
def api_password_reset():
    data = request.get_json(silent=True) or {}
    email = (data.get("identifier") or "").strip().lower()
    reset_code = (data.get("code") or "").strip()
    new_password = data.get("newPassword") or ""

    if not email:
        return jsonify({"success": False, "error": "Email address is required."}), 400
    if "@" not in email or "." not in email:
        return jsonify({"success": False, "error": "Please enter a valid email address."}), 400
    if not reset_code:
        return jsonify({"success": False, "error": "Reset code is required."}), 400

    user = db.get_user_by_email(email)
    if not user:
        return jsonify({"success": False, "error": "Invalid reset request."}), 400

    ok_pw, _field_pw, msg_pw = password_policy.validate_new_password_for_user_row(new_password, user)
    if not ok_pw:
        return jsonify({"success": False, "field": "resetNewPassword", "error": msg_pw}), 400

    if check_password_hash(user.get("password_hash") or "", new_password):
        return jsonify({"success": False, "error": "Please enter a password different from your previous one."}), 400

    reset_row = db.get_password_reset(user["email"])
    if not reset_row:
        return jsonify({"success": False, "error": "Invalid or expired reset code."}), 400

    expires_raw = reset_row.get("expires_at")
    try:
        if isinstance(expires_raw, str):
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        else:
            expires_at = expires_raw
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    if datetime.now(timezone.utc) > expires_at or (reset_row.get("reset_code") or "") != reset_code:
        return jsonify({"success": False, "error": "Invalid or expired reset code."}), 400

    if not db.update_user_password_by_email(user["email"], new_password):
        return jsonify({"success": False, "error": "Could not update password. Please try again."}), 500

    db.delete_password_reset(user["email"])
    return jsonify({"success": True, "message": "Password updated successfully. You can now sign in."}), 200


@app.route("/api/password/verify-code", methods=["POST"])
def api_password_verify_code():
    data = request.get_json(silent=True) or {}
    email = (data.get("identifier") or "").strip().lower()
    reset_code = (data.get("code") or "").strip()

    if not email:
        return jsonify({"success": False, "error": "Email address is required."}), 400
    if "@" not in email or "." not in email:
        return jsonify({"success": False, "error": "Please enter a valid email."}), 400
    if not reset_code:
        return jsonify({"success": False, "error": "Reset code is required."}), 400

    user = db.get_user_by_email(email)
    if not user:
        return jsonify({"success": False, "error": "Invalid reset request."}), 400

    reset_row = db.get_password_reset(user["email"])
    if not reset_row:
        return jsonify({"success": False, "error": "Invalid or expired reset code."}), 400

    expires_raw = reset_row.get("expires_at")
    try:
        if isinstance(expires_raw, str):
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        else:
            expires_at = expires_raw
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    if datetime.now(timezone.utc) > expires_at or (reset_row.get("reset_code") or "") != reset_code:
        return jsonify({"success": False, "error": "Invalid or expired reset code."}), 400

    return jsonify({"success": True, "message": "Code verified."}), 200


# ============================================================================
# Admin Suite Endpoints (Dashboard, Users, Analytics, AI & Services, Settings)
# ============================================================================

def _get_admin_actor_email() -> str:
    """Helper to retrieve current admin email for audit logs."""
    uid = session.get("user_id")
    if uid:
        u = db.get_user_by_id(uid)
        if u and u.get("email"):
            return u["email"]
    return _configured_admin_email() or "admin@diaricore.internal"


@app.route("/api/admin/dashboard", methods=["GET"])
def api_admin_dashboard():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    try:
        stats = db.get_admin_dashboard_stats()
        hf_token = db.get_system_setting("hf_api_token", "") or os.environ.get("HF_API_TOKEN", "") or os.environ.get("HF_TOKEN", "")
        brevo_key = db.get_system_setting("brevo_api_key", "") or os.environ.get("BREVO_API_KEY", "")
        email_enabled = (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true"

        service_summary = {
            "database": {"status": "operational", "label": "Operational"},
            "voiceAi": {"status": "operational" if hf_token else "warning", "label": "Operational" if hf_token else "Token Missing"},
            "emailService": {"status": "operational" if (brevo_key and email_enabled) else ("disabled" if not email_enabled else "warning"), "label": "Operational" if (brevo_key and email_enabled) else ("Disabled" if not email_enabled else "Not Configured")},
            "emotionAi": {"status": "operational", "label": "Operational"},
        }
        stats["services"] = service_summary
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/admin/users", methods=["GET"])
def api_admin_users():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("perPage", 20, type=int)
    try:
        result = db.list_admin_users(search=q, status_filter=status, page=page, per_page=per_page)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/admin/users/<int:user_id>", methods=["GET"])
def api_admin_user_details(user_id):
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    try:
        user = db.get_admin_user_details(user_id)
        if not user:
            return jsonify({"success": False, "error": "User not found."}), 404
        return jsonify({"success": True, "user": user})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/admin/users/<int:user_id>/toggle-status", methods=["POST"])
def api_admin_user_toggle_status(user_id):
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    csrf_err = authsec.validate_csrf(request, session)
    if csrf_err:
        return jsonify({"success": False, "error": csrf_err}), 403

    current_uid = session.get("user_id")
    if current_uid and int(current_uid) == int(user_id):
        return jsonify({"success": False, "error": "You cannot disable your own administrator account."}), 400

    target_user = db.get_user_by_id(user_id)
    if not target_user:
        return jsonify({"success": False, "error": "User not found."}), 404
    if _user_is_configured_admin(target_user):
        return jsonify({"success": False, "error": "Cannot modify system administrator status."}), 400

    data = request.get_json(silent=True) or {}
    is_disabled = bool(data.get("disabled"))
    ok = db.set_user_disabled_status(user_id, is_disabled)
    if ok:
        admin_email = _get_admin_actor_email()
        db.log_admin_action(
            admin_email,
            "USER_DISABLED" if is_disabled else "USER_ACTIVATED",
            {"targetUserId": user_id, "targetEmail": target_user.get("email"), "targetNickname": target_user.get("nickname")},
            request.remote_addr,
        )
        return jsonify({"success": True, "message": f"User account has been {'deactivated' if is_disabled else 'activated'}."})
    return jsonify({"success": False, "error": "Could not update user status."}), 500


@app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
def api_admin_user_delete(user_id):
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    csrf_err = authsec.validate_csrf(request, session)
    if csrf_err:
        return jsonify({"success": False, "error": csrf_err}), 403

    current_uid = session.get("user_id")
    if current_uid and int(current_uid) == int(user_id):
        return jsonify({"success": False, "error": "You cannot delete your own administrator account."}), 400

    target_user = db.get_user_by_id(user_id)
    if not target_user:
        return jsonify({"success": False, "error": "User not found."}), 404
    if _user_is_configured_admin(target_user):
        return jsonify({"success": False, "error": "Cannot delete system administrator account."}), 400

    ok = db.delete_user_account_admin(user_id)
    if ok:
        admin_email = _get_admin_actor_email()
        db.log_admin_action(
            admin_email,
            "USER_DELETED",
            {"targetUserId": user_id, "targetEmail": target_user.get("email"), "targetNickname": target_user.get("nickname")},
            request.remote_addr,
        )
        return jsonify({"success": True, "message": "User account and all related records deleted permanently."})
    return jsonify({"success": False, "error": "Could not delete user account."}), 500


@app.route("/api/admin/analytics", methods=["GET"])
def api_admin_analytics():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    range_str = (request.args.get("range") or "30d").strip().lower()
    days_map = {"7d": 7, "30d": 30, "90d": 90, "all": 365}
    days = days_map.get(range_str, 30)
    try:
        data = db.get_admin_analytics_data(days=days)
        return jsonify({"success": True, "analytics": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/admin/services", methods=["GET"])
def api_admin_services():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    db_health = db.get_database_health_info()

    brevo_key = db.get_system_setting("brevo_api_key", "") or os.environ.get("BREVO_API_KEY", "")
    sender_email = db.get_system_setting("brevo_sender_email", "") or os.environ.get("BREVO_SENDER_EMAIL", "")
    sender_name = db.get_system_setting("brevo_sender_name", "DiariCore")
    email_enabled = (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true"

    hf_token = db.get_system_setting("hf_api_token", "") or os.environ.get("HF_API_TOKEN", "") or os.environ.get("HF_TOKEN", "")

    services = {
        "database": {
            "name": "Database Storage",
            "provider": db_health.get("engine", "PostgreSQL"),
            "status": "operational" if db_health.get("connected") else "error",
            "latencyMs": db_health.get("latencyMs", 0),
            "details": f"{db_health.get('totalUsers', 0)} users, {db_health.get('totalEntries', 0)} journal entries",
        },
        "email": {
            "name": "Email Delivery Service",
            "provider": "Brevo (Sendinblue) REST API v3",
            "status": "operational" if (brevo_key and email_enabled) else ("warning" if not brevo_key else "disabled"),
            "configured": bool(brevo_key and sender_email),
            "enabled": email_enabled,
            "senderEmail": sender_email or "Not configured",
            "senderName": sender_name,
        },
        "voiceAi": {
            "name": "Voice AI Speech Recognition",
            "provider": "Hugging Face Serverless Inference Router",
            "model": "openai/whisper-large-v3-turbo",
            "status": "operational" if hf_token else "warning",
            "configured": bool(hf_token),
            "supportedLanguages": "Auto, English (en), Taglish / Filipino (tl)",
        },
        "emotionAi": {
            "name": "Emotion & Sentiment NLP",
            "provider": "Transformer Inference Pipeline",
            "status": "operational",
            "model": "DiariCore RoBERTa / DistilRoBERTa Ensemble",
            "emotions": "Happy, Sad, Anxious, Angry, Neutral",
        }
    }
    return jsonify({"success": True, "services": services})


@app.route("/api/admin/services/test-email", methods=["POST"])
def api_admin_services_test_email():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    csrf_err = authsec.validate_csrf(request, session)
    if csrf_err:
        return jsonify({"success": False, "error": csrf_err}), 403

    data = request.get_json(silent=True) or {}
    dest_email = (data.get("recipientEmail") or "").strip()
    if not dest_email or "@" not in dest_email:
        dest_email = _get_admin_actor_email()

    api_key = os.environ.get("BREVO_API_KEY") or db.get_system_setting("brevo_api_key")
    sender_email = os.environ.get("BREVO_SENDER_EMAIL") or db.get_system_setting("brevo_sender_email")
    sender_name = os.environ.get("BREVO_SENDER_NAME") or db.get_system_setting("brevo_sender_name", "DiariCore")

    if not api_key:
        return jsonify({"success": False, "error": "No Brevo API key is configured. Please add an API key in System Settings."}), 400
    if not sender_email:
        return jsonify({"success": False, "error": "No Sender Email is configured. Please specify a sender email in System Settings."}), 400

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": dest_email, "name": "DiariCore Administrator"}],
        "subject": "DiariCore System Health Test - Brevo Email Service",
        "htmlContent": f"""
            <div style='font-family: Inter, -apple-system, sans-serif; max-width: 520px; padding: 24px; border: 1px solid #E0E6E3; border-radius: 12px; background: #FAFDFB;'>
                <h2 style='color: #2F3E36; margin-top: 0;'>✅ Email Service Operational</h2>
                <p style='color: #55665D; line-height: 1.5;'>This is a diagnostic test email generated by the <strong>DiariCore Admin Suite</strong>.</p>
                <div style='background: #EBF3EE; padding: 14px 18px; border-radius: 8px; margin: 16px 0;'>
                    <p style='margin: 0; color: #2F3E36; font-size: 14px;'><strong>Sender:</strong> {sender_name} &lt;{sender_email}&gt;</p>
                    <p style='margin: 4px 0 0; color: #2F3E36; font-size: 14px;'><strong>Timestamp:</strong> {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}</p>
                    <p style='margin: 4px 0 0; color: #2F3E36; font-size: 14px;'><strong>Status:</strong> Connected via Brevo REST API v3</p>
                </div>
                <p style='color: #7D8A84; font-size: 12px; margin-bottom: 0;'>DiariCore Admin Diagnostic Tool</p>
            </div>
        """,
        "textContent": f"DiariCore System Health Test: Email service is working properly. Sent from {sender_email} at {datetime.now(timezone.utc).isoformat()}.",
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            resp_body = resp.read().decode("utf-8")
            admin_email = _get_admin_actor_email()
            db.log_admin_action(admin_email, "TEST_EMAIL_SENT", {"recipient": dest_email, "response": resp_body[:100]}, request.remote_addr)
            return jsonify({"success": True, "message": f"Test email successfully delivered to {dest_email}."})
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        return jsonify({"success": False, "error": f"Brevo HTTP {e.code}: {err_msg[:200]}"}), 400
    except Exception as ex:
        return jsonify({"success": False, "error": f"Connection error: {str(ex)}"}), 500


@app.route("/api/admin/services/test-ai", methods=["POST"])
def api_admin_services_test_ai():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    csrf_err = authsec.validate_csrf(request, session)
    if csrf_err:
        return jsonify({"success": False, "error": csrf_err}), 403

    try:
        import time
        import urllib.request
        import urllib.error
        import hf_speech

        hf_token = hf_speech.get_hf_token()
        if not hf_token:
            return jsonify({
                "success": False,
                "error": "No Hugging Face token is configured. Please enter your token in System Settings."
            }), 200

        t0 = time.perf_counter()
        endpoint = "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo"
        headers = {
            "Authorization": f"Bearer {hf_token}",
            "User-Agent": "DiariCore/1.0",
        }
        status_code = None

        try:
            import httpx
            with httpx.Client(timeout=httpx.Timeout(12.0, connect=6.0)) as client:
                resp = client.get(endpoint, headers=headers)
                status_code = resp.status_code
        except Exception:
            # Fallback to standard library urllib
            req = urllib.request.Request(endpoint, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    status_code = response.getcode()
            except urllib.error.HTTPError as he:
                status_code = he.code
            except Exception as ex:
                return jsonify({"success": False, "error": f"Network error contacting router: {str(ex)}"}), 200

        latency = round((time.perf_counter() - t0) * 1000, 2)
        try:
            admin_email = _get_admin_actor_email()
            db.log_admin_action(admin_email, "TEST_AI_PING", {"status": status_code, "latencyMs": latency}, request.remote_addr)
        except Exception:
            pass

        if status_code in (200, 400, 405):
            return jsonify({
                "success": True,
                "message": "Voice AI router is operational and responsive!",
                "latencyMs": latency,
                "model": "openai/whisper-large-v3-turbo"
            }), 200
        elif status_code == 401:
            return jsonify({
                "success": False,
                "error": "Hugging Face returned 401 Unauthorized. Your API token is invalid or lacks Inference Providers permission."
            }), 200
        else:
            return jsonify({
                "success": True,
                "message": f"Endpoint responded with HTTP {status_code}",
                "latencyMs": latency
            }), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Voice AI test encountered an issue: {str(e)}"}), 200


@app.route("/api/admin/audit-logs", methods=["GET"])
def api_admin_audit_logs():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("perPage", request.args.get("per_page", 12, type=int), type=int)
    limit = request.args.get("limit", None, type=int)
    try:
        data = db.get_admin_audit_logs(page=page, per_page=per_page, limit=limit)
        return jsonify({
            "success": True,
            "logs": data["records"],
            "data": data,
            "total": data["total"],
            "page": data["page"],
            "perPage": data["perPage"],
            "totalPages": data["totalPages"],
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/admin/settings", methods=["GET"])
def api_admin_settings_get():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    api_key = db.get_system_setting("brevo_api_key", "")
    masked = ""
    if api_key:
        if len(api_key) <= 8:
            masked = "*" * len(api_key)
        else:
            masked = f"{api_key[:4]}{'*' * (len(api_key) - 8)}{api_key[-4:]}"

    hf_token = db.get_system_setting("hf_api_token", "") or os.environ.get("HF_API_TOKEN", "") or os.environ.get("HF_TOKEN", "")
    masked_hf = ""
    if hf_token:
        if len(hf_token) <= 8:
            masked_hf = "*" * len(hf_token)
        else:
            masked_hf = f"{hf_token[:4]}{'*' * (len(hf_token) - 8)}{hf_token[-4:]}"

    return jsonify(
        {
            "success": True,
            "settings": {
                "hasApiKey": bool(api_key),
                "maskedApiKey": masked,
                "hasHfToken": bool(hf_token),
                "maskedHfToken": masked_hf,
                "senderEmail": db.get_system_setting("brevo_sender_email", ""),
                "senderName": db.get_system_setting("brevo_sender_name", "DiariCore"),
                "enableEmailNotifications": (db.get_system_setting("enable_email_notifications", "true") or "true").lower() == "true",
                "appName": db.get_system_setting("app_name", "DiariCore"),
                "allowRegistration": (db.get_system_setting("allow_registration", "true") or "true").lower() == "true",
                "maintenanceMode": (db.get_system_setting("maintenance_mode", "false") or "false").lower() == "true",
            },
        }
    )


@app.route("/api/admin/settings", methods=["POST"])
def api_admin_settings_save():
    if not session.get("is_admin"):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    csrf_err = authsec.validate_csrf(request, session)
    if csrf_err:
        return jsonify({"success": False, "error": csrf_err}), 403

    data = request.get_json(silent=True) or {}
    api_key = (data.get("apiKey") or "").strip()
    hf_token = (data.get("hfToken") or "").strip()
    sender_email = (data.get("senderEmail") or "").strip()
    sender_name = (data.get("senderName") or "").strip()
    enable_notifications = bool(data.get("enableEmailNotifications"))
    app_name = (data.get("appName") or "DiariCore").strip()
    allow_registration = bool(data.get("allowRegistration", True))
    maintenance_mode = bool(data.get("maintenanceMode", False))

    if sender_email and ("@" not in sender_email or "." not in sender_email):
        return jsonify({"success": False, "error": "Sender email is invalid."}), 400

    if api_key:
        db.set_system_setting("brevo_api_key", api_key)
    if hf_token:
        db.set_system_setting("hf_api_token", hf_token)
    if sender_email:
        db.set_system_setting("brevo_sender_email", sender_email)
    if sender_name:
        db.set_system_setting("brevo_sender_name", sender_name)
    db.set_system_setting("enable_email_notifications", "true" if enable_notifications else "false")
    db.set_system_setting("app_name", app_name)
    db.set_system_setting("allow_registration", "true" if allow_registration else "false")
    db.set_system_setting("maintenance_mode", "true" if maintenance_mode else "false")

    admin_email = _get_admin_actor_email()
    db.log_admin_action(admin_email, "SETTINGS_UPDATED", {"enableNotifications": enable_notifications, "maintenanceMode": maintenance_mode}, request.remote_addr)

    return jsonify({"success": True, "message": "Settings saved successfully."}), 200


@app.route("/api/admin/logout", methods=["POST"])
def api_admin_logout():
    admin_email = _get_admin_actor_email()
    db.log_admin_action(admin_email, "ADMIN_LOGOUT", {}, request.remote_addr)
    session.clear()
    return jsonify({"success": True})


@app.route("/admin")
def admin_page():
    if not _session_is_admin():
        return abort(403)
    return send_from_directory(TEMPLATES_DIR, "admin.html")


@app.route("/api/check-availability")
def api_check_availability():
    field = (request.args.get("field") or "").strip().lower()
    value = (request.args.get("value") or "").strip()
    exclude_raw = (request.args.get("excludeUserId") or "").strip()
    exclude_id = None
    if exclude_raw.isdigit():
        exclude_id = int(exclude_raw)

    if field not in ("nickname", "email"):
        return jsonify({"success": False, "error": "Invalid field."}), 400
    if not value:
        return jsonify({"success": False, "error": "Value is required."}), 400

    if field == "nickname":
        row = db.get_user_by_nickname(value)
        taken = row is not None and (exclude_id is None or int(row.get("id") or 0) != exclude_id)
        return jsonify(
            {
                "success": True,
                "field": "nickname",
                "available": not taken,
                "message": None if not taken else "Username already exists.",
            }
        )

    row = db.get_user_by_email(value)
    taken = row is not None and (exclude_id is None or int(row.get("id") or 0) != exclude_id)
    return jsonify(
        {
            "success": True,
            "field": "signUpEmail",
            "available": not taken,
            "message": None if not taken else "Email already exists.",
        }
    )


@app.route("/api/entries", methods=["GET"])
def api_entries_get():
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    user = db.get_user_by_id(user_id) if hasattr(db, "get_user_by_id") else None
    if not user:
        return jsonify({"success": False, "error": "User not found."}), 404
    rows = db.get_journal_entries_by_user(user_id)
    resp = jsonify({"success": True, "entries": [serialize_entry(r) for r in rows]})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200


@app.route("/api/tags", methods=["GET"])
def api_tags_get():
    uid, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    if not db.get_user_by_id(uid):
        return jsonify({"success": False, "error": "User not found."}), 404
    rows = db.list_user_tags(uid)
    items = []
    for r in rows:
        if not r or not r.get("tag"):
            continue
        items.append(
            {
                "tag": r.get("tag"),
                "iconName": (r.get("icon_name") or "").strip().lower() or None,
            }
        )
    # Keep legacy `tags` for old clients while returning richer `tagItems`.
    tags = [x["tag"] for x in items]
    return jsonify({"success": True, "tags": tags, "tagItems": items}), 200


@app.route("/api/tags", methods=["POST"])
def api_tags_post():
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    tag_raw = data.get("tag") or ""
    icon_raw = data.get("iconName") or ""
    ok_tag, tag, err_tag = insec.validate_tag(tag_raw)
    if not ok_tag:
        return jsonify({"success": False, "error": err_tag or "Invalid tag."}), 400
    ok_icon, icon_name, err_icon = insec.validate_icon_name(icon_raw)
    if not ok_icon:
        return jsonify({"success": False, "error": err_icon or "Invalid icon."}), 400
    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404
    ok = db.add_user_tag(user_id=user_id, tag=tag, icon_name=icon_name)
    if not ok:
        return jsonify({"success": False, "error": "Could not save tag."}), 500
    return jsonify({"success": True}), 201


@app.route("/api/tags", methods=["DELETE"])
def api_tags_delete():
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    tag_raw = data.get("tag") or ""
    ok_tag, tag, err_tag = insec.validate_tag(tag_raw)
    if not ok_tag:
        return jsonify({"success": False, "error": err_tag or "Invalid tag."}), 400
    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404
    ok = db.delete_user_tag(user_id=user_id, tag=tag)
    if not ok:
        return jsonify({"success": False, "error": "Could not delete tag."}), 500
    return jsonify({"success": True}), 200


@app.route("/api/triggers/summary", methods=["GET"])
def api_triggers_summary():
    uid, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    if not db.get_user_by_id(uid):
        return jsonify({"success": False, "error": "User not found."}), 404

    summary = db.get_tag_trigger_summary(uid, min_entries_per_bucket=3)
    stress_list = [x for x in (summary.get("topStressTriggers") or []) if x]
    happy_list = [x for x in (summary.get("topHappinessTriggers") or []) if x]
    stress_rank = [x for x in (summary.get("stressRanking") or []) if x]
    happy_rank = [x for x in (summary.get("happinessRanking") or []) if x]
    stress_counts = summary.get("stressCounts") or {}
    happy_counts = summary.get("happinessCounts") or {}

    # Primary tags (what we display as "Top ... trigger")
    stress_primary = stress_rank[0] if stress_rank else (stress_list[0] if stress_list else None)
    happy_primary = happy_rank[0] if happy_rank else (happy_list[0] if happy_list else None)

    stress = _to_title_case(stress_primary) if stress_primary else None
    happy = _to_title_case(happy_primary) if happy_primary else None
    stress_top_count = int(stress_counts.get(stress_primary) or 0) if stress_primary else 0
    happy_top_count = int(happy_counts.get(happy_primary) or 0) if happy_primary else 0

    stress_desc = (
        _pick_template(STRESS_TRIGGER_TEMPLATES, tag=stress_primary)
        if stress_primary
        else "Add more tagged stress-related entries to unlock your stress trigger insight."
    )
    happy_desc = (
        _pick_template(HAPPINESS_TRIGGER_TEMPLATES, tag=happy_primary)
        if happy_primary
        else "Add more tagged happy entries to unlock your positive trigger insight."
    )
    stress_justification = (
        _pick_count_template(STRESS_COUNT_JUSTIFICATION_TEMPLATES, tag=stress_primary, count=stress_top_count)
        if stress_primary and stress_top_count > 0
        else None
    )
    happiness_justification = (
        _pick_count_template(HAPPINESS_COUNT_JUSTIFICATION_TEMPLATES, tag=happy_primary, count=happy_top_count)
        if happy_primary and happy_top_count > 0
        else None
    )

    return jsonify(
        {
            "success": True,
            "topStressTrigger": stress,
            "topHappinessTrigger": happy,
            "topStressTriggers": [_to_title_case(x) for x in stress_list],
            "topHappinessTriggers": [_to_title_case(x) for x in happy_list],
            "stressDescription": stress_desc,
            "happinessDescription": happy_desc,
            "stressTopCount": stress_top_count,
            "happinessTopCount": happy_top_count,
            "stressJustification": stress_justification,
            "happinessJustification": happiness_justification,
            "stressTaggedEntries": int(summary.get("stressTaggedEntries") or 0),
            "happinessTaggedEntries": int(summary.get("happinessTaggedEntries") or 0),
            "minRequiredEntries": int(summary.get("minRequiredEntries") or 3),
        }
    ), 200


@app.route("/api/entries", methods=["POST"])
def api_entries_post():
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    title_raw = data.get("title") or ""
    entry_date_time_local = (data.get("entryDateTimeLocal") or "").strip()
    text = insec.normalize_entry_text(data.get("text") or "")
    tags = data.get("tags") or []
    image_urls = data.get("imageUrls") or []

    if not text:
        return jsonify({"success": False, "error": "Entry text is required."}), 400
    ok_title, title, err_title = insec.validate_title(title_raw)
    if not ok_title:
        return jsonify({"success": False, "error": err_title or "Invalid title."}), 400
    ok_tags, tags, err_tags = insec.sanitize_tags_list(tags)
    if not ok_tags:
        return jsonify({"success": False, "error": err_tags or "Invalid tags."}), 400
    ok_imgs, clean_images, err_imgs = insec.sanitize_image_urls(image_urls)
    if not ok_imgs:
        return jsonify({"success": False, "error": err_imgs or "Invalid image URLs."}), 400
    word_count = _entry_word_count(text)
    if word_count > ENTRY_WORD_MAX:
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        f"Please keep your entry to {ENTRY_WORD_MAX} words or fewer "
                        f"(you have {word_count})."
                    ),
                }
            ),
            400,
        )
    user = db.get_user_by_id(user_id) if hasattr(db, "get_user_by_id") else None
    if not user:
        return jsonify({"success": False, "error": "User not found."}), 404

    analysis = space_nlp.analyze(text)
    entry_dt_utc = _parse_ph_local_to_utc_iso(entry_date_time_local)
    if entry_dt_utc:
        try:
            parsed_dt = datetime.fromisoformat(entry_dt_utc.replace("Z", "+00:00"))
            if parsed_dt > datetime.now(timezone.utc):
                return jsonify({"success": False, "error": "Future entry date/time is not allowed."}), 400
        except Exception:
            return jsonify({"success": False, "error": "Invalid entry date/time."}), 400
    row = db.create_journal_entry(
        user_id=user_id,
        text_content=text,
        title=title,
        entry_datetime_utc=entry_dt_utc,
        tags_json=json.dumps(tags),
        image_urls_json=json.dumps(clean_images),
        sentiment_label=analysis["sentimentLabel"],
        sentiment_score=float(analysis["sentimentScore"]),
        emotion_label=analysis["emotionLabel"],
        emotion_score=float(analysis["emotionScore"]),
        all_probs_json=json.dumps(analysis.get("all_probs") or {}),
    )
    response_entry = serialize_entry(row)
    response_entry["secondaryMood"] = analysis.get("secondaryMood")
    return jsonify({"success": True, "entry": response_entry, "analysisEngine": analysis.get("engine", "hf-custom")}), 201


@app.route("/api/entries/analyze-text", methods=["POST"])
def api_entries_analyze_text():
    """Run mood/NLP on text only (no DB write). Used by entry view / modal re-run."""
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    rl = authsec.rate_limit_check(request, f"analyze:{user_id}", _RATE_ANALYZE[0], _RATE_ANALYZE[1])
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    text = insec.normalize_entry_text(data.get("text") or "")
    if not text:
        return jsonify({"success": False, "error": "Entry text is required."}), 400
    word_count = _entry_word_count(text)
    if word_count > ENTRY_WORD_MAX:
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        f"Please keep your entry to {ENTRY_WORD_MAX} words or fewer "
                        f"(you have {word_count})."
                    ),
                }
            ),
            400,
        )
    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404
    analysis = space_nlp.analyze(text)
    return (
        jsonify(
            {
                "success": True,
                "sentimentLabel": (analysis.get("sentimentLabel") or "neutral"),
                "sentimentScore": float(analysis.get("sentimentScore") or 0.5),
                "emotionLabel": (analysis.get("emotionLabel") or "neutral"),
                "emotionScore": float(analysis.get("emotionScore") or 0.5),
                "all_probs": analysis.get("all_probs") or {},
                "analysisEngine": analysis.get("engine", "hf-custom"),
            }
        ),
        200,
    )


@app.route("/api/entries/<int:entry_id>", methods=["GET"])
def api_entries_one(entry_id: int):
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404
    row = db.get_journal_entry_by_id(entry_id, user_id)
    if not row:
        return jsonify({"success": False, "error": "Entry not found."}), 404
    return jsonify({"success": True, "entry": serialize_entry(row)}), 200


@app.route("/api/entries/<int:entry_id>", methods=["PATCH"])
def api_entries_patch(entry_id: int):
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    title_raw = data.get("title") or ""
    text = insec.normalize_entry_text(data.get("text") or "")
    tags = data.get("tags") or []
    reanalyze = bool(data.get("reanalyze"))

    if not text:
        return jsonify({"success": False, "error": "Entry text is required."}), 400
    ok_title, title, err_title = insec.validate_title(title_raw)
    if not ok_title:
        return jsonify({"success": False, "error": err_title or "Invalid title."}), 400
    ok_tags, clean_tags, err_tags = insec.sanitize_tags_list(tags)
    if not ok_tags:
        return jsonify({"success": False, "error": err_tags or "Invalid tags."}), 400
    word_count = _entry_word_count(text)
    if word_count > ENTRY_WORD_MAX:
        return (
            jsonify(
                {
                    "success": False,
                    "error": (
                        f"Please keep your entry to {ENTRY_WORD_MAX} words or fewer "
                        f"(you have {word_count})."
                    ),
                }
            ),
            400,
        )
    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404

    existing = db.get_journal_entry_by_id(entry_id, user_id)
    if not existing:
        return jsonify({"success": False, "error": "Entry not found."}), 404

    old_img_raw = existing.get("image_urls_json") or "[]"
    try:
        old_image_list = json.loads(old_img_raw) if isinstance(old_img_raw, str) else []
        if not isinstance(old_image_list, list):
            old_image_list = []
    except Exception:
        old_image_list = []

    if "imageUrls" in data:
        raw_images = data.get("imageUrls") or []
        ok_imgs, clean_images, err_imgs = insec.sanitize_image_urls(raw_images)
        if not ok_imgs:
            return jsonify({"success": False, "error": err_imgs or "Invalid image URLs."}), 400
        _cleanup_removed_entry_uploads(old_image_list, clean_images)
        images_json = json.dumps(clean_images)
    else:
        clean_images = [str(x).strip() for x in old_image_list if isinstance(x, str) and str(x).strip()]
        images_json = json.dumps(clean_images)

    engine = None
    if reanalyze:
        analysis = space_nlp.analyze(text)
        sentiment_label = analysis["sentimentLabel"]
        sentiment_score = float(analysis["sentimentScore"])
        emotion_label = analysis["emotionLabel"]
        emotion_score = float(analysis["emotionScore"])
        all_probs_json = json.dumps(analysis.get("all_probs") or {})
        engine = analysis.get("engine", "hf-custom")
    else:
        sentiment_label = existing.get("sentiment_label") or "neutral"
        sentiment_score = float(existing.get("sentiment_score") or 0.5)
        emotion_label = existing.get("emotion_label") or "neutral"
        emotion_score = float(existing.get("emotion_score") or 0.5)
        all_probs_json = existing.get("all_probs_json") or "{}"

    row = db.update_journal_entry(
        entry_id,
        user_id,
        title=title,
        text_content=text,
        tags_json=json.dumps(clean_tags),
        sentiment_label=str(sentiment_label).lower()[:32],
        sentiment_score=sentiment_score,
        emotion_label=str(emotion_label).lower()[:32],
        emotion_score=emotion_score,
        all_probs_json=all_probs_json,
        image_urls_json=images_json,
    )
    if not row:
        return jsonify({"success": False, "error": "Could not update entry."}), 500
    response_entry = serialize_entry(row)
    if reanalyze:
        response_entry["secondaryMood"] = None
    return jsonify({"success": True, "entry": response_entry, "analysisEngine": engine if reanalyze else None}), 200


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
def api_entries_delete(entry_id: int):
    data = request.get_json(silent=True) or {}
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    if not db.get_user_by_id(user_id):
        return jsonify({"success": False, "error": "User not found."}), 404
    existing = db.get_journal_entry_by_id(entry_id, user_id)
    if not existing:
        return jsonify({"success": False, "error": "Entry not found."}), 404
    if not db.delete_journal_entry(entry_id, user_id):
        return jsonify({"success": False, "error": "Could not delete entry."}), 500
    return jsonify({"success": True}), 200


@app.route("/api/uploads/image", methods=["POST"])
def api_upload_image():
    try:
        user_id, auth_err = _require_authenticated_user()
        if auth_err:
            return auth_err
        rl = authsec.rate_limit_check(request, f"upload:{user_id}", _RATE_UPLOAD[0], _RATE_UPLOAD[1])
        if rl:
            return jsonify({"success": False, "error": rl}), 429
        if not db.get_user_by_id(user_id):
            return jsonify({"success": False, "error": "User not found."}), 404
        file = request.files.get("file")
        if not file or not file.filename:
            return jsonify({"success": False, "error": "Image file is required."}), 400
        if not _allowed_image_extension(file.filename):
            return jsonify(
                {
                    "success": False,
                    "error": "Unsupported file type. Use JPEG, PNG, WebP, GIF, HEIC, BMP, TIFF, or AVIF.",
                }
            ), 400

        ext = os.path.splitext(file.filename)[1].lower()
        safe_name = f"entry_{user_id}_{uuid.uuid4().hex}{ext}"
        abs_path = os.path.join(UPLOADS_DIR, safe_name)
        try:
            file.save(abs_path)
        except OSError:
            app.logger.exception("entry image save failed for %s", safe_name)
            return jsonify({"success": False, "error": "Could not save image on server. Try again or use a smaller file."}), 503
        return jsonify({"success": True, "url": f"/uploads/{safe_name}"}), 201
    except Exception:
        app.logger.exception("api_upload_image failed")
        return jsonify({"success": False, "error": "Image upload failed. Please try again."}), 500


MAX_VOICE_TRANSCRIBE_BYTES = 8 * 1024 * 1024


@app.route("/api/voice/status", methods=["GET"])
def api_voice_status():
    """Optional server transcription status (default voice path is on-device in the browser)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    import hf_speech

    try:
        import groq_speech

        groq_configured = groq_speech.is_configured()
        groq_model = os.environ.get("GROQ_SPEECH_MODEL", "whisper-large-v3-turbo")
    except Exception:
        groq_configured = False
        groq_model = os.environ.get("GROQ_SPEECH_MODEL", "whisper-large-v3-turbo")

    provider = "groq" if groq_configured else ("hf" if hf_speech.is_configured() else "on-device")

    return jsonify(
        {
            "success": True,
            "configured": hf_speech.is_configured(),
            "model": os.environ.get("HF_SPEECH_MODEL", "openai/whisper-large-v3"),
            "groqConfigured": groq_configured,
            "groqModel": groq_model,
            "provider": provider,
            "onDeviceDefault": True,
        }
    ), 200


@app.route("/api/voice/transcribe", methods=["POST"])
def api_voice_transcribe():
    """Fast server voice transcription using Whisper AI."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    rl = authsec.rate_limit_check(request, f"voice:{user_id}", 15, 60.0)
    if rl:
        return jsonify({"success": False, "error": rl}), 429
    import hf_speech

    f = request.files.get("audio")
    if not f:
        return jsonify({"success": False, "error": "Missing audio file (form field: audio)."}), 400
    data = f.read()
    if not data:
        return jsonify({"success": False, "error": "Empty audio upload."}), 400
    if len(data) > MAX_VOICE_TRANSCRIBE_BYTES:
        return jsonify({"success": False, "error": "Recording is too large (max ~8 MB)."}), 413

    content_type = (f.mimetype or "audio/webm").split(";")[0].strip()
    language_hint = (request.form.get("language") or "").strip().lower() or None

    # Primary: Groq Whisper (fast, generous free tier). Fallback: HF Inference.
    try:
        import groq_speech

        if groq_speech.is_configured():
            text, err = groq_speech.transcribe_upload_bytes(data, content_type, language=language_hint)
            if text is not None:
                return jsonify({"success": True, "text": text, "source": "groq_whisper"}), 200
            if err and groq_speech.is_no_speech_error(err):
                return jsonify({"success": False, "error": err.split("NO_SPEECH: ", 1)[-1]}), 502
            print(f"[voice/transcribe] Groq failed, trying HF fallback: {(err or '')[:200]}")
    except Exception as ge:
        print(f"[voice/transcribe] Groq path exception, trying HF fallback: {ge}")

    text, err = hf_speech.transcribe_upload_bytes(data, content_type, language=language_hint)
    if text is not None:
        return jsonify({"success": True, "text": text, "source": "whisper_ai"}), 200
    err_low = (err or "").lower()
    if err and ("credits_exhausted" in err_low or "credits are exhausted" in err_low or "insufficient" in err_low or "quota" in err_low):
        status = 402
    elif err and "warming" in err_low:
        status = 503
    else:
        status = 502
    return jsonify({"success": False, "error": err or "Transcription failed."}), status



@app.route("/BOOK.json")
def streak_book_lottie():
    """Dashboard streak widget — baked static/img/BOOK.json."""
    img_base = os.path.join(STATIC_DIR, "img")
    full = os.path.join(img_base, "BOOK.json")
    if os.path.abspath(full).startswith(os.path.abspath(img_base)) and os.path.isfile(full):
        return send_from_directory(img_base, "BOOK.json")
    abort(404)


@app.route("/noto-emoji/book.json")
def mood_analysis_book_lottie():
    """Mood-analysis overlay — static/img/noto-emoji/book.json (not BOOK.json)."""
    img_base = os.path.join(STATIC_DIR, "img")
    folder = os.path.join(img_base, "noto-emoji")
    full = os.path.join(folder, "book.json")
    if os.path.abspath(full).startswith(os.path.abspath(img_base)) and os.path.isfile(full):
        return send_from_directory(folder, "book.json")
    abort(404)


@app.route("/uploads/<path:filename>")
def uploaded_images(filename):
    safe = os.path.normpath(filename)
    if ".." in safe or safe.startswith(os.sep):
        abort(404)
    if not _allowed_image_extension(safe):
        abort(404)
    return send_from_directory(UPLOADS_DIR, safe)


@app.route("/")
def index():
    return send_from_directory(TEMPLATES_DIR, "login.html")


@app.route("/index.html")
def legacy_index_page():
    return send_from_directory(TEMPLATES_DIR, "login.html")


@app.route("/manifest.webmanifest")
def pwa_manifest():
    """Web app manifest for installable PWA."""
    return send_from_directory(
        STATIC_DIR,
        "manifest.webmanifest",
        mimetype="application/manifest+json",
    )


@app.route("/service-worker.js")
def pwa_service_worker():
    """Service worker at site root for full-scope PWA control."""
    resp = send_from_directory(STATIC_DIR, "service-worker.js", mimetype="application/javascript")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/api/push/vapid-public-key", methods=["GET"])
def api_push_vapid_public_key():
    """PWA Web Push: public VAPID key for PushManager.subscribe."""
    key = push_service.vapid_public_key()
    if request.args.get("health") == "1":
        health = push_service.push_health()
        health.update(push_service.push_scheduler_health())
    else:
        health = {"pushBackendVersion": push_service.PUSH_BACKEND_VERSION}
    if not key:
        return jsonify({"success": False, "error": "Web Push is not configured on this server.", **health}), 503
    return jsonify({"success": True, "publicKey": key, **health}), 200


@app.route("/api/push/subscribe", methods=["POST"])
def api_push_subscribe():
    """Save browser PushSubscription for the logged-in user (PWA true push)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    data = request.get_json(silent=True) or {}
    sub = data.get("subscription") if isinstance(data.get("subscription"), dict) else data
    if not isinstance(sub, dict) or not sub.get("endpoint"):
        return jsonify({"success": False, "error": "Invalid push subscription."}), 400
    if not push_service.push_configured():
        return jsonify({"success": False, "error": "Web Push is not configured on this server."}), 503
    endpoint = str(sub.get("endpoint") or "").strip()
    pruned = 0
    if data.get("keepThisDeviceOnly") is not False and endpoint:
        pruned = db.delete_push_subscriptions_for_user_except(user_id, endpoint)
    if not db.upsert_push_subscription(user_id, sub, push_service.vapid_public_key()):
        return jsonify({"success": False, "error": "Could not save subscription."}), 500
    push_service.clear_daily_push_retry_state(user_id)
    devices = len(db.list_push_subscriptions_for_user(user_id))
    print(
        f"[diari-push-subscribe] user={user_id} devices={devices} "
        f"target={push_service._endpoint_hint(endpoint)} pruned={pruned}",
        flush=True,
    )
    notif = data.get("notifications")
    if isinstance(notif, dict):
        old_prefs = push_service._user_notification_prefs(user_id)
        db.merge_user_ui_preferences_json(user_id, {"notifications": notif})
        new_prefs = push_service._user_notification_prefs(user_id)
        if old_prefs.get("reminderTimeOverride") != new_prefs.get("reminderTimeOverride"):
            push_service.clear_daily_reminder_state(user_id)
    return jsonify(
        {
            "success": True,
            "webPush": True,
            "prunedOtherDevices": pruned,
            "schedule": push_service.schedule_status_for_user(user_id),
            "subscribedDevices": devices,
        }
    ), 200


@app.route("/api/push/unsubscribe", methods=["POST"])
def api_push_unsubscribe():
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    data = request.get_json(silent=True) or {}
    endpoint = str(data.get("endpoint") or "").strip()
    if not endpoint:
        return jsonify({"success": False, "error": "endpoint is required."}), 400
    db.delete_push_subscription(user_id, endpoint)
    return jsonify({"success": True}), 200


@app.route("/api/push/preferences", methods=["POST"])
def api_push_preferences():
    """Sync PWA notification toggles + reminder time to server for cron dispatch."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    data = request.get_json(silent=True)
    if not data and request.data:
        try:
            data = json.loads(request.data.decode("utf-8"))
        except Exception:
            data = {}
    data = data or {}
    patch = {}
    if "notifications" in data and isinstance(data["notifications"], dict):
        patch["notifications"] = data["notifications"]
    if not patch:
        return jsonify({"success": False, "error": "Provide notifications object."}), 400
    old_prefs = push_service._user_notification_prefs(user_id)
    if not db.merge_user_ui_preferences_json(user_id, patch):
        return jsonify({"success": False, "error": "Could not save preferences."}), 500
    new_prefs = push_service._user_notification_prefs(user_id)
    if old_prefs.get("reminderTimeOverride") != new_prefs.get("reminderTimeOverride"):
        push_service.clear_daily_reminder_state(user_id)
    schedule = push_service.schedule_status_for_user(user_id)
    # Do not dispatch from preference sync while the app is open — cron handles the
    # scheduled window; immediate dispatch here caused extra banners every ~5 minutes.
    return jsonify({"success": True, "schedule": schedule}), 200


@app.route("/api/push/diagnostics", methods=["POST"])
def api_push_client_diagnostics():
    """PWA: store last client-side push registration report (for support debugging)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    data = request.get_json(silent=True) or {}
    report = data.get("report") if isinstance(data.get("report"), dict) else data
    if not isinstance(report, dict):
        return jsonify({"success": False, "error": "Invalid report."}), 400
    db.merge_user_ui_preferences_json(
        user_id,
        {
            "pushDebug": {
                "lastClientReport": report,
                "lastClientReportAt": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    devices = len(db.list_push_subscriptions_for_user(user_id))
    err = str(report.get("error") or "").strip()
    print(
        f"[diari-push-diag] user={user_id} devices={devices} "
        f"pwa={report.get('pwaStandalone')} perm={report.get('notificationPermission')} "
        f"err={err[:120] if err else 'none'}",
        flush=True,
    )
    return jsonify({"success": True, "subscribedDevices": devices}), 200


@app.route("/api/push/schedule-status", methods=["GET"])
def api_push_schedule_status():
    """PWA: show what time the server will use for daily reminders."""
    user_id, auth_err = _require_authenticated_user()
    if auth_err:
        return auth_err
    return jsonify(
        {"success": True, **push_service.schedule_status_for_user(user_id)}
    ), 200


@app.route("/api/push/prune-devices", methods=["POST"])
def api_push_prune_devices():
    """Keep only this phone's push endpoint (newest registration)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    data = request.get_json(silent=True) or {}
    endpoint = str(data.get("endpoint") or "").strip()
    pruned = db.prune_push_subscriptions_for_user(
        user_id, keep_endpoint=endpoint or None, max_keep=1
    )
    return jsonify(
        {
            "success": True,
            "pruned": pruned,
            "schedule": push_service.schedule_status_for_user(user_id),
        }
    ), 200


@app.route("/api/push/reset-daily-reminder", methods=["POST"])
def api_push_reset_daily_reminder():
    """Clear server-side 'already sent today' so the next window can fire again (testing / missed banner)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    push_service.clear_daily_reminder_state(user_id)
    return jsonify(
        {
            "success": True,
            "schedule": push_service.schedule_status_for_user(user_id),
        }
    ), 200


@app.route("/api/push/delivery-ack", methods=["POST"])
def api_push_delivery_ack():
    """Service worker: confirms push reached the device (not just FCM accepted)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    data = request.get_json(silent=True) or {}
    push_service.record_delivery_ack(user_id, data)
    return jsonify({"success": True}), 200


@app.route("/api/push/send-daily-test", methods=["POST"])
def api_push_send_daily_test():
    """Send the real daily-reminder push now (same title/body/tag as cron)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    if not push_service.push_configured():
        return jsonify({"success": False, "error": "Web Push is not configured on this server."}), 503
    result = push_service.send_daily_test_push_to_user(user_id)
    status = 200 if result.get("ok") else 502
    return jsonify({"success": result.get("ok"), **result}), status


@app.route("/api/push/test", methods=["POST"])
def api_push_test():
    """PWA: send one test push immediately (logged-in user)."""
    user_id, auth_err = _require_authenticated_user(check_csrf=False)
    if auth_err:
        return auth_err
    if not push_service.push_configured():
        return jsonify({"success": False, "error": "Web Push is not configured on this server."}), 503
    result = push_service.send_test_push_to_user(user_id)
    status = 200 if result.get("ok") else 502
    return jsonify({"success": result.get("ok"), **result}), status


def _require_push_cron_secret():
    secret = (os.environ.get("PUSH_CRON_SECRET") or "").strip()
    if not secret:
        return None, (jsonify({"success": False, "error": "PUSH_CRON_SECRET not set."}), 503)
    provided = (request.headers.get("X-Push-Cron-Secret") or "").strip()
    if provided != secret:
        abort(403)
    return secret, None


@app.route("/api/internal/push/test", methods=["POST"])
def api_internal_push_test():
    """
    Send test push to ALL subscribed devices immediately (PowerShell / cron ops).
    Header: X-Push-Cron-Secret
    """
    _, err = _require_push_cron_secret()
    if err:
        return err
    if not push_service.push_configured():
        return jsonify({"success": False, "error": "Web Push is not configured."}), 503
    result = push_service.send_test_push_to_all()
    status = 200 if result.get("ok") else 502
    return jsonify({"success": result.get("ok"), **result}), status


@app.route("/api/internal/push/dispatch", methods=["POST"])
def api_internal_push_dispatch():
    """
    Cron endpoint: send due Web Push notifications (true push when app is closed).
    Header: X-Push-Cron-Secret must match PUSH_CRON_SECRET.
    """
    _, err = _require_push_cron_secret()
    if err:
        return err
    debug = request.args.get("debug") == "1"
    result = push_service.dispatch_due_notifications(debug=debug)
    return jsonify({"success": True, **result}), 200


@app.route("/<path:filename>")
def static_files(filename):
    if filename.startswith("api/"):
        abort(404)
    if filename == "admin.html" and not _session_is_admin():
        abort(403)

    safe = os.path.normpath(filename)
    if ".." in safe or safe.startswith(os.sep):
        abort(404)

    ext = os.path.splitext(safe)[1].lower()
    template_exts = {".html"}
    static_dir_map = {
        ".css": "css",
        ".js": "js",
        ".json": "img",
        ".woff": "css",
        ".woff2": "css",
        ".ttf": "css",
        ".eot": "css",
        ".png": "img",
        ".jpg": "img",
        ".jpeg": "img",
        ".gif": "img",
        ".webp": "img",
        ".svg": "img",
        ".ico": "img",
    }

    if ext in template_exts:
        full = os.path.join(TEMPLATES_DIR, safe)
        if os.path.abspath(full).startswith(os.path.abspath(TEMPLATES_DIR)) and os.path.isfile(full):
            return send_from_directory(TEMPLATES_DIR, safe)
        abort(404)

    full_static = os.path.join(STATIC_DIR, safe)
    if os.path.abspath(full_static).startswith(os.path.abspath(STATIC_DIR)) and os.path.isfile(full_static):
        return send_from_directory(STATIC_DIR, safe)

    subdir = static_dir_map.get(ext)
    if subdir:
        full = os.path.join(STATIC_DIR, subdir, safe)
        static_base = os.path.join(STATIC_DIR, subdir)
        if os.path.abspath(full).startswith(os.path.abspath(static_base)) and os.path.isfile(full):
            return send_from_directory(static_base, safe)

    # Fallback for remaining root-level files that are intentionally kept.
    full = os.path.join(BASE_DIR, safe)
    if os.path.abspath(full).startswith(os.path.abspath(BASE_DIR)) and os.path.isfile(full):
        return send_from_directory(BASE_DIR, safe)
    abort(404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
