from pathlib import Path
import torchaudio
import torch
from speaker_detector.core import get_embedding, STORAGE_DIR

CHUNK_DURATION = 2.5  # seconds

def match_speaker(embedding, speaker_embeddings):
    scores = {}
    for name, emb in speaker_embeddings.items():
        score = torch.nn.functional.cosine_similarity(emb, embedding, dim=0).item()
        scores[name] = score
    if not scores:
        return "unknown", 0.0
    best = max(scores.items(), key=lambda kv: kv[1])
    return best[0], round(best[1], 3)

def analyze_meeting(wav_path):
    waveform, sample_rate = torchaudio.load(wav_path)
    duration_sec = waveform.shape[1] / sample_rate

    chunk_samples = int(CHUNK_DURATION * sample_rate)
    num_chunks = int(waveform.shape[1] / chunk_samples)

    # Load enrolled speaker embeddings
    speaker_embeddings = {}
    for spk_dir in STORAGE_DIR.iterdir():
        if not spk_dir.is_dir():
            continue
        wavs = list(spk_dir.glob("*.wav"))
        if not wavs:
            continue
        # Average multiple embeddings
        embs = [get_embedding(str(wav)) for wav in wavs]
        speaker_embeddings[spk_dir.name] = torch.stack(embs).mean(dim=0)

    results = []

    for i in range(num_chunks):
        start_sample = i * chunk_samples
        end_sample = start_sample + chunk_samples
        chunk = waveform[:, start_sample:end_sample]

        tmp_path = Path(wav_path).parent / f"tmp_chunk_{i}.wav"
        torchaudio.save(str(tmp_path), chunk, sample_rate)

        embedding = get_embedding(str(tmp_path))
        speaker, score = match_speaker(embedding, speaker_embeddings)

        results.append({
            "start": round(i * CHUNK_DURATION, 2),
            "end": round((i + 1) * CHUNK_DURATION, 2),
            "speaker": speaker,
            "score": score
        })

        tmp_path.unlink()  # clean up

    return results
