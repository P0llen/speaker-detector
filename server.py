from http.server import BaseHTTPRequestHandler, HTTPServer
import cgi
import json
import os
import tempfile
import mimetypes
from speaker_detector.core import enroll_speaker, identify_speaker, list_speakers

PORT = 8000

class SpeakerHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/":
            try:
                with open("templates/index.html", "rb") as f:
                    self.send_response(200)
                    self.send_header("Content-type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(f.read())
            except Exception as e:
                self.send_error(500, f"Error loading index.html: {e}")
        elif self.path.startswith("/static/"):
            file_path = "." + self.path
            if os.path.isfile(file_path):
                self.send_response(200)
                mime_type, _ = mimetypes.guess_type(file_path)
                self.send_header("Content-type", mime_type or "application/octet-stream")
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, "Static file not found.")
        elif self.path == "/speakers":
            self._send_json({"speakers": list_speakers()})
        else:
            self.send_error(404, "Route not found.")

    def do_POST(self):
        content_type, pdict = cgi.parse_header(self.headers.get("Content-Type", ""))
        if content_type != "multipart/form-data":
            self._send_json({"error": "Expected multipart form data"}, status=400)
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={"REQUEST_METHOD": "POST"},
        )

        try:
            file_field = form["file"]
            file_obj = getattr(file_field, "file", None)
            if file_obj is None:
                raise ValueError("Missing .file on field")
        except Exception as e:
            self._send_json({"error": f"File field issue: {e}"}, status=400)
            return

        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        with os.fdopen(tmp_fd, "wb") as out_file:
            out_file.write(file_obj.read())

        if self.path.startswith("/enroll/"):
            speaker_id = self.path.split("/")[-1]
            enroll_speaker(tmp_path, speaker_id)
            self._send_json({"status": "enrolled", "speaker": speaker_id})
        elif self.path == "/identify":
            result = identify_speaker(tmp_path)
            self._send_json(result)
        else:
            self.send_error(404, "POST endpoint not found.")

        os.remove(tmp_path)


if __name__ == "__main__":
    print(f"🎙 speaker-detector API running at http://localhost:{PORT}")
    server = HTTPServer(("0.0.0.0", PORT), SpeakerHandler)
    server.serve_forever()
