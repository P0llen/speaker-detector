# speaker_detector/routes/identify_routes.py

import os
import tempfile
from pathlib import Path
from flask import Blueprint, request, jsonify
from pydub import AudioSegment

from speaker_detector.core import (
    identify_speaker_strict,
    identify_speaker_flexible,
    rank_speakers,
)
from speaker_detector.utils.paths import SPEAKERS_DIR
import speaker_detector.speaker_state as state
from speaker_detector.constants import DEFAULT_CONFIDENCE_THRESHOLD

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
        try:
            threshold = float(request.form.get("threshold", getattr(state, "DETECTION_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD)))
        except Exception:
            threshold = getattr(state, "DETECTION_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD)

        if mode == "flexible":
            speaker, score = identify_speaker_flexible(wav_path, threshold)
        else:
            speaker, score = identify_speaker_strict(wav_path, threshold)
        speaker_norm = (speaker or "").lower()
        is_background = speaker_norm in ("background", "background_noise")
        if is_background:
            speaker = "background"

        # Always compute a suggestion for UI tuning
        suggestion = None
        ranked = rank_speakers(wav_path)
        if ranked:
            suggestion = {"speaker": ranked[0][0], "confidence": round(float(ranked[0][1]), 3)}

        # Optional auto-improve if explicitly requested and we have a positive match
        auto_flag = (request.form.get("auto_improve", "").lower() in ("1","true","yes"))
        improved = False
        if auto_flag and speaker not in (None, "unknown", "error"):
            try:
                # Save the wav sample into the speaker's folder
                spk_dir = SPEAKERS_DIR / speaker
                spk_dir.mkdir(parents=True, exist_ok=True)
                from pathlib import Path as _P
                dest = spk_dir / f"{speaker}_imp_{int(__import__('time').time())}.wav"
                _P(wav_path).rename(dest)
                improved = True
                # Prevent removal below since we moved it
                wav_path = None
            except Exception:
                improved = False

        if wav_path and os.path.exists(wav_path):
            os.remove(wav_path)

        return jsonify({
            "speaker": speaker,
            "score": round(score or 0, 3),
            "suggested": suggestion,
            "improved": improved,
            "is_background": is_background,
        })

    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify({"error": str(e)}), 500
