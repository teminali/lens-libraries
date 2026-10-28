# Lens Code word reader

This library packs, unchanged:

- **indra-ocr** 1.1.2, by Datalab (https://www.datalab.to), under the Apache License 2.0: `LICENSES/indra-ocr-Apache-2.0.txt`.
- **The indra-ocr models** (https://huggingface.co/datalab-to/indra-ocr, revision v1.1.0), by Datalab, under the AI Pubs Open RAIL-M License (modified):
  `LICENSES/indra-ocr-models-OpenRAIL-M.txt`. The use restrictions in its Attachment A apply to everyone who uses these models through this library.
- **CPython** 3.11 (python-build-standalone), under the Python Software Foundation License, and the Python packages it needs (numpy, opencv-python-headless,
  onnxruntime, pypdfium2, huggingface_hub, pillow), each under its own licence, found beside it in `python/`.

Nothing in the models was modified. `lib/ocr.py` and `bin/` are Lens Code's own (MIT).
