# index_routes.py — serves the main index.html

from flask import Blueprint, send_from_directory
from speaker_detector.utils.paths import STATIC_DIR

index_bp = Blueprint("index", __name__)

@index_bp.route("/")
def serve_index():
    return send_from_directory(STATIC_DIR, "index.html")
