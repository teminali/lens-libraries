// The design's own layer in a picture: the shapes a UI draws (a button, a card, a stroke of a letter, an icon, a ring), found by what a photograph does not have.
// One detector for both engines of the library: plate.mjs erases these shapes from a picture, and cutout.mjs keeps them out of a lifted subject.
//
// A design shape is a region of one colour (neighbours within 6 levels) whose colour hardly varies (spread 4 or less per channel), whose edge is mostly sharp (a step of
// 24+ levels within two pixels of it: anti-aliasing blends one), and which is not huge (a quarter of the picture at most). A photograph's smooth parts are shaded and
// grainy, and its edges soft. A long thin diagonal shape is left out (its box would take the photo with it), and a small shape counts only in a row of like ones:
// letters come in rows, while a photo's small flat things (a far mast, a pole, a bird) stand alone.
//
//   designShapes(D, W, H) -> { shapes: [{ x0, y0, x1, y1, n, bw, bh }], label: Int32Array (pixel -> shape index + 1, or 0) }
//   D is RGBA (W x H x 4).

// The picture's own noise: in its smooth parts, how much neighbouring pixels differ (the 75th percentile of the steps under 20). A PNG screenshot draws its UI exactly (0
// to 2); a compressed or sharpened export of a design does not (2026-11-13, the Wingly artboard: the white letters of its nav vary by 11 between neighbours, and
// none was found). The tolerances below follow it.
function noiseOf(D, W, H, step) {
  const counts = new Uint32Array(20); let total = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x + 1 < W; x += 2) { const i = y * W + x; const v = step(i, i + 1); if (v < 20) { counts[v]++; total++; } }
  let seen = 0; for (let v = 0; v < 20; v++) { seen += counts[v]; if (seen >= total * 0.75) return v; }
  return 0;
}

export function designShapes(D, W, H) {
  const N = W * H;
  const step = (i, j) => Math.max(Math.abs(D[i * 4] - D[j * 4]), Math.abs(D[i * 4 + 1] - D[j * 4 + 1]), Math.abs(D[i * 4 + 2] - D[j * 4 + 2]));
  const noise = noiseOf(D, W, H, step);
  const TOL = Math.min(16, Math.max(6, noise * 3)); // one colour: neighbours within this
  const SPREAD = Math.max(4, noise * 1.5); // and a spread within this
  const parent = new Int32Array(N); for (let i = 0; i < N; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x + 1 < W && step(i, i + 1) <= TOL) join(i, i + 1); if (y + 1 < H && step(i, i + W) <= TOL) join(i, i + W); }
  const root = new Int32Array(N); for (let i = 0; i < N; i++) root[i] = find(i);
  const stats = new Map();
  for (let i = 0; i < N; i++) {
    const r = root[i]; let s = stats.get(r);
    if (!s) { s = { r, n: 0, x0: W, y0: H, x1: -1, y1: -1, s: [0, 0, 0], q: [0, 0, 0], edge: 0, sharp: 0 }; stats.set(r, s); }
    const x = i % W, y = (i - x) / W;
    s.n++; if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
    for (let c = 0; c < 3; c++) { const v = D[i * 4 + c]; s.s[c] += v; s.q[c] += v * v; }
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
    if (spread > SPREAD || s.sharp / s.edge < 0.5) continue;
    const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
    if (bw * bh > s.n * 8 && Math.min(bw, bh) > 40) continue;
    flat.push({ r: s.r, n: s.n, x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, bw, bh, small: s.n < 300 && Math.max(bw, bh) < 60 });
  }
  const smalls = flat.filter((f) => f.small);
  const shapes = [];
  for (const f of flat) {
    if (f.small) {
      const cy = (f.y0 + f.y1) / 2, h = f.bh;
      let mates = 0;
      for (const o of smalls) {
        if (o === f || o.bh < h * 0.5 || o.bh > h * 2) continue;
        if (Math.abs((o.y0 + o.y1) / 2 - cy) > h * 0.35) continue;
        if (Math.max(o.x0 - f.x1, f.x0 - o.x1) <= h * 3) { mates++; if (mates >= 2) break; }
      }
      if (mates < 2) continue;
    }
    shapes.push(f);
  }
  const label = new Int32Array(N);
  const index = new Map(shapes.map((f, k) => [f.r, k + 1]));
  for (let i = 0; i < N; i++) { const k = index.get(root[i]); if (k) label[i] = k; }
  // Letters as ink: text on a noisy export is not flat, but its strokes stand out strongly from what is around them. Pixels 40+ levels from the mean of their 9 x 9
  // neighbourhood are ink; a piece of ink of a letter's size counts when two more of a like height stand on its rows within three heights (letters come in rows) and
  // the rows just above and below it are quiet (a line of text has its leading; a photo's texture goes on). Not already part of a shape above.
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.299 * D[i * 4] + 0.587 * D[i * 4 + 1] + 0.114 * D[i * 4 + 2];
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += lum[y * W + x]; integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row; } }
  const meanAt = (x, y, r) => { const a = Math.max(0, x - r), b = Math.max(0, y - r), c = Math.min(W, x + r + 1), d = Math.min(H, y + r + 1); return (integral[d * (W + 1) + c] - integral[b * (W + 1) + c] - integral[d * (W + 1) + a] + integral[b * (W + 1) + a]) / ((c - a) * (d - b)); };
  const ink = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(lum[y * W + x] - meanAt(x, y, 4)) > 40) ink[y * W + x] = 1;
  const seen = new Uint8Array(N); const pieces = [];
  for (let k = 0; k < N; k++) {
    if (!ink[k] || seen[k] || label[k]) continue;
    const stack = [k]; seen[k] = 1; let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1; const px = [];
    while (stack.length) {
      const j = stack.pop(); n++; px.push(j); const x = j % W, y = (j - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (n > 4000) break;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const i = yy * W + xx; if (ink[i] && !seen[i]) { seen[i] = 1; stack.push(i); } }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (n > 4000 || n < 6 || bh < 6 || bh > 80 || bw > bh * 3 + 20) continue;
    pieces.push({ n, x0, y0, x1, y1, bw, bh, px });
  }
  const quiet = (p) => { const m = Math.max(2, Math.round(p.bh * 0.35)); let busy = 0; for (const yy of [p.y0 - m, p.y1 + m]) { if (yy < 0 || yy >= H) continue; for (let x = p.x0; x <= p.x1; x++) busy += ink[yy * W + x]; } return busy <= Math.max(1, p.bw * 0.1); };
  for (const p of pieces) {
    if (!quiet(p)) continue;
    const cy = (p.y0 + p.y1) / 2; let mates = 0;
    for (const o of pieces) {
      if (o === p || o.bh < p.bh * 0.5 || o.bh > p.bh * 2 || Math.abs((o.y0 + o.y1) / 2 - cy) > p.bh * 0.35) continue;
      if (Math.max(o.x0 - p.x1, p.x0 - o.x1) <= p.bh * 3) { mates++; if (mates >= 2) break; }
    }
    if (mates < 2) continue;
    shapes.push({ r: -1, n: p.n, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, bw: p.bw, bh: p.bh, small: true, ink: true });
    for (const j of p.px) label[j] = shapes.length;
  }
  return { shapes: shapes.map(({ r, small, ...rest }) => rest), label, noise, tolerance: TOL };
}
