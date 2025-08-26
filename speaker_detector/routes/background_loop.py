# speaker_detector/routes/background_loop.py

import os, time, tempfile, wave
from datetime import datetime

import numpy as np
import sounddevice as sd
import soundfile as sf

from speaker_detector.core import identify_speaker

# Shared flag for shutdown control
stop_event = None

def init_loop(shared_stop_event):
    global stop_event
    stop_event = shared_stop_event

# --- helper: quick WAV metadata ---
def _wav_meta(path):
    try:
        with wave.open(path, "rb") as w:
            sr = w.getframerate()
            ch = w.getnchannels()
            dur = w.getnframes() / max(1, sr)
            return {"sr": sr, "ch": ch, "dur": dur}
    except Exception:
        return {"sr": 0, "ch": 0, "dur": 0.0}

def background_speaker_loop():
    print("👂 Background loop running...")

    # Use model-friendly defaults
    samplerate = 16000  # ECAPA/most speaker models expect 16k
    duration_s = 1.25   # ~1–1.5 s tends to work best
    channels = 1

    # If the default input isn’t mono, downmix after capture
    sd.default.samplerate = samplerate

    while not stop_event.is_set():
        try:
            print("🌀 Loop tick")

            # Record float32 in [-1, 1] (safer than int16; avoids rounding/clipping)
            frames = int(duration_s * samplerate)
            audio = sd.rec(frames, samplerate=samplerate, channels=channels, dtype="float32")
            sd.wait()

            # Ensure 1D mono float32 array
            if audio.ndim > 1:
                audio = np.mean(audio, axis=1, dtype=np.float32)
            else:
                audio = audio.reshape(-1).astype(np.float32, copy=False)

            # Diagnostics (pre-write)
            rms = float(np.sqrt(np.mean(np.square(audio))) if audio.size else 0.0)
            peak = float(np.max(np.abs(audio)) if audio.size else 0.0)
            dur_est = audio.size / float(samplerate)

            # Gate obviously-bad clips (too short / nearly silent)
            if dur_est < 0.5 or rms < 1e-3:
                print(
                    f"⚠️  Skipping clip — dur:{dur_est:.2f}s rms:{rms:.4f} "
                    f"peak:{peak:.4f} sr:{samplerate} ch:{channels}"
                )
                time.sleep(0.5)
                continue

            # Write temp WAV (float32; soundfile will set PCM 32-bit float)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_path = tmp.name
            sf.write(tmp_path, audio, samplerate)

            # Diagnostics (post-write)
            meta = _wav_meta(tmp_path)
            size = os.path.getsize(tmp_path)
            print(
                f"📈 live clip — dur:{meta['dur']:.2f}s sr:{meta['sr']} ch:{meta['ch']} "
                f"rms:{rms:.4f} peak:{peak:.4f} bytes:{size}"
            )

            # Classify
            try:
                speaker, conf = identify_speaker(tmp_path)
                print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")
            finally:
                # Always clean up temp file
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

        except Exception as e:
            print(f"❌ Detection loop error: {e}")

        time.sleep(0.5)
