# paths.py — Central path configuration

from pathlib import Path

# Root of the entire project
ROOT_DIR = Path(__file__).resolve().parent.parent.parent


# Code package root
PKG_DIR = ROOT_DIR / "speaker_detector"

# Storage (for recordings, embeddings, etc.)
STORAGE_DIR = ROOT_DIR / "storage"
SPEAKERS_DIR = STORAGE_DIR / "speakers"
NOISE_DIR = STORAGE_DIR / "background_noise"
EXPORTS_DIR = STORAGE_DIR / "exports"
MEETINGS_DIR = STORAGE_DIR / "meetings"
EMBEDDINGS_DIR = STORAGE_DIR / "embeddings"

# Web-related paths
WEB_DIR = PKG_DIR / "web"
STATIC_DIR = WEB_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"
FAVICON = STATIC_DIR / "favicon.ico"
SCRIPT_DIR = STATIC_DIR / "scripts"
COMPONENTS_DIR = STATIC_DIR / "components"
INDEX_JSON = COMPONENTS_DIR / "index.json"

# Utility scripts and model directory
UTILS_DIR = PKG_DIR / "utils"
MODEL_DIR = PKG_DIR / "model"
