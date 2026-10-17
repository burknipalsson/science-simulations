// test composition order on the Kepler problem
const W8 = [0.102799849391985, -1.96061023297549, 1.93813913762276, -0.158240635368243, -1.44485223686048, 0.253693336566229, 0.914844246229740];
const W6 = [-1.17767998417887, 0.235573213359357, 0.784513610477560];
function seq(W, rev) { const w0 = 1 - 2 * W.reduce((a, b) => a + b, 0); const a = rev ? W.slice().reverse() : W.slice(); return [...a.slice().reverse(), w0, ...a]; }
function run(ws, h, T) {
  let x = 1, y = 0, vx = 0, vy = 1.3; // e ~ 0.69
  const n = Math.round(T / h);
  for (let s = 0; s < n; s++) for (const w of ws) {
    const d = w * h; x += vx * d / 2; y += vy * d / 2;
    const r3 = Math.pow(x * x + y * y, 1.5); vx -= x / r3 * d; vy -= y / r3 * d;
    x += vx * d / 2; y += vy * d / 2;
  }
  return [x, y];
}
for (const [nm, W] of [['y6', W6], ['y8', W8]]) for (const rev of [false, true]) {
  const ws = seq(W, rev); const ref = run(ws, 0.0005, 20);
  const e = [0.2, 0.1, 0.05].map(h => { const p = run(ws, h, 20); return Math.hypot(p[0] - ref[0], p[1] - ref[1]); });
  console.log(nm, rev, e.map(v => v.toExponential(2)).join(' '), 'order', Math.log2(e[0] / e[1]).toFixed(2), Math.log2(e[1] / e[2]).toFixed(2));
}
