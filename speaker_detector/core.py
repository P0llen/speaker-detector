# core.py

from pathlib import Path
import torch
import torchaudio
from speechbrain.inference import SpeakerRecognition
from pydub import AudioSegment

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
    """Build/refresh background embedding from noise samples.

    Accepts WAVs directly. If none exist, attempts to convert common
    compressed formats (webm/ogg/mp3/m4a) to WAV in-place, then proceeds.
    """
    # 1) Look for WAVs
    wavs = list(NOISE_DIR.glob("*.wav"))

    # 2) If none, try converting other audio files to WAV
    if not wavs:
        candidates = [
            *NOISE_DIR.glob("*.webm"),
            *NOISE_DIR.glob("*.ogg"),
            *NOISE_DIR.glob("*.mp3"),
            *NOISE_DIR.glob("*.m4a"),
        ]
        for src in candidates:
            try:
                dst = src.with_suffix(".wav")
                if not dst.exists():
                    AudioSegment.from_file(src).export(dst, format="wav")
            except Exception:
                # Skip files we cannot decode
                continue
        wavs = list(NOISE_DIR.glob("*.wav"))

    if not wavs:
        raise RuntimeError("No background noise samples (need .wav or convertible formats).")

    paths = [str(p) for p in wavs]
    emb = average_embeddings(paths)
    torch.save(emb, EMBEDDINGS_DIR / "background_noise.pt")

# ── IDENTIFICATION ───────────────────────────────────────────────────────────
def rank_speakers(audio_path: str) -> list[tuple[str, float]]:
    """Return all speaker scores sorted desc as (name, score)."""
    try:
        test_emb = get_embedding(audio_path)
    except Exception:
        return []

    scores = {}
    for emb_path in EMBEDDINGS_DIR.glob("*.pt"):
        name = emb_path.stem
        try:
            emb = torch.load(emb_path)
            score = torch.nn.functional.cosine_similarity(emb, test_emb, dim=0).item()
            scores[name] = score
        except Exception:
            continue
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)

def identify_speaker(audio_path: str, threshold: float = 0.25) -> tuple[str, float]:
    print(f"📣 identify_speaker() called — file: {audio_path}, threshold: {threshold}")
    ranked = rank_speakers(audio_path)
    if not ranked:
        return "unknown", 0.0

    best, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    auto_thresh = (best_score - second_score) > 0.1

    # Special handling for background noise embedding
    name_norm = (best or "").lower()
    is_background_best = name_norm in ("background", "background_noise")
    # Lookup background score regardless of rank
    bg_items = [x for x in ranked if x[0].lower() in ("background", "background_noise")]
    background_score = bg_items[0][1] if bg_items else None

    if is_background_best:
        # Slightly more permissive for background: either clear gap or reasonable score
        background_ok = auto_thresh or (best_score >= max(0.35, threshold * 0.8))
        if background_ok:
            return "background", round(best_score, 3)
        # If background not good enough, fall through to normal decision

    # If top is not background and not a match, but background is close and reasonably high, prefer background
    if not (auto_thresh or best_score >= threshold) and background_score is not None:
        if background_score >= max(0.4, threshold * 0.85) and (best_score - background_score) <= 0.03:
            return "background", round(background_score, 3)

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


# Strict version for secure/manual matches
def identify_speaker_strict(audio_path: str, threshold: float = 0.5) -> tuple[str, float]:
    speaker, score = identify_speaker(audio_path, threshold)
    return (speaker, score) if score >= threshold else ("unknown", score)

# Flexible version, same as current default behavior
def identify_speaker_flexible(audio_path: str, threshold: float = 0.25) -> tuple[str, float]:
    return identify_speaker(audio_path, threshold)
