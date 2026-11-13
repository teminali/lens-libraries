// The elements of a UI in a picture: a trained detector (RF-DETR medium fine-tuned on mobile UI designs, merve/rf-detr-mobile-ui, Apache-2.0, model and data;
// engine/ui_elements.onnx, exported from its safetensors at 576 x 576) that boxes four kinds of element: an image (a photo, an avatar, an illustration, a logo),
// a rectangle (a card, a button, a field), a group (a card with its contents, a row) and text. Its boxes are the elements a page places; whether an image is a
// photograph is not its call (photo_area.mjs judges the pixels).
//
//   uiElements(ort, session, rgba, W, H, { thresh }) -> [{ kind, x, y, w, h, score }]   (boxes in the picture's pixels)
//
// Input: the picture resized to 576 x 576 (PIL's antialiased bilinear filter), RGB scaled to 0..1, ImageNet mean
// and std. Output: 300 queries, each with 4 class logits (sigmoid) and a box (centre x, centre y, width, height, as parts of the picture). DETR boxes need no
// suppression of duplicates; a query whose best class scores over `thresh` is an element. Checked 2026-11-13 on 9 pictures (dashboards, chats, landing pages, a
// console): the ONNX file finds what the torch model finds (812 of 812), and this resize gives PIL's pixels within one level, so only a detection right at the
// threshold can differ.
const SIZE = 576;
const KINDS = ['group', 'image', 'rectangle', 'text'];

export async function uiElements(ort, session, rgba, W, H, { thresh = 0.3 } = {}) {
  const N = SIZE * SIZE;
  const x = new Float32Array(3 * N);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  // PIL's antialiased bilinear resize (Image.resize BILINEAR), separable: each output pixel takes the input pixels within `scale` of its centre, weighted by a triangle
  // of that width (the preprocessing the model was checked with)
  const weights = (inLen) => {
    const scale = inLen / SIZE, support = Math.max(1, scale), list = [];
    for (let o = 0; o < SIZE; o++) {
      const centre = (o + 0.5) * scale, lo = Math.max(0, Math.floor(centre - support)), hi = Math.min(inLen, Math.ceil(centre + support));
      const idx = [], w = []; let sum = 0;
      for (let i = lo; i < hi; i++) { const t = Math.max(0, 1 - Math.abs((i + 0.5 - centre) / Math.max(1, scale))); if (t > 0) { idx.push(i); w.push(t); sum += t; } }
      list.push({ idx, w: w.map((v) => v / sum) });
    }
    return list;
  };
  const wx = weights(W), wy = weights(H);
  const rows = new Float32Array(3 * SIZE * H); // horizontal pass: H rows of SIZE
  for (let y = 0; y < H; y++) for (let ox = 0; ox < SIZE; ox++) {
    const { idx, w } = wx[ox]; let r = 0, g = 0, b = 0;
    for (let k = 0; k < idx.length; k++) { const i = (y * W + idx[k]) * 4; r += rgba[i] * w[k]; g += rgba[i + 1] * w[k]; b += rgba[i + 2] * w[k]; }
    const j = (y * SIZE + ox) * 3; rows[j] = Math.min(255, Math.max(0, Math.round(r))); rows[j + 1] = Math.min(255, Math.max(0, Math.round(g))); rows[j + 2] = Math.min(255, Math.max(0, Math.round(b)));
  }
  for (let oy = 0; oy < SIZE; oy++) {
    const { idx, w } = wy[oy];
    for (let ox = 0; ox < SIZE; ox++) {
      const s = [0, 0, 0];
      for (let k = 0; k < idx.length; k++) { const j = (idx[k] * SIZE + ox) * 3; s[0] += rows[j] * w[k]; s[1] += rows[j + 1] * w[k]; s[2] += rows[j + 2] * w[k]; }
      // PIL rounds each pass to 8 bits
      for (let c = 0; c < 3; c++) x[c * N + oy * SIZE + ox] = (Math.min(255, Math.max(0, Math.round(s[c]))) / 255 - mean[c]) / std[c];
    }
  }
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, SIZE, SIZE]) });
  const logits = res[session.outputNames[0]], boxes = res[session.outputNames[1]];
  const Q = logits.dims[1], C = logits.dims[2];
  const out = [];
  for (let q = 0; q < Q; q++) {
    let best = 0, p = -Infinity;
    for (let c = 0; c < C; c++) { const v = logits.data[q * C + c]; if (v > p) { p = v; best = c; } }
    const score = 1 / (1 + Math.exp(-p));
    if (score <= thresh) continue;
    const [cx, cy, bw, bh] = boxes.data.slice(q * 4, q * 4 + 4);
    const bx = Math.max(0, Math.round((cx - bw / 2) * W)), by = Math.max(0, Math.round((cy - bh / 2) * H));
    const ex = Math.min(W, Math.round((cx + bw / 2) * W)), ey = Math.min(H, Math.round((cy + bh / 2) * H));
    if (ex - bx < 2 || ey - by < 2) continue;
    out.push({ kind: KINDS[best] || String(best), x: bx, y: by, w: ex - bx, h: ey - by, score: Math.round(score * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score);
}
