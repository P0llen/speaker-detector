# routes/speakers.py

from flask import Blueprint, request, jsonify
from pathlib import Path
import tempfile, time, os
from pydub import AudioSegment

from speaker_detector.utils.paths import SPEAKERS_DIR, STORAGE_DIR
from speaker_detector.core import (
    identify_speaker,
    rebuild_embedding,
    get_speakers_needing_rebuild,
)

speakers_bp = Blueprint("speakers", __name__)

DETECTION_THRESHOLD = 0.75  # local fallback

def get_speaker_folder(name: str) -> Path:
    return SPEAKERS_DIR / name

@speakers_bp.route("/api/speakers")
def list_speakers():
    speakers = []
    for spk_dir in SPEAKERS_DIR.iterdir():
        if spk_dir.is_dir():
            wavs = list(spk_dir.glob("*.wav"))
            speakers.append({
                "name": spk_dir.name,
                "recordings": len(wavs)
            })
    return jsonify(speakers)

@speakers_bp.route("/api/enroll/<name>", methods=["POST"])
def enroll_speaker(name):
    if "file" not in request.files:
        return jsonify({"error": "Missing audio file"}), 400
    audio = request.files["file"]
    folder = get_speaker_folder(name)
    folder.mkdir(exist_ok=True)
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
        dest_path = folder / f"{name}_{int(time.time())}.wav"
        Path(wav_path).rename(dest_path)
        return jsonify({"status": "enrolled", "file": dest_path.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@speakers_bp.route("/api/speakers/<name>", methods=["DELETE"])
def delete_speaker(name):
    folder = get_speaker_folder(name)
    emb_path = STORAGE_DIR / "embeddings" / f"{name}.pt"
    try:
        if folder.exists():
            for file in folder.glob("*"):
                file.unlink()
            folder.rmdir()
        if emb_path.exists():
            emb_path.unlink()
        return jsonify({"deleted": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@speakers_bp.route("/api/speakers/<name>/improve", methods=["POST"])
def improve_speaker(name):
    if "file" not in request.files:
        return jsonify({"error": "Missing audio file"}), 400
    folder = get_speaker_folder(name)
    if not folder.exists():
        return jsonify({"error": f"Speaker '{name}' not found"}), 404
    audio = request.files["file"]
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
        dest_path = folder / f"{name}_imp_{int(time.time())}.wav"
        Path(wav_path).rename(dest_path)
        return jsonify({"status": "improved", "file": dest_path.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@speakers_bp.route("/api/rebuild-all", methods=["POST"])
def rebuild_all():
    rebuilt = []
    errors = {}
    for spk_dir in SPEAKERS_DIR.iterdir():
        if spk_dir.is_dir():
            name = spk_dir.name
            try:
                rebuild_embedding(name)
                rebuilt.append(name)
            except Exception as e:
                errors[name] = str(e)
    if errors:
        return jsonify({"status": "partial", "rebuilt": rebuilt, "errors": errors}), 207
    return jsonify({"status": "rebuilt", "rebuilt": rebuilt})

@speakers_bp.route("/api/rebuild/<name>", methods=["POST"])
def rebuild_one(name):
    try:
        rebuild_embedding(name)
        return jsonify({"status": "rebuilt", "name": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@speakers_bp.route("/api/speakers/needs-rebuild")
def needs_rebuild():
    try:
        to_rebuild = get_speakers_needing_rebuild()
        return jsonify({"toRebuild": to_rebuild})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@speakers_bp.route("/api/speakers/list-names")
def list_speaker_names():
    from speaker_detector.core import list_speakers
    return {"speakers": list_speakers()}

@speakers_bp.route("/api/speakers/<name>/rename", methods=["POST"])
def rename_speaker(name):
    data = request.get_json()
    new_name = data.get("new_name")
    if not new_name:
        return jsonify({"error": "Missing new_name"}), 400

    old_dir = get_speaker_folder(name)
    new_dir = get_speaker_folder(new_name)
    if not old_dir.exists():
        return jsonify({"error": f"Speaker '{name}' not found"}), 404
    if new_dir.exists():
        return jsonify({"error": f"Speaker '{new_name}' already exists"}), 409

    try:
        old_dir.rename(new_dir)

        # Also rename embedding if it exists
        emb_old = STORAGE_DIR / "embeddings" / f"{name}.pt"
        emb_new = STORAGE_DIR / "embeddings" / f"{new_name}.pt"
        if emb_old.exists():
            emb_old.rename(emb_new)

        return jsonify({"renamed": True, "from": name, "to": new_name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
