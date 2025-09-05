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
    DEFAULT_SPK_THRESHOLD,
    DEFAULT_BG_THRESHOLD,
    DEFAULT_DECISION_MARGIN,
    DEFAULT_BG_MARGIN_OVER_SPK,
    DEFAULT_RMS_SPEECH_GATE,
)
from speaker_detector.core import identify_speaker, rank_speakers
from collections import deque

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

# ── Advanced identification tunables ─────────────────────────
SPK_THRESHOLD = DEFAULT_SPK_THRESHOLD
BG_THRESHOLD = DEFAULT_BG_THRESHOLD
DECISION_MARGIN = DEFAULT_DECISION_MARGIN
BG_MARGIN_OVER_SPK = DEFAULT_BG_MARGIN_OVER_SPK
RMS_SPEECH_GATE = DEFAULT_RMS_SPEECH_GATE

# Rolling embedding average + VAD trimming toggles
EMBED_AVG = False
EMBED_AVG_N = 3
VAD_TRIM = False

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

                # Optional VAD-based trimming inside window
                trimmed_ratio = None
                if bool(globals().get("VAD_TRIM", False)):
                    try:
                        frame = int(0.02 * samplerate) or 320
                        if frame > 0 and audio.size >= frame:
                            import numpy as _np
                            # frame-wise RMS
                            n = int(_np.floor(audio.size / frame))
                            rms_frames = _np.sqrt(_np.mean(_np.square(audio[:n*frame].reshape(n, frame)), axis=1))
                            thr = max(1e-6, float(globals().get("RMS_SPEECH_GATE", 1e-3)) * 0.5)
                            mask = rms_frames >= thr
                            if mask.any():
                                # expand mask by 2 frames padding
                                pad = 2
                                idx = _np.where(mask)[0]
                                keep = _np.zeros_like(mask)
                                for i in idx:
                                    keep[max(0, i-pad):min(n, i+pad+1)] = True
                                sel = _np.repeat(keep, frame)
                                before = audio.size
                                audio = audio[:sel.size][sel]
                                after = audio.size
                                if before > 0:
                                    trimmed_ratio = float(after) / float(before)
                    except Exception:
                        pass

                # Write temp WAV and classify
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp_path = tmp.name
                sf.write(tmp_path, audio, samplerate)
                try:
                        # Optionally use rolling embedding average
                        use_embed_avg = bool(globals().get("EMBED_AVG", False))
                        if use_embed_avg:
                            from speaker_detector.core import get_embedding, identify_embedding
                            from speaker_detector.core import rank_speakers_from_embedding
                            if not hasattr(detection_loop, "_embed_buf"):
                                detection_loop._embed_buf = deque(maxlen=int(globals().get("EMBED_AVG_N", 3) or 3))
                            test_emb = get_embedding(tmp_path)
                            detection_loop._embed_buf.append(test_emb)
                            import torch as _torch
                            avg_emb = _torch.stack(list(detection_loop._embed_buf)).mean(dim=0)
                            speech_present = rms >= float(globals().get("RMS_SPEECH_GATE", 1e-3))
                            speaker, conf = identify_embedding(
                                avg_emb,
                                speech_present=speech_present,
                                spk_threshold=SPK_THRESHOLD,
                                bg_threshold=BG_THRESHOLD,
                                margin=DECISION_MARGIN,
                                bg_margin_over_spk=BG_MARGIN_OVER_SPK,
                            )
                            ranked = rank_speakers_from_embedding(avg_emb)
                        else:
                            from speaker_detector.core import rank_speakers
                            speaker, conf = identify_speaker(
                                tmp_path,
                                spk_threshold=SPK_THRESHOLD,
                                bg_threshold=BG_THRESHOLD,
                                margin=DECISION_MARGIN,
                                bg_margin_over_spk=BG_MARGIN_OVER_SPK,
                                rms_speech_gate=RMS_SPEECH_GATE,
                            )
                            ranked = rank_speakers(tmp_path)
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

                        # Confidence smoothing factor
                        try:
                            alpha = float(globals().get("CONFIDENCE_SMOOTHING", 0.0))
                        except Exception:
                            alpha = 0.0
                        def _smooth(val: float) -> float:
                            try:
                                prev = current_speaker_state.get("confidence")
                                if prev is not None and 0.0 <= alpha <= 1.0:
                                    return (alpha * float(val)) + ((1.0 - alpha) * float(prev))
                            except Exception:
                                pass
                            return float(val)

                        # Extract top-2 and background for diagnostics
                        try:
                            top1_name, top1_score = (ranked[0][0], float(ranked[0][1])) if ranked else (None, 0.0)
                            top2_score = float(ranked[1][1]) if ranked and len(ranked) > 1 else 0.0
                            bg_items = [x for x in ranked if (x[0] or '').lower() in ('background','background_noise')]
                            bg_score = float(bg_items[0][1]) if bg_items else None
                            margin = float(top1_score - top2_score)
                        except Exception:
                            top1_name, top1_score, top2_score, bg_score, margin = None, 0.0, 0.0, None, 0.0

                        # Infer decision reason for quick debugging
                        reason = 'uncertain'
                        try:
                            spk_thr = float(SPK_THRESHOLD)
                            bg_thr = float(BG_THRESHOLD)
                            gap = float(DECISION_MARGIN)
                            bg_over = float(BG_MARGIN_OVER_SPK)
                            if (speaker or '').lower() not in ('unknown','background'):
                                if (top1_score - top2_score) >= gap:
                                    reason = 'spk:margin'
                                elif top1_score >= spk_thr:
                                    reason = 'spk:thr'
                                else:
                                    reason = 'spk:weak'
                            elif (speaker or '').lower() == 'background':
                                if bg_score is not None and (bg_score >= bg_thr) and ((bg_score - top1_score) >= (bg_over + (0.02 if (speech_present if 'speech_present' in locals() else False) else 0.0))):
                                    reason = 'bg:override'
                                else:
                                    reason = 'bg:weak'
                            else:
                                reason = 'unknown'
                        except Exception:
                            pass

                        diag = {
                            "window_s": duration_s,
                            "interval_ms": float(globals().get("DETECTION_INTERVAL_MS", 0)),
                            "conf_smooth": float(globals().get("CONFIDENCE_SMOOTHING", 0.0)),
                            "embed_avg": bool(globals().get("EMBED_AVG", False)),
                            "embed_avg_n": int(globals().get("EMBED_AVG_N", 3)),
                            "embed_buf_len": int(len(getattr(detection_loop, "_embed_buf", []))) if hasattr(detection_loop, "_embed_buf") else 0,
                            "vad_trim": bool(globals().get("VAD_TRIM", False)),
                            "trimmed_ratio": trimmed_ratio,
                            "rms": rms,
                            "speech_present": speech_present if 'speech_present' in locals() else (rms >= float(globals().get("RMS_SPEECH_GATE", 1e-3))),
                            "elapsed_ms": (time.monotonic() - tick_started) * 1000.0,
                            "top1_name": top1_name,
                            "top1_score": round(top1_score, 3),
                            "top2_score": round(top2_score, 3),
                            "bg_score": (round(bg_score, 3) if bg_score is not None else None),
                            "margin": round(margin, 3),
                            "reason": reason,
                        }

                        if speaker == "background":
                            print(f"{datetime.now().strftime('%H:%M:%S')} 🌫️ Detected: background noise ({conf:.2f})")
                            unknown_streak += 1
                            if unknown_streak >= UNKNOWN_STREAK_LIMIT or last_age > HOLD_TTL_S:
                                current_speaker_state.update({
                                    "speaker": "background",
                                    "confidence": _smooth(conf),
                                    "is_speaking": False,
                                    "suggested": None,
                                    "diag": diag,
                                })
                            else:
                                # Hold last confident, but do not mark as speaking
                                current_speaker_state.update({
                                    "speaker": last_confident["speaker"],
                                    "confidence": _smooth(last_confident["confidence"]),
                                    "is_speaking": False,
                                    "suggested": None,
                                    "diag": diag,
                                })

                        elif speaker != "unknown" and speaker != "background":
                            print(f"{datetime.now().strftime('%H:%M:%S')} 🧠 Detected: {speaker} ({conf:.2f})")
                            current_speaker_state.update({
                                "speaker": speaker,
                                "confidence": _smooth(conf),
                                "is_speaking": True,
                                "suggested": None,
                                "diag": diag,
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
                                    "confidence": _smooth(conf),
                                    "is_speaking": False,
                                }
                                if suggestion:
                                    payload["suggested"] = suggestion
                                payload["diag"] = diag
                                current_speaker_state.update(payload)
                            else:
                                print(
                                    f"{datetime.now().strftime('%H:%M:%S')} 🧠 Holding (quiet): "
                                    f"{last_confident['speaker']} ({last_confident['confidence']:.2f})"
                                )
                                hold_payload = {
                                    "speaker": last_confident["speaker"],
                                    "confidence": _smooth(last_confident["confidence"]),
                                    "is_speaking": False,
                                }
                                if suggestion:
                                    hold_payload["suggested"] = suggestion
                                hold_payload["diag"] = diag
                                current_speaker_state.update(hold_payload)
                except Exception:
                    # Bubble up to outer loop handler
                    raise
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
        "diag": current_speaker_state.get("diag"),
    }

def restart_detection_loop():
    stop_detection_loop()
    time.sleep(1)
    start_detection_loop()
