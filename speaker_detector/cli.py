import argparse
from speaker_detector.core import enroll_speaker, identify_speaker, list_speakers

def main():
    parser = argparse.ArgumentParser(description="Speaker Detector CLI")
    subparsers = parser.add_subparsers(dest="command")

    # Enroll
    enroll_cmd = subparsers.add_parser("enroll")
    enroll_cmd.add_argument("speaker_id", help="Name/ID of the speaker")
    enroll_cmd.add_argument("audio_path", help="Path to .wav file")

    # Identify
    identify_cmd = subparsers.add_parser("identify")
    identify_cmd.add_argument("audio_path", help="Path to .wav file")

    # List speakers
    subparsers.add_parser("list", help="List enrolled speakers")

    args = parser.parse_args()

    if args.command == "enroll":
        enroll_speaker(args.audio_path, args.speaker_id)
        print(f"✅ Enrolled: {args.speaker_id}")
    elif args.command == "identify":
        result = identify_speaker(args.audio_path)
        print(f"🕵️ Speaker: {result['speaker']} (score: {result['score']})")
    elif args.command == "list":
        for s in list_speakers():
            print(f"• {s}")
    else:
        parser.print_help()
