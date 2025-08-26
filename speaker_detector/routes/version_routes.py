# speaker_detector/routes/version_routes.py
from flask import Blueprint, jsonify, make_response

# Pull version from backend constants; fall back safely if missing
try:
    from speaker_detector.constants import BACKEND_VERSION
except Exception:
    BACKEND_VERSION = "0.0.0"

version_bp = Blueprint("version", __name__)

@version_bp.route("/api/version", methods=["GET"])
def api_version():
    """
    Returns the backend version as defined in speaker_detector/constants.py.
    Example:
      { "version": "0.1.9" }
    """
    resp = make_response(jsonify({"version": BACKEND_VERSION}))
    # Avoid stale caches in frontends/proxies
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp
