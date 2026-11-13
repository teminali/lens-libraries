# Cut-out library: what is inside

| Part | Licence | Source |
|---|---|---|
| `engine/model.onnx`: BiRefNet general lite (Swin-T backbone, epoch 232), ONNX export | MIT | Zheng Peng et al., github.com/ZhengPeng7/BiRefNet; the export rembg publishes (github.com/danielgatis/rembg, MIT) |
| `engine/node_modules/onnxruntime-node` | MIT | github.com/microsoft/onnxruntime |
| `engine/node_modules/pngjs` | MIT | github.com/pngjs/pngjs |
| `node/`: the Node.js runtime | MIT and the licences in `node/LICENSE` | nodejs.org |
| `engine/cutout.mjs`, `bin/` | the Lens libraries' own | github.com/teminali/lens-libraries |

Each package's own licence file is inside its folder. Nothing here is sent anywhere: the picture is read and the cut-out written on this computer.
