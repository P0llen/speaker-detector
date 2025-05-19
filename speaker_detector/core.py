from speechbrain.pretrained import SpeakerRecognition
from pathlib import Path
import torchaudio
import torch

# Storage directories
BASE_DIR = Path(__file__).resolve().parent.parent / "storage"
SPEAKER_AUDIO_DIR = BASE_DIR / "speakers"
EMBEDDINGS_DIR = BASE_DIR / "embeddings"

# Ensure they exist
SPEAKER_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)

# Load model once
MODEL = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb", savedir="model"
)

def get_embedding(audio_path):
    try:
        signal, fs = torchaudio.load(audio_path)
        if signal.numel() == 0:
            raise ValueError(f"{audio_path} is empty.")
        return MODEL.encode_batch(signal).squeeze().detach().cpu()
    except Exception as e:
        raise RuntimeError(f"Failed to embed {audio_path}: {e}")

def enroll_speaker(audio_path, speaker_id):
    speaker_dir = SPEAKER_AUDIO_DIR / speaker_id
    speaker_dir.mkdir(parents=True, exist_ok=True)

    # Save audio sample
    existing = list(speaker_dir.glob("*.wav"))
    new_index = len(existing) + 1
    dest_path = speaker_dir / f"{new_index}.wav"

    waveform, sample_rate = torchaudio.load(audio_path)
    if waveform.numel() == 0:
        raise ValueError("Cannot enroll empty audio file.")

    torchaudio.save(str(dest_path), waveform, sample_rate)
    print(f"🎙 Saved {speaker_id}'s recording #{new_index} → {dest_path}")

    # Save embedding
    emb = get_embedding(audio_path)
    emb_path = EMBEDDINGS_DIR / f"{speaker_id}.pt"
    torch.save(emb, emb_path)
    print(f"🧠 Saved embedding for {speaker_id} → {emb_path}")

def identify_speaker(audio_path, threshold=0.25):
    try:
        test_emb = get_embedding(audio_path)
    except Exception as e:
        return {"speaker": "error", "score": 0, "error": str(e)}

    scores = {}
    for emb_path in EMBEDDINGS_DIR.glob("*.pt"):
        speaker_name = emb_path.stem
        try:
            enrolled_emb = torch.load(emb_path)
            score = torch.nn.functional.cosine_similarity(enrolled_emb, test_emb, dim=0).item()
            scores[speaker_name] = score
        except Exception as e:
            continue

    if not scores:
        return {"speaker": "unknown", "score": 0}

    sorted_scores = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best, second = sorted_scores[0], sorted_scores[1] if len(sorted_scores) > 1 else (None, None)
    auto_thresh = best[1] - (second[1] if second else 0) > 0.1
    is_match = auto_thresh or best[1] >= threshold

    result = {
        "speaker": best[0] if is_match else "unknown",
        "score": round(best[1], 3),
        "all_scores": {k: round(v, 3) for k, v in sorted_scores}
    }
    return result

def list_speakers():
    speakers = []
    for dir in SPEAKER_AUDIO_DIR.iterdir():
        if dir.is_dir():
            count = len(list(dir.glob("*.wav")))
            speakers.append(f"{dir.name} ({count} recording{'s' if count != 1 else ''})")
    print(f"📋 Found {len(speakers)} enrolled speaker(s): {speakers}")
    return [s.split()[0] for s in speakers]

def rebuild_embedding(speaker_id):
    speaker_dir = SPEAKER_AUDIO_DIR / speaker_id
    wavs = list(speaker_dir.glob("*.wav"))

    if not wavs:
        raise RuntimeError(f"No recordings found for {speaker_id}.")

    embeddings = [get_embedding(w) for w in wavs]
    avg_emb = torch.stack(embeddings).mean(dim=0)

    emb_path = EMBEDDINGS_DIR / f"{speaker_id}.pt"
    torch.save(avg_emb, emb_path)
    print(f"🔁 Rebuilt embedding for {speaker_id}")
