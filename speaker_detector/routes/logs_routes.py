from __future__ import annotations

from flask import Blueprint, request, jsonify, send_file
from pathlib import Path
import io
import time
import re

from speaker_detector.utils.paths import STORAGE_DIR
import speaker_detector.speaker_state as state
from speaker_detector.constants import (
    DEFAULT_INTERVAL_MS,
    DEFAULT_WINDOW_S,
    DEFAULT_UNKNOWN_STREAK_LIMIT,
    DEFAULT_HOLD_TTL_S,
    DEFAULT_SPK_THRESHOLD,
    DEFAULT_BG_THRESHOLD,
    DEFAULT_DECISION_MARGIN,
    DEFAULT_BG_MARGIN_OVER_SPK,
    DEFAULT_RMS_SPEECH_GATE,
    DEFAULT_CONFIDENCE_SMOOTHING,
)

logs_bp = Blueprint("logs", __name__)

LOGS_DIR = STORAGE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

_SID_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")

def _safe_name(name: str) -> str | None:
    if not name:
        return None
    name = str(name)
    return name if _SID_RE.match(name) else None

def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())

@logs_bp.route("/api/logs", methods=["GET"])
def list_logs():
    items = []
    for p in LOGS_DIR.glob("*.log"):
        try:
            stat = p.stat()
            items.append({
                "file": p.name,
                "size": stat.st_size,
                "mtime": int(stat.st_mtime),
            })
        except Exception:
            continue
    items.sort(key=lambda x: x["mtime"], reverse=True)
    resp = jsonify(items)
    # Prevent browser/proxy caching
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp

@logs_bp.route("/api/logs/session", methods=["POST"])
def save_ui_session_log():
    data = request.get_json(silent=True) or {}
    sid = _safe_name(data.get("session_id"))
    text = data.get("text") or ""
    lines = data.get("lines")
    if not sid:
        return jsonify({"error": "missing or invalid session_id"}), 400
    if not text and not lines:
        return jsonify({"error": "missing log content"}), 400
    body = text if text else "\n".join(str(x) for x in lines)
    # Use a single combined file per session id
    ui_file = LOGS_DIR / f"{sid}.log"
    # Gather end-of-session settings at save time
    try:
        settings = {
            "mode": state.LISTENING_MODE.get("mode", "off"),
            "interval_ms": getattr(state, "DETECTION_INTERVAL_MS", DEFAULT_INTERVAL_MS),
            "window_s": getattr(state, "DURATION_S", DEFAULT_WINDOW_S),
            "unknown_streak_limit": getattr(state, "UNKNOWN_STREAK_LIMIT", DEFAULT_UNKNOWN_STREAK_LIMIT),
            "hold_ttl_s": getattr(state, "HOLD_TTL_S", DEFAULT_HOLD_TTL_S),
            "spk_threshold": getattr(state, "SPK_THRESHOLD", DEFAULT_SPK_THRESHOLD),
            "bg_threshold": getattr(state, "BG_THRESHOLD", DEFAULT_BG_THRESHOLD),
            "decision_margin": getattr(state, "DECISION_MARGIN", DEFAULT_DECISION_MARGIN),
            "bg_margin_over_spk": getattr(state, "BG_MARGIN_OVER_SPK", DEFAULT_BG_MARGIN_OVER_SPK),
            "rms_speech_gate": getattr(state, "RMS_SPEECH_GATE", DEFAULT_RMS_SPEECH_GATE),
            "confidence_smoothing": getattr(state, "CONFIDENCE_SMOOTHING", DEFAULT_CONFIDENCE_SMOOTHING),
            "embed_avg": bool(getattr(state, "EMBED_AVG", False)),
            "embed_avg_n": int(getattr(state, "EMBED_AVG_N", 3)),
            "vad_trim": bool(getattr(state, "VAD_TRIM", False)),
        }
        header_lines = [
            f"SESSION SETTINGS (end):",
        ]
        header_lines += [f"  {k}={settings[k]}" for k in settings]
        header_lines.append("")
        header = "\n".join(header_lines)
    except Exception:
        header = ""
    try:
        existing = ""
        if ui_file.exists():
            try:
                existing = ui_file.read_text(encoding="utf-8")
            except Exception:
                existing = ""
        with open(ui_file, "w", encoding="utf-8") as f:
            if header:
                f.write(header)
            if existing:
                f.write(existing if existing.endswith("\n") else existing + "\n")
            if body:
                f.write(body.rstrip("\n") + "\n")
        return jsonify({"ok": True, "file": ui_file.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@logs_bp.route("/api/logs/file/<name>")
def read_log(name: str):
    safe = _safe_name(name)
    if not safe:
        return jsonify({"error": "invalid filename"}), 400
    path = LOGS_DIR / safe
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        # serve plain text and prevent caching
        resp = send_file(io.BytesIO(content.encode("utf-8")), mimetype="text/plain", download_name=safe)
        try:
            resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        except Exception:
            pass
        return resp
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@logs_bp.route("/api/logs/file/<name>", methods=["DELETE"])
def delete_log(name: str):
    safe = _safe_name(name)
    if not safe:
        return jsonify({"error": "invalid filename"}), 400
    path = LOGS_DIR / safe
    try:
        if path.exists():
            path.unlink()
        return jsonify({"deleted": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
