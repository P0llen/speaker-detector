# speaker_detector/routes/background_loop.py

import os, time, tempfile
import sounddevice as sd
import soundfile as sf
from datetime import datetime
from speaker_detector.core import identify_speaker

# Shared flag for shutdown control
stop_event = None

def init_loop(shared_stop_event):
    global stop_event
    stop_event = shared_stop_event

def background_speaker_loop():
    print("👂 Background loop running...")
    samplerate = 16000
    duration = 2

    while not stop_event.is_set():
        try:
            print("🌀 Loop tick")
            audio = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=1, dtype="int16")
            sd.wait()
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                sf.write(tmp.name, audio, samplerate)
                speaker, conf = identify_speaker(tmp.name)
                os.remove(tmp.name)
                print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")
        except Exception as e:
            print(f"❌ Detection loop error: {e}")
        time.sleep(0.5)
