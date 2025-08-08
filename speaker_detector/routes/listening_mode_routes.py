# speaker_detector/routes/listening_mode_routes.py

from flask import Blueprint, request, jsonify
import speaker_detector.speaker_state as state  # <-- use the module directly

listening_bp = Blueprint("listening", __name__)

@listening_bp.route("/api/listening-mode", methods=["GET", "POST"])
def update_listening_mode():
    if request.method == "POST":
        data = request.get_json() or {}

        # 1) Update detection mode (the dict is shared by reference)
        new_mode = data.get("mode", state.LISTENING_MODE["mode"])
        state.LISTENING_MODE["mode"] = new_mode

        # 2) Update the *real* state variables used by the detection loop
        if "interval_ms" in data:
            state.DETECTION_INTERVAL_MS = int(data["interval_ms"])
        if "threshold" in data:
            state.DETECTION_THRESHOLD = float(data["threshold"])
        if "streak_limit" in data:
            state.UNKNOWN_STREAK_LIMIT = int(data["streak_limit"])

        # 3) Start/stop the detection loop against the shared state
        if new_mode == "off":
            state.stop_detection_loop()
        else:
            state.start_detection_loop()

    # Always return the actual current values from speaker_state
    return jsonify({
        "interval_ms": state.DETECTION_INTERVAL_MS,
        "threshold": state.DETECTION_THRESHOLD,
        "streak_limit": state.UNKNOWN_STREAK_LIMIT,
        "mode": state.LISTENING_MODE["mode"],
    })


@listening_bp.route("/api/restart-detection", methods=["POST"])
def restart_detection():
    try:
        state.restart_detection_loop()
        return jsonify({"status": "ok", "message": "Detection loop restarted."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@listening_bp.route("/api/active-speaker-secure", methods=["GET"])
def get_active_speaker_strict():
    """Stricter polling endpoint for secure uses (higher confidence required)."""
    current = state.get_current_speaker()
    conf = current.get("confidence") or 0.0
    if conf < 0.75:
        return jsonify({
            "speaker": "unknown",
            "confidence": conf,
            "is_speaking": False,
            "status": "strict",
        })
    return jsonify({
        "speaker": current.get("speaker"),
        "confidence": conf,
        "is_speaking": current.get("is_speaking", False),
        "status": "strict",
    })
