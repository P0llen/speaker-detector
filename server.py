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
    STORAGE_DIR,
)

# ─── Configuration ──────────────────────────────────────────────────────────────

load_dotenv()
PORT = int(os.getenv("PORT", 9000))

BASE_DIR = Path(__file__).parent.resolve()
MEETING_DIR = BASE_DIR / "storage" / "meetings"
FAILED_DIR = BASE_DIR / "storage" / "failed_chunks"
STORAGE_BASE = BASE_DIR / "storage"
TEMPLATES_DIR = BASE_DIR / "templates"

# Ensure storage dirs exist
for d in (MEETING_DIR, FAILED_DIR, STORAGE_BASE):
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
    for spk in STORAGE_DIR.iterdir():
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
        for seg in resp.segments:
            start, end, text = seg.start, seg.end, seg.text.strip()
            tmp = NamedTemporaryFile(suffix=".wav", delete=False).name
            subprocess.run([
                "ffmpeg", "-y", "-i", str(merged),
                "-ss", str(start), "-to", str(end),
                "-ar", "16000", "-ac", "1", tmp
            ], check=True)

            spk = identify_speaker(tmp)
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

    res = identify_speaker(tmp_wav)
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

    enroll_speaker(tmp_wav, speaker_id)
    os.remove(tmp_wav)
    return jsonify(status="enrolled", speaker=speaker_id)

# —— Delete meeting

@app.route("/api/delete-meeting/<meeting_id>", methods=["DELETE"])
def delete_meeting(meeting_id):
    folder = MEETING_DIR / meeting_id
    if folder.exists():
        shutil.rmtree(folder)
        return jsonify(deleted=True)
    return jsonify(error="Not found"), 404

# ─── Launch ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"🎙 Server listening on http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT)
