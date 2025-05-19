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

    # ---- export-model ----
    model_parser = subparsers.add_parser("export-model", help="Export ECAPA model to ONNX")
    model_parser.add_argument("--pt", required=True, help="Path to embedding_model.ckpt")
    model_parser.add_argument("--out", default="speaker_embedding.onnx", help="Output ONNX file")

    # ---- export-speaker-json ----
    emb_parser = subparsers.add_parser("export-speaker-json", help="Convert enrolled .pt file to browser-friendly .json")
    emb_parser.add_argument("--pt", required=True, help="Path to enrolled_speakers.pt")
    emb_parser.add_argument("--out", default="speakers.json", help="Output .json file for browser")

    # ---- combine ----
    comb_parser = subparsers.add_parser("combine", help="Combine individual .pt files into enrolled_speakers.pt")
    comb_parser.add_argument("--folder", required=True, help="Folder with individual .pt files")
    comb_parser.add_argument("--out", required=True, help="Output .pt file path")

    # ---- Parse arguments ----
    args = parser.parse_args()

    # ---- Suppress warnings unless --verbose ----
    if not args.verbose:
        warnings.simplefilter("ignore", category=DeprecationWarning)
        warnings.simplefilter("ignore", category=UserWarning)
        os.environ["PYTHONWARNINGS"] = "ignore"

    # ---- Import modules after filtering warnings ----
    from .core import enroll_speaker, identify_speaker, list_speakers
    from .export_model import export_model_to_onnx
    from .export_embeddings import export_embeddings_to_json
    from .combine import combine_embeddings_from_folder

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

    elif args.command == "export-model":
        export_model_to_onnx(args.pt, args.out)

    elif args.command == "export-speaker-json":
        export_embeddings_to_json(args.pt, args.out)

    elif args.command == "combine":
        combine_embeddings_from_folder(args.folder, args.out)

    else:
        parser.print_help()
