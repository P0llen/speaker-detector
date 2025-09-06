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
        DEFAULT_SPK_THRESHOLD,
        DEFAULT_BG_THRESHOLD,
        DEFAULT_DECISION_MARGIN,
        DEFAULT_BG_MARGIN_OVER_SPK,
        DEFAULT_RMS_SPEECH_GATE,
        DEFAULT_CONFIDENCE_SMOOTHING,
        DEFAULT_SESSION_LOGGING,
        DEFAULT_EMBED_AVG,
        DEFAULT_EMBED_AVG_N,
        DEFAULT_VAD_TRIM,
    )
except Exception:
    DEFAULT_CONFIDENCE_THRESHOLD = 0.75
    DEFAULT_INTERVAL_MS = 4000
    DEFAULT_UNKNOWN_STREAK_LIMIT = 2
    DEFAULT_HOLD_TTL_S = 4.0
    DEFAULT_WINDOW_S = 4.0
    DEFAULT_SPK_THRESHOLD = 0.38
    DEFAULT_BG_THRESHOLD = 0.70
    DEFAULT_DECISION_MARGIN = 0.07
    DEFAULT_BG_MARGIN_OVER_SPK = 0.10
    DEFAULT_RMS_SPEECH_GATE = 1e-3
    DEFAULT_CONFIDENCE_SMOOTHING = 0.80
    DEFAULT_SESSION_LOGGING = False
    DEFAULT_EMBED_AVG = True
    DEFAULT_EMBED_AVG_N = 3
    DEFAULT_VAD_TRIM = True

SETTINGS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..", "storage"))
os.makedirs(SETTINGS_DIR, exist_ok=True)
SETTINGS_PATH = os.path.join(SETTINGS_DIR, "listening_settings.json")
PROFILES_PATH = os.path.join(SETTINGS_DIR, "listening_profiles.json")

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

def _load_profiles() -> dict:
    try:
        if os.path.exists(PROFILES_PATH):
            with open(PROFILES_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
    except Exception:
        pass
    return {}

def _save_profiles(data: dict) -> None:
    try:
        tmp = PROFILES_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, PROFILES_PATH)
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

def _sanitize_bool(v, default: bool = False) -> bool:
    try:
        if isinstance(v, bool):
            return v
        s = str(v).strip().lower()
        if s in ("1", "true", "yes", "on"):
            return True
        if s in ("0", "false", "no", "off"):
            return False
    except Exception:
        pass
    return default

def _payload(include_defaults: bool = True, persisted_found: bool | None = None) -> dict:
    out = {
        "mode": state.LISTENING_MODE.get("mode", "off"),
        "interval_ms": getattr(state, "DETECTION_INTERVAL_MS", DEFAULT_INTERVAL_MS),
        "unknown_streak_limit": getattr(state, "UNKNOWN_STREAK_LIMIT", DEFAULT_UNKNOWN_STREAK_LIMIT),
        "hold_ttl_s": getattr(state, "HOLD_TTL_S", DEFAULT_HOLD_TTL_S),
        "window_s": getattr(state, "DURATION_S", DEFAULT_WINDOW_S),
        # Advanced identification tunables
        "spk_threshold": getattr(state, "SPK_THRESHOLD", DEFAULT_SPK_THRESHOLD),
        "bg_threshold": getattr(state, "BG_THRESHOLD", DEFAULT_BG_THRESHOLD),
        "decision_margin": getattr(state, "DECISION_MARGIN", DEFAULT_DECISION_MARGIN),
        "bg_margin_over_spk": getattr(state, "BG_MARGIN_OVER_SPK", DEFAULT_BG_MARGIN_OVER_SPK),
        "rms_speech_gate": getattr(state, "RMS_SPEECH_GATE", DEFAULT_RMS_SPEECH_GATE),
        # Behavior toggles
        "confidence_smoothing": getattr(state, "CONFIDENCE_SMOOTHING", DEFAULT_CONFIDENCE_SMOOTHING),
        "session_logging": getattr(state, "SESSION_LOGGING", DEFAULT_SESSION_LOGGING),
        "embed_avg": getattr(state, "EMBED_AVG", DEFAULT_EMBED_AVG),
        "embed_avg_n": getattr(state, "EMBED_AVG_N", DEFAULT_EMBED_AVG_N),
        "vad_trim": getattr(state, "VAD_TRIM", DEFAULT_VAD_TRIM),
    }
    if include_defaults:
        out["defaults"] = {
            "interval_ms": DEFAULT_INTERVAL_MS,
            "unknown_streak_limit": DEFAULT_UNKNOWN_STREAK_LIMIT,
            "hold_ttl_s": DEFAULT_HOLD_TTL_S,
            "window_s": DEFAULT_WINDOW_S,
            # Advanced defaults
            "spk_threshold": DEFAULT_SPK_THRESHOLD,
            "bg_threshold": DEFAULT_BG_THRESHOLD,
            "decision_margin": DEFAULT_DECISION_MARGIN,
            "bg_margin_over_spk": DEFAULT_BG_MARGIN_OVER_SPK,
            "rms_speech_gate": DEFAULT_RMS_SPEECH_GATE,
            # Behavior toggles
            "confidence_smoothing": DEFAULT_CONFIDENCE_SMOOTHING,
            "session_logging": DEFAULT_SESSION_LOGGING,
            "embed_avg": DEFAULT_EMBED_AVG,
            "embed_avg_n": DEFAULT_EMBED_AVG_N,
            "vad_trim": DEFAULT_VAD_TRIM,
        }
    if persisted_found is not None:
        out["persisted"] = bool(persisted_found)
    return out

