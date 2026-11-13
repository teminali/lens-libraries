// What is in a picture, read before any work on it: how much of it is photograph (photo_area.mjs) and the images a trained UI-element detector finds in it
// (ui_elements.mjs: photos, avatars, logos, icons, drawings). About a second; no picture is written. For a caller that plans its work from it (a copy of a
// design takes its photographs first and writes its page once), and for anything else that needs to know what a picture holds.
//
//   node inventory.mjs <in.png>
//   -> {"ok":true,"width":W,"height":H,"photo":{share,largest,box,flat},"images":[{x,y,w,h,score}]}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { photoArea } from './photo_area.mjs';
import { uiElements } from './ui_elements.mjs';

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
  return answer({ ok: true, width: W, height: H, photo, images });
}
await main();
