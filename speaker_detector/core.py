from speechbrain.pretrained import SpeakerRecognition
from pathlib import Path
import torchaudio
import torch

# Folder structure
BASE_DIR = Path.home() / ".speaker-detector"
ENROLLMENTS_DIR = BASE_DIR / "enrollments"
RECORDINGS_DIR = BASE_DIR / "recordings"

ENROLLMENTS_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

# Load model
MODEL = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb", savedir="model"
)

def get_embedding(audio_path):
    signal, fs = torchaudio.load(audio_path)
    return MODEL.encode_batch(signal).squeeze().detach().cpu()

def enroll_speaker(audio_path, speaker_id):
    emb = get_embedding(audio_path)
    torch.save(emb, ENROLLMENTS_DIR / f"{speaker_id}.pt")

def list_speakers():
    return [f.stem for f in ENROLLMENTS_DIR.glob("*.pt")]

def identify_speaker(audio_path):
    test_emb = get_embedding(audio_path)
    scores = {}

    for speaker_file in ENROLLMENTS_DIR.glob("*.pt"):
        ref_emb = torch.load(speaker_file)
        score = torch.nn.functional.cosine_similarity(ref_emb, test_emb, dim=0).item()
        scores[speaker_file.stem] = score

    print("🔍 Similarity Scores:")
    for name, score in scores.items():
        print(f"  {name}: {score:.3f}")

    if not scores:
        return {"speaker": "unknown", "score": 0}

    best = max(scores.items(), key=lambda kv: kv[1])
    return {"speaker": best[0], "score": round(best[1], 3)}
