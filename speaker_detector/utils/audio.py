# speaker_detector/audio.py

import torch
import torchaudio
from pathlib import Path
from speaker_detector.core import MODEL

def get_embedding(audio_path):
    try:
        signal, fs = torchaudio.load(audio_path)
        if signal.numel() == 0:
            raise ValueError(f"{audio_path} is empty.")
        return MODEL.encode_batch(signal).squeeze().detach().cpu()
    except Exception as e:
        raise RuntimeError(f"Failed to embed {audio_path}: {e}")

def cosine_similarity(a, b):
    return torch.nn.functional.cosine_similarity(a, b, dim=0).item()
