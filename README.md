# speaker-detector 🎙️

A lightweight CLI tool for speaker enrollment and voice identification, powered by [SpeechBrain](https://speechbrain.readthedocs.io/).

## 🔧 Features

- ✅ Record audio and enroll speakers
- 🕵️ Identify speakers from audio
- 🧠 Embedding-based voice matching
- 🎛️ Simple, fast command-line interface
- 📁 Clean storage in `~/.speaker-detector/`

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
