# How engine/ui_elements.onnx is made (it is our own export: no ONNX of this model is published).
# Source: huggingface.co/merve/rf-detr-mobile-ui at revision 8195d5994e83dbd38fbbdd337d1f2c96ad0b4bfd (Apache-2.0; RF-DETR medium fine-tuned on
#   merve/mobile-ui-design, Apache-2.0): model.safetensors (loading it runs no code), config.json, preprocessor_config.json; their sha256 are in library.json.
# Environment: Python 3.12.7 and the exact packages in export_requirements.txt (torch 2.15.0, transformers 5.22.2, onnx 1.23.2, onnxruntime 1.32.0,
#   onnxscript 0.7.2: the dynamo exporter; the older one cannot export the backbone's antialiased bicubic resize). make_ui_elements.sh sets it up and runs this.
#   python -I export_ui_elements.py <folder with the three files> <out.onnx> <a picture>
# The exporter writes each node's Python stack trace (absolute paths of this script and of the installed packages) into the file, so the same export made from
# another folder had other bytes. Those debug notes are removed before saving: the file is then the same bytes wherever it is made (checked 2026-11-14: exports
# from two folders, with three different pictures, all 7d468378...; onnxruntime gives the unstripped file's outputs exactly, max diff 0.0). The picture only
# feeds the comparison below; it does not change the export.
# It prints how the export compares with torch on the picture. The detections (not the raw query order, which a tiny numeric change reshuffles) must match; on
# 2026-11-13 they matched 812 of 812 over 9 pictures. The result goes in lens-libraries/dist/models/ui_elements.onnx; its sha256 is uiElementsSha256 in library.json.
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
import onnx


def plain(g):
    """Drops the exporter's per-node debug notes (stack traces with absolute paths, fx names, scopes), which make the bytes depend on where it ran."""
    del g.metadata_props[:]
    for n in g.node:
        del n.metadata_props[:]
        n.doc_string = ''
        for a in n.attribute:
            if a.HasField('g'):
                plain(a.g)
            for sg in a.graphs:
                plain(sg)


m = onnx.load(out)
plain(m.graph)
del m.metadata_props[:]
onnx.save(m, out)
import onnxruntime as ort
s = ort.InferenceSession(out)
lo, bo = s.run(None, {'pixel_values': x.numpy()})
print('logits', lo.shape, 'max diff', float(np.abs(lo - lt.numpy()).max()), '| boxes', bo.shape, 'max diff', float(np.abs(bo - bt.numpy()).max()))
sc = 1 / (1 + np.exp(-lo[0]))
print('queries over 0.3:', int((sc.max(1) > 0.3).sum()), 'labels', model.config.id2label)
