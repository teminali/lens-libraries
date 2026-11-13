// Lens library "cutout", second engine: a clean plate. A design's own layer (its words, buttons, cards, icons, rings and ruled lines) is erased from a picture and
// filled with what lies behind it (LaMa, big-lama, Apache-2.0, the ONNX port by Carve: fixed 512 x 512), so the picture's photograph can sit behind real HTML.
// One engine on macOS, Windows and Linux: this script and engine/lama.onnx are the same bytes everywhere.
//
//   node plate.mjs <in.png> <out.png> <hints.json>
//     hints.json: { "boxes": [{ x, y, w, h }], "mask": "<a PNG of the picture's size: white is erased>", "auto": true }   (a bare array is boxes alone)
//   -> prints {"ok":true,"found":{...},"areas":[...],"filled":N}: what was erased and why, and the areas filled
//
// WHAT IS ERASED, AND HOW IT IS FOUND (the answer says each part, so whoever uses the plate knows what it rests on):
//   ruled lines: a row or column that differs, the same way, from the rows (columns) two away along more than 55% of the picture (a grid, a frame): filled by
//     blending its two sides, not by the model, and first, so a shape a line crosses is still one shape.
//   design shapes (auto, on unless "auto": false): a region of one colour (neighbours within 6 levels) whose colour hardly varies (spread 4 or less per channel), whose
//     edge is mostly sharp (a step of 24+ levels within two pixels of it: anti-aliasing blends one), and which is not huge (a quarter of the picture at most). A UI draws such shapes (a button,
//     a card, a stroke of a letter, an icon, a ring); a photograph does not: its smooth parts are shaded and grainy, and its edges soft. The box of each shape is
//     erased, with what it holds (a portrait in a card, a face in an avatar's ring); a long thin diagonal shape is not boxed.
//   boxes: the caller's own, grown a little (anti-aliasing and shadows sit just outside).
//   mask: exact shapes (the photos a page lifts and places on top).
//   spill: an edge that crosses an erased area's border and is joined to edges inside it, followed outwards, when it is small beside the area (a head above its
//     card, the rest of a button a box half covers); a long run (the horizon, a turbine behind a card) is not followed.
//   words: PP-OCRv5 text detection (text_mask.mjs, engine/ppocr_det.onnx), at the picture's own resolution, on any kind of picture (clean screenshot, compressed
//     export, text over a photo). The flat-shape test above is used only for the UI's larger surfaces.
// WHAT IT CANNOT FIND ON ITS OWN: a photographic thing placed on the background with no flat part (a cut-out person, a product shot): box it or pass its mask.
// Thin and small holes are filled by MI-GAN in one pass at full resolution; each big group by LaMa in a square window of its surroundings (at least 512 px, scaled
// to 512). Only the erased pixels are put back, with a soft edge: the rest of the picture keeps its own pixels and its full resolution.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { designShapes } from './design_layer.mjs';
import { textBoxes } from './text_mask.mjs';
import { photoArea } from './photo_area.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const [a1, a2, a3] = process.argv.slice(2);
let session = null;
const say = async (o, code = 0) => { console.log(JSON.stringify(o)); process.exitCode = code; if (session) { try { await session.release(); } catch (_) {} } else process.exit(code); };
if (!a1 || !a2 || !a3) { await say({ ok: false, why: 'usage: plate.mjs in.png out.png hints.json' }, 2); }
const src = PNG.sync.read(fs.readFileSync(a1));
const W = src.width, H = src.height, N = W * H;
const D = src.data;
let given;
try { given = JSON.parse(fs.readFileSync(a3, 'utf8')); } catch (_) { given = null; }
const boxes = Array.isArray(given) ? given : given && Array.isArray(given.boxes) ? given.boxes : [];
const auto = !(given && given.auto === false);
let extra = null;
if (given && typeof given.mask === 'string') { try { const m = PNG.sync.read(fs.readFileSync(given.mask)); if (m.width === W && m.height === H) extra = m.data; } catch (_) { extra = null; } }
const S = 512;
const GROW = Math.max(3, Math.round(Math.min(W, H) * 0.003));
const hole = new Uint8Array(N);
const areasErased = [];
const found = { shapes: 0, shapeBoxes: [], textBoxes: 0, textRuns: 0, boxes: 0, masked: 0, spills: 0, lines: { rows: [], cols: [] } };
const eraseBox = (x0, y0, x1, y1, grow = GROW) => {
  x0 = Math.max(0, Math.floor(x0 - grow)); y0 = Math.max(0, Math.floor(y0 - grow)); x1 = Math.min(W, Math.ceil(x1 + grow)); y1 = Math.min(H, Math.ceil(y1 + grow));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  for (let y = y0; y < y1; y++) hole.fill(1, y * W + x0, y * W + x1);
  const b = { x0, y0, x1, y1 }; areasErased.push(b); return b;
};
const lum = new Float32Array(N);
const readLum = () => { for (let i = 0; i < N; i++) lum[i] = 0.299 * D[i * 4] + 0.587 * D[i * 4 + 1] + 0.114 * D[i * 4 + 2]; };
readLum();
const step = (i, j) => Math.max(Math.abs(D[i * 4] - D[j * 4]), Math.abs(D[i * 4 + 1] - D[j * 4 + 1]), Math.abs(D[i * 4 + 2] - D[j * 4 + 2]));

