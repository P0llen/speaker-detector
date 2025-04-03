import argparse
import subprocess
import tempfile
from speaker_detector.core import (
    enroll_speaker,
    identify_speaker,
    list_speakers,
)

def main():
    parser = argparse.ArgumentParser(description="Speaker Detector CLI")
    subparsers = parser.add_subparsers(dest="command")

    enroll_cmd = subparsers.add_parser("enroll", help="Enroll a speaker with a given WAV file")
    enroll_cmd.add_argument("speaker_id", help="Name/ID of the speaker")
    enroll_cmd.add_argument("audio_path", help="Path to .wav file")

    identify_cmd = subparsers.add_parser("identify", help="Identify the speaker in a given WAV file")
    identify_cmd.add_argument("audio_path", help="Path to .wav file")

    list_cmd = subparsers.add_parser("list", help="Show all enrolled speaker IDs")

    record_cmd = subparsers.add_parser("record", help="Record audio with optional actions")
    record_cmd.add_argument("--enroll", help="Enroll speaker from recorded audio")
    record_cmd.add_argument("--test", action="store_true", help="Identify speaker from recording")
    record_cmd.add_argument("--duration", type=int, default=4, help="Recording duration in seconds")
    record_cmd.add_argument("--output", help="Path to save the recording (optional)")

    args = parser.parse_args()

    if args.command == "enroll":
        enroll_speaker(args.audio_path, args.speaker_id)
        print(f"✅ Enrolled speaker: {args.speaker_id}")

    elif args.command == "identify":
        result = identify_speaker(args.audio_path)
        print(f"🕵️  Identified: {result['speaker']} (score: {result['score']})")

    elif args.command == "list":
        speakers = list_speakers()
        if speakers:
            print("📋 Enrolled Speakers:")
            for s in speakers:
                print(f"  • {s}")
        else:
            print("⚠️  No speakers enrolled yet.")

        elif args.command == "record":
        from speaker_detector.core import RECORDINGS_DIR
        import uuid

        if args.output:
            path = args.output
        else:
            name = args.enroll or f"clip-{uuid.uuid4().hex[:8]}"
            path = str(RECORDINGS_DIR / f"{name}.wav")

        print(f"🎙️ Recording {args.duration}s to {path}...")
        subprocess.run([
            "arecord", "-d", str(args.duration), "-f", "cd", "-r", "16000", "-c", "1", path
        ])

        if args.enroll:
            enroll_speaker(path, args.enroll)
            print(f"✅ Enrolled speaker: {args.enroll}")
        elif args.test:
            result = identify_speaker(path)
            print(f"🕵️  Detected: {result['speaker']} (score: {result['score']})")
        elif args.output:
            print(f"📁 Saved to {path}")
        else:
            print("⚠️  No action taken. Use --enroll, --test or --output.")

        if args.output:
            path = args.output
        else:
            path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name

        print(f"🎙️ Recording {args.duration}s to {path}...")
        subprocess.run([
            "arecord", "-d", str(args.duration), "-f", "cd", "-r", "16000", "-c", "1", path
        ])

        if args.enroll:
            enroll_speaker(path, args.enroll)
            print(f"✅ Enrolled speaker: {args.enroll}")
        elif args.test:
            result = identify_speaker(path)
            print(f"🕵️  Detected: {result['speaker']} (score: {result['score']})")
        elif args.output:
            print(f"📁 Saved to {path}")
        else:
            print("⚠️  No action taken. Use --enroll, --test or --output.")

    else:
        parser.print_help()
