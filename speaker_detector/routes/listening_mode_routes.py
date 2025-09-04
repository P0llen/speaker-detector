from flask import Blueprint, request, jsonify
import json
import os

import speaker_detector.speaker_state as state

try:
    from speaker_detector.speaker_state import restart_detection_loop as _restart_detection_loop
    def restart_detection_loop():
        _restart_detection_loop()
except Exception:
    def restart_detection_loop():
        state.stop_detection_loop()
        state.start_detection_loop()

try:
    from speaker_detector.constants import (
        DEFAULT_CONFIDENCE_THRESHOLD,
        DEFAULT_INTERVAL_MS,
        DEFAULT_UNKNOWN_STREAK_LIMIT,
        DEFAULT_HOLD_TTL_S,
        DEFAULT_WINDOW_S,
    )
except Exception:
    DEFAULT_CONFIDENCE_THRESHOLD = 0.75
    DEFAULT_INTERVAL_MS = 3000
    DEFAULT_UNKNOWN_STREAK_LIMIT = 2
    DEFAULT_HOLD_TTL_S = 4.0
    DEFAULT_WINDOW_S = 1.25

SETTINGS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..", "storage"))
os.makedirs(SETTINGS_DIR, exist_ok=True)
SETTINGS_PATH = os.path.join(SETTINGS_DIR, "listening_settings.json")

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

def _sanitize_int(v, *, lo: int = 0, hi: int = 10, default: int = 0) -> int:
    try:
        x = int(v)
        return max(lo, min(hi, x))
    except Exception:
        return default

def _sanitize_float(v, *, lo: float = 0.0, hi: float = 10.0, default: float = 0.0) -> float:
    try:
        x = float(v)
        x = max(lo, min(hi, x))
        return x
    except Exception:
        return default

def _payload(include_defaults: bool = True, persisted_found: bool | None = None) -> dict:
    out = {
        "mode": state.LISTENING_MODE.get("mode", "off"),
        "interval_ms": getattr(state, "DETECTION_INTERVAL_MS", DEFAULT_INTERVAL_MS),
        "threshold": getattr(state, "DETECTION_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD),
        "unknown_streak_limit": getattr(state, "UNKNOWN_STREAK_LIMIT", DEFAULT_UNKNOWN_STREAK_LIMIT),
        "hold_ttl_s": getattr(state, "HOLD_TTL_S", DEFAULT_HOLD_TTL_S),
        "window_s": getattr(state, "DURATION_S", DEFAULT_WINDOW_S),
    }
    if include_defaults:
        out["defaults"] = {
            "threshold": DEFAULT_CONFIDENCE_THRESHOLD,
            "interval_ms": DEFAULT_INTERVAL_MS,
            "unknown_streak_limit": DEFAULT_UNKNOWN_STREAK_LIMIT,
            "hold_ttl_s": DEFAULT_HOLD_TTL_S,
            "window_s": DEFAULT_WINDOW_S,
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
            "unknown_streak_limit": getattr(state, "UNKNOWN_STREAK_LIMIT", DEFAULT_UNKNOWN_STREAK_LIMIT),
            "hold_ttl_s": getattr(state, "HOLD_TTL_S", DEFAULT_HOLD_TTL_S),
            "window_s": getattr(state, "DURATION_S", DEFAULT_WINDOW_S),
        }
    )

# One-time rehydrate on import
_persisted = _read_persisted()
if _persisted:
    state.LISTENING_MODE["mode"] = _sanitize_mode(_persisted.get("mode"))
    state.DETECTION_INTERVAL_MS = _sanitize_interval(_persisted.get("interval_ms"))
    state.DETECTION_THRESHOLD   = _sanitize_threshold(_persisted.get("threshold"))
    # Optional tunables for smoothing and window length
    state.UNKNOWN_STREAK_LIMIT  = _sanitize_int(_persisted.get("unknown_streak_limit"), lo=0, hi=5, default=DEFAULT_UNKNOWN_STREAK_LIMIT)
    state.HOLD_TTL_S            = _sanitize_float(_persisted.get("hold_ttl_s"), lo=0.0, hi=10.0, default=DEFAULT_HOLD_TTL_S)
    state.DURATION_S            = _sanitize_float(_persisted.get("window_s"), lo=0.5, hi=3.0, default=DEFAULT_WINDOW_S)

listening_bp = Blueprint("listening", __name__)

@listening_bp.route("/api/listening-mode", methods=["GET", "POST"])
def listening_mode():
    """
    Read or update listening settings: { mode, interval_ms, threshold }.
    Idempotent: only start/stop the loop when the mode actually changes.
    """
    if request.method == "POST":
        data = request.get_json(silent=True) or {}

        prev_mode      = state.LISTENING_MODE.get("mode", "off")
        prev_interval  = getattr(state, "DETECTION_INTERVAL_MS", DEFAULT_INTERVAL_MS)
        prev_threshold = getattr(state, "DETECTION_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD)
        prev_unknown   = getattr(state, "UNKNOWN_STREAK_LIMIT", DEFAULT_UNKNOWN_STREAK_LIMIT)
        prev_hold_ttl  = getattr(state, "HOLD_TTL_S", DEFAULT_HOLD_TTL_S)
        prev_window_s  = getattr(state, "DURATION_S", DEFAULT_WINDOW_S)

        new_mode      = _sanitize_mode(data.get("mode", prev_mode))
        new_interval  = _sanitize_interval(data.get("interval_ms", prev_interval))
        new_threshold = _sanitize_threshold(data.get("threshold", prev_threshold))
        new_unknown   = _sanitize_int(data.get("unknown_streak_limit", prev_unknown), lo=0, hi=5, default=prev_unknown)
        new_hold_ttl  = _sanitize_float(data.get("hold_ttl_s", prev_hold_ttl), lo=0.0, hi=10.0, default=prev_hold_ttl)
        new_window_s  = _sanitize_float(data.get("window_s", prev_window_s), lo=0.5, hi=3.0, default=prev_window_s)

        # Update in-memory SSOT
        state.LISTENING_MODE["mode"] = new_mode
        state.DETECTION_INTERVAL_MS  = new_interval
        state.DETECTION_THRESHOLD    = new_threshold
        state.UNKNOWN_STREAK_LIMIT   = new_unknown
        state.HOLD_TTL_S             = new_hold_ttl
        state.DURATION_S             = new_window_s

        # Persist once
        _persist_current()

        # Only touch the loop if mode actually changed
        if new_mode != prev_mode:
            if new_mode == "off":
                state.stop_detection_loop()
            else:
                state.start_detection_loop()
        # Else: leave the loop alone; interval/threshold will be picked up naturally

    persisted_state = _read_persisted()
    return jsonify(_payload(include_defaults=True, persisted_found=bool(persisted_state)))

@listening_bp.route("/api/restart-detection", methods=["POST"])
def restart_detection():
    try:
        restart_detection_loop()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
