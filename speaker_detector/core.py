from speechbrain.pretrained import SpeakerRecognition
from pathlib import Path
import torchaudio
import torch

# Store files in ./storage (project-relative)
STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

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
    speaker_dir = STORAGE_DIR / speaker_id
    speaker_dir.mkdir(parents=True, exist_ok=True)

    existing = list(speaker_dir.glob("*.wav"))
    new_index = len(existing) + 1
    dest_path = speaker_dir / f"{new_index}.wav"

    waveform, sample_rate = torchaudio.load(audio_path)
    if waveform.numel() == 0:
        raise ValueError("Cannot enroll empty audio file.")

    torchaudio.save(str(dest_path), waveform, sample_rate)
    print(f"🎙 Saved {speaker_id}'s recording #{new_index} → {dest_path}")

def identify_speaker(audio_path):
    try:
        test_emb = get_embedding(audio_path)
    except Exception as e:
        return {"speaker": "error", "score": 0, "error": str(e)}

    scores = {}
    for speaker_dir in STORAGE_DIR.iterdir():
        if not speaker_dir.is_dir():
            continue

        emb_list = []
        for wav_file in speaker_dir.glob("*.wav"):
            try:
                emb = get_embedding(wav_file)
                emb_list.append(emb)
            except Exception as e:
                print(f"⚠️ Skipped bad file {wav_file.name}: {e}")
                continue

        if not emb_list:
            continue

        avg_emb = torch.stack(emb_list).mean(dim=0)
        score = torch.nn.functional.cosine_similarity(avg_emb, test_emb, dim=0).item()
        scores[speaker_dir.name] = score

    print("🔍 Similarity Scores:")
    for name, score in scores.items():
        print(f"  {name}: {score:.3f}")

    if not scores:
        return {"speaker": "unknown", "score": 0}

    best = max(scores.items(), key=lambda kv: kv[1])
    return {"speaker": best[0], "score": round(best[1], 3)}

def list_speakers():
    speakers = []
    for dir in STORAGE_DIR.iterdir():
        if dir.is_dir():
            count = len(list(dir.glob("*.wav")))
            speakers.append(f"{dir.name} ({count} recording{'s' if count != 1 else ''})")
    print(f"📋 Found {len(speakers)} enrolled speaker(s): {speakers}")
    return [s.split()[0] for s in speakers]
