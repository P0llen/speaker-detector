import warnings
import argparse
import os

def main():
    parser = argparse.ArgumentParser(prog="speaker-detector", description="Speaker Detector CLI")
    subparsers = parser.add_subparsers(dest="command")

    # ---- Global options ----
    parser.add_argument("--verbose", action="store_true", help="Show detailed logs and warnings")

    # ---- enroll ----
    enroll_cmd = subparsers.add_parser("enroll", help="Enroll a speaker from a .wav file")
    enroll_cmd.add_argument("speaker_id", help="Name/ID of the speaker")
    enroll_cmd.add_argument("audio_path", help="Path to .wav file")

    # ---- identify ----
    identify_cmd = subparsers.add_parser("identify", help="Identify speaker from a .wav file")
    identify_cmd.add_argument("audio_path", help="Path to .wav file")

    # ---- list-speakers ----
    subparsers.add_parser("list-speakers", help="List enrolled speakers")

    # ---- rebuild ----
    rebuild_cmd = subparsers.add_parser("rebuild", help="Rebuild embeddings")
    rebuild_cmd.add_argument("--name", help="Name of the speaker to rebuild (leave empty to rebuild all)", default=None)

    # ---- Parse arguments ----
    args = parser.parse_args()

    # ---- Suppress warnings unless --verbose ----
    if not args.verbose:
        warnings.simplefilter("ignore", category=DeprecationWarning)
        warnings.simplefilter("ignore", category=UserWarning)
        os.environ["PYTHONWARNINGS"] = "ignore"

    # ---- Import modules after filtering warnings ----
    from .core import enroll_speaker, identify_speaker, list_speakers, rebuild_embedding
    from .utils.analyze import rebuild_all_embeddings

    # ---- Command Dispatch ----
    if args.command == "enroll":
        enroll_speaker(args.audio_path, args.speaker_id)
        print(f"✅ Enrolled: {args.speaker_id}")

    elif args.command == "identify":
        result = identify_speaker(args.audio_path)
        print(f"🕵️  Identified: {result['speaker']} (score: {result['score']})")

    elif args.command == "list-speakers":
        speakers = list_speakers()
        if speakers:
            print("📋 Enrolled Speakers:")
            for s in speakers:
                print(f"  • {s}")
        else:
            print("⚠️  No speakers enrolled yet.")

    elif args.command == "rebuild":
        if args.name:
            rebuild_embedding(args.name)
            print(f"🔁 Rebuilt: {args.name}")
        else:
            rebuild_all_embeddings()
            print("🔁 Rebuilt all embeddings.")

    else:
        parser.print_help()
