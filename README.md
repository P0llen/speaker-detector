# speaker-detector 🎙️

A lightweight CLI tool for speaker enrollment and voice identification, powered by [SpeechBrain](https://speechbrain.readthedocs.io/).

## 🔧 Features


- ✅ Enroll speakers from .wav audio
- 🕵️ Identify speakers from audio samples
- 🧠 ECAPA-TDNN embedding-based matching
- 🎛️ Simple, fast command-line interface
- 📁 Clean file storage in `~/.speaker-detector/`
- 🔊 Optional `--verbose` mode for debugging


## 📦 Installation

Install from [TestPyPI](https://test.pypi.org/):

```bash
pip install --index-url https://test.pypi.org/simple/ speaker-detector
```

## 🚀 Usage

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