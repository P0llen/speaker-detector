import os
import torch
import torchaudio
import requests
from pathlib import Path
from pydub import AudioSegment
from dotenv import load_dotenv
from speaker_detector.core import get_embedding, STORAGE_DIR

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

CHUNK_DURATION = 8  # seconds
SCORE_THRESHOLD = 0.6
MIN_VALID_DURATION = 1.0  # seconds
WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions"

def match_speaker(embedding, speaker_embeddings):
    scores = {
        name: torch.nn.functional.cosine_similarity(emb, embedding, dim=0).item()
        for name, emb in speaker_embeddings.items()
    }
    if not scores:
        return "unknown", 0.0
    best = max(scores.items(), key=lambda kv: kv[1])
    return best[0], round(best[1], 3)

def transcribe_full_audio(wav_path: Path) -> str:
    try:
        with open(wav_path, "rb") as f:
            response = requests.post(
                WHISPER_API_URL,
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                files={"file": (wav_path.name, f, "audio/wav")},
                data={
                    "model": "whisper-1",
                    "response_format": "json",
                    "temperature": 0.2,
                    "language": "en",
                    "prompt": "This is a meeting transcription.",
                },
                timeout=120
            )
        response.raise_for_status()
        return response.json()["text"].strip()
    except Exception as e:
        print(f"❌ Whisper failed: {e}")
        return ""

def is_valid_audio(path):
    try:
        waveform, sample_rate = torchaudio.load(str(path))
        duration_sec = waveform.shape[1] / sample_rate
        return duration_sec >= MIN_VALID_DURATION
    except Exception:
        return False

def generate_summary(meeting_dir: Path):
    meeting_dir = meeting_dir.resolve()
    chunk_files = sorted([
        f for f in meeting_dir.iterdir()
        if f.name.startswith("chunk_") and f.suffix == ".wav" and is_valid_audio(f)
    ])

    if not chunk_files:
        return {"warning": "No valid .wav chunks found in meeting folder.", "segments": []}

    # Merge all chunks into one file
    combined = AudioSegment.empty()
    for f in chunk_files:
        combined += AudioSegment.from_wav(f)
    merged_path = meeting_dir / "combined.wav"
    combined.export(merged_path, format="wav")

    # Get full transcript
    full_text = transcribe_full_audio(merged_path)
    print("🧠 Full transcript:", full_text)

    # Load speaker embeddings
    speaker_embeddings = {}
    for spk_dir in STORAGE_DIR.iterdir():
        if spk_dir.is_dir():
            wavs = [w for w in spk_dir.glob("*.wav") if is_valid_audio(w)]
            if wavs:
                embs = [get_embedding(str(w)) for w in wavs]
                speaker_embeddings[spk_dir.name] = torch.stack(embs).mean(dim=0)

    segments = []
    total = len(chunk_files)

    for idx, chunk in enumerate(chunk_files):
        try:
            emb = get_embedding(chunk)
            speaker, score = match_speaker(emb, speaker_embeddings)
            segment_text = f"[chunk {idx+1}]"
            segments.append({
                "timestamp": idx * CHUNK_DURATION,
                "speaker": speaker if score >= SCORE_THRESHOLD else "unknown",
                "score": round(score, 3),
                "text": segment_text,
                "progress": round((idx + 1) / total * 100)
            })
        except Exception as e:
            print(f"❌ Failed on {chunk.name}: {e}")

    return {
        "transcript": full_text,
        "segments": segments if segments else [],
        "warning": None if segments else "No speaker segments found."
    }
