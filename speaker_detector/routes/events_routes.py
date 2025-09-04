from flask import Blueprint, Response
import json
import time
import os
from typing import Optional

try:
    from speaker_detector.constants import BACKEND_VERSION
except Exception:
    BACKEND_VERSION = "0.0.0"


events_bp = Blueprint("events", __name__)


def _sse(event: str | None, data: dict | str | None = None) -> str:
    """Format a Server-Sent Event line block.

    When `event` is None, only the data field is sent. `data` is JSON encoded
    if it's a dict, otherwise treated as a string.
    """
    lines = []
    if event:
        lines.append(f"event: {event}")
    if data is not None:
        if isinstance(data, (dict, list)):
            payload = json.dumps(data, ensure_ascii=False)
        else:
            payload = str(data)
        # Split on newlines to comply with SSE framing
        for ln in payload.splitlines() or [""]:
            lines.append(f"data: {ln}")
    lines.append("")  # end of message
    return "\n".join(lines) + "\n"


## Removed legacy `/api/events` stream in favor of `/api/online` and `/api/detection-state`.


@events_bp.route("/api/online")
def online_once():
    """SSE endpoint that emits a one-time `online` event and closes.

    CORS: Allows a specific client origin (default http://localhost:5173) as
    requested. If you need a different origin, set CLIENT_ORIGIN env var.
    """

    client_origin = os.environ.get("CLIENT_ORIGIN", "http://localhost:5173")

    def generate():
        # Named event variant: matches example
        yield _sse(event="online", data=1)
        # Then end stream

    resp = Response(generate(), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Connection"] = "keep-alive"
    resp.headers["Access-Control-Allow-Origin"] = client_origin
    return resp


def _detection_state() -> str:
    """Return 'running' when listening mode is on and engine is ready, else 'stopped'."""
    try:
        from speaker_detector.speaker_state import LISTENING_MODE, MIC_AVAILABLE, detection_thread
        mode = LISTENING_MODE.get("mode", "off")
        thread_alive = bool(getattr(detection_thread, "is_alive", lambda: False)())
        if mode != "off" and bool(MIC_AVAILABLE) and thread_alive:
            return "running"
    except Exception:
        pass
    return "stopped"


@events_bp.route("/api/detection-state")
def detection_state_stream():
    """SSE stream that informs clients whether detection is running or stopped.

    Emits an immediate 'detection' event with 'running' or 'stopped', then
    periodically re-emits when the state changes, along with keep-alives.
    """
    client_origin = os.environ.get("CLIENT_ORIGIN", "http://localhost:5173")

    def generate():
        last: Optional[str] = None
        # Send initial state immediately
        state = _detection_state()
        last = state
        yield _sse(event="detection", data=state)

        # Then monitor for changes
        while True:
            time.sleep(2)
            cur = _detection_state()
            # keep-alive comment
            yield ": keep-alive\n\n"
            if cur != last:
                yield _sse(event="detection", data=cur)
                last = cur

    resp = Response(generate(), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Connection"] = "keep-alive"
    resp.headers["Access-Control-Allow-Origin"] = client_origin
    resp.headers["X-Accel-Buffering"] = "no"
    return resp
