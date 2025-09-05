08/08: a lot of improvements to the speaker-detector-client which resulted in a few changes to this backend. 

23/07/2025 - Lara Whybrow, Creator - it has a few bugs that need fixing, but I ma determining if it is data related or software related. Feel free to clone from Github and help with bug fixes. 

# speaker-detector 🎙️

A lightweight CLI tool for speaker enrollment and voice identification, powered by [SpeechBrain](https://speechbrain.readthedocs.io/).

## 🔧 Features


- ✅ Enroll speakers from .wav audio
- 🕵️ Identify speakers from audio samples
- 🧠 ECAPA-TDNN embedding-based matching
- 🎛️ Simple, fast command-line interface
- 📁 Clean file storage in `~/.speaker-detector/`
- 🔊 Optional `--verbose` mode for debugging

Web UI note: The web client uses a guided-only enrollment flow (multiple short recordings). Quick enroll with a single clip has been removed to ensure model accuracy.


## 📦 Installation


```bash
pip install speaker-detector


When installing packages with a stale requirement file you might need to use:  pip install --break-system-packages soundfile to install on WSL Ubuntu environment.

Run this version with -m module flag if you are having issues with running server.py:
python3 -m speaker_detector.server

```

## 🚀 Example Usage

## 🎙️ Enroll a speaker:

```bash
speaker-detector record --enroll Lara
```

## 🕵️ Identify a speaker:

```bash
speaker-detector record --test
```
## 📋 List enrolled speakers:

```bash
speaker-detector list
```

## 🗂️ Project Structure

~/.speaker-detector/enrollments/	    Saved .pt voice embeddings
~/.speaker-detector/recordings/	        CLI-recorded .wav audio files

🧹 Clean vs Verbose Mode
By default, warnings from speechbrain, torch, etc. are hidden for a clean CLI experience.
To enable full logs & deprecation warnings:

speaker-detector --verbose identify samples/test_sample.wav

🛠 Requirements
Python 3.8+
torch
speechbrain
numpy
soundfile
onnxruntime

| Step                              | Command                                                                                                             | When / Purpose                | Output                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| **1. Export ECAPA Model to ONNX** | `speaker-detector export-model --pt models/embedding_model.ckpt --out ecapa_model.onnx`                             | Run once unless model changes | `ecapa_model.onnx`                       |
| **2. Enroll Speaker**             | `speaker-detector enroll <speaker_id> <audio_path>`<br>Example:<br>`speaker-detector enroll Lara samples/lara1.wav` | Run per new speaker           | Individual `.pt` files (e.g., `Lara.pt`) |
| **3. Combine Embeddings**         | `speaker-detector combine --folder data/embeddings/ --out data/enrolled_speakers.pt`                                | After enrolling speakers      | `enrolled_speakers.pt`                   |
| **4. Export Speakers to JSON**    | `speaker-detector export-speaker-json --pt data/enrolled_speakers.pt --out public/speakers.json`                    | For frontend use              | `speakers.json`                          |
| **5. Identify Speaker**           | `speaker-detector identify samples/test_sample.wav`                                                                 | Identify speaker from audio   | Console output: name + score             |
| **6. List Enrolled Speakers**     | `speaker-detector list-speakers`                                                                                    | Show all enrolled speakers    | Console output: list of IDs              |
| **Verbose Mode (optional)**       | Add `--verbose` to any command:<br>`speaker-detector --verbose identify samples/test_sample.wav`                    | Show warnings, detailed logs  | Developer debug info                     |




NB: When pushing to Github, do not include any .identifier files.

You can manually clean up stale embeddings that don’t match any existing speaker folder with a quick script:

# Run inside your project root
cd storage/embeddings
for f in *.pt; do
  speaker="${f%.pt}"
  if [ ! -d "../speakers/$speaker" ]; then
    echo "Deleting stale embedding: $f"
    rm "$f"
  fi
done


## HTTP API: Online & Detection State

This backend exposes simple endpoints to let a client know when the server is reachable and when live detection is ready to be polled.

### Online (one-shot SSE)

- Path: `GET /api/online`
- Headers:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`
  - `Access-Control-Allow-Origin: http://localhost:5173` (override with env `CLIENT_ORIGIN`)
- Behavior: immediately emits a single event and closes the stream.

Example event:

```
event: online
data: 1

```

This removes the need for heartbeat polling: as soon as the client connects, it can mark the backend as reachable.

### Detection State (SSE)

- Path: `GET /api/detection-state`
- Emits an immediate state and then re-emits on changes; includes keep-alives.
- Event name: `detection`
- Data: `running` | `stopped`

Example stream excerpts:

```
event: detection
data: stopped

: keep-alive

event: detection
data: running

```

Clients can start polling `/api/active-speaker` only when the state is `running`, and pause when `stopped`.

### Active Speaker (readiness semantics)

- Path: `GET /api/active-speaker`
- Responses:
  - When listening mode is OFF: `200 { "status": "disabled", "speaker": null, "confidence": null, "is_speaking": false }`
  - When mode is ON but engine not yet ready (e.g., mic unavailable or loop not running): `200 { "status": "pending", ... }`
  - When running and healthy: `200` with the usual payload including `speaker`, `confidence`, `is_speaking`, `status: "listening"`, and optional `suggested`.

These semantics avoid red 503s in DevTools while still making state transitions explicit for the client.

### Quick Examples

Curl (SSE streams)

```
# One-shot online event
curl -N -H 'Accept: text/event-stream' http://127.0.0.1:9000/api/online

# Detection state stream (emits running|stopped)
curl -N -H 'Accept: text/event-stream' http://127.0.0.1:9000/api/detection-state
```

Browser client (minimal)

```js
// Reachability: mark backend online as soon as server is up
const online = new EventSource('http://127.0.0.1:9000/api/online');
online.addEventListener('online', () => {
  console.log('Backend online');
  online.close(); // one-shot
});

// Detection state: start/stop polling active speaker
let pollTimer = null;
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch('http://127.0.0.1:9000/api/active-speaker');
      const j = await r.json();
      if (j.status === 'disabled' || j.status === 'pending') return; // wait
      console.log('Active:', j);
    } catch (e) {
      console.warn('poll failed', e);
    }
  }, 500);
}
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

const detect = new EventSource('http://127.0.0.1:9000/api/detection-state');
detect.addEventListener('detection', (ev) => {
  const state = (ev.data || '').trim();
  if (state === 'running') startPolling(); else stopPolling();
});
```
