// Lens library "cutout": the main subject of a picture on a transparent background (BiRefNet-lite, MIT; onnxruntime). One engine on macOS, Windows and Linux:
// this script and engine/model.onnx are the same bytes on every system, and only the Node runtime and onnxruntime's native part differ per platform.
//   node cutout.mjs --version                       -> the library's version (its VERSION file)
//   node cutout.mjs <in.png> <out.png> [x,y,w,h]   -> prints {"ok":true,"x":..,"y":..,"w":..,"h":..} : the subject's box in the input's pixels
// Pre/post-processing as rembg's BiRefNet session: 1024x1024 RGB scaled by its max, ImageNet mean/std, sigmoid, min-max, mask resized to the picture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (() => { try { return fs.readFileSync(path.join(here, '..', 'VERSION'), 'utf8').trim(); } catch (_) { return '0.0.0'; } })();
const [a1, a2, a3] = process.argv.slice(2);
if (a1 === '--version') { console.log(VERSION); process.exit(0); }
let session = null;
const say = async (o, code = 0) => { console.log(JSON.stringify(o)); process.exitCode = code; if (session) { try { await session.release(); } catch (_) {} } if (!session) process.exit(code); };
if (!a1 || !a2) say({ ok: false, why: 'usage: cutout.mjs in.png out.png [x,y,w,h]' }, 2);
const ort = await import('onnxruntime-node');
const src = PNG.sync.read(fs.readFileSync(a1));
let [ox, oy, W, H] = [0, 0, src.width, src.height];
if (a3) {
  const r = a3.split(',').map(Number);
  if (r.length !== 4 || r.some((n) => !Number.isFinite(n))) say({ ok: false, why: 'the region is x,y,w,h' }, 2);
  ox = Math.max(0, Math.round(r[0])); oy = Math.max(0, Math.round(r[1]));
  W = Math.min(src.width - ox, Math.round(r[2])); H = Math.min(src.height - oy, Math.round(r[3]));
  if (W < 16 || H < 16) say({ ok: false, why: 'the region is too small' }, 2);
}
const px = (x, y) => ((oy + y) * src.width + (ox + x)) * 4;
const S = 1024;
// the region at 1024 x 1024: each output pixel averages the source pixels under it when shrinking (an area filter, close to the Lanczos resize the model was trained with;
// plain point sampling aliases fine detail and the mask grows onto the things around the subject), bilinear when enlarging
const rgb = new Float32Array(3 * S * S);
let max = 1e-6;
const d = src.data;
for (let y = 0; y < S; y++) {
  const sy0 = (y * H) / S, sy1 = ((y + 1) * H) / S;
  for (let x = 0; x < S; x++) {
    const sx0 = (x * W) / S, sx1 = ((x + 1) * W) / S;
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(sy0); yy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)) && yy < H; yy++) {
      for (let xx = Math.floor(sx0); xx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)) && xx < W; xx++) { const i = px(xx, yy); r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    }
    const o = y * S + x;
    rgb[o] = r / n; rgb[S * S + o] = g / n; rgb[2 * S * S + o] = b / n;
    if (rgb[o] > max) max = rgb[o]; if (rgb[S * S + o] > max) max = rgb[S * S + o]; if (rgb[2 * S * S + o] > max) max = rgb[2 * S * S + o];
  }
}
const input = new Float32Array(3 * S * S);
const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
for (let c = 0; c < 3; c++) for (let i = 0; i < S * S; i++) input[c * S * S + i] = (rgb[c * S * S + i] / max - mean[c]) / std[c];
session = await ort.InferenceSession.create(path.join(here, 'model.onnx'), { graphOptimizationLevel: 'all' });
const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) };
const out = (await session.run(feeds))[session.outputNames[0]].data;
let mi = Infinity, ma = -Infinity;
const pred = new Float32Array(S * S);
for (let i = 0; i < S * S; i++) { const v = 1 / (1 + Math.exp(-out[i])); pred[i] = v; if (v < mi) mi = v; if (v > ma) ma = v; }
const span = ma - mi || 1;
// the mask at the region's size (bilinear), then the subject's box (alpha above 16 of 255)
const alpha = new Uint8Array(W * H);
let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = (x + 0.5) * S / W - 0.5, fy = (y + 0.5) * S / H - 0.5;
  const x0 = Math.max(0, Math.min(S - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(S - 1, Math.floor(fy)));
  const x1 = Math.min(S - 1, x0 + 1), y1 = Math.min(S - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
  const v = (pred[y0 * S + x0] * (1 - tx) + pred[y0 * S + x1] * tx) * (1 - ty) + (pred[y1 * S + x0] * (1 - tx) + pred[y1 * S + x1] * tx) * ty;
  const a = Math.round(((v - mi) / span) * 255);
  alpha[y * W + x] = a;
  if (a > 16) { if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y; }
}
// One subject, not every salient thing: the connected pieces of the mask are labelled, the largest is the subject, and a piece whose box touches the subject's box
// (wings, a hand-held card) stays with it; the rest (a card or a bird across the page) is cleared. A region the caller names narrows this further.
{
  const label = new Int32Array(W * H); const sizes = [0]; const boxes = [null]; const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (alpha[i] <= 16 || label[i]) continue;
    const id = sizes.length; let n = 0, sp = 0; let x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack[sp++] = i; label[i] = id;
    while (sp) {
      const j = stack[--sp]; n++; const x = j % W, y = (j - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && alpha[j - 1] > 16 && !label[j - 1]) { label[j - 1] = id; stack[sp++] = j - 1; }
      if (x < W - 1 && alpha[j + 1] > 16 && !label[j + 1]) { label[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && alpha[j - W] > 16 && !label[j - W]) { label[j - W] = id; stack[sp++] = j - W; }
      if (y < H - 1 && alpha[j + W] > 16 && !label[j + W]) { label[j + W] = id; stack[sp++] = j + W; }
    }
    sizes.push(n); boxes.push([x0, y0, x1, y1]);
  }
  let main = 0; for (let k = 1; k < sizes.length; k++) if (!main || sizes[k] > sizes[main]) main = k;
  if (main) {
    const [mx0, my0, mx1, my1] = boxes[main]; const pad = Math.round(Math.max(mx1 - mx0, my1 - my0) * 0.02);
    const keep = new Uint8Array(sizes.length);
    for (let k = 1; k < sizes.length; k++) { const [a, b, c, e] = boxes[k]; keep[k] = k === main || (a <= mx1 + pad && c >= mx0 - pad && b <= my1 + pad && e >= my0 - pad) ? 1 : 0; }
    bx0 = W; by0 = H; bx1 = -1; by1 = -1;
    for (let i = 0; i < W * H; i++) {
      const k = label[i];
      if (alpha[i] <= 16) continue;
      if (!keep[k]) { alpha[i] = 0; continue; }
      const x = i % W, y = (i - x) / W; if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y;
    }
  }
}
if (bx1 < 0) { await say({ ok: false, why: 'no subject was found in the picture' }, 3); } else {
const ow = bx1 - bx0 + 1, oh = by1 - by0 + 1;
const png = new PNG({ width: ow, height: oh });
for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
  const s = px(bx0 + x, by0 + y), d = (y * ow + x) * 4;
  const al = alpha[(by0 + y) * W + bx0 + x]; png.data[d] = al ? src.data[s] : 0; png.data[d + 1] = al ? src.data[s + 1] : 0; png.data[d + 2] = al ? src.data[s + 2] : 0; png.data[d + 3] = al;
}
fs.writeFileSync(a2, PNG.sync.write(png));
await say({ ok: true, x: ox + bx0, y: oy + by0, w: ow, h: oh });
}
