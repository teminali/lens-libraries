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

export function designShapes(D, W, H) {
  const N = W * H;
  const step = (i, j) => Math.max(Math.abs(D[i * 4] - D[j * 4]), Math.abs(D[i * 4 + 1] - D[j * 4 + 1]), Math.abs(D[i * 4 + 2] - D[j * 4 + 2]));
  const parent = new Int32Array(N); for (let i = 0; i < N; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (x + 1 < W && step(i, i + 1) <= 6) join(i, i + 1); if (y + 1 < H && step(i, i + W) <= 6) join(i, i + W); }
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
    if (spread > 4 || s.sharp / s.edge < 0.5) continue;
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
  return { shapes: shapes.map(({ r, small, ...rest }) => rest), label };
}
