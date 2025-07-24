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
    """Rebuild embeddings for all enrolled speakers."""
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
        return jsonify({
            "status": "partial",
            "rebuilt": rebuilt,
            "errors": errors
        }), 207

    return jsonify({
        "status": "rebuilt",
        "rebuilt": rebuilt
    })


@rebuild_bp.route("/api/rebuild/<name>", methods=["POST"])
def api_rebuild_one(name):
    """Rebuild embedding for a single speaker."""
    try:
        rebuild_embedding(name)
        return jsonify({
            "status": "rebuilt",
            "speaker": name
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "speaker": name,
            "error": str(e)
        }), 400


@rebuild_bp.route("/api/rebuild-background", methods=["POST"])
def api_rebuild_background():
    """Rebuild background noise embedding."""
    try:
        compute_background_embedding()
        return jsonify({
            "status": "success"
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500


@rebuild_bp.route("/api/speakers/needs-rebuild", methods=["GET"])
def api_needs_rebuild():
    """Return list of speakers whose embeddings are outdated or missing."""
    try:
        to_rebuild = get_speakers_needing_rebuild()
        return jsonify({
            "status": "ok",
            "toRebuild": to_rebuild
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500
