"""
The word reader of Lens Code's OCR library: reads the lines of words in a picture with indra-ocr and its models, both held in this library's own folder.

    ocr <picture>      prints a JSON array of lines: {"box": [x0, y0, x1, y1], "text": "...", "conf": 0.97}
    ocr --version      prints the library's version

Nothing is downloaded: the models are read from ../models (INDRA_OCR_MODEL_DIR), and a failure prints an empty array (the words are a help to the
measurement, never a requirement), with the reason on stderr.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
os.environ.setdefault("INDRA_OCR_MODEL_DIR", os.path.join(ROOT, "models"))
os.environ["HF_HUB_OFFLINE"] = "1"


def version():
    with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f:
        return f.read().strip()


def read(path):
    import numpy as np
    from PIL import Image
    import indra_ocr

    ocr = indra_ocr.OrtOCR(indra_ocr.model_dir())
    image = np.array(Image.open(path).convert("L"))
    result = ocr(image, turn=False)
    return [{"box": [float(c) for c in line.box], "text": line.text.strip(), "conf": float(line.conf)} for line in result.lines]


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--version":
        print(version())
        sys.exit(0)
    if len(sys.argv) < 2:
        print("[]")
        sys.exit(0)
    try:
        print(json.dumps(read(sys.argv[1]), ensure_ascii=False))
    except Exception as e:  # the words are optional to the caller: say why, answer with none
        sys.stderr.write(f"ocr: {e}\n")
        print("[]")
