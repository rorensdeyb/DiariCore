"""
Hugging Face automatic speech recognition (Whisper).

Uses huggingface_hub.InferenceClient with provider fallbacks. Browser recordings
are usually WebM/Opus or MP4/AAC depending on the device.
"""

from __future__ import annotations

import os
import time
from typing import Any, List, Optional, Tuple

HF_SPEECH_MODEL = os.environ.get("HF_SPEECH_MODEL", "openai/whisper-large-v3-turbo").strip()

# Providers that commonly host Whisper for InferenceClient.
_ASR_PROVIDERS: List[Optional[str]] = [
    os.environ.get("HF_SPEECH_PROVIDER", "").strip() or None,
    "fal-ai",
    "hf-inference",
    "auto",
    None,
]
# De-dupe while preserving order.
_seen_prov = set()
ASR_PROVIDER_CHAIN: List[Optional[str]] = []
for p in _ASR_PROVIDERS:
    key = p or "__default__"
    if key in _seen_prov:
        continue
    _seen_prov.add(key)
    ASR_PROVIDER_CHAIN.append(p)


def get_hf_token() -> str:
    """Retrieve HF Token from environment or system_settings database table."""
    token = (
        os.environ.get("HF_API_TOKEN_FOR_VOICE", "").strip()
        or os.environ.get("HF_API_TOKEN", "").strip()
        or os.environ.get("HF_TOKEN", "").strip()
    )
    if token:
        return token
    try:
        import db
        val = db.get_system_setting("hf_api_token", "")
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    except Exception:
        pass
    return ""


def is_configured() -> bool:
    """Return True if HF API token is configured."""
    return bool(get_hf_token())


SILENCE_PHRASES = {
    "", ".", "...", "..", ",", "-", "--", "!", "?",
    "so", "you", "thank you", "thanks for watching", "subtitles by",
    "the end", "bye", "mbc", "music", "silence", "applause", "whispering", "screaming",
}


def _clean_transcript_text(raw: str) -> str:
    if not raw:
        return ""
    text = raw.strip()
    norm = "".join(c for c in text.lower() if c.isalnum() or c.isspace()).strip()
    if norm in SILENCE_PHRASES:
        return ""
    if text.strip(" .?!-–—,;:\t\n\r") == "":
        return ""
    return text


def _extract_text(out: Any) -> str:
    if out is None:
        return ""
    text = getattr(out, "text", None)
    if isinstance(text, str) and text.strip():
        return _clean_transcript_text(text.strip())
    if isinstance(out, dict):
        t = out.get("text")
        if isinstance(t, str) and t.strip():
            return _clean_transcript_text(t.strip())
    chunks = getattr(out, "chunks", None)
    if chunks:
        parts: List[str] = []
        for ch in chunks:
            if isinstance(ch, dict):
                piece = ch.get("text") or ""
            else:
                piece = getattr(ch, "text", "") or ""
            if piece:
                parts.append(str(piece))
        joined = " ".join(parts).strip()
        if joined:
            return _clean_transcript_text(joined)
    return ""


