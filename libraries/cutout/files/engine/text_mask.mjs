// Where the words of a picture are: PP-OCRv5 text detection (PaddleOCR, Apache-2.0; engine/ppocr_det.onnx, the server model), run at the picture's own resolution so
// small text is not lost to the model's usual 960 px resize. One engine on every system, as the rest of this library.
//
//   textBoxes(ort, session, rgba, W, H, { thresh, boxThresh }) -> [{ x, y, w, h, score }]   (boxes in the picture's pixels, grown as DBNet's "unclip" does)
//
// The model gives a probability of text per pixel; a piece of pixels above `thresh` whose mean probability is at least `boxThresh` is a word or a line, grown by
// area x 1.5 / perimeter (DBNet's unclip ratio) so the box holds the whole of its letters. Input: BGR, scaled to 0..1, ImageNet mean and std, sides padded to 32.

export async function textBoxes(ort, session, rgba, W, H, { thresh = 0.2, boxThresh = 0.4 } = {}) {
  const PW = Math.ceil(W / 32) * 32, PH = Math.ceil(H / 32) * 32;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const x = new Float32Array(3 * PW * PH);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = (y * W + xx) * 4;
    const bgr = [rgba[i + 2], rgba[i + 1], rgba[i]];
    for (let c = 0; c < 3; c++) x[c * PW * PH + y * PW + xx] = (bgr[c] / 255 - mean[c]) / std[c];
  }
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, PH, PW]) });
  const prob = res[session.outputNames[0]].data;
  const on = new Uint8Array(PW * PH);
  for (let i = 0; i < PW * PH; i++) if (prob[i] > thresh) on[i] = 1;
  const seen = new Uint8Array(PW * PH);
  const boxes = [];
  for (let k = 0; k < PW * PH; k++) {
    if (!on[k] || seen[k]) continue;
    const stack = [k]; seen[k] = 1;
    let n = 0, sum = 0, x0 = PW, y0 = PH, x1 = -1, y1 = -1;
    while (stack.length) {
      const j = stack.pop(); n++; sum += prob[j];
      const a = j % PW, b = (j - a) / PW;
      if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
      if (a > 0 && on[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; stack.push(j - 1); }
      if (a + 1 < PW && on[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; stack.push(j + 1); }
      if (b > 0 && on[j - PW] && !seen[j - PW]) { seen[j - PW] = 1; stack.push(j - PW); }
      if (b + 1 < PH && on[j + PW] && !seen[j + PW]) { seen[j + PW] = 1; stack.push(j + PW); }
    }
    if (n < 6 || sum / n < boxThresh) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const d = Math.round((w * h * 1.5) / (2 * (w + h)));
    const bx = Math.max(0, x0 - d), by = Math.max(0, y0 - d);
    boxes.push({ x: bx, y: by, w: Math.min(W, x1 + d + 1) - bx, h: Math.min(H, y1 + d + 1) - by, score: Math.round((sum / n) * 100) / 100 });
  }
  return boxes.filter((b) => b.w > 0 && b.h > 0);
}
