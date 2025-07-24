# routes/settings_routes.py

from flask import Blueprint, request, jsonify
from speaker_detector.speaker_state import (
    LISTENING_MODE,
    DETECTION_INTERVAL_MS,
    DETECTION_THRESHOLD,
    start_detection_loop,
    stop_detection_loop,
)

listening_bp = Blueprint("listening", __name__)

@listening_bp.route("/api/listening-mode", methods=["GET", "POST"])
def update_listening_mode():
    global DETECTION_INTERVAL_MS, DETECTION_THRESHOLD

    if request.method == "POST":
        data = request.get_json() or {}

        # Update detection mode
        new_mode = data.get("mode", LISTENING_MODE["mode"])
        LISTENING_MODE["mode"] = new_mode

        # Update interval and threshold
        if "interval_ms" in data:
            DETECTION_INTERVAL_MS = int(data["interval_ms"])
        if "threshold" in data:
            DETECTION_THRESHOLD = float(data["threshold"])

        # Start/stop detection loop based on mode
        if new_mode == "off":
            stop_detection_loop()
        else:
            start_detection_loop()

    # Return current settings
    return jsonify({
        "interval_ms": DETECTION_INTERVAL_MS,
        "threshold": DETECTION_THRESHOLD,
        "mode": LISTENING_MODE["mode"]
    })
