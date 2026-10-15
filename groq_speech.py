"""
Groq automatic speech recognition (Whisper, fast inference).

Uses Groq's OpenAI-compatible audio transcription endpoint — generous free
tier, very fast, and far more accurate than on-device whisper-tiny/small.
Browser recordings are usually WebM/Opus or MP4/AAC.

Setup: set GROQ_API_KEY in Railway Variables (get a free key at
https://console.groq.com/keys). Optional override: GROQ_SPEECH_MODEL
(default "whisper-large-v3-turbo").

Returns (transcript_text, error_message). On success error_message is None.
Errors prefixed with "NO_SPEECH: " mean the clip had no usable speech
(caller should NOT try another provider). Errors prefixed with
"CREDITS_EXHAUSTED: " mean quota/rate issues (caller may try HF fallback).
"""

from __future__ import annotations

import os
from typing import Optional, Tuple

GROQ_SPEECH_MODEL = os.environ.get("GROQ_SPEECH_MODEL", "whisper-large-v3-turbo").strip()
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"

NO_SPEECH_MSG = "It seems like you didn't talk during the recording. No words were transcribed — please try again."


def get_groq_token() -> str:
    """Retrieve Groq API key from environment or system_settings database table."""
    token = os.environ.get("GROQ_API_KEY", "").strip()
    if token:
        return token
    try:
        import db
        val = db.get_system_setting("groq_api_key", "")
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    except Exception:
        pass
    return ""


def is_configured() -> bool:
    """Return True if a Groq API key is configured."""
    return bool(get_groq_token())


def is_no_speech_error(err: Optional[str]) -> bool:
    return bool(err) and err.startswith("NO_SPEECH: ")


def _map_language(hint: Optional[str]) -> Optional[str]:
    """Map DiariCore voice hint ('en'/'tl') to Whisper ISO-639-1 codes."""
    h = (hint or "").strip().lower()
    if h in ("en", "en-us", "english"):
        return "en"
    if h in ("tl", "fil", "tagalog", "filipino", "taglish", "fil-ph"):
        return "tl"
    return None  # auto-detect


def _extension_for(content_type: str) -> str:
    ct = (content_type or "").lower()
    if "mp4" in ct or "aac" in ct:
        return "m4a"
    if "ogg" in ct:
        return "ogg"
    if "wav" in ct:
        return "wav"
    if "mpeg" in ct or "mp3" in ct:
        return "mp3"
    return "webm"


def transcribe_upload_bytes(
    data: bytes, content_type: str, language: Optional[str] = None
) -> Tuple[Optional[str], Optional[str]]:
    if not data:
        return None, "NO_SPEECH: Empty audio recording."
    if len(data) < 200:
        return None, "NO_SPEECH: Recording was too short. Please speak for at least 2–3 seconds."

    token = get_groq_token()
    if not token:
        return None, "Groq API key is not configured yet. Set GROQ_API_KEY in Railway Variables."

    model_id = GROQ_SPEECH_MODEL or "whisper-large-v3-turbo"
    clean_ct = (content_type or "audio/webm").split(";")[0].strip() or "audio/webm"
    filename = f"recording.{_extension_for(clean_ct)}"
    lang = _map_language(language)

    try:
        import httpx

        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": "DiariCore/1.0",
        }
        # NOTE: `data` values must be plain strings — tuple values here made
        # httpx emit a malformed duplicate `model` part, which Groq rejects
        # with 400 "only one model is allowed".
        form_fields: dict = {
            "model": model_id,
            "response_format": "json",
        }
        if lang:
            form_fields["language"] = lang
        files = {"file": (filename, data, clean_ct)}
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            resp = client.post(GROQ_ENDPOINT, headers=headers, data=form_fields, files=files)
    except Exception as e:
        print(f"[groq_speech] request exception: {e}")
        return None, "CREDITS_EXHAUSTED: Could not reach the Groq transcription service. Check your connection and try again."

    if resp.status_code == 200:
        try:
            payload = resp.json()
        except Exception:
            return None, "CREDITS_EXHAUSTED: Groq returned an unreadable response. Please try again."
        text = (payload.get("text") or "").strip() if isinstance(payload, dict) else ""
        if text:
            return text, None
        return None, f"NO_SPEECH: {NO_SPEECH_MSG}"

    try:
        body = resp.text or ""
    except Exception:
        body = ""
    snippet = body[:300]
    print(f"[groq_speech] HTTP {resp.status_code}: {snippet}")
    low = body.lower()

    if resp.status_code == 401:
        return None, "Groq API key unauthorized (401). Check GROQ_API_KEY in Railway Variables."
    if resp.status_code == 413:
        return None, "NO_SPEECH: Recording is too large for transcription. Try a shorter recording."
    if resp.status_code == 429 or "rate" in low or "quota" in low or "credit" in low or "exceeded" in low:
        return None, "CREDITS_EXHAUSTED: Groq rate limit / quota reached (HTTP %s). Try again shortly." % resp.status_code
    if resp.status_code in (500, 502, 503, 504):
        return None, "CREDITS_EXHAUSTED: Groq transcription is temporarily unavailable (HTTP %s). Please try again." % resp.status_code
    return None, "CREDITS_EXHAUSTED: Groq transcription failed (HTTP %s). Please try again." % resp.status_code
