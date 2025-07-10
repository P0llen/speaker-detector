# speaker_detector/state.py

import threading
import tempfile
import time
import sounddevice as sd
import soundfile as sf
from datetime import datetime
from pathlib import Path

from speaker_detector.core import identify_speaker  # ✅ safe import — no circular loop

# ── Global State ─────────────────────────────────────────────
current_speaker = {"speaker": None, "confidence": None}
LISTENING_MODE = {"mode": "off"}  # Values: "off", "single", "multi"
DETECTION_INTERVAL_MS = 3000
DETECTION_THRESHOLD = 0.75

MIC_AVAILABLE = True
stop_event = threading.Event()  # ✅ defined here, no self-import
detection_thread = None

# ── Background Detection Loop ────────────────────────────────
def detection_loop():
    global MIC_AVAILABLE

    samplerate = 16000
    duration = 2

    while not stop_event.is_set():
        try:
            audio = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=1, dtype="int16")
            sd.wait()

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                sf.write(tmp.name, audio, samplerate)
                MIC_AVAILABLE = True
                speaker, conf = identify_speaker(tmp.name, threshold=DETECTION_THRESHOLD)
                current_speaker.update(speaker=speaker, confidence=conf)
                print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")
        except Exception as e:
            print(f"❌ Detection loop error: {e}")
            current_speaker.update(speaker=None, confidence=None)
            if isinstance(e, sd.PortAudioError):
                MIC_AVAILABLE = False

        time.sleep(DETECTION_INTERVAL_MS / 1000.0)

# ── Control Functions ────────────────────────────────────────
def start_detection_loop():
    global detection_thread
    if detection_thread and detection_thread.is_alive():
        return
    print("🔁 Starting detection loop...")
    stop_event.clear()
    detection_thread = threading.Thread(target=detection_loop, daemon=True)
    detection_thread.start()

def stop_detection_loop():
    if detection_thread and detection_thread.is_alive():
        print("⏹️ Stopping detection loop...")
        stop_event.set()

def get_active_speaker():
    if LISTENING_MODE["mode"] == "off":
        return {"speaker": None, "confidence": None, "status": "disabled"}
    if not MIC_AVAILABLE:
        return {"speaker": None, "confidence": None, "status": "mic unavailable"}
    return {**current_speaker, "status": "listening"}
