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
//   lines of text: from each letter-sized shape found, along its own rows while ink continues close by and the rows above and below stay quiet (a photo's
//     texture goes on above and below a row; a line of text has its leading). A small flat shape is a letter only with two more of its height on its rows.
// WHAT IT CANNOT FIND ON ITS OWN: a photographic thing placed on the background with no flat part (a cut-out person, a product shot): box it or pass its mask.
// Each group of erased areas is filled in a square window of its surroundings (at least 512 px, scaled to 512), and only the erased pixels are put back, with a
// soft edge: the rest of the picture keeps its own pixels and its full resolution.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
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
const found = { shapes: 0, shapeBoxes: [], textRuns: 0, boxes: 0, masked: 0, spills: 0, lines: { rows: [], cols: [] } };
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

// 2. design shapes: regions of one colour (union-find over neighbours within 6 levels)
if (auto) {
  const parent = new Int32Array(N); for (let i = 0; i < N; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x + 1 < W && step(i, i + 1) <= 6) join(i, i + 1); if (y + 1 < H && step(i, i + W) <= 6) join(i, i + W); }
  const root = new Int32Array(N); for (let i = 0; i < N; i++) root[i] = find(i);
  const stats = new Map();
  for (let i = 0; i < N; i++) {
    const r = root[i]; let s = stats.get(r);
    if (!s) { s = { n: 0, x0: W, y0: H, x1: -1, y1: -1, s: [0, 0, 0], q: [0, 0, 0], edge: 0, sharp: 0 }; stats.set(r, s); }
    const x = i % W, y = (i - x) / W;
    s.n++; if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
    for (let c = 0; c < 3; c++) { const v = D[i * 4 + c]; s.s[c] += v; s.q[c] += v * v; }
    // sharp over two pixels: an anti-aliased edge (a letter, a rounded card) steps a little to its first blended pixel and fully by the second; a photo's soft
    // edge does not get there in two (one pixel alone missed every card and button with text in it, 2026-11-13)
    if (x > 0 && root[i - 1] !== r) { s.edge++; if (Math.max(step(i, i - 1), x > 1 ? step(i, i - 2) : 0) >= 24) s.sharp++; }
    if (x + 1 < W && root[i + 1] !== r) { s.edge++; if (Math.max(step(i, i + 1), x + 2 < W ? step(i, i + 2) : 0) >= 24) s.sharp++; }
    if (y > 0 && root[i - W] !== r) { s.edge++; if (Math.max(step(i, i - W), y > 1 ? step(i, i - 2 * W) : 0) >= 24) s.sharp++; }
    if (y + 1 < H && root[i + W] !== r) { s.edge++; if (Math.max(step(i, i + W), y + 2 < H ? step(i, i + 2 * W) : 0) >= 24) s.sharp++; }
  }
  const MAX = N * 0.25;
  const flat = [];
  for (const [, s] of stats) {
    if (s.n < 12 || s.n > MAX || !s.edge) continue;
    let spread = 0; for (let c = 0; c < 3; c++) spread = Math.max(spread, Math.sqrt(Math.max(0, s.q[c] / s.n - (s.s[c] / s.n) ** 2)));
    if (spread > 4 || s.sharp / s.edge < 0.5) continue;
    const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
    if (bw * bh > s.n * 8 && Math.min(bw, bh) > 40) continue; // a long thin diagonal: its box would take the photo with it
    flat.push({ ...s, bw, bh, small: s.n < 300 && Math.max(bw, bh) < 60 });
  }
  // A small flat shape is a letter only in a row of letters: two more of a like height on the same rows within three heights. A photo's small flat things (a far
  // mast, a pole, a bird) stand alone (2026-11-13: the far turbines on the hero's hills were taken as shapes and erased). A large one (a button, a card) counts alone.
  const smalls = flat.filter((f) => f.small);
  for (const f of flat) {
    if (f.small) {
      const cy = (f.y0 + f.y1) / 2, h = f.bh;
      let mates = 0;
      for (const o of smalls) {
        if (o === f || o.bh < h * 0.5 || o.bh > h * 2) continue;
        if (Math.abs((o.y0 + o.y1) / 2 - cy) > h * 0.35) continue;
        const gapX = Math.max(o.x0 - f.x1, f.x0 - o.x1);
        if (gapX <= h * 3) { mates++; if (mates >= 2) break; }
      }
      if (mates < 2) continue;
    }
    found.shapes++;
    const b = eraseBox(f.x0, f.y0, f.x1 + 1, f.y1 + 1);
    if (b && f.bw * f.bh > 2000) found.shapeBoxes.push({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
  }
}
// 2b. lines of text: letters come in lines. A letter-sized shape found above leads along its own rows, left and right, while there is ink close by (a gap of at
//     most one and a half letter heights, at most 30 heights each way), so the letters the flat test missed (thin strokes, small sizes) go with the ones it found.
{
  const letters = areasErased.filter((b) => { const h = b.y1 - b.y0, w = b.x1 - b.x0; return h >= 6 && h <= 140 && w <= h * 3 + 20; });
  const colInk = (x, y0, y1) => { for (let y = y0; y < y1; y++) if (edge[y * W + x]) return true; return false; };
  // a line of text has quiet rows above and below it (its leading); a photo's texture goes on above and below, and the line stops where it starts
  const busy = (x, y0, y1) => { const m = Math.max(2, Math.round((y1 - y0) * 0.4)); let n = 0; for (let y = Math.max(0, y0 - m); y < y0; y++) n += edge[y * W + x]; for (let y = y1; y < Math.min(H, y1 + m); y++) n += edge[y * W + x]; return n > 1; };
  let lines = 0;
  for (const g of letters) {
    const h = g.y1 - g.y0, gapMax = Math.ceil(h * 1.5), far = h * 30;
    let right = g.x1 - 1, gap = 0, rough = 0;
    for (let x = g.x1; x < W && x < g.x1 + far && gap <= gapMax; x++) { if (busy(x, g.y0, g.y1)) { if (++rough >= 3) break; } else rough = 0; if (colInk(x, g.y0, g.y1)) { right = x; gap = 0; } else gap++; }
    let left = g.x0, gap2 = 0; rough = 0;
    for (let x = g.x0 - 1; x >= 0 && x > g.x0 - far && gap2 <= gapMax; x--) { if (busy(x, g.y0, g.y1)) { if (++rough >= 3) break; } else rough = 0; if (colInk(x, g.y0, g.y1)) { left = x; gap2 = 0; } else gap2++; }
    // the line takes some of its quiet rows above and below too: the dots of i and j, accents and the tops of taller letters sit there (only rows that are quiet
    // along the line: a photo above the line is not taken)
    let top = g.y0, bottom = g.y1;
    const quietRow = (y) => { let n = 0; for (let x = left; x <= right; x++) n += edge[y * W + x]; return n <= Math.max(2, (right - left + 1) * 0.15); };
    for (let k = 1; k <= Math.round(h * 0.45) && g.y0 - k >= 0; k++) { if (!quietRow(g.y0 - k) && k > Math.round(h * 0.45)) break; top = g.y0 - k; }
    for (let k = 0; k < Math.round(h * 0.3) && g.y1 + k < H; k++) bottom = g.y1 + k + 1;
    const busyAbove = (() => { let n = 0; for (let y = Math.max(0, top - Math.round(h * 0.3)); y < top; y++) for (let x = left; x <= right; x++) n += edge[y * W + x]; return n > (right - left + 1) * 0.3; })();
    if (busyAbove) top = g.y0;
    if (right > g.x1 - 1 || left < g.x0 || top < g.y0) { eraseBox(left, top, right + 1, bottom, 1); lines++; }
  }
  found.textRuns = lines;
}
// 3. the caller's boxes and exact shapes
for (const b of boxes) { const n = [b.x, b.y, b.w, b.h].map(Number); if (n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 && eraseBox(n[0], n[1], n[0] + n[2], n[1] + n[3])) found.boxes++; }
if (extra) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) if (extra[i * 4] > 127) { const x = i % W, y = (i - x) / W; for (let dy = -GROW; dy <= GROW; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; hole.fill(1, yy * W + Math.max(0, x - GROW), yy * W + Math.min(W, x + GROW + 1)); } if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 >= 0) { areasErased.push({ x0: Math.max(0, x0 - GROW), y0: Math.max(0, y0 - GROW), x1: Math.min(W, x1 + GROW + 1), y1: Math.min(H, y1 + GROW + 1) }); found.masked = 1; }
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
const ort = await import('onnxruntime-node');
session = await ort.InferenceSession.create(path.join(here, 'lama.onnx'), { graphOptimizationLevel: 'all' });
const areas = [];
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
await say({ ok: true, filled: areas.length, areas: areas.slice(0, 60), found });
