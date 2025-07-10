import torch
import json

def export_embeddings_to_json(pt_path, json_path):
    """
    Converts a .pt file containing speaker embeddings into a
    JSON file for use in the browser frontend.

    Expected input format:
        {
            "lara": tensor([...]),
            "guest": tensor([...]),
            ...
        }

    Output format:
        [
            { "label": "lara", "vector": [...] },
            { "label": "guest", "vector": [...] },
            ...
        ]
    """
    data = torch.load(pt_path, map_location="cpu")

    if not isinstance(data, dict):
        raise ValueError("Expected a dict of {label: tensor} in the .pt file")

    converted = []
    for label, tensor in data.items():
        if not isinstance(tensor, torch.Tensor):
            print(f"⚠️ Skipping {label}: not a tensor")
            continue
        converted.append({
            "label": label,
            "vector": tensor.tolist()
        })

    with open(json_path, "w") as f:
        json.dump(converted, f, indent=2)

    print(f"✅ Exported {len(converted)} speaker embeddings to {json_path}")

def load_embeddings_from_json(json_path, embeddings_dir):
    """Load speaker embeddings directly from uploaded JSON format."""
    with open(json_path, "r") as f:
        speakers = json.load(f)

    if not isinstance(speakers, list):
        raise ValueError("Expected a list of speaker records in speakers.json")

    for entry in speakers:
        speaker_id = entry.get("label")
        vector = entry.get("vector")

        if speaker_id and isinstance(vector, list):
            emb_path = embeddings_dir / f"{speaker_id}.pt"
            torch.save(torch.tensor(vector), emb_path)
            print(f"✅ Loaded embedding for {speaker_id} → {emb_path}")
        else:
            print(f"⚠️ Skipping invalid speaker record: {entry}")


