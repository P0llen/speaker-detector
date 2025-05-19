# server.py

import os
import shutil
import subprocess
import traceback
from pathlib import Path
from tempfile import NamedTemporaryFile

from dotenv import load_dotenv
from flask import (
    Flask,
    request,
    jsonify,
    render_template,
    send_from_directory,
    abort,
)
from openai import OpenAI

from speaker_detector.core import (
    enroll_speaker,
    identify_speaker,
    list_speakers,
)
from speaker_detector.combine import combine_embeddings_from_folder
from speaker_detector.export_embeddings import export_embeddings_to_json


# ─── Configuration ──────────────────────────────────────────────────────────────

load_dotenv()
PORT = int(os.getenv("PORT", 9000))

BASE_DIR = Path(__file__).parent.resolve()
MEETING_DIR = BASE_DIR / "storage" / "meetings"
FAILED_DIR = BASE_DIR / "storage" / "failed_chunks"
STORAGE_BASE = BASE_DIR / "storage"
SPEAKER_AUDIO_DIR = STORAGE_BASE / "speakers"
EMBEDDINGS_DIR = STORAGE_BASE / "embeddings"
TEMPLATES_DIR = BASE_DIR / "templates"
EXPORTS_DIR = STORAGE_BASE / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)


# Ensure storage dirs exist
for d in (MEETING_DIR, FAILED_DIR, STORAGE_BASE, SPEAKER_AUDIO_DIR, EMBEDDINGS_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Initialize OpenAI client
client = OpenAI()

# ─── Helper ────────────────────────────────────────────────────────────────────

def convert_to_wav(input_path: str, output_path: str, sample_rate: int = 16000):
    """Convert any audio to mono-16 kHz WAV via ffmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-ar", str(sample_rate),
        "-ac", "1",
        output_path,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0 or not os.path.exists(output_path):
        err = proc.stderr.decode(errors="ignore") or f"Missing output: {output_path}"
        return False, err
    return True, ""

# ─── App Setup ────────────────────────────────────────────────────────────────

app = Flask(
    __name__,
    static_folder=str(BASE_DIR / "static"),
    template_folder=str(TEMPLATES_DIR),
)

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/storage/<path:filename>")
def serve_storage(filename):
    return send_from_directory(str(STORAGE_BASE), filename)

# —— Speaker & Meeting Lists

@app.route("/api/speakers", methods=["GET"])
def api_speakers():
    return jsonify(list_speakers())

@app.route("/api/meetings", methods=["GET"])
def api_meetings():
    ids = [d.name for d in MEETING_DIR.iterdir() if d.is_dir()]
    return jsonify(ids)

@app.route("/api/recordings", methods=["GET"])
def api_recordings():
    rec = {}
    for spk in SPEAKER_AUDIO_DIR.iterdir():
        if spk.is_dir():
            rec[spk.name] = sorted(f.name for f in spk.glob("*.wav"))
    return jsonify(rec)

# —— Generate Summary

@app.route("/api/generate-summary/<meeting_id>", methods=["GET"])
def generate_summary(meeting_id):
    folder = MEETING_DIR / meeting_id
    if not folder.exists():
        return jsonify(error="Meeting not found"), 404

    try:
        # 1) Merge chunks
        wavs = sorted(folder.glob("*.wav"))
        if not wavs:
            raise RuntimeError("No audio chunks to summarize.")
        listfile = folder / f"{meeting_id}_files.txt"
        listfile.write_text("\n".join(f"file '{str(p)}'" for p in wavs))

        merged = folder / f"{meeting_id}_merged.wav"
        subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(listfile), "-c", "copy", str(merged)
        ], check=True)

        # 2) Whisper transcription
        with open(merged, "rb") as mf:
            resp = client.audio.transcriptions.create(
                model="whisper-1",
                file=mf,
                response_format="verbose_json",
                temperature=0
            )

        # 3) Label segments
        segments = []
        # ...inside generate_summary() after you get each segment from Whisper:
        for seg in resp.segments:
            start, end, text = seg.start, seg.end, seg.text.strip()
            tmp = NamedTemporaryFile(suffix=".wav", delete=False).name
            subprocess.run([
                "ffmpeg", "-y", "-i", str(merged),
                "-ss", str(start), "-to", str(end),
                "-ar", "16000", "-ac", "1", tmp
            ], check=True)

            spk = identify_speaker(tmp)  # ✅ improved speaker recognition
            os.remove(tmp)

            segments.append({
                "start": round(start, 2),
                "end":   round(end,   2),
                "speaker": spk.get("speaker", "unknown"),
                "score":   spk.get("score",   0.0),
                "text":    text,
            })

        # Cleanup
        merged.unlink()
        listfile.unlink()

        return jsonify(transcript=resp.text, segments=segments)

    except Exception as e:
        traceback.print_exc()
        return jsonify(error=str(e)), 500


# —— Chunk saving, identify & enroll

@app.route("/api/save-chunk", methods=["POST"])
def save_chunk():
    file = request.files.get("file")
    meeting_id = request.form.get("meeting_id")
    if not file or not meeting_id:
        return jsonify(error="Missing file or meeting_id"), 400

    # write blob to temp .webm
    tmp_webm = NamedTemporaryFile(suffix=".webm", delete=False).name
    file.save(tmp_webm)

    out_dir = MEETING_DIR / meeting_id
    out_dir.mkdir(parents=True, exist_ok=True)
    wav_out = out_dir / f"{Path(file.filename).stem}.wav"

    ok, err = convert_to_wav(tmp_webm, str(wav_out))
    os.remove(tmp_webm)
    if not ok:
        return jsonify(error=err), 500

    return jsonify(status="saved")

@app.route("/api/identify", methods=["POST"])
def api_identify():
    file = request.files.get("file")
    if not file:
        return jsonify(error="Missing file"), 400

    tmp_webm = NamedTemporaryFile(suffix=".webm", delete=False).name
    file.save(tmp_webm)
    tmp_wav = tmp_webm + ".wav"

    ok, err = convert_to_wav(tmp_webm, tmp_wav)
    os.remove(tmp_webm)
    if not ok:
        return jsonify(error=err), 500

    res = identify_speaker(tmp_wav)  # ✅ uses improved with threshold and gap
    os.remove(tmp_wav)
    return jsonify(res)


@app.route("/api/enroll/<speaker_id>", methods=["POST"])
def api_enroll(speaker_id):
    file = request.files.get("file")
    if not file:
        return jsonify(error="Missing file"), 400

    tmp_webm = NamedTemporaryFile(suffix=".webm", delete=False).name
    file.save(tmp_webm)
    tmp_wav = tmp_webm + ".wav"

    ok, err = convert_to_wav(tmp_webm, tmp_wav)
    os.remove(tmp_webm)
    if not ok:
        return jsonify(error=err), 500

    try:
        enroll_speaker(tmp_wav, speaker_id)
        os.remove(tmp_wav)
        return jsonify(status="enrolled", speaker=speaker_id)
    except Exception as e:
        os.remove(tmp_wav)
        return jsonify(error=str(e)), 500

@app.route("/api/speakers/rename", methods=["POST"])
def rename_speaker():
    data = request.get_json()
    old_name = data.get("oldName")
    new_name = data.get("newName")
    if not old_name or not new_name:
        return jsonify(error="Missing oldName or newName"), 400

    old_dir = SPEAKER_AUDIO_DIR / old_name
    new_dir = SPEAKER_AUDIO_DIR / new_name
    if not old_dir.exists():
        return jsonify(error="Old speaker does not exist"), 404
    if new_dir.exists():
        return jsonify(error="New speaker already exists"), 400

    shutil.move(str(old_dir), str(new_dir))

    # Also rename embedding file if exists
    old_emb = EMBEDDINGS_DIR / f"{old_name}.pt"
    new_emb = EMBEDDINGS_DIR / f"{new_name}.pt"
    if old_emb.exists():
        old_emb.rename(new_emb)

    return jsonify(status="renamed", from_=old_name, to=new_name)

@app.route("/api/speakers/<speaker_id>", methods=["DELETE"])
def delete_speaker(speaker_id):
    speaker_dir = SPEAKER_AUDIO_DIR / speaker_id
    emb_file = EMBEDDINGS_DIR / f"{speaker_id}.pt"

    if speaker_dir.exists():
        shutil.rmtree(speaker_dir)
    if emb_file.exists():
        emb_file.unlink()

    return jsonify(deleted=True)

@app.route("/api/speakers/<speaker_id>/improve", methods=["POST"])
def improve_speaker(speaker_id):
    file = request.files.get("file")
    if not file:
        return jsonify(error="Missing file"), 400

    tmp_webm = NamedTemporaryFile(suffix=".webm", delete=False).name
    file.save(tmp_webm)
    tmp_wav = tmp_webm + ".wav"

    ok, err = convert_to_wav(tmp_webm, tmp_wav)
    os.remove(tmp_webm)
    if not ok:
        return jsonify(error=err), 500

    try:
        # Append new sample
        speaker_dir = SPEAKER_AUDIO_DIR / speaker_id
        speaker_dir.mkdir(parents=True, exist_ok=True)
        existing = list(speaker_dir.glob("*.wav"))
        dest_path = speaker_dir / f"{len(existing)+1}.wav"
        shutil.move(tmp_wav, dest_path)
        print(f"🎙 Improved recording saved for {speaker_id} → {dest_path}")

        # Rebuild embedding
        from speaker_detector.core import rebuild_embedding
        rebuild_embedding(speaker_id)

        return jsonify(status="improved", speaker=speaker_id)
    except Exception as e:
        if os.path.exists(tmp_wav):
            os.remove(tmp_wav)
        return jsonify(error=str(e)), 500


# —— Delete meeting

@app.route("/api/delete-meeting/<meeting_id>", methods=["DELETE"])
def delete_meeting(meeting_id):
    folder = MEETING_DIR / meeting_id
    if folder.exists():
        shutil.rmtree(folder)
        return jsonify(deleted=True)
    return jsonify(error="Not found"), 404

@app.route("/api/correct-segment", methods=["POST"])
def correct_segment():
    data = request.get_json()
    if not all(k in data for k in ("old_speaker", "correct_speaker", "filename")):
        return jsonify(error="Missing fields"), 400

    old_speaker = data["old_speaker"]
    new_speaker = data["correct_speaker"]
    filename = data["filename"]

    old_path = SPEAKER_AUDIO_DIR / old_speaker / filename
    new_dir = SPEAKER_AUDIO_DIR / new_speaker
    new_dir.mkdir(parents=True, exist_ok=True)
    new_path = new_dir / filename

    if not old_path.exists():
        return jsonify(error="Old recording not found"), 404

    try:
        # Move file and optionally remove old
        shutil.copyfile(old_path, new_path)
        if data.get("delete_original", True):
            old_path.unlink()

        # Rebuild embedding
        from speaker_detector.core import rebuild_embedding
        rebuild_embedding(new_speaker)

        # Log feedback for audit trail
        with open(STORAGE_BASE / "feedback_log.json", "a") as f:
            f.write(json.dumps(data) + "\n")

        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=f"Correction failed: {str(e)}"), 500


@app.route("/api/exports", methods=["GET"])
def list_exports():
    files = [f.name for f in EXPORTS_DIR.glob("*.json")]
    return jsonify(files)

@app.route("/exports/<filename>")
def serve_export(filename):
    return send_from_directory(str(EXPORTS_DIR), filename)


@app.route("/api/delete-export/<filename>", methods=["DELETE"])
def delete_export(filename):
    file_path = EXPORTS_DIR / filename
    if not file_path.exists():
        return jsonify(error="File not found"), 404

    file_path.unlink()
    return jsonify(deleted=True)


@app.route("/api/export-speakers-json", methods=["POST"])
def api_export_speakers_json():
    try:
        input_folder = str(STORAGE_BASE / "embeddings")
        combined_file = str(STORAGE_BASE / "enrolled_speakers.pt")
        output_file = str(EXPORTS_DIR / "speakers.json")

        combine_embeddings_from_folder(input_folder, combined_file)
        export_embeddings_to_json(combined_file, output_file)

        return jsonify(status="combined and exported", output=str(output_file))
    except Exception as e:
        return jsonify(error=str(e)), 500


# ─── Launch ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"🎙 Server listening on http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT)
