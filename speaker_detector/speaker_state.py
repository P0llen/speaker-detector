import threading
import tempfile
import time
import sounddevice as sd
import soundfile as sf
from datetime import datetime
import numpy as np

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

# ── Smoothing State ────────────────────────────────────────────
last_confident = {"speaker": None, "confidence": 0.0}
unknown_streak = 0
UNKNOWN_STREAK_LIMIT = 3

# ── Background Detection Loop ─────────────────────────────

def detection_loop():
    global MIC_AVAILABLE, unknown_streak

    samplerate = 16000
    duration = 2  # seconds

    try:
        while not stop_event.is_set():
            try:
                audio = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=1, dtype="int16")
                sd.wait()

                # Detect if audio is essentially silence
                if np.abs(audio).mean() < 1e-4:
                    print("⚠️ Mic detected, but no signal — likely virtual or muted.")
                    MIC_AVAILABLE = True
                    current_speaker_state.update({
                        "speaker": "no-signal",
                        "confidence": 0.0,
                        "is_speaking": False
                    })
                    continue
                else:
                    MIC_AVAILABLE = True

                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    sf.write(tmp.name, audio, samplerate)

                    speaker, conf = identify_speaker(tmp.name, threshold=DETECTION_THRESHOLD)

                    if speaker == "background":
                        print(f"{datetime.now().strftime('%H:%M:%S')} 🌫️ Detected: background noise ({conf:.2f})")
                        unknown_streak += 1
                        if unknown_streak >= UNKNOWN_STREAK_LIMIT:
                            current_speaker_state.update({
                                "speaker": "background",
                                "confidence": conf,
                                "is_speaking": False
                            })
                        else:
                            current_speaker_state.update({
                                "speaker": last_confident["speaker"],
                                "confidence": last_confident["confidence"],
                                "is_speaking": True
                            })

                    elif speaker != "unknown" and conf >= DETECTION_THRESHOLD:
                        print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")
                        current_speaker_state.update({
                            "speaker": speaker,
                            "confidence": conf,
                            "is_speaking": True
                        })
                        last_confident.update(speaker=speaker, confidence=conf)
                        unknown_streak = 0

                    else:
                        unknown_streak += 1
                        if unknown_streak >= UNKNOWN_STREAK_LIMIT:
                            print(f"{datetime.now().strftime('%H:%M:%S')} ❓ Detected: unknown ({conf:.2f})")
                            current_speaker_state.update({
                                "speaker": "unknown",
                                "confidence": conf,
                                "is_speaking": False
                            })
                        else:
                            print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Holding: {last_confident['speaker']} ({last_confident['confidence']:.2f})")
                            current_speaker_state.update({
                                "speaker": last_confident["speaker"],
                                "confidence": last_confident["confidence"],
                                "is_speaking": True
                            })

            except Exception as e:
                print(f"❌ Detection loop error: {e}")
                current_speaker_state.update({
                    "speaker": None,
                    "confidence": None,
                    "is_speaking": False
                })
                if isinstance(e, sd.PortAudioError):
                    MIC_AVAILABLE = False

            time.sleep(DETECTION_INTERVAL_MS / 1000.0)

    finally:
        print("🧹 Cleaning up detection loop...")
        try:
            sd.stop()
        except Exception as e:
            print(f"⚠️ Failed to stop sounddevice stream: {e}")

# ── Lifecycle Control ─────────────────────────────────────

def start_detection_loop():
    global detection_thread
    if detection_thread and detection_thread.is_alive():
        print("🔁 Detection loop already running.")
        return
    print("🔁 Starting detection loop...")
    stop_event.clear()
    detection_thread = threading.Thread(target=detection_loop, daemon=True)
    detection_thread.start()
    print("✅ Detection thread started.")

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

    if current_speaker_state["speaker"] == "no-signal":
        return {
            "speaker": None,
            "confidence": None,
            "is_speaking": False,
            "status": "mic no signal"
        }

    return {
        "speaker": current_speaker_state.get("speaker"),
        "confidence": current_speaker_state.get("confidence"),
        "is_speaking": current_speaker_state.get("is_speaking", False),
        "status": "listening"
    }

def restart_detection_loop():
    stop_detection_loop()
    time.sleep(1)
    start_detection_loop()