// 0. is there a photograph to clean? (photo_area.mjs) A picture whose largest photographic piece is under a fifth of it has no photo behind its design: nothing is
// filled or written, and the answer gives the flat colours of its paint and where its photographic pieces are, for the page to draw and to crop.
const photo = photoArea(D, W, H);
if (photo.largest < 20) await say({ ok: true, noPhoto: true, photo });
// 1. ruled lines
const ruledRow = new Uint8Array(H), ruledCol = new Uint8Array(W);
for (let y = 2; y < H - 2; y++) {
  let up = 0, down = 0;
  for (let x = 0; x < W; x++) { const d = lum[y * W + x] - (lum[(y - 2) * W + x] + lum[(y + 2) * W + x]) / 2; if (d > 3) up++; else if (d < -3) down++; }
  if (Math.max(up, down) > W * 0.55) ruledRow[y] = 1;
}
for (let x = 2; x < W - 2; x++) {
  let up = 0, down = 0;
  for (let y = 0; y < H; y++) { const d = lum[y * W + x] - (lum[y * W + x - 2] + lum[y * W + x + 2]) / 2; if (d > 3) up++; else if (d < -3) down++; }
  if (Math.max(up, down) > H * 0.55) ruledCol[x] = 1;
}
for (let y = 0; y < H; y++) {
  if (!ruledRow[y]) continue;
  let b = y; while (b + 1 < H && ruledRow[b + 1]) b++;
  const top = Math.max(0, y - 1), bot = Math.min(H - 1, b + 1);
  for (let yy = top + 1; yy < bot; yy++) { const t = (yy - top) / (bot - top); for (let x = 0; x < W; x++) { const p = (yy * W + x) * 4, pa = (top * W + x) * 4, pb = (bot * W + x) * 4; for (let c = 0; c < 3; c++) D[p + c] = Math.round(D[pa + c] * (1 - t) + D[pb + c] * t); } }
  found.lines.rows.push(y); y = b + 1;
}
for (let x = 0; x < W; x++) {
  if (!ruledCol[x]) continue;
  let b = x; while (b + 1 < W && ruledCol[b + 1]) b++;
  const left = Math.max(0, x - 1), right = Math.min(W - 1, b + 1);
  for (let xx = left + 1; xx < right; xx++) { const t = (xx - left) / (right - left); for (let y = 0; y < H; y++) { const p = (y * W + xx) * 4, pa = (y * W + left) * 4, pb = (y * W + right) * 4; for (let c = 0; c < 3; c++) D[p + c] = Math.round(D[pa + c] * (1 - t) + D[pb + c] * t); } }
  found.lines.cols.push(x); x = b + 1;
}
readLum();
// edges: a pixel that stands out from the mean of its 9 x 9 neighbourhood (letters, rims, textures; a soft sky or haze has none)
const integral = new Float64Array((W + 1) * (H + 1));
for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += lum[y * W + x]; integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row; } }
const meanAt = (x, y, r) => { const a = Math.max(0, x - r), b = Math.max(0, y - r), c = Math.min(W, x + r + 1), d = Math.min(H, y + r + 1); return (integral[d * (W + 1) + c] - integral[b * (W + 1) + c] - integral[d * (W + 1) + a] + integral[b * (W + 1) + a]) / ((c - a) * (d - b)); };
const edge = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(lum[y * W + x] - meanAt(x, y, 4)) > 18) edge[y * W + x] = 1;

