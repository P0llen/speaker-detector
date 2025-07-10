# speaker_detector/routes/recordings_routes.py

import os
import tempfile
import time
from pathlib import Path
from flask import Blueprint, request, jsonify
from pydub import AudioSegment
from speaker_detector.utils.paths import STORAGE_DIR

RECORDINGS_DIR = STORAGE_DIR / "recordings"
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

recordings_bp = Blueprint("recordings_routes", __name__)

@recordings_bp.route("/api/recordings", methods=["GET"])
def list_recordings():
    files = sorted(RECORDINGS_DIR.glob("*.wav"), key=os.path.getmtime, reverse=True)
    return jsonify([f.name for f in files])

@recordings_bp.route("/api/recordings", methods=["POST"])
def save_recording():
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
        dest = RECORDINGS_DIR / f"recording_{timestamp}.wav"
        wav_path.rename(dest)
        return jsonify({"status": "saved", "file": dest.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
