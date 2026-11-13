# How engine/ui_elements.onnx is made (it is our own export: no ONNX of this model is published).
# Source: huggingface.co/merve/rf-detr-mobile-ui (Apache-2.0; RF-DETR medium fine-tuned on merve/mobile-ui-design, Apache-2.0), model.safetensors
#   sha256 66ede812de6359fc35412516aca96d00a570f215b6ebc225326e8c4868b46017 (safetensors: loading it runs no code), with its config.json and preprocessor_config.json.
# Environment used 2026-11-13: Python 3.12, torch 2.15.0, transformers 5.22.2, onnx 1.23.2, onnxruntime 1.32.0, onnxscript (the dynamo exporter; the older one
#   cannot export the backbone's antialiased bicubic resize).
#   python -I export_ui_elements.py <folder with the three files> <out.onnx> <a picture>
# It prints how the export compares with torch on the picture. The detections (not the raw query order, which a tiny numeric change reshuffles) must match; on
# 2026-11-13 they matched 812 of 812 over 9 pictures. Put the result in lens-libraries/dist/models/ui_elements.onnx and its sha256 in library.json.
# usage: env/bin/python -I export_onnx.py <model dir> <out.onnx> <picture>
import sys
import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForObjectDetection

mdir, out, pic = sys.argv[1:4]
model = AutoModelForObjectDetection.from_pretrained(mdir, local_files_only=True, use_safetensors=True).eval()
proc = AutoImageProcessor.from_pretrained(mdir, local_files_only=True)


class Wrap(torch.nn.Module):
    def __init__(self, m):
        super().__init__(); self.m = m

    def forward(self, pixel_values):
        o = self.m(pixel_values=pixel_values)
        return o.logits, o.pred_boxes


im = Image.open(pic).convert('RGB')
ours = np.asarray(im.resize((576, 576), Image.BILINEAR), dtype=np.float32) / 255.0
ours = (ours - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
x = torch.from_numpy(ours.transpose(2, 0, 1)[None].copy())
theirs = proc(images=im, return_tensors='pt')['pixel_values']
print('processor tensor', tuple(theirs.shape), 'mean abs diff from ours', float((theirs - x).abs().mean()) if theirs.shape == x.shape else 'shape differs')
w = Wrap(model).eval()
with torch.no_grad():
    lt, bt = w(x)
torch.onnx.export(w, (x,), out, input_names=['pixel_values'], output_names=['logits', 'boxes'], opset_version=18, dynamo=True, external_data=False)
import onnxruntime as ort
s = ort.InferenceSession(out)
lo, bo = s.run(None, {'pixel_values': x.numpy()})
print('logits', lo.shape, 'max diff', float(np.abs(lo - lt.numpy()).max()), '| boxes', bo.shape, 'max diff', float(np.abs(bo - bt.numpy()).max()))
sc = 1 / (1 + np.exp(-lo[0]))
print('queries over 0.3:', int((sc.max(1) > 0.3).sum()), 'labels', model.config.id2label)
