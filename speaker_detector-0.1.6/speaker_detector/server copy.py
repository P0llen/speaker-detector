# server.py

import os
import tempfile
import threading
import time
import signal
import json
import sounddevice as sd
import soundfile as sf
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pydub import AudioSegment
import numpy as np

from speaker_detector.utils.generate_index import regenerate_component_index
regenerate_component_index(verbose=False)


from speaker_detector.core import (
    identify_speaker,
    rebuild_embedding,
    compute_background_embedding,
    get_speakers_needing_rebuild,
)
from speaker_detector.utils.paths import (
    STATIC_DIR,
    STORAGE_DIR,
    SPEAKERS_DIR,
    NOISE_DIR,
    EXPORTS_DIR,
    MEETINGS_DIR,
    COMPONENTS_DIR,
    INDEX_JSON,
)

# ── Flask Setup ─────────────────────────────────────────────────────
app = Flask(
    __name__,
    static_folder=str(STATIC_DIR)
)

# ── State ───────────────────────────────────────────────────────────
current_speaker = {"speaker": None, "confidence": None}
MIC_AVAILABLE = True
stop_event = threading.Event()
LISTENING_MODE = {"mode": "single"}  # off, single, multi
DETECTION_INTERVAL_MS = 3000
DETECTION_THRESHOLD = 0.75

# ── Setup ───────────────────────────────────────────────────────────
for d in [SPEAKERS_DIR, NOISE_DIR, EXPORTS_DIR, MEETINGS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

def get_speaker_folder(name: str) -> Path:
    return SPEAKERS_DIR / name



# ── Routes ──────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/settings", methods=["GET", "POST"])
def update_settings():
    global DETECTION_INTERVAL_MS, DETECTION_THRESHOLD, LISTENING_MODE
    if request.method == "POST":
        data = request.get_json() or {}
        DETECTION_INTERVAL_MS = int(data.get("interval_ms", DETECTION_INTERVAL_MS))
        DETECTION_THRESHOLD = float(data.get("threshold", DETECTION_THRESHOLD))
        LISTENING_MODE["mode"] = data.get("mode", LISTENING_MODE["mode"])
    return jsonify({
        "interval_ms": DETECTION_INTERVAL_MS,
        "threshold": DETECTION_THRESHOLD,
        "mode": LISTENING_MODE["mode"]
    })

@app.route("/api/active-speaker")
def get_active_speaker():
    if LISTENING_MODE["mode"] == "off":
        return jsonify({"speaker": None, "confidence": None, "status": "disabled"})
    if not MIC_AVAILABLE:
        return jsonify({"speaker": None, "confidence": None, "status": "mic unavailable"}), 503
    return jsonify({**current_speaker, "status": "listening"})

@app.route("/api/identify", methods=["POST"])
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

@app.route("/api/speakers")
def api_speakers():
    speakers = []
    for spk_dir in SPEAKERS_DIR.iterdir():
        if spk_dir.is_dir():
            wavs = list(spk_dir.glob("*.wav"))
            speakers.append({
                "name": spk_dir.name,
                "recordings": len(wavs)
            })
    return jsonify(speakers)

@app.route("/api/enroll/<name>", methods=["POST"])
def api_enroll(name):
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

@app.route("/api/speakers/<name>", methods=["DELETE"])
def api_delete_speaker(name):
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

@app.route("/api/speakers/<name>/improve", methods=["POST"])
def api_improve(name):
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

@app.route("/api/background_noise", methods=["POST"])
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

@app.route("/api/rebuild-all", methods=["POST"])
def api_rebuild_all():
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

@app.route("/api/rebuild/<name>", methods=["POST"])
def api_rebuild_one(name):
    try:
        rebuild_embedding(name)
        return jsonify({"status": "rebuilt", "name": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/rebuild-background", methods=["POST"])
def api_rebuild_background():
    try:
        compute_background_embedding()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/speakers/needs-rebuild")
def api_needs_rebuild():
    try:
        to_rebuild = get_speakers_needing_rebuild()
        return jsonify({"toRebuild": to_rebuild})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.after_request
def remove_favicon_warnings(response):
    if request.path.endswith("favicon.ico"):
        response.status_code = 204
    return response

# ── Background Detection Loop ──────────────────────────────────────
def background_speaker_loop():
    global current_speaker, MIC_AVAILABLE
    samplerate = 16000
    duration = 2
    while not stop_event.is_set():
        try:
            audio = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=1, dtype="int16")
            sd.wait()
            tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            sf.write(tmp.name, audio, samplerate)
            MIC_AVAILABLE = True
            speaker, conf = identify_speaker(tmp.name, threshold=DETECTION_THRESHOLD)
            os.remove(tmp.name)
            current_speaker.update(speaker=speaker, confidence=conf)
            print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")
        except Exception as e:
            print(f"❌ Loop error: {e}")
            current_speaker.update(speaker=None, confidence=None)
            if isinstance(e, sd.PortAudioError):
                MIC_AVAILABLE = False
        time.sleep(0.5)

def handle_interrupt(sig, frame):
    print("🛑 Shutting down cleanly...")
    stop_event.set()
    time.sleep(1)
    exit(0)

signal.signal(signal.SIGINT, handle_interrupt)

if __name__ == "__main__":
    thread = threading.Thread(target=background_speaker_loop, daemon=True)
    thread.start()
    print("🎤 Speaker detection loop started.")
    time.sleep(2)
    print("🌐 Server running on http://0.0.0.0:9000")
    app.run(host="0.0.0.0", port=9000)