def _persist_current():
    _write_persisted(
        {
            "mode": state.LISTENING_MODE.get("mode", "off"),
            "interval_ms": getattr(state, "DETECTION_INTERVAL_MS", DEFAULT_INTERVAL_MS),
            "unknown_streak_limit": getattr(state, "UNKNOWN_STREAK_LIMIT", DEFAULT_UNKNOWN_STREAK_LIMIT),
            "hold_ttl_s": getattr(state, "HOLD_TTL_S", DEFAULT_HOLD_TTL_S),
            "window_s": getattr(state, "DURATION_S", DEFAULT_WINDOW_S),
            "spk_threshold": getattr(state, "SPK_THRESHOLD", DEFAULT_SPK_THRESHOLD),
            "bg_threshold": getattr(state, "BG_THRESHOLD", DEFAULT_BG_THRESHOLD),
            "decision_margin": getattr(state, "DECISION_MARGIN", DEFAULT_DECISION_MARGIN),
            "bg_margin_over_spk": getattr(state, "BG_MARGIN_OVER_SPK", DEFAULT_BG_MARGIN_OVER_SPK),
            "rms_speech_gate": getattr(state, "RMS_SPEECH_GATE", DEFAULT_RMS_SPEECH_GATE),
            "confidence_smoothing": getattr(state, "CONFIDENCE_SMOOTHING", DEFAULT_CONFIDENCE_SMOOTHING),
            "session_logging": getattr(state, "SESSION_LOGGING", DEFAULT_SESSION_LOGGING),
            "embed_avg": getattr(state, "EMBED_AVG", DEFAULT_EMBED_AVG),
            "embed_avg_n": getattr(state, "EMBED_AVG_N", DEFAULT_EMBED_AVG_N),
            "vad_trim": getattr(state, "VAD_TRIM", DEFAULT_VAD_TRIM),
        }
    )

