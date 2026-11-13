// Lens library "cutout": the main subject of a picture on a transparent background (BiRefNet-lite, MIT; onnxruntime). One engine on macOS, Windows and Linux:
// this script and engine/model.onnx are the same bytes on every system, and only the Node runtime and onnxruntime's native part differ per platform.
//   node cutout.mjs --version                       -> the library's version (its VERSION file)
//   node cutout.mjs <in.png> <out.png> [x,y,w,h]   -> prints {"ok":true,"x":..,"y":..,"w":..,"h":..} : the subject's box in the input's pixels
// Pre/post-processing as rembg's BiRefNet session: 1024x1024 RGB scaled by its max, ImageNet mean/std, sigmoid, min-max, mask resized to the picture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { designShapes } from './design_layer.mjs';
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
// pieces of the mask: 4-connected pixels for which on(i) holds
function piecesOf(on) {
  const label = new Int32Array(W * H); const sizes = [0]; const boxes = [null]; const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!on(i) || label[i]) continue;
    const id = sizes.length; let n = 0, sp = 0; let x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack[sp++] = i; label[i] = id;
    while (sp) {
      const j = stack[--sp]; n++; const x = j % W, y = (j - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && on(j - 1) && !label[j - 1]) { label[j - 1] = id; stack[sp++] = j - 1; }
      if (x < W - 1 && on(j + 1) && !label[j + 1]) { label[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && on(j - W) && !label[j - W]) { label[j - W] = id; stack[sp++] = j - W; }
      if (y < H - 1 && on(j + W) && !label[j + W]) { label[j + W] = id; stack[sp++] = j + W; }
    }
    sizes.push(n); boxes.push([x0, y0, x1, y1]);
  }
  let main = 0; for (let k = 1; k < sizes.length; k++) if (!main || sizes[k] > sizes[main]) main = k;
  return { label, sizes, boxes, main };
}
// The design's own shapes are not the subject (2026-11-13, Wingly leg 72: the lift of the man took the "Get started" button under his feet). A design shape
// (design_layer.mjs: one colour, sharp edge; the detector the plate uses) that the mask took in, half of its pixels or more, is set aside; the subject's body is
// found without them; a set-aside shape that touches the body (wings drawn around a person, a badge on a jacket) belongs to it and stays, and one apart from it (a
// button, a label) is cut out pixel by pixel. A flat background around the subject (a card behind a portrait) is never in the mask, so it is not touched.
let designCut = 0;
{
  const region = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s0 = px(x, y), d0 = (y * W + x) * 4; region[d0] = d[s0]; region[d0 + 1] = d[s0 + 1]; region[d0 + 2] = d[s0 + 2]; region[d0 + 3] = 255; }
  const { shapes, label: dl } = designShapes(region, W, H);
  if (shapes.length) {
    const inMask = new Int32Array(shapes.length + 1);
    for (let i = 0; i < W * H; i++) if (dl[i] && alpha[i] > 16) inMask[dl[i]]++;
    const aside = new Uint8Array(shapes.length + 1);
    shapes.forEach((f, k) => { if (inMask[k + 1] >= f.n * 0.5) aside[k + 1] = 1; });
    const body = piecesOf((i) => alpha[i] > 16 && !aside[dl[i]]);
    if (body.main) {
      // attached through other kept shapes counts too: a wing's white fill touches its outline, and only the outline touches the body (2026-11-13, Wingly leg 78:
      // the right wing's fill was cut and a scrap of its outline was left by the phone). Passes repeat until nothing more joins.
      const touches = new Uint8Array(shapes.length + 1);
      for (let pass = 0, grew = true; grew && pass < 6; pass++) {
        grew = false;
        for (let i = 0; i < W * H; i++) {
          const k = dl[i]; if (!k || !aside[k] || touches[k]) continue;
          const x = i % W, y = (i - x) / W;
          for (let dy = -2; dy <= 2 && !touches[k]; dy++) for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx, o = dl[j];
            if (body.label[j] === body.main || (o && o !== k && aside[o] && touches[o])) { touches[k] = 1; grew = true; break; }
          }
        }
      }
      // A flat design shape in a hole of the mask, enclosed by the kept subject, that is NOT the background seen through (the white fill inside a wing's outline, which
      // the salience model left out) belongs to the subject. Background trapped between the wing's lobes and the body is flat and enclosed too, so the test is the
      // colour: a shape whose mean colour is within 40 levels of the background just outside the subject nearest it (the clear pixels reached from the rect's border,
      // in the smallest ring around the shape's box that holds some) is that background and stays clear (2026-11-13, Wingly leg 78: one wing's fill lost; the first try without this test kept
      // the trapped sky as blue blobs).
      {
        const out = new Uint8Array(W * H); const st = [];
        const seed = (i) => { if (alpha[i] <= 16 && !out[i]) { out[i] = 1; st.push(i); } };
        for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
        for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
        while (st.length) { const j = st.pop(), x = j % W, y = (j - x) / W; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = yy * W + xx; if (!out[q] && alpha[q] <= 16) { out[q] = 1; st.push(q); } } }
        const size = new Int32Array(shapes.length + 1), inHole = new Int32Array(shapes.length + 1), sum = new Float64Array((shapes.length + 1) * 3);
        for (let i = 0; i < W * H; i++) { const k = dl[i]; if (!k) continue; size[k]++; if (alpha[i] <= 16 && !out[i]) inHole[k]++; for (let c = 0; c < 3; c++) sum[k * 3 + c] += region[i * 4 + c]; }
        const fillK = new Uint8Array(shapes.length + 1);
        for (let k = 1; k <= shapes.length; k++) {
          if (size[k] < 12 || inHole[k] < size[k] * 0.8) continue;
          // the NEAREST background: the ring around the shape's box grown 8, 16, 32 then 64 px, until it holds 24 clear pixels (a wide mean mixes in a cloud or a card)
          const f = shapes[k - 1], bg = [0, 0, 0]; let n = 0;
          for (const R of [8, 16, 32, 64]) {
            bg[0] = bg[1] = bg[2] = 0; n = 0;
            for (let y = Math.max(0, f.y0 - R); y <= Math.min(H - 1, f.y1 + R); y++) for (let x = Math.max(0, f.x0 - R); x <= Math.min(W - 1, f.x1 + R); x++) { const i = y * W + x; if (!out[i]) continue; n++; for (let c = 0; c < 3; c++) bg[c] += region[i * 4 + c]; }
            if (n >= 24) break;
          }
          if (!n) continue; // nothing of the background near it to tell it from: left as it was
          let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(sum[k * 3 + c] / size[k] - bg[c] / n));
          if (d > 40) fillK[k] = 1;
        }
        for (let i = 0; i < W * H; i++) {
          if (!fillK[dl[i]]) continue;
          const x = i % W, y = (i - x) / W;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const q = yy * W + xx; if (!out[q]) alpha[q] = 255; }
        }
      }
      for (let k = 1; k <= shapes.length; k++) if (aside[k] && !touches[k]) designCut++;
      for (let i = 0; i < W * H; i++) {
        const k = dl[i]; if (!k || !aside[k] || touches[k]) continue;
        const x = i % W, y = (i - x) / W;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && body.label[yy * W + xx] !== body.main) alpha[yy * W + xx] = 0; }
      }
    }
  }
}
// One subject, not every salient thing: the largest piece is the subject, and a piece whose box touches the subject's box (a hand-held card) stays with it, unless it
// is a scrap (under 0.5% of the subject: the rim of something cut out); the rest (a card or a bird across the page) is cleared. A region the caller names narrows this.
{
  const { label, sizes, boxes, main } = piecesOf((i) => alpha[i] > 16);
  if (main) {
    const [mx0, my0, mx1, my1] = boxes[main]; const pad = Math.round(Math.max(mx1 - mx0, my1 - my0) * 0.02);
    const keep = new Uint8Array(sizes.length);
    for (let k = 1; k < sizes.length; k++) { const [a, b, c, e] = boxes[k]; keep[k] = k === main || (sizes[k] >= sizes[main] * 0.005 && a <= mx1 + pad && c >= mx0 - pad && b <= my1 + pad && e >= my0 - pad) ? 1 : 0; }
    bx0 = W; by0 = H; bx1 = -1; by1 = -1;
    for (let i = 0; i < W * H; i++) {
      if (alpha[i] <= 16) continue;
      if (!keep[label[i]]) { alpha[i] = 0; continue; }
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
await say({ ok: true, x: ox + bx0, y: oy + by0, w: ow, h: oh, designCut });
}
