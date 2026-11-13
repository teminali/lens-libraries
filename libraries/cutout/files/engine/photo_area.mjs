// How much of a picture is photographic, and where: the test the plate makes before it fills anything (a UI screenshot has no photo behind its panels, and a "clean
// plate" of one is grey mush that a page must not use).
//
//   photoArea(D, W, H) -> { share, largest, box: { x, y, w, h } | null, flat: [{ hex, share }], shareIn(rect) -> 0..1 }
//     share: the part of the picture in photographic cells; largest: the part in the biggest connected piece of them (box: its box); flat: the colours of the
//     exactly flat paint, most used first, each with its part of the picture.
//
// The picture is read in 16 x 16 cells. A cell with no hard step (no neighbour 12+ levels of brightness apart) is smooth; a smooth cell is flat paint when its pixels
// sit on the mean of their 3 x 3 neighbourhood (mean distance under 0.05 levels: a UI fills its surfaces with one exact colour, even after PNG or WebP export) and alive
// otherwise (a photo and a rendered gradient have grain: sky, skin, cloud, mist). A hard cell between two or more alive cells is the photo's own texture. Measured on
// 2026-11-13 over 9 pictures: interface screens (dashboards, chats, an inbox, a console, two of them on a laptop photo) have their largest photographic piece at 0.1 to
// 10.3% of the picture; landing pages whose background is a photo at 50.9 and 55.6%.
const CELL = 16;
export function photoArea(D, W, H) {
  const L = (x, y) => { const i = (y * W + x) * 4; return 0.299 * D[i] + 0.587 * D[i + 1] + 0.114 * D[i + 2]; };
  const GW = Math.floor((W - 2) / CELL), GH = Math.floor((H - 2) / CELL), G = GW * GH;
  if (G < 4) return { share: 0, largest: 0, box: null, flat: [], shareIn: () => 0 };
  const kind = new Uint8Array(G); // 0 hard, 1 flat paint, 2 alive
  const paint = new Map();
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const cx = 1 + gx * CELL, cy = 1 + gy * CELL; let hard = false, g = 0, n = 0;
    for (let y = cy; y < cy + CELL && !hard; y++) for (let x = cx; x < cx + CELL; x++) {
      const v = L(x, y);
      if (Math.abs(v - L(x + 1, y)) > 12 || Math.abs(v - L(x, y + 1)) > 12) { hard = true; break; }
      let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += L(x + dx, y + dy);
      g += Math.abs(v - m / 9); n++;
    }
    const k = gy * GW + gx;
    kind[k] = hard ? 0 : g / n < 0.05 ? 1 : 2;
    if (kind[k] === 1) {
      const i = ((cy + CELL / 2) * W + cx + CELL / 2) * 4;
      const key = ((D[i] >> 2) << 12) | ((D[i + 1] >> 2) << 6) | (D[i + 2] >> 2);
      const p = paint.get(key) || { n: 0, r: D[i], g: D[i + 1], b: D[i + 2] }; p.n++; paint.set(key, p);
    }
  }
  const photo = new Uint8Array(G);
  const near = (k, want) => { const x = k % GW, y = (k - x) / GW; let a = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < GW && yy < GH && kind[yy * GW + xx] === want) a++; } return a; };
  for (let k = 0; k < G; k++) photo[k] = kind[k] === 2 || (kind[k] === 0 && near(k, 2) >= 2) ? 1 : 0;
  const seen = new Uint8Array(G); let total = 0, best = 0, box = null;
  for (let k = 0; k < G; k++) {
    if (!photo[k] || seen[k]) continue;
    const stack = [k]; seen[k] = 1; let n = 0, x0 = GW, y0 = GH, x1 = 0, y1 = 0;
    while (stack.length) {
      const j = stack.pop(); n++; const x = j % GW, y = (j - x) / GW;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue; const q = yy * GW + xx; if (photo[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    total += n;
    if (n > best) { best = n; box = { x: 1 + x0 * CELL, y: 1 + y0 * CELL, w: (x1 - x0 + 1) * CELL, h: (y1 - y0 + 1) * CELL }; }
  }
  const hex = (p) => '#' + [p.r, p.g, p.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const flat = [...paint.values()].sort((a, b) => b.n - a.n).slice(0, 6).filter((p) => p.n / G >= 0.01).map((p) => ({ hex: hex(p), share: Math.round((1000 * p.n) / G) / 10 }));
  // the part of a rectangle that is photographic (cells it covers): an element of the design that is a photo has most of it
  const shareIn = (r) => {
    const gx0 = Math.max(0, Math.floor((r.x - 1) / CELL)), gy0 = Math.max(0, Math.floor((r.y - 1) / CELL)), gx1 = Math.min(GW - 1, Math.floor((r.x + r.w - 2) / CELL)), gy1 = Math.min(GH - 1, Math.floor((r.y + r.h - 2) / CELL));
    let n = 0, p = 0; for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { n++; p += photo[gy * GW + gx]; }
    return n ? p / n : 0;
  };
  return { share: Math.round((1000 * total) / G) / 10, largest: Math.round((1000 * best) / G) / 10, box, flat, shareIn };
}
