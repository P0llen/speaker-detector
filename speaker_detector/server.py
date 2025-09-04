# ── Core Imports ─────────────────────────────────────────────
import os, signal, time
from flask import Flask, request, send_from_directory, send_file, jsonify
from flask_cors import CORS

# ── Internal Modules ─────────────────────────────────────────
from speaker_detector.utils.paths import STATIC_DIR, INDEX_HTML, COMPONENTS_DIR
from speaker_detector.speaker_state import LISTENING_MODE, start_detection_loop, stop_detection_loop, stop_event
from speaker_detector.routes.version_routes import version_bp
from speaker_detector.routes.events_routes import events_bp

# ── App Setup ────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(STATIC_DIR))
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# ── Routes ──────────────────────────────────────────────────
@app.route("/api/<path:dummy>", methods=["OPTIONS"])
def cors_preflight(dummy):
    response = jsonify({"ok": True})
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return response

# NOTE: /api/version is provided by version_bp; no inline duplicate here.

@app.route("/")
def serve_index():
    return send_file(INDEX_HTML)

@app.route("/index.html")
def serve_index_html():
    return send_file(INDEX_HTML)

@app.route("/static/<path:filename>")
def serve_static_file(filename):
    return send_from_directory(STATIC_DIR, filename)

@app.route("/static/components/<path:filename>")
def serve_component_file(filename):
    return send_from_directory(COMPONENTS_DIR, filename)

@app.route("/favicon.ico")
def serve_favicon():
    return send_from_directory(STATIC_DIR, "favicon.ico")

@app.errorhandler(404)
def not_found(e):
    return {"error": "Resource not found"}, 404

# ── Route Registrations ─────────────────────────────────────
from speaker_detector.routes.index_routes import index_bp
from speaker_detector.routes.listening_mode_routes import listening_bp
from speaker_detector.routes.speaker_routes import speakers_bp
from speaker_detector.routes.background_routes import background_bp
from speaker_detector.routes.rebuild_routes import rebuild_bp
from speaker_detector.routes.identify_routes import identify_bp
from speaker_detector.routes.recordings_routes import recordings_bp
from speaker_detector.routes.meetings_routes import meetings_bp
from speaker_detector.routes.correction_routes import correction_bp

app.register_blueprint(index_bp)
app.register_blueprint(listening_bp)
app.register_blueprint(speakers_bp)
app.register_blueprint(background_bp)
app.register_blueprint(rebuild_bp)
app.register_blueprint(identify_bp)
app.register_blueprint(recordings_bp)
app.register_blueprint(meetings_bp)
app.register_blueprint(correction_bp)
app.register_blueprint(version_bp)
app.register_blueprint(events_bp)

# ── Interrupt Handler ───────────────────────────────────────
def handle_interrupt(sig, frame):
    print("🛑 Shutting down cleanly...")
    stop_event.set()
    time.sleep(1)
    raise SystemExit(0)

signal.signal(signal.SIGINT, handle_interrupt)

# ── Entrypoint ───────────────────────────────────────────────
if __name__ == "__main__":
    print("🌐 Server running on http://0.0.0.0:9000")
    print(f"🚀 Static folder:     {STATIC_DIR}")
    print(f"📁 Component folder:  {COMPONENTS_DIR}")
    print(f"📄 Index HTML:        {INDEX_HTML}")
    app.run(host="0.0.0.0", port=9000, debug=True)
