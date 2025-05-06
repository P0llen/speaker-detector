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
