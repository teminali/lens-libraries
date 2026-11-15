// Where the words of a picture are, all of them: PP-OCRv5 text detection (text_mask.mjs textBoxes, engine/ppocr_det.onnx) over the whole picture (a large one
// at half size, below), so a design's small text is found as well as its headline. A design reader needs this before it reads shapes: a letter's bowl or a word's ink is
// not a card or a button (Lens Code's design model drops what lies inside a word, and reads text as lines of their own). No file is written.
//
//   node words.mjs <in.png>
//   -> {"ok":true,"width":W,"height":H,"words":[{x,y,w,h,score}],"ms":N}
//   a box is one word or one line, as the detector joins them, grown to hold its letters whole (DBNet's unclip, as textBoxes grows it).
//   A picture whose longest side passes MAX_SIDE is read at half size (boxes given at full size): four to five times faster (a 2048 x 1536 design: 10 s
//   against 2.5 s), and every word found at full size is still inside a box (half size joins a line's words into one box).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { textBoxes } from './text_mask.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_SIDE = 1600;
const MAX_WORDS = 600;
const answer = (o, code = 0) => { console.log(JSON.stringify(o)); process.exitCode = code; };

async function main() {
  const file = process.argv[2];
  if (!file) return answer({ ok: false, why: 'usage: words.mjs in.png' }, 2);
  const started = Date.now();
  let src;
  try { src = PNG.sync.read(fs.readFileSync(file)); } catch (e) { return answer({ ok: false, why: `the picture could not be read: ${e && e.message}` }, 2); }
  const model = path.join(here, 'ppocr_det.onnx');
  if (!fs.existsSync(model)) return answer({ ok: false, why: 'the text detector is not in this library' }, 1);
  const W = src.width, H = src.height;
  const k = Math.max(W, H) > MAX_SIDE ? 2 : 1;
  const w = Math.floor(W / k), h = Math.floor(H / k);
  let rgba = src.data;
  if (k > 1) {
    rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = ((y * 2 + dy) * W + x * 2 + dx) * 4; r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; }
      rgba[o] = r / 4; rgba[o + 1] = g / 4; rgba[o + 2] = b / 4; rgba[o + 3] = 255;
    }
  }
  const ort = await import('onnxruntime-node');
  const det = await ort.InferenceSession.create(model, { graphOptimizationLevel: 'all' });
  let found;
  try { found = await textBoxes(ort, det, rgba, w, h); } finally { try { await det.release(); } catch (_) { /* freed on exit */ } }
  const words = found
    .map((b) => ({ x: b.x * k, y: b.y * k, w: Math.min(W - b.x * k, b.w * k), h: Math.min(H - b.y * k, b.h * k), score: Math.round(b.score * 1000) / 1000 }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, MAX_WORDS);
  return answer({ ok: true, width: W, height: H, words, ms: Date.now() - started });
}
await main();
