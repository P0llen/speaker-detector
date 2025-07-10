# routes/settings_routes.py

from flask import Blueprint, request, jsonify
from speaker_detector.state import (
    LISTENING_MODE,
    DETECTION_INTERVAL_MS,
    DETECTION_THRESHOLD,
    start_detection_loop,
    stop_detection_loop,
)

settings_bp = Blueprint("settings", __name__)

@settings_bp.route("/api/settings", methods=["GET", "POST"])
def update_settings():
    global DETECTION_INTERVAL_MS, DETECTION_THRESHOLD

    if request.method == "POST":
        data = request.get_json() or {}
        new_mode = data.get("mode", LISTENING_MODE["mode"])

        LISTENING_MODE["mode"] = new_mode
        DETECTION_INTERVAL_MS = int(data.get("interval_ms", DETECTION_INTERVAL_MS))
        DETECTION_THRESHOLD = float(data.get("threshold", DETECTION_THRESHOLD))

        if new_mode == "off":
            stop_detection_loop()
        else:
            detection_loop()

    return jsonify({
        "interval_ms": DETECTION_INTERVAL_MS,
        "threshold": DETECTION_THRESHOLD,
        "mode": LISTENING_MODE["mode"]
    })
