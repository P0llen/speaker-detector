# core.py

from pathlib import Path
import torch
import torchaudio
from speechbrain.inference import SpeakerRecognition
from pydub import AudioSegment
from speaker_detector.constants import (
    DEFAULT_SPK_THRESHOLD,
    DEFAULT_BG_THRESHOLD,
    DEFAULT_DECISION_MARGIN,
    DEFAULT_BG_MARGIN_OVER_SPK,
    DEFAULT_RMS_SPEECH_GATE,
)
import torch.nn.functional as F

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

def rank_speakers_from_embedding(test_emb: torch.Tensor) -> list[tuple[str, float]]:
    scores = {}
    for emb_path in EMBEDDINGS_DIR.glob("*.pt"):
        name = emb_path.stem
        try:
            emb = torch.load(emb_path)
            score = F.cosine_similarity(emb, test_emb, dim=0).item()
            scores[name] = score
        except Exception:
            continue
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)

def identify_speaker(
    audio_path: str,
    threshold: float = 0.25,
    *,
    spk_threshold: float | None = None,
    bg_threshold: float | None = None,
    margin: float | None = None,
    bg_margin_over_spk: float | None = None,
    rms_speech_gate: float | None = None,
) -> tuple[str, float]:
    """Identify speaker with separate operating points for speakers and background.

    Args:
        audio_path: Path to audio file.
        threshold: Backward-compat shim; used as speaker threshold if others unset.
        spk_threshold: Score to accept a named speaker.
        bg_threshold: Score to accept background.
        margin: Required gap between top1 and top2 to auto-accept.
        bg_margin_over_spk: How much background must beat best speaker to win.
        rms_speech_gate: Minimum RMS to consider the window as speech present.

    Returns:
        (label, score)
    """
    print(
        f"📣 identify_speaker() file={audio_path} thr={threshold}"
    )

    # Thresholds and gates
    spk_thr = float(spk_threshold if spk_threshold is not None else threshold if threshold is not None else DEFAULT_SPK_THRESHOLD)
    bg_thr = float(bg_threshold if bg_threshold is not None else DEFAULT_BG_THRESHOLD)
    gap = float(margin if margin is not None else DEFAULT_DECISION_MARGIN)
    bg_over_spk = float(bg_margin_over_spk if bg_margin_over_spk is not None else DEFAULT_BG_MARGIN_OVER_SPK)
    rms_gate = float(rms_speech_gate if rms_speech_gate is not None else DEFAULT_RMS_SPEECH_GATE)

    # Compute ranked scores
    ranked = rank_speakers(audio_path)
    if not ranked:
        return "unknown", 0.0

    best, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0

    # Background score (regardless of rank)
    bg_items = [x for x in ranked if x[0].lower() in ("background", "background_noise")]
    background_score = bg_items[0][1] if bg_items else None

    # Estimate RMS for speech presence gating
    try:
        sig, _ = torchaudio.load(audio_path)
        # mono average if needed
        if sig.dim() == 2 and sig.size(0) > 1:
            sig = sig.mean(dim=0, keepdim=True)
        rms = float(torch.sqrt(torch.clamp((sig ** 2).mean(), min=0.0)).item())
    except Exception:
        rms = 0.0
    speech_present = rms >= rms_gate

    name_norm = (best or "").lower()
    is_background_best = name_norm in ("background", "background_noise")

    # 1) If best is a named speaker, accept if strong enough by margin or threshold
    if not is_background_best:
        if (best_score - second_score) >= gap or best_score >= spk_thr:
            return best, round(best_score, 3)
        # Speaker not strong enough; consider background if it clearly dominates
        if background_score is not None:
            if (background_score >= bg_thr) and ((background_score - best_score) >= bg_over_spk):
                # Allow background override; but if clear speech is present, be stricter
                if speech_present and (background_score - best_score) < (bg_over_spk + 0.02):
                    return "unknown", round(best_score, 3)
                return "background", round(background_score, 3)
        return "unknown", round(best_score, 3)

    # 2) If best is background
    if is_background_best:
        # In quiet segments, allow background if score clears bg_thr or has clear margin
        if not speech_present:
            if (best_score >= bg_thr) or ((best_score - second_score) >= gap):
                return "background", round(best_score, 3)
            return "unknown", round(best_score, 3)

        # If speech appears present, only accept background when it clearly dominates speakers
        # Find top non-background score
        non_bg_scores = [s for (n, s) in ranked if n.lower() not in ("background", "background_noise")]
        top_spk_score = non_bg_scores[0] if non_bg_scores else 0.0
        if (best_score >= bg_thr) and ((best_score - top_spk_score) >= (bg_over_spk + 0.02)):
            return "background", round(best_score, 3)
        # Else, treat as uncertain speech
        return "unknown", round(best_score, 3)

    # Fallback
    return "unknown", round(best_score, 3)

def identify_embedding(
    test_emb: torch.Tensor,
    *,
    spk_threshold: float | None = None,
    bg_threshold: float | None = None,
    margin: float | None = None,
    bg_margin_over_spk: float | None = None,
    speech_present: bool | None = None,
) -> tuple[str, float]:
    ranked = rank_speakers_from_embedding(test_emb)
    if not ranked:
        return "unknown", 0.0
    spk_thr = float(spk_threshold if spk_threshold is not None else DEFAULT_SPK_THRESHOLD)
    bg_thr = float(bg_threshold if bg_threshold is not None else DEFAULT_BG_THRESHOLD)
    gap = float(margin if margin is not None else DEFAULT_DECISION_MARGIN)
    bg_over_spk = float(bg_margin_over_spk if bg_margin_over_spk is not None else DEFAULT_BG_MARGIN_OVER_SPK)
    best, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    bg_items = [x for x in ranked if x[0].lower() in ("background", "background_noise")]
    background_score = bg_items[0][1] if bg_items else None
    spk_name_norm = (best or "").lower()
    is_bg_best = spk_name_norm in ("background", "background_noise")

    if not is_bg_best:
        if (best_score - second_score) >= gap or best_score >= spk_thr:
            return best, round(best_score, 3)
        if background_score is not None:
            if (background_score >= bg_thr) and ((background_score - best_score) >= bg_over_spk):
                if (speech_present is True) and ((background_score - best_score) < (bg_over_spk + 0.02)):
                    return "unknown", round(best_score, 3)
                return "background", round(background_score, 3)
        return "unknown", round(best_score, 3)

    if is_bg_best:
        if not speech_present:
            if (best_score >= bg_thr) or ((best_score - second_score) >= gap):
                return "background", round(best_score, 3)
            return "unknown", round(best_score, 3)
        non_bg_scores = [s for (n, s) in ranked if n.lower() not in ("background", "background_noise")]
        top_spk_score = non_bg_scores[0] if non_bg_scores else 0.0
        if (best_score >= bg_thr) and ((best_score - top_spk_score) >= (bg_over_spk + 0.02)):
            return "background", round(best_score, 3)
        return "unknown", round(best_score, 3)

    return "unknown", round(best_score, 3)

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
