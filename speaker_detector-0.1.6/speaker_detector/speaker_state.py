# speaker_detector/speaker_state.py

import threading
import tempfile
import time
import sounddevice as sd
import soundfile as sf
from datetime import datetime

from speaker_detector.constants import DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_INTERVAL_MS
from speaker_detector.core import identify_speaker

# ── Shared Speaker Detection State ─────────────────────────────

current_speaker_state = {
    "speaker": None,
    "confidence": None,
    "is_speaking": False,
}

def get_current_speaker():
    return current_speaker_state

LISTENING_MODE = {"mode": "off"}  # Options: "off", "single", "multi"
DETECTION_INTERVAL_MS = DEFAULT_INTERVAL_MS
DETECTION_THRESHOLD = DEFAULT_CONFIDENCE_THRESHOLD

MIC_AVAILABLE = True
stop_event = threading.Event()
detection_thread = None

# ── Background Detection Loop ─────────────────────────────

def detection_loop():
    global MIC_AVAILABLE

    samplerate = 16000
    duration = 2  # seconds

    while not stop_event.is_set():
        try:
            audio = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=1, dtype="int16")
            sd.wait()

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                sf.write(tmp.name, audio, samplerate)
                MIC_AVAILABLE = True

                speaker, conf = identify_speaker(tmp.name, threshold=DETECTION_THRESHOLD)
                current_speaker_state["speaker"] = speaker
                current_speaker_state["confidence"] = conf
                current_speaker_state["is_speaking"] = speaker != "unknown" and conf >= DETECTION_THRESHOLD

                print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")

        except Exception as e:
            print(f"❌ Detection loop error: {e}")
            current_speaker_state["speaker"] = None
            current_speaker_state["confidence"] = None
            current_speaker_state["is_speaking"] = False
            if isinstance(e, sd.PortAudioError):
                MIC_AVAILABLE = False

        time.sleep(DETECTION_INTERVAL_MS / 1000.0)

# ── Lifecycle Control ─────────────────────────────────────

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
        return {
            "speaker": None,
            "confidence": None,
            "is_speaking": False,
            "status": "disabled"
        }
    if not MIC_AVAILABLE:
        return {
            "speaker": None,
            "confidence": None,
            "is_speaking": False,
            "status": "mic unavailable"
        }

    return {
        "speaker": current_speaker_state.get("speaker"),
        "confidence": current_speaker_state.get("confidence"),
        "is_speaking": current_speaker_state.get("is_speaking", False),
        "status": "listening"
    }
