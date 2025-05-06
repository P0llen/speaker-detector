# server.py
from http.server import BaseHTTPRequestHandler, HTTPServer
import cgi, json, os, tempfile, mimetypes, shutil, subprocess, traceback
from pathlib import Path
from tempfile import NamedTemporaryFile
from dotenv import load_dotenv
from openai import OpenAI
from speaker_detector.core import enroll_speaker, identify_speaker, list_speakers, STORAGE_DIR

# Load environment variables
load_dotenv()

# Configuration
PORT = 8000
MEETING_DIR = Path("storage/meetings")
FAILED_DIR = Path("storage/failed_chunks")
TEMPLATES_DIR = Path("templates")

# Ensure directories exist
MEETING_DIR.mkdir(parents=True, exist_ok=True)
FAILED_DIR.mkdir(parents=True, exist_ok=True)

# Initialize OpenAI client
client = OpenAI()

def convert_to_wav(input_path: str, output_path: str, sample_rate: int = 16000):
    """
    Convert an input audio blob (e.g. WebM chunk) into a WAV file.
    Returns (True, "") on success or (False, error_message) on failure.
    """
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,        # auto-detect container
        "-ar", str(sample_rate),
        "-ac", "1",
        output_path
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        err = proc.stderr.decode(errors="ignore")
        print(f"[ffmpeg] ❌ Conversion error:\n{err}")
        return False, err
    if not os.path.exists(output_path):
        err = f"Missing output file: {output_path}"
        print(f"[ffmpeg] ❌ {err}")
        return False, err
    print(f"[ffmpeg] ✅ Converted → {output_path}")
    return True, ""

class SpeakerHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/":
            try:
                content = (TEMPLATES_DIR / "index.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                traceback.print_exc()
                self.send_error(500, str(e))
        elif self.path.startswith("/static/") or self.path.startswith("/storage/"):
            fp = Path('.') / self.path.lstrip('/')
            if fp.is_file():
                self.send_response(200)
                mime, _ = mimetypes.guess_type(str(fp))
                self.send_header("Content-Type", mime or "application/octet-stream")
                self.end_headers()
                self.wfile.write(fp.read_bytes())
            else:
                self.send_error(404, "Not found")
        elif self.path == "/speakers":
            self._send_json(list_speakers())
        elif self.path == "/meetings":
            ids = [d.name for d in MEETING_DIR.iterdir() if d.is_dir()]
            self._send_json(ids)
        elif self.path == "/recordings":
            rec = {}
            if STORAGE_DIR.exists():
                for spk in STORAGE_DIR.iterdir():
                    if spk.is_dir():
                        rec[spk.name] = sorted(f.name for f in spk.glob("*.wav"))
            self._send_json(rec)
        elif self.path.startswith("/generate-summary/"):
            meeting_id = self.path.rsplit('/',1)[-1]
            folder = MEETING_DIR / meeting_id
            if not folder.exists():
                return self._send_json({"error":"Meeting not found"},404)
            try:
                # 1) Concatenate WAV chunks
                wavs = sorted(folder.glob("*.wav"))
                if not wavs:
                    raise RuntimeError("No audio chunks to summarize.")
                listfile = folder / f"{meeting_id}_list.txt"
                listfile.write_text("\n".join(f"file '{str(p.resolve())}'" for p in wavs))
                merged = folder / f"{meeting_id}_merged.wav"
                subprocess.run([
                    "ffmpeg","-y","-f","concat","-safe","0",
                    "-i", str(listfile), "-c","copy", str(merged)
                ], check=True)

                # 2) Whisper transcription
                with open(merged, "rb") as mf:
                    resp = client.audio.transcriptions.create(
                        model="whisper-1", file=mf,
                        response_format="verbose_json", temperature=0
                    )
                full_text = resp.text

                # 3) Label each segment
                segments = []
                for seg in resp.segments:
                    start, end, text = seg.start, seg.end, seg.text
                    tmpwav = NamedTemporaryFile(suffix=".wav", delete=False).name
                    subprocess.run([
                        "ffmpeg","-y","-i", str(merged),
                        "-ss", str(start), "-to", str(end),
                        "-ar","16000","-ac","1", tmpwav
                    ], check=True)
                    spk = identify_speaker(tmpwav)
                    os.remove(tmpwav)
                    segments.append({
                        "start": round(start,2),
                        "end": round(end,2),
                        "speaker": spk.get("speaker","unknown"),
                        "score": spk.get("score",0.0),
                        "text": text.strip()
                    })

                # Cleanup
                os.remove(merged)
                os.remove(listfile)
                return self._send_json({"transcript":full_text,"segments":segments})
            except Exception as e:
                traceback.print_exc()
                return self._send_json({"error":str(e)},500)
        else:
            self.send_error(404)

    def do_POST(self):
        tmp_blob = None
        try:
            ctype, _ = cgi.parse_header(self.headers.get("Content-Type",""))
            if ctype != "multipart/form-data":
                return self._send_json({"error":"Bad content type"},400)
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers,
                                     environ={"REQUEST_METHOD":"POST"})
            file_field = form["file"]
            blob = file_field.file.read()
            fd, tmp_blob = tempfile.mkstemp(suffix=".webm")
            os.close(fd)
            with open(tmp_blob, "wb") as f:
                f.write(blob)

            # /save-chunk → convert and save WAV
            if self.path == "/save-chunk":
                meeting_id = form.getvalue("meeting_id")
                fn = file_field.filename
                out_dir = MEETING_DIR / meeting_id
                out_dir.mkdir(parents=True, exist_ok=True)
                wav_out = out_dir / f"{Path(fn).stem}.wav"
                ok, err = convert_to_wav(tmp_blob, str(wav_out))
                if not ok:
                    raise RuntimeError(err)
                print(f"✅ Saved chunk → {wav_out}")
                return self._send_json({"status":"saved"})

            # /identify → convert blob to WAV and identify
            elif self.path == "/identify":
                wav_tmp = tmp_blob + ".wav"
                ok, err = convert_to_wav(tmp_blob, wav_tmp)
                if not ok:
                    raise RuntimeError(err)
                res = identify_speaker(wav_tmp)
                os.remove(wav_tmp)
                return self._send_json(res)

            # /enroll → convert and enroll
            elif self.path.startswith("/enroll/"):
                sid = self.path.rsplit('/',1)[-1]
                wav_tmp = tmp_blob + ".wav"
                ok, err = convert_to_wav(tmp_blob, wav_tmp)
                if not ok:
                    raise RuntimeError(err)
                enroll_speaker(wav_tmp, sid)
                os.remove(wav_tmp)
                return self._send_json({"status":"enrolled","speaker":sid})

            else:
                return self._send_json({"error":"Route not found"},404)
        except Exception as e:
            traceback.print_exc()
            return self._send_json({"error":str(e)},500)
        finally:
            if tmp_blob and os.path.exists(tmp_blob):
                os.remove(tmp_blob)

    def do_DELETE(self):
        if self.path.startswith("/delete-meeting/"):
            mid = self.path.rsplit('/',1)[-1]
            folder = MEETING_DIR / mid
            if folder.exists(): shutil.rmtree(folder); return self._send_json({"deleted":True})
            return self._send_json({"error":"Not found"},404)
        self.send_error(404)

if __name__ == "__main__":
    print(f"🎙 API running at http://0.0.0.0:{PORT}")
    HTTPServer(("0.0.0.0", PORT), SpeakerHandler).serve_forever()
