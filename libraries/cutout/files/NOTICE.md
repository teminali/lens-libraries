# Cut-out library: what is inside

| Part | Licence | Source |
|---|---|---|
| `engine/model.onnx`: BiRefNet general lite (Swin-T backbone, epoch 232), ONNX export | MIT | Zheng Peng et al., github.com/ZhengPeng7/BiRefNet; the export rembg publishes (github.com/danielgatis/rembg, MIT) |
| `engine/lama.onnx`: big-lama inpainting, ONNX port (512 x 512) | Apache-2.0 | Roman Suvorov et al., github.com/advimman/lama; the export by Carve (huggingface.co/Carve/LaMa-ONNX) |
| `engine/ppocr_det.onnx`: PP-OCRv5 server text detection | Apache-2.0 | PaddlePaddle/PaddleOCR (github.com/PaddlePaddle/PaddleOCR); ONNX export huggingface.co/monkt/paddleocr-onnx |
| `engine/migan.onnx`: MI-GAN inpainting pipeline (512) | MIT (code and weights) | Picsart AI Research, github.com/Picsart-AI-Research/MI-GAN; ONNX huggingface.co/andraniksargsyan/migan |
| `engine/ui_elements.onnx`: UI-element detector (RF-DETR medium, 576 x 576) | Apache-2.0 (model and its training data) | huggingface.co/merve/rf-detr-mobile-ui, on Roboflow RF-DETR (Apache-2.0) and DINOv2; ONNX exported by Lens (tools/export_ui_elements.py) |
| `engine/node_modules/onnxruntime-node` | MIT | github.com/microsoft/onnxruntime |
| `engine/node_modules/pngjs` | MIT | github.com/pngjs/pngjs |
| `node/`: the Node.js runtime | MIT and the licences in `node/LICENSE` | nodejs.org |
| `engine/cutout.mjs`, `engine/plate.mjs`, `engine/design_layer.mjs`, `engine/text_mask.mjs`, `bin/` | the Lens libraries' own | github.com/teminali/lens-libraries |

Each package's own licence file is inside its folder. Nothing here is sent anywhere: the picture is read and the cut-out written on this computer.
