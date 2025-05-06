import torch
import os

def combine_embeddings_from_folder(folder_path, output_path):
    speaker_data = {}

    for fname in os.listdir(folder_path):
        if fname.endswith(".pt"):
            label = os.path.splitext(fname)[0]
            fpath = os.path.join(folder_path, fname)
            tensor = torch.load(fpath, map_location="cpu")
            if not isinstance(tensor, torch.Tensor):
                print(f"❌ Skipping {fname}: not a valid tensor")
                continue
            speaker_data[label] = tensor

    if not speaker_data:
        print("⚠️ No valid .pt files found.")
        return

    torch.save(speaker_data, output_path)
    print(f"✅ Combined {len(speaker_data)} speakers into {output_path}")
