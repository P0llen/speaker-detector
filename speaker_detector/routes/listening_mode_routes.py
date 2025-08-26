# speaker_detector/routes/listening_mode_routes.py
from flask import Blueprint, request, jsonify
import json
import os

# Work directly on the real state module to avoid shadowing globals
import speaker_detector.speaker_state as state

# Optional restart helper; if missing we wrap stop->start
try:
    from speaker_detector.speaker_state import restart_detection_loop as _restart_detection_loop
    def restart_detection_loop():
        _restart_detection_loop()
except Exception:
    def restart_detection_loop():
        state.stop_detection_loop()
        state.start_detection_loop()

# --- Backend defaults (single source of truth) ---
try:
    from speaker_detector.constants import (
        DEFAULT_CONFIDENCE_THRESHOLD,
        DEFAULT_INTERVAL_MS,
    )
except Exception:
    # Safe fallback if constants module changes
    DEFAULT_CONFIDENCE_THRESHOLD = 0.75
    DEFAULT_INTERVAL_MS = 3000

# --- Persistence location ---
# Use your existing "storage" folder at project root
SETTINGS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..", "storage"))
os.makedirs(SETTINGS_DIR, exist_ok=True)
SETTINGS_PATH = os.path.join(SETTINGS_DIR, "listening_settings.json")

# --- Helpers ---
def _read_persisted() -> dict:
    if not os.path.exists(SETTINGS_PATH):
        return {}
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}

def _write_persisted(payload: dict) -> None:
    try:
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, SETTINGS_PATH)
    except Exception:
        pass

def _sanitize_mode(m: str) -> str:
    m = (m or "").strip()
    return m if m in ("off", "single", "multi") else "off"

def _sanitize_interval(v) -> int:
    try:
        return max(200, int(v))
    except Exception:
        return DEFAULT_INTERVAL_MS

def _sanitize_threshold(v) -> float:
    try:
        t = float(v)
        if 0.0 <= t <= 1.0:
            return t
    except Exception:
        pass
    return DEFAULT_CONFIDENCE_THRESHOLD

def _payload(include_defaults: bool = True, persisted_found: bool | None = None) -> dict:
    out = {
        "mode": state.LISTENING_MODE.get("mode", "off"),
        "interval_ms": getattr(state, "DETECTION_INTERVAL_MS", DEFAULT_INTERVAL_MS),
        "threshold": getattr(state, "DETECTION_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD),
    }
    if include_defaults:
        out["defaults"] = {
            "threshold": DEFAULT_CONFIDENCE_THRESHOLD,
            "interval_ms": DEFAULT_INTERVAL_MS,
        }
    if persisted_found is not None:
        out["persisted"] = bool(persisted_found)
    return out

def _persist_current():
    _write_persisted(
        {
            "mode": state.LISTENING_MODE.get("mode", "off"),
            "interval_ms": getattr(state, "DETECTION_INTERVAL_MS", DEFAULT_INTERVAL_MS),
            "threshold": getattr(state, "DETECTION_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD),
        }
    )

# --- One-time rehydrate on import ---
_persisted = _read_persisted()
if _persisted:
    state.LISTENING_MODE["mode"] = _sanitize_mode(_persisted.get("mode"))
    state.DETECTION_INTERVAL_MS = _sanitize_interval(_persisted.get("interval_ms"))
    state.DETECTION_THRESHOLD   = _sanitize_threshold(_persisted.get("threshold"))

listening_bp = Blueprint("listening", __name__)

@listening_bp.route("/api/listening-mode", methods=["GET", "POST"])
def listening_mode():
    """
    Read or update listening settings: { mode, interval_ms, threshold }.
    """
    if request.method == "POST":
        data = request.get_json(silent=True) or {}

        # mode
        new_mode = _sanitize_mode(data.get("mode") or state.LISTENING_MODE.get("mode") or "off")
        state.LISTENING_MODE["mode"] = new_mode

        # interval
        if "interval_ms" in data:
            state.DETECTION_INTERVAL_MS = _sanitize_interval(data["interval_ms"])

        # threshold
        if "threshold" in data:
            state.DETECTION_THRESHOLD = _sanitize_threshold(data["threshold"])

        # persist user choice
        _persist_current()

        # manage loop based on mode
        if new_mode == "off":
            state.stop_detection_loop()
        else:
            state.start_detection_loop()

    persisted_state = _read_persisted()
    return jsonify(_payload(include_defaults=True, persisted_found=bool(persisted_state)))

@listening_bp.route("/api/restart-detection", methods=["POST"])
def restart_detection():
    try:
        restart_detection_loop()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
