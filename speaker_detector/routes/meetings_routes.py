# speaker_detector/routes/meetings_routes.py

import os
import tempfile
import time
from pathlib import Path
from flask import Blueprint, request, jsonify
from pydub import AudioSegment
from speaker_detector.utils.paths import STORAGE_DIR

MEETINGS_DIR = STORAGE_DIR / "meetings"
MEETINGS_DIR.mkdir(parents=True, exist_ok=True)

meetings_bp = Blueprint("meetings_routes", __name__)

@meetings_bp.route("/api/meetings", methods=["GET"])
def list_meetings():
    files = sorted(MEETINGS_DIR.glob("*.wav"), key=os.path.getmtime, reverse=True)
    return jsonify([f.name for f in files])

@meetings_bp.route("/api/meetings", methods=["POST"])
def save_meeting():
    if "audio" not in request.files:
        return jsonify({"error": "Missing audio file"}), 400
    audio = request.files["audio"]
    suffix = Path(audio.filename).suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio.save(tmp.name)
        temp_path = Path(tmp.name)

    try:
        if suffix != ".wav":
            wav_path = temp_path.with_suffix(".wav")
            AudioSegment.from_file(temp_path).export(wav_path, format="wav")
            temp_path.unlink()
        else:
            wav_path = temp_path

        timestamp = int(time.time())
        dest = MEETINGS_DIR / f"meeting_{timestamp}.wav"
        wav_path.rename(dest)
        return jsonify({"status": "saved", "file": dest.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
