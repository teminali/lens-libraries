// What is in a picture, read before any work on it: how much of it is photograph (photo_area.mjs) and the images a trained UI-element detector finds in it
// (ui_elements.mjs: photos, avatars, logos, icons, drawings). About a second; no picture is written. For a caller that plans its work from it (a copy of a
// design takes its photographs first and writes its page once), and for anything else that needs to know what a picture holds.
//
//   node inventory.mjs <in.png>
//   -> {"ok":true,"width":W,"height":H,"photo":{share,largest,box,flat},"images":[{x,y,w,h,score}],"cut":[{edge,x,y,w,h}]}
//   cut: words the picture's own edge cuts through (a screenshot that ends in the middle of a line): PP-OCRv5 in a strip along each edge, kept where the letters'
//   ink reaches the edge's last rows (or columns). The screenshot ends there; the design does not.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { photoArea } from './photo_area.mjs';
import { uiElements } from './ui_elements.mjs';
import { textBoxes } from './text_mask.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const answer = (o, code = 0) => { console.log(JSON.stringify(o)); process.exitCode = code; };
async function main() {
  const file = process.argv[2];
  if (!file) return answer({ ok: false, why: 'usage: inventory.mjs in.png' }, 2);
  let src;
  try { src = PNG.sync.read(fs.readFileSync(file)); } catch (e) { return answer({ ok: false, why: `the picture could not be read: ${e && e.message}` }, 2); }
  const W = src.width, H = src.height, N = W * H, D = src.data;
  const photo = photoArea(D, W, H);
  const images = [];
  if (fs.existsSync(path.join(here, 'ui_elements.onnx'))) {
    const ort = await import('onnxruntime-node');
    const ses = await ort.InferenceSession.create(path.join(here, 'ui_elements.onnx'), { graphOptimizationLevel: 'all' });
    const found = await uiElements(ort, ses, D, W, H);
    try { await ses.release(); } catch (_) { /* freed on exit */ }
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    for (const e of found) {
      if (e.kind !== 'image' || e.w * e.h > N * 0.25) continue;
      if (images.some((p) => overlap(p, e) > Math.min(p.w * p.h, e.w * e.h) * 0.5)) continue;
      images.push({ x: e.x, y: e.y, w: e.w, h: e.h, score: e.score });
    }
    images.splice(16);
    images.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y));
  }
  const cut = [];
  if (fs.existsSync(path.join(here, 'ppocr_det.onnx'))) {
    const ort = await import('onnxruntime-node');
    const det = await ort.InferenceSession.create(path.join(here, 'ppocr_det.onnx'), { graphOptimizationLevel: 'all' });
    const L = (x, y) => { const i = (y * W + x) * 4; return 0.299 * D[i] + 0.587 * D[i + 1] + 0.114 * D[i + 2]; };
    // ink: a pixel 28+ levels from the mean of its 41-px run along the edge (letters have it; a sky or a flat panel does not)
    const inkAlong = (pts) => { let n = 0; for (let k = 0; k < pts.length; k++) { let s = 0, c = 0; for (let j = Math.max(0, k - 20); j < Math.min(pts.length, k + 21); j++) { s += pts[j]; c++; } if (Math.abs(pts[k] - s / c) > 28) n++; } return n; };
    const s = Math.min(Math.min(W, H), Math.max(96, Math.round(Math.min(W, H) * 0.12)));
    const strips = [
      { edge: 'bottom', x: 0, y: H - s, w: W, h: s }, { edge: 'top', x: 0, y: 0, w: W, h: s },
      { edge: 'right', x: W - s, y: 0, w: s, h: H }, { edge: 'left', x: 0, y: 0, w: s, h: H }
    ];
    for (const st of strips) {
      const rgba = new Uint8Array(st.w * st.h * 4);
      for (let y = 0; y < st.h; y++) D.copy(rgba, y * st.w * 4, ((st.y + y) * W + st.x) * 4, ((st.y + y) * W + st.x + st.w) * 4);
      for (const b of await textBoxes(ort, det, rgba, st.w, st.h)) {
        const bx = st.x + b.x, by = st.y + b.y;
        // the word's own box reaches the edge (a whole line just above a cut one does not), and its letters' ink is in the edge's last row or column
        const reaches = st.edge === 'bottom' ? by + b.h >= H - 2 : st.edge === 'top' ? by <= 1 : st.edge === 'right' ? bx + b.w >= W - 2 : bx <= 1;
        if (!reaches) continue;
        let pts = [];
        if (st.edge === 'bottom' || st.edge === 'top') { const row = st.edge === 'bottom' ? H - 2 : 1; for (let x = bx; x < bx + b.w; x++) pts.push(L(x, row)); }
        else { const col = st.edge === 'right' ? W - 2 : 1; for (let y = by; y < by + b.h; y++) pts.push(L(col, y)); }
        if (pts.length >= 8 && inkAlong(pts) >= Math.max(3, pts.length * 0.03)) cut.push({ edge: st.edge, x: bx, y: by, w: b.w, h: b.h });
      }
    }
    try { await det.release(); } catch (_) { /* freed on exit */ }
  }
  return answer({ ok: true, width: W, height: H, photo, images, cut: cut.slice(0, 8) });
}
await main();