def transcribe_upload_bytes(data: bytes, content_type: str, language: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (transcript_text, error_message). On success error_message is None.
    """
    if not data:
        return None, "Empty audio recording."
    if len(data) < 200:
        return None, "Recording was too short. Please speak for at least 2–3 seconds."

    token = get_hf_token()
    if not token:
        return (
            None,
            "Hugging Face API token is not configured yet. Set HF_API_TOKEN in Railway or Admin Settings.",
        )

    model_id = HF_SPEECH_MODEL or "openai/whisper-large-v3-turbo"
    clean_ct = (content_type or "audio/webm").split(";")[0].strip() or "audio/webm"

    def _credit_error_message(status: int, body: str) -> Optional[str]:
        low = (body or "").lower()
        credit_hints = (
            "insufficient",
            "credit",
            "quota",
            "exceeded",
            "payment required",
            "billing",
            "free tier",
            "monthly included",
        )
        if status == 402 or any(h in low for h in credit_hints):
            return (
                "Hugging Face inference credits are exhausted (HTTP %s). "
                "The app will try free on-device transcription instead. "
                "To re-enable server AI, add a new token with credits via "
                "Railway Variables (HF_API_TOKEN) or Admin Settings." % status
            )
        return None

    def _status_error(status: int, body: str) -> Tuple[Optional[str], bool]:
        """Return (error_message, retryable)."""
        snippet = (body or "")[:300]
        print(f"[hf_speech] router HTTP {status}: {snippet}")
        credit_msg = _credit_error_message(status, body)
        if credit_msg:
            return credit_msg, False
        if status == 401:
            return "Hugging Face token unauthorized (401). Please verify token permissions include 'Inference'.", False
        if status == 403:
            return "Hugging Face token forbidden (403) for this model. Check token permissions or model access.", False
        if status == 404:
            return f"Speech model '{model_id}' not found (404) on the inference router.", False
        if status == 429:
            return "Transcription is rate-limited right now (429). The app will try free on-device transcription instead.", True
        if status in (500, 502, 503, 504):
            return "", True  # retryable; caller retries once then falls through
        return f"Transcription router returned HTTP {status}. The app will try free on-device transcription instead.", True

    # 1. Primary: Direct high-speed HTTP call via Hugging Face serverless router (1-2s response)
    try:
        import httpx
        url = f"https://router.huggingface.co/hf-inference/models/{model_id}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": clean_ct,
            "User-Agent": "DiariCore/1.0",
        }
        with httpx.Client(timeout=httpx.Timeout(25.0, connect=10.0)) as client:
            resp = client.post(url, headers=headers, content=data)

        if resp.status_code == 200:
            res_data = resp.json()
            text = _extract_text(res_data)
            if text:
                return text, None
            return None, "It seems like you didn't talk during the recording. No words were transcribed — please try again."
        elif resp.status_code in (500, 502, 503, 504):
            time.sleep(2.0)
            # retry once on warm-up
            with httpx.Client(timeout=httpx.Timeout(25.0, connect=10.0)) as client:
                resp = client.post(url, headers=headers, content=data)
            if resp.status_code == 200:
                text = _extract_text(resp.json())
                if text:
                    return text, None
                return None, "It seems like you didn't talk during the recording. No words were transcribed — please try again."
        if resp.status_code != 200:
            try:
                body_text = resp.text or ""
            except Exception:
                body_text = ""
            err_msg, _retryable = _status_error(resp.status_code, body_text)
            if err_msg:
                # Non-retryable (credits/auth) or informative: surface immediately.
                # Mark credit errors so the client knows to use the free on-device path.
                if "credits are exhausted" in err_msg or "rate-limited" in err_msg:
                    return None, "CREDITS_EXHAUSTED: " + err_msg
                return None, err_msg
            # else: transient 5xx already retried -> fall through to InferenceClient
    except Exception as e:
        print(f"[hf_speech] Direct HTTP call exception: {e}")

    # 2. Secondary fallback via InferenceClient
    try:
        from huggingface_hub import InferenceClient
        client = InferenceClient(token=token)
        out = client.automatic_speech_recognition(audio=data, model=model_id)
        text = _extract_text(out)
        if text:
            return text, None
        return None, "It seems like you didn't talk during the recording. No words were transcribed — please try again."
    except Exception as exc:
        msg = str(exc)
        print(f"[hf_speech] InferenceClient fallback error: {exc}")
        credit_msg = _credit_error_message(0, msg)
        if credit_msg:
            return None, "CREDITS_EXHAUSTED: " + credit_msg
        low = msg.lower()
        if "401" in low or "unauthorized" in low:
            return None, "Hugging Face token unauthorized (401). Please verify token permissions include 'Inference'."
        if "429" in low or "too many" in low or "rate" in low:
            return None, "CREDITS_EXHAUSTED: Transcription is rate-limited right now. The app will try free on-device transcription instead."

    return None, "CREDITS_EXHAUSTED: Transcription service temporarily unavailable. The app will try free on-device transcription instead — no new token required for that path."


