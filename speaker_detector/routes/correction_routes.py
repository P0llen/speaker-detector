# speaker_detector/routes/correction_routes.py

from flask import Blueprint, request
from tempfile import NamedTemporaryFile
from speaker_detector.core import list_speakers, enroll_speaker
from speaker_detector.utils.paths import NOISE_DIR
import time

correction_bp = Blueprint("correction", __name__)

@correction_bp.route("/api/speakers")
def api_list_speakers():
    return {"speakers": list_speakers()}

@correction_bp.route("/api/save-background", methods=["POST"])
def save_background_sample():
    file = request.files.get("file")
    if not file:
        return {"error": "No file provided."}, 400

    path = NOISE_DIR / f"bg_{int(time.time())}.wav"
    file.save(path)
    return {"ok": True, "path": str(path)}

@correction_bp.route("/api/enroll", methods=["POST"])
def enroll_corrected_speaker():
    file = request.files.get("file")
    speaker = request.form.get("speaker")
    if not file or not speaker:
        return {"error": "Missing file or speaker name."}, 400

    with NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        file.save(tmp.name)
        try:
            enroll_speaker(tmp.name, speaker)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}, 500

@correction_bp.route("/api/speakers/list-names")
def api_list_speaker_names():
    from speaker_detector.core import list_speakers
    return {"speakers": list_speakers()}
