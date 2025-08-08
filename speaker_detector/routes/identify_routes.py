# speaker_detector/routes/identify_routes.py

import os
import tempfile
from pathlib import Path
from flask import Blueprint, request, jsonify
from pydub import AudioSegment

from speaker_detector.core import (
    identify_speaker_strict,
    identify_speaker_flexible,
)
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
        # Convert to WAV if needed
        if suffix in [".webm", ".ogg", ".mp3"]:
            wav_path = tmp_path.replace(suffix, ".wav")
            AudioSegment.from_file(tmp_path).export(wav_path, format="wav")
            os.remove(tmp_path)
        else:
            wav_path = tmp_path

        # Determine threshold and mode from form
        mode = request.form.get("mode", "strict")
        threshold = float(request.form.get("threshold", DETECTION_THRESHOLD))

        if mode == "flexible":
            speaker, score = identify_speaker_flexible(wav_path, threshold)
        else:
            speaker, score = identify_speaker_strict(wav_path, threshold)

        os.remove(wav_path)
        return jsonify({"speaker": speaker, "score": round(score or 0, 3)})

    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({"error": str(e)}), 500
