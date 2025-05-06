import torch
from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN
from collections import OrderedDict

def export_model_to_onnx(ckpt_path, out_path):
    model = ECAPA_TDNN(
        input_size=80,
        channels=[1024, 1024, 1024, 1024, 3072],
        kernel_sizes=[5, 3, 3, 3, 1],
        dilations=[1, 2, 3, 4, 1],
        attention_channels=128,
        lin_neurons=192,
    )

    state_dict = torch.load(ckpt_path, map_location="cpu")

    if "model" in state_dict:
        state_dict = state_dict["model"]

    new_state_dict = OrderedDict()
    for k, v in state_dict.items():
        if k.startswith("embedding_model."):
            k = k[len("embedding_model."):]
        new_state_dict[k] = v

    model.load_state_dict(new_state_dict)
    model.eval()

    dummy_input = torch.randn(1, 200, 80)
    torch.onnx.export(
        model,
        dummy_input,
        out_path,
        input_names=["features"],
        output_names=["embedding"],
        dynamic_axes={"features": {0: "batch", 1: "time"}},
        opset_version=12,
    )

    print(f"✅ Exported ECAPA-TDNN to {out_path}")
