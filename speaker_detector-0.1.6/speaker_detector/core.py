# core.py

from pathlib import Path
import torch
import torchaudio
from speechbrain.inference import SpeakerRecognition

# ── DIRECTORIES ──────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent / "storage"
SPEAKER_AUDIO_DIR = BASE_DIR / "speakers"
EMBEDDINGS_DIR = BASE_DIR / "embeddings"
NOISE_DIR = BASE_DIR / "background_noise"

SPEAKER_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)
NOISE_DIR.mkdir(parents=True, exist_ok=True)

# ── MODEL LOADING ────────────────────────────────────────────────────────────
MODEL = SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir="model"
)

# ── EMBEDDING HELPERS ────────────────────────────────────────────────────────
def get_embedding(audio_path: str) -> torch.Tensor:
    signal, fs = torchaudio.load(audio_path)
    if signal.numel() == 0:
        raise ValueError(f"{audio_path} is empty.")
    return MODEL.encode_batch(signal).squeeze().detach().cpu()

def average_embeddings(paths: list[str]) -> torch.Tensor:
    embeddings = [get_embedding(p) for p in paths]
    return torch.stack(embeddings).mean(dim=0)

# ── ENROLL / IMPROVE ─────────────────────────────────────────────────────────
def enroll_speaker(audio_path: str, speaker_id: str) -> None:
    speaker_dir = SPEAKER_AUDIO_DIR / speaker_id
    speaker_dir.mkdir(parents=True, exist_ok=True)

    existing = list(speaker_dir.glob("*.wav"))
    dest_path = speaker_dir / f"{len(existing)+1}.wav"

    waveform, sr = torchaudio.load(audio_path)
    if waveform.numel() == 0:
        raise ValueError("Cannot enroll empty audio file.")
    torchaudio.save(str(dest_path), waveform, sr)

    emb = get_embedding(audio_path)
    torch.save(emb, EMBEDDINGS_DIR / f"{speaker_id}.pt")

def rebuild_embedding(speaker_id: str) -> None:
    speaker_dir = SPEAKER_AUDIO_DIR / speaker_id
    wavs = list(speaker_dir.glob("*.wav"))
    if not wavs:
        raise RuntimeError(f"No recordings for {speaker_id}.")
    emb = average_embeddings([str(w) for w in wavs])
    torch.save(emb, EMBEDDINGS_DIR / f"{speaker_id}.pt")

# ── BACKGROUND NOISE MODELING ────────────────────────────────────────────────
def compute_background_embedding() -> None:
    paths = [str(p) for p in NOISE_DIR.glob("*.wav")]
    if not paths:
        raise RuntimeError("No background noise samples.")
    emb = average_embeddings(paths)
    torch.save(emb, EMBEDDINGS_DIR / "background_noise.pt")

# ── IDENTIFICATION ───────────────────────────────────────────────────────────
def identify_speaker(audio_path: str, threshold: float = 0.25) -> tuple[str, float]:
    try:
        test_emb = get_embedding(audio_path)
    except Exception:
        return "error", 0.0

    scores = {}
    for emb_path in EMBEDDINGS_DIR.glob("*.pt"):
        name = emb_path.stem
        try:
            emb = torch.load(emb_path)
            score = torch.nn.functional.cosine_similarity(emb, test_emb, dim=0).item()
            scores[name] = score
        except:
            continue

    if not scores:
        return "unknown", 0.0

    sorted_scores = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best, best_score = sorted_scores[0]
    second_score = sorted_scores[1][1] if len(sorted_scores) > 1 else 0.0
    auto_thresh = (best_score - second_score) > 0.1
    match = auto_thresh or best_score >= threshold

    return (best, round(best_score, 3)) if match else ("unknown", round(best_score, 3))

# ── REBUILD CHECKING ─────────────────────────────────────────────────────────
def list_speakers() -> list[str]:
    return [p.name for p in SPEAKER_AUDIO_DIR.iterdir() if p.is_dir()]

def speaker_needs_rebuild(speaker_id: str) -> bool:
    speaker_dir = SPEAKER_AUDIO_DIR / speaker_id
    emb_path = EMBEDDINGS_DIR / f"{speaker_id}.pt"
    if not emb_path.exists():
        return True
    emb_mtime = emb_path.stat().st_mtime
    for wav in speaker_dir.glob("*.wav"):
        if wav.stat().st_mtime > emb_mtime:
            return True
    return False

def get_speakers_needing_rebuild() -> list[str]:
    return [s for s in list_speakers() if speaker_needs_rebuild(s)]



# ── ALIAS FOR COMPATIBILITY ──────────────────────────────────────────────────
rebuild_embeddings_for_speaker = rebuild_embedding


