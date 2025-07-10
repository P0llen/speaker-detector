# speaker_detector/routes/background_routes.py

from flask import Blueprint, request, jsonify
from pydub import AudioSegment
import tempfile, time, os
from pathlib import Path

from speaker_detector.utils.paths import NOISE_DIR
from speaker_detector.core import compute_background_embedding

background_bp = Blueprint("background", __name__)

@background_bp.route("/api/background_noise", methods=["POST"])
def api_background_noise():
    if "audio" not in request.files:
        return jsonify({"error": "Missing audio file"}), 400
    audio = request.files["audio"]
    suffix = Path(audio.filename).suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio.save(tmp.name)
        path = Path(tmp.name)
    try:
        if suffix != ".wav":
            wav_path = path.with_suffix(".wav")
            AudioSegment.from_file(path).export(wav_path, format="wav")
            os.remove(path)
        else:
            wav_path = path
        final_path = NOISE_DIR / f"noise_{int(time.time())}.wav"
        Path(wav_path).rename(final_path)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@background_bp.route("/api/rebuild-background", methods=["POST"])
def api_rebuild_background():
    try:
        compute_background_embedding()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