// 2. design shapes (design_layer.mjs, shared with the cut-out)
// Text is not taken from these shapes any more: PP-OCRv5 (step 2t) finds it on every kind of picture; the flat-shape test is kept for the UI's own surfaces (a
// button, a card, an icon, a ring), which are larger than a letter (2026-11-13: letter rules held on a clean screenshot and failed on a compressed export).
if (auto) {
  for (const f of designShapes(D, W, H).shapes) {
    if (f.ink || (f.n < 300 && Math.max(f.bw, f.bh) < 60)) continue;
    found.shapes++;
    const b = eraseBox(f.x0, f.y0, f.x1 + 1, f.y1 + 1);
    if (b && f.bw * f.bh > 2000) found.shapeBoxes.push({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
  }
}
// 2t. the words: PP-OCRv5 detection at the picture's own resolution (text_mask.mjs), each box grown a little; the model loaded only when it is in the library
const ort = await import('onnxruntime-node');
if (auto && fs.existsSync(path.join(here, 'ppocr_det.onnx'))) {
  const det = await ort.InferenceSession.create(path.join(here, 'ppocr_det.onnx'), { graphOptimizationLevel: 'all' });
  const words = await textBoxes(ort, det, D, W, H);
  for (const b of words) eraseBox(b.x, b.y, b.x + b.w, b.y + b.h, Math.max(2, Math.round(GROW / 2)));
  found.textBoxes = words.length;
  try { await det.release(); } catch (_) { /* freed on exit */ }
}
// 3. the caller's boxes and exact shapes
for (const b of boxes) { const n = [b.x, b.y, b.w, b.h].map(Number); if (n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 && eraseBox(n[0], n[1], n[0] + n[2], n[1] + n[3])) found.boxes++; }
if (extra) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  // a lifted shape is erased from its soft edge outwards (any alpha above 8, not only the solid part) and grown by 0.6% of the short side: the halo of a subject (its
  // shadow, the blend of its edge) is not left for the fill to spread (2026-11-13: a dark smear across the Wingly cloud where the man had been)
  const G = Math.max(GROW, Math.round(Math.min(W, H) * 0.006));
  for (let i = 0; i < N; i++) if (extra[i * 4] > 8) { const x = i % W, y = (i - x) / W; for (let dy = -G; dy <= G; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; hole.fill(1, yy * W + Math.max(0, x - G), yy * W + Math.min(W, x + G + 1)); } if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 >= 0) { areasErased.push({ x0: Math.max(0, x0 - G), y0: Math.max(0, y0 - G), x1: Math.min(W, x1 + G + 1), y1: Math.min(H, y1 + G + 1) }); found.masked = 1; }
}
// 4. spill
const seen = new Uint8Array(N);
for (const b of areasErased.slice()) {
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  if (bw * bh < 400) continue;
  const limit = Math.max(400, bw * bh * 0.6), reach = Math.round(Math.max(bw, bh) * 0.5);
  const ring = [];
  for (let x = b.x0; x < b.x1; x++) for (const y of [b.y0 - 1, b.y1]) if (y >= 0 && y < H) ring.push(y * W + x);
  for (let y = b.y0; y < b.y1; y++) for (const x of [b.x0 - 1, b.x1]) if (x >= 0 && x < W) ring.push(y * W + x);
  for (const start of ring) {
    if (!edge[start] || hole[start] || seen[start]) continue;
    const stack = [start]; seen[start] = 1; const piece = []; let runs = false;
    while (stack.length) {
      const j = stack.pop(); piece.push(j);
      const x = j % W, y = (j - x) / W;
      if (piece.length > limit || x < b.x0 - reach || x >= b.x1 + reach || y < b.y0 - reach || y >= b.y1 + reach) { runs = true; break; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const i = yy * W + xx; if (edge[i] && !hole[i] && !seen[i]) { seen[i] = 1; stack.push(i); } }
    }
    if (runs || piece.length < 8) continue;
    let sx0 = W, sy0 = H, sx1 = -1, sy1 = -1;
    for (const j of piece) { const x = j % W, y = (j - x) / W; if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; }
    eraseBox(sx0, sy0, sx1 + 1, sy1 + 1); found.spills++;
  }
}
if (!areasErased.length && !found.lines.rows.length && !found.lines.cols.length) { await say({ ok: false, why: 'nothing to erase: no design shapes were found and no boxes or mask were given' }, 3); }

// 5. groups of erased areas, each filled in its own window (a group never grows past half the picture: then it is filled in parts, each at its own detail)
const groups = areasErased.map((b) => ({ ...b }));
const CAP = Math.max(1024, Math.max(W, H) * 0.5);
for (let merged = true; merged;) {
  merged = false;
  for (let i = 0; i < groups.length && !merged; i++) for (let j = i + 1; j < groups.length && !merged; j++) {
    const a = groups[i], c = groups[j], pad = 32;
    const u = { x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) };
    if (Math.max(u.x1 - u.x0, u.y1 - u.y0) > CAP) continue;
    if (a.x0 - pad < c.x1 && c.x0 - pad < a.x1 && a.y0 - pad < c.y1 && c.y0 - pad < a.y1) { groups[i] = u; groups.splice(j, 1); merged = true; }
  }
}
const areas = [];
// Two fillers, each for what it does well (2026-11-13: MI-GAN on the hole of a lifted man painted an icy mountain into the cloud; LaMa per window took 90 s for text):
//  - MI-GAN (engine/migan.onnx, MIT; its pipeline crops around each hole itself) fills the thin and small holes (lines of text, buttons, small cards) in one pass at the
//    picture's own resolution, in about 2 s;
//  - LaMa fills the big holes (a lifted person, a large panel), each in a window of its surroundings.
// A group is small when it is thin (its short side at most 120 px) or covers at most 2% of the picture.
const small = (g) => Math.min(g.x1 - g.x0, g.y1 - g.y0) <= 120 || (g.x1 - g.x0) * (g.y1 - g.y0) <= N * 0.02;
if (fs.existsSync(path.join(here, 'migan.onnx')) && groups.some(small)) {
  const mg = await ort.InferenceSession.create(path.join(here, 'migan.onnx'), { graphOptimizationLevel: 'all' });
  const img = new Uint8Array(3 * N), mask = new Uint8Array(N).fill(255); // 0 is a hole
  for (let i = 0; i < N; i++) { img[i] = D[i * 4]; img[N + i] = D[i * 4 + 1]; img[2 * N + i] = D[i * 4 + 2]; }
  const mine = groups.filter(small);
  for (const g of mine) for (let y = g.y0; y < g.y1; y++) for (let x = g.x0; x < g.x1; x++) if (hole[y * W + x]) mask[y * W + x] = 0;
  const outM = (await mg.run({ image: new ort.Tensor('uint8', img, [1, 3, H, W]), mask: new ort.Tensor('uint8', mask, [1, 1, H, W]) })).result.data;
  for (let i = 0; i < N; i++) if (!mask[i]) { D[i * 4] = outM[i]; D[i * 4 + 1] = outM[N + i]; D[i * 4 + 2] = outM[2 * N + i]; D[i * 4 + 3] = 255; hole[i] = 0; }
  for (const g of mine) areas.push({ x: g.x0, y: g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0, by: 'migan' });
  found.filledSmall = mine.length;
  try { await mg.release(); } catch (_) { /* freed on exit */ }
}
session = await ort.InferenceSession.create(path.join(here, 'lama.onnx'), { graphOptimizationLevel: 'all' });
for (const g of groups) {
  const gw = g.x1 - g.x0, gh = g.y1 - g.y0;
  let any = false; for (let y = g.y0; y < g.y1 && !any; y++) for (let x = g.x0; x < g.x1; x++) if (hole[y * W + x]) { any = true; break; }
  if (!any) continue;
  const side = Math.min(Math.max(S, Math.round(Math.max(gw, gh) * 1.6)), Math.max(W, H));
  const ww = Math.min(W, side), wh = Math.min(H, side);
  const wx = Math.max(0, Math.min(W - ww, Math.round(g.x0 + gw / 2 - ww / 2)));
  const wy = Math.max(0, Math.min(H - wh, Math.round(g.y0 + gh / 2 - wh / 2)));
  const image = new Float32Array(3 * S * S), mask = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const sy0 = wy + (y * wh) / S, sy1 = wy + ((y + 1) * wh) / S;
    for (let x = 0; x < S; x++) {
      const sx0 = wx + (x * ww) / S, sx1 = wx + ((x + 1) * ww) / S;
      let r = 0, gg = 0, b = 0, n = 0, m = 0;
      for (let yy = Math.floor(sy0); yy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)) && yy < H; yy++) {
        for (let xx = Math.floor(sx0); xx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)) && xx < W; xx++) { const i = (yy * W + xx) * 4; r += D[i]; gg += D[i + 1]; b += D[i + 2]; n++; if (hole[yy * W + xx]) m = 1; }
      }
      const o = y * S + x;
      if (m) { mask[o] = 1; continue; }
      image[o] = r / n / 255; image[S * S + o] = gg / n / 255; image[2 * S * S + o] = b / n / 255;
    }
  }
  const out = (await session.run({ image: new ort.Tensor('float32', image, [1, 3, S, S]), mask: new ort.Tensor('float32', mask, [1, 1, S, S]) })).output.data;
  let peak = 0; for (let i = 0; i < out.length; i += 97) if (out[i] > peak) peak = out[i];
  const k = peak > 2 ? 1 : 255; // the export answers in 0..255 or 0..1: read which from what it gave
  // only this group's own erased pixels take the model's colours (other erased areas in the window stay masked and are filled in their own window), 3 px around blend
  const px0 = Math.max(wx, g.x0 - 3), px1 = Math.min(wx + ww, g.x1 + 3), py0 = Math.max(wy, g.y0 - 3), py1 = Math.min(wy + wh, g.y1 + 3);
  const inG = (x, y) => x >= g.x0 && x < g.x1 && y >= g.y0 && y < g.y1;
  for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) {
    const p = y * W + x;
    let wgt = hole[p] && inG(x, y) ? 1 : 0;
    if (!wgt) {
      let near = 99;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (inG(xx, yy) && hole[yy * W + xx]) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy))); }
      if (near > 3) continue;
      wgt = 1 - near / 4;
    }
    const fx = ((x - wx + 0.5) * S) / ww - 0.5, fy = ((y - wy + 0.5) * S) / wh - 0.5;
    const x0 = Math.max(0, Math.min(S - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(S - 1, Math.floor(fy)));
    const x1 = Math.min(S - 1, x0 + 1), y1 = Math.min(S - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
    for (let c = 0; c < 3; c++) {
      const P = (yy, xx) => out[c * S * S + yy * S + xx];
      const v = ((P(y0, x0) * (1 - tx) + P(y0, x1) * tx) * (1 - ty) + (P(y1, x0) * (1 - tx) + P(y1, x1) * tx) * ty) * k;
      D[p * 4 + c] = Math.max(0, Math.min(255, Math.round(D[p * 4 + c] * (1 - wgt) + v * wgt)));
    }
    D[p * 4 + 3] = 255;
  }
  for (let y = g.y0; y < g.y1; y++) hole.fill(0, y * W + g.x0, y * W + g.x1);
  areas.push({ x: g.x0, y: g.y0, w: gw, h: gh });
}
fs.writeFileSync(a2, PNG.sync.write(src));
found.shapeBoxes = found.shapeBoxes.slice(0, 40);
await say({ ok: true, filled: areas.length, areas: areas.slice(0, 60), found, photo });