# One-time rehydrate on import
_persisted = _read_persisted()
if _persisted:
    state.LISTENING_MODE["mode"] = _sanitize_mode(_persisted.get("mode"))
    state.DETECTION_INTERVAL_MS = _sanitize_interval(_persisted.get("interval_ms"))
    # Optional tunables for smoothing and window length
    state.UNKNOWN_STREAK_LIMIT  = _sanitize_int(_persisted.get("unknown_streak_limit"), lo=0, hi=5, default=DEFAULT_UNKNOWN_STREAK_LIMIT)
    state.HOLD_TTL_S            = _sanitize_float(_persisted.get("hold_ttl_s"), lo=0.0, hi=10.0, default=DEFAULT_HOLD_TTL_S)
    state.DURATION_S            = _sanitize_float(_persisted.get("window_s"), lo=0.5, hi=5.0, default=DEFAULT_WINDOW_S)
    # Advanced tunables
    state.SPK_THRESHOLD         = _sanitize_float(_persisted.get("spk_threshold"), lo=0.2, hi=0.95, default=DEFAULT_SPK_THRESHOLD)
    state.BG_THRESHOLD          = _sanitize_float(_persisted.get("bg_threshold"), lo=0.2, hi=0.95, default=DEFAULT_BG_THRESHOLD)
    state.DECISION_MARGIN       = _sanitize_float(_persisted.get("decision_margin"), lo=0.0, hi=0.3, default=DEFAULT_DECISION_MARGIN)
    state.BG_MARGIN_OVER_SPK    = _sanitize_float(_persisted.get("bg_margin_over_spk"), lo=0.0, hi=0.2, default=DEFAULT_BG_MARGIN_OVER_SPK)
    state.RMS_SPEECH_GATE       = _sanitize_float(_persisted.get("rms_speech_gate"), lo=0.0, hi=0.02, default=DEFAULT_RMS_SPEECH_GATE)
    # Behavior toggles
    state.CONFIDENCE_SMOOTHING  = _sanitize_float(_persisted.get("confidence_smoothing"), lo=0.0, hi=1.0, default=DEFAULT_CONFIDENCE_SMOOTHING)
    state.SESSION_LOGGING       = _sanitize_bool(_persisted.get("session_logging"), default=DEFAULT_SESSION_LOGGING)
    state.EMBED_AVG             = _sanitize_bool(_persisted.get("embed_avg"), default=False)
    state.EMBED_AVG_N           = _sanitize_int(_persisted.get("embed_avg_n"), lo=1, hi=8, default=3)
    state.VAD_TRIM              = _sanitize_bool(_persisted.get("vad_trim"), default=False)

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
        prev_unknown   = getattr(state, "UNKNOWN_STREAK_LIMIT", DEFAULT_UNKNOWN_STREAK_LIMIT)
        prev_hold_ttl  = getattr(state, "HOLD_TTL_S", DEFAULT_HOLD_TTL_S)
        prev_window_s  = getattr(state, "DURATION_S", DEFAULT_WINDOW_S)

        new_mode      = _sanitize_mode(data.get("mode", prev_mode))
        new_interval  = _sanitize_interval(data.get("interval_ms", prev_interval))
        new_unknown   = _sanitize_int(data.get("unknown_streak_limit", prev_unknown), lo=0, hi=5, default=prev_unknown)
        new_hold_ttl  = _sanitize_float(data.get("hold_ttl_s", prev_hold_ttl), lo=0.0, hi=10.0, default=prev_hold_ttl)
        new_window_s  = _sanitize_float(data.get("window_s", prev_window_s), lo=0.5, hi=5.0, default=prev_window_s)
        # Advanced
        new_spk_thr   = _sanitize_float(data.get("spk_threshold", getattr(state, "SPK_THRESHOLD", DEFAULT_SPK_THRESHOLD)), lo=0.2, hi=0.95, default=getattr(state, "SPK_THRESHOLD", DEFAULT_SPK_THRESHOLD))
        new_bg_thr    = _sanitize_float(data.get("bg_threshold", getattr(state, "BG_THRESHOLD", DEFAULT_BG_THRESHOLD)), lo=0.2, hi=0.95, default=getattr(state, "BG_THRESHOLD", DEFAULT_BG_THRESHOLD))
        new_margin    = _sanitize_float(data.get("decision_margin", getattr(state, "DECISION_MARGIN", DEFAULT_DECISION_MARGIN)), lo=0.0, hi=0.3, default=getattr(state, "DECISION_MARGIN", DEFAULT_DECISION_MARGIN))
        new_bg_over   = _sanitize_float(data.get("bg_margin_over_spk", getattr(state, "BG_MARGIN_OVER_SPK", DEFAULT_BG_MARGIN_OVER_SPK)), lo=0.0, hi=0.2, default=getattr(state, "BG_MARGIN_OVER_SPK", DEFAULT_BG_MARGIN_OVER_SPK))
        new_rms_gate  = _sanitize_float(data.get("rms_speech_gate", getattr(state, "RMS_SPEECH_GATE", DEFAULT_RMS_SPEECH_GATE)), lo=0.0, hi=0.02, default=getattr(state, "RMS_SPEECH_GATE", DEFAULT_RMS_SPEECH_GATE))
        new_conf_smooth = _sanitize_float(data.get("confidence_smoothing", getattr(state, "CONFIDENCE_SMOOTHING", DEFAULT_CONFIDENCE_SMOOTHING)), lo=0.0, hi=1.0, default=getattr(state, "CONFIDENCE_SMOOTHING", DEFAULT_CONFIDENCE_SMOOTHING))
        new_session_logging = _sanitize_bool(data.get("session_logging", getattr(state, "SESSION_LOGGING", DEFAULT_SESSION_LOGGING)), default=getattr(state, "SESSION_LOGGING", DEFAULT_SESSION_LOGGING))
        new_embed_avg      = _sanitize_bool(data.get("embed_avg", getattr(state, "EMBED_AVG", DEFAULT_EMBED_AVG)), default=getattr(state, "EMBED_AVG", DEFAULT_EMBED_AVG))
        new_embed_avg_n    = _sanitize_int(data.get("embed_avg_n", getattr(state, "EMBED_AVG_N", DEFAULT_EMBED_AVG_N)), lo=1, hi=8, default=getattr(state, "EMBED_AVG_N", DEFAULT_EMBED_AVG_N))
        new_vad_trim       = _sanitize_bool(data.get("vad_trim", getattr(state, "VAD_TRIM", DEFAULT_VAD_TRIM)), default=getattr(state, "VAD_TRIM", DEFAULT_VAD_TRIM))

        # Update in-memory SSOT
        state.LISTENING_MODE["mode"] = new_mode
        state.DETECTION_INTERVAL_MS  = new_interval
        state.UNKNOWN_STREAK_LIMIT   = new_unknown
        state.HOLD_TTL_S             = new_hold_ttl
        state.DURATION_S             = new_window_s
        state.SPK_THRESHOLD          = new_spk_thr
        state.BG_THRESHOLD           = new_bg_thr
        state.DECISION_MARGIN        = new_margin
        state.BG_MARGIN_OVER_SPK     = new_bg_over
        state.RMS_SPEECH_GATE        = new_rms_gate
        state.CONFIDENCE_SMOOTHING   = new_conf_smooth
        state.SESSION_LOGGING        = new_session_logging
        state.EMBED_AVG              = new_embed_avg
        state.EMBED_AVG_N            = new_embed_avg_n
        state.VAD_TRIM               = new_vad_trim

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

