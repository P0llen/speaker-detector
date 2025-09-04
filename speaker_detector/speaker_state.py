import threading
import tempfile
import time
import sounddevice as sd
import soundfile as sf
from datetime import datetime
import numpy as np

from speaker_detector.constants import (
    DEFAULT_CONFIDENCE_THRESHOLD,
    DEFAULT_INTERVAL_MS,
    DEFAULT_WINDOW_S,
    DEFAULT_UNKNOWN_STREAK_LIMIT,
    DEFAULT_HOLD_TTL_S,
)
from speaker_detector.core import identify_speaker, rank_speakers

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
DURATION_S = DEFAULT_WINDOW_S  # window length used by detection_loop

MIC_AVAILABLE = True
stop_event = threading.Event()
detection_thread = None

# ── Smoothing State ────────────────────────────────────────────
last_confident = {"speaker": None, "confidence": 0.0}
last_confident_ts = 0.0  # monotonic timestamp of last confident detection
unknown_streak = 0
# Less aggressive holding: switch sooner on unknown/background
UNKNOWN_STREAK_LIMIT = DEFAULT_UNKNOWN_STREAK_LIMIT
# Stop holding if last confident is too old
HOLD_TTL_S = DEFAULT_HOLD_TTL_S

# ── Background Detection Loop ─────────────────────────────

def detection_loop():
    global MIC_AVAILABLE, unknown_streak, last_confident_ts

    samplerate = 16000  # model-friendly default
    # Use module-level DURATION_S so it can be tuned at runtime
    duration_s = float(globals().get("DURATION_S", 1.25))

    try:
        while not stop_event.is_set():
            tick_started = time.monotonic()
            try:
                # Capture mono float32 in [-1, 1]
                frames = int(duration_s * samplerate)
                audio = sd.rec(frames, samplerate=samplerate, channels=1, dtype="float32")
                sd.wait()

                # Ensure 1D mono array
                if hasattr(audio, "ndim") and audio.ndim > 1:
                    audio = np.mean(audio, axis=1).astype(np.float32, copy=False)
                else:
                    audio = audio.reshape(-1).astype(np.float32, copy=False)

                # Basic gating for silence / bad clips
                rms = float(np.sqrt(np.mean(np.square(audio))) if audio.size else 0.0)
                peak = float(np.max(np.abs(audio)) if audio.size else 0.0)
                dur_est = audio.size / float(samplerate)

                if dur_est < 0.5 or rms < 1e-3:
                    # Likely muted/virtual device or near-silent window
                    MIC_AVAILABLE = True
                    print("⚠️  Mic OK but no signal — holding idle.")
                    current_speaker_state.update({
                        "speaker": "no-signal",
                        "confidence": 0.0,
                        "is_speaking": False,
                    })
                else:
                    MIC_AVAILABLE = True

                    # Write temp WAV and classify
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                        tmp_path = tmp.name
                    sf.write(tmp_path, audio, samplerate)
                    try:
                        speaker, conf = identify_speaker(tmp_path, threshold=DETECTION_THRESHOLD)
                        # Normalize background alias
                        if (speaker or "").lower() in ("background", "background_noise"):
                            speaker = "background"
                        suggestion = None
                        try:
                            if speaker == "unknown":
                                ranked = rank_speakers(tmp_path)
                                if ranked:
                                    suggestion = {"speaker": ranked[0][0], "confidence": round(float(ranked[0][1]), 3)}
                        except Exception:
                            pass

                        # Age of last confident detection
                        last_age = time.monotonic() - last_confident_ts if last_confident_ts else 1e9

                        if speaker == "background":
                            print(f"{datetime.now().strftime('%H:%M:%S')} 🌫️ Detected: background noise ({conf:.2f})")
                            unknown_streak += 1
                            if unknown_streak >= UNKNOWN_STREAK_LIMIT or last_age > HOLD_TTL_S:
                                current_speaker_state.update({
                                    "speaker": "background",
                                    "confidence": conf,
                                    "is_speaking": False,
                                    "suggested": None,
                                })
                            else:
                                # Hold last confident, but do not mark as speaking
                                current_speaker_state.update({
                                    "speaker": last_confident["speaker"],
                                    "confidence": last_confident["confidence"],
                                    "is_speaking": False,
                                    "suggested": None,
                                })

                        elif speaker != "unknown" and conf >= DETECTION_THRESHOLD:
                            print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")
                            current_speaker_state.update({
                                "speaker": speaker,
                                "confidence": conf,
                                "is_speaking": True,
                                "suggested": None,
                            })
                            last_confident.update(speaker=speaker, confidence=conf)
                            last_confident_ts = time.monotonic()
                            unknown_streak = 0

                        else:
                            unknown_streak += 1
                            if unknown_streak >= UNKNOWN_STREAK_LIMIT or last_age > HOLD_TTL_S:
                                print(f"{datetime.now().strftime('%H:%M:%S')} ❓ Detected: unknown ({conf:.2f})")
                                payload = {
                                    "speaker": "unknown",
                                    "confidence": conf,
                                    "is_speaking": False,
                                }
                                if suggestion:
                                    payload["suggested"] = suggestion
                                current_speaker_state.update(payload)
                            else:
                                print(
                                    f"{datetime.now().strftime('%H:%M:%S')} 🧠 Holding (quiet): "
                                    f"{last_confident['speaker']} ({last_confident['confidence']:.2f})"
                                )
                                hold_payload = {
                                    "speaker": last_confident["speaker"],
                                    "confidence": last_confident["confidence"],
                                    "is_speaking": False,
                                }
                                if suggestion:
                                    hold_payload["suggested"] = suggestion
                                current_speaker_state.update(hold_payload)
                    finally:
                        # Always clean temp file
                        try:
                            import os
                            os.remove(tmp_path)
                        except Exception:
                            pass

            except Exception as e:
                print(f"❌ Detection loop error: {e}")
                current_speaker_state.update({
                    "speaker": None,
                    "confidence": None,
                    "is_speaking": False,
                })
                if isinstance(e, sd.PortAudioError):
                    MIC_AVAILABLE = False

            # Bound total tick period to DETECTION_INTERVAL_MS (includes capture time)
            target_period = max(0.05, float(DETECTION_INTERVAL_MS) / 1000.0)
            elapsed = time.monotonic() - tick_started
            sleep_s = max(0.0, target_period - elapsed)
            time.sleep(sleep_s)

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
        "status": "listening",
        "suggested": current_speaker_state.get("suggested"),
    }

def restart_detection_loop():
    stop_detection_loop()
    time.sleep(1)
    start_detection_loop()
