# speaker_detector/routes/identify_routes.py

import os
import tempfile
from pathlib import Path
from flask import Blueprint, request, jsonify
from pydub import AudioSegment

from speaker_detector.core import identify_speaker
from speaker_detector.speaker_state import DETECTION_THRESHOLD


identify_bp = Blueprint("identify_routes", __name__)

@identify_bp.route("/api/identify", methods=["POST"])
def api_identify():
    if "file" not in request.files:
        return jsonify({"error": "Missing file"}), 400

    audio = request.files["file"]
    suffix = Path(audio.filename).suffix.lower()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name
        audio.save(tmp_path)

    try:
        if suffix in [".webm", ".ogg", ".mp3"]:
            wav_path = tmp_path.replace(suffix, ".wav")
            AudioSegment.from_file(tmp_path).export(wav_path, format="wav")
            os.remove(tmp_path)
        else:
            wav_path = tmp_path

        speaker, score = identify_speaker(wav_path, threshold=DETECTION_THRESHOLD)
        os.remove(wav_path)
        return jsonify({"speaker": speaker, "score": round(score or 0, 3)})

    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({"error": str(e)}), 500