# ── Profiles API ─────────────────────────────────────────────

@listening_bp.route('/api/listening-profiles', methods=['GET'])
def list_profiles():
    data = _load_profiles()
    names = sorted(list(data.keys()))
    return jsonify({"profiles": names})

@listening_bp.route('/api/listening-profiles', methods=['POST'])
def save_profile():
    body = request.get_json(silent=True) or {}
    name = (body.get('name') or '').strip()
    settings = body.get('settings') or {}
    if not name:
        return jsonify({"error": "missing name"}), 400
    if not isinstance(settings, dict) or not settings:
        return jsonify({"error": "missing settings"}), 400
    data = _load_profiles()
    data[name] = settings
    _save_profiles(data)
    return jsonify({"ok": True, "name": name})

@listening_bp.route('/api/listening-profiles/<name>', methods=['GET'])
def get_profile(name: str):
    data = _load_profiles()
    if name not in data:
        return jsonify({"error": "not found"}), 404
    return jsonify({"name": name, "settings": data[name]})

@listening_bp.route('/api/listening-profiles/<name>', methods=['DELETE'])
def delete_profile(name: str):
    data = _load_profiles()
    if name in data:
        del data[name]
        _save_profiles(data)
    return jsonify({"deleted": True})

@listening_bp.route('/api/listening-profiles/<name>/rename', methods=['POST'])
def rename_profile(name: str):
    body = request.get_json(silent=True) or {}
    new_name = (body.get('new_name') or '').strip()
    if not new_name:
        return jsonify({"error": "missing new_name"}), 400
    data = _load_profiles()
    if name not in data:
        return jsonify({"error": "not found"}), 404
    if new_name in data:
        return jsonify({"error": "target exists"}), 409
    data[new_name] = data.pop(name)
    _save_profiles(data)
    return jsonify({"renamed": True, "from": name, "to": new_name})
