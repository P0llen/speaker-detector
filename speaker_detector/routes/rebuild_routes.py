# speaker_detector/routes/rebuild_routes.py

from flask import Blueprint, jsonify
from speaker_detector.core import (
    rebuild_embedding,
    compute_background_embedding,
    get_speakers_needing_rebuild,
)
from speaker_detector.utils.paths import SPEAKERS_DIR

rebuild_bp = Blueprint("rebuild_routes", __name__)


@rebuild_bp.route("/api/rebuild-all", methods=["POST"])
def api_rebuild_all():
    rebuilt = []
    errors = {}
    for spk_dir in SPEAKERS_DIR.iterdir():
        if spk_dir.is_dir():
            name = spk_dir.name
            try:
                rebuild_embedding(name)
                rebuilt.append(name)
            except Exception as e:
                errors[name] = str(e)
    if errors:
        return jsonify({"status": "partial", "rebuilt": rebuilt, "errors": errors}), 207
    return jsonify({"status": "rebuilt", "rebuilt": rebuilt})

@rebuild_bp.route("/api/rebuild/<name>", methods=["POST"])
def api_rebuild_one(name):
    try:
        rebuild_embedding(name)
        return jsonify({"status": "rebuilt", "name": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@rebuild_bp.route("/api/rebuild-background", methods=["POST"])
def api_rebuild_background():
    try:
        compute_background_embedding()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@rebuild_bp.route("/api/speakers/needs-rebuild")
def api_needs_rebuild():
    try:
        to_rebuild = get_speakers_needing_rebuild()
        return jsonify({"toRebuild": to_rebuild})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
