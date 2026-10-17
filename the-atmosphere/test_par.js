const { makeEarth, initState, gmean } = require('./earth.js');
const W = +process.argv[2] || 4, N = +process.argv[3] || 60;
const ref = makeEarth(); ref.ph.sstMode = true; initState(ref, 0);
const co = makeEarth(); co.ph.sstMode = true; initState(co, 0);
const ws = []; const nh = co.md.nlat >> 1;
for (let w = 0; w < W; w++) { const e = makeEarth(); e.ph.sstMode = true; initState(e, 0); e.md.setPairs(Math.floor(w * nh / W), Math.floor((w + 1) * nh / W)); ws.push(e); }
const vars = ['Z', 'D', 'T', 'Q', 'LP'];
let t0 = performance.now();
for (let s = 0; s < N; s++) ref.md.step();
const tr = performance.now() - t0; t0 = performance.now();
for (let s = 0; s < N; s++) {
  const tend = co.md.tend; for (const k in tend) { tend[k].re.fill(0); tend[k].im.fill(0); }
  for (const e of ws) {
    for (const v of vars) { e.md[v][1].re.set(co.md[v][1].re); e.md[v][1].im.set(co.md[v][1].im); }
    e.md.time = co.md.time; e.md.first = co.md.first;
    e.md.gridStage();
    for (const k in tend) { const a = tend[k], b = e.md.tend[k]; for (let i = 0; i < a.re.length; i++) { a.re[i] += b.re[i]; a.im[i] += b.im[i]; } }
  }
  co.md.advance();
}
console.log(`single ${tr.toFixed(0)} ms, split ${(performance.now() - t0).toFixed(0)} ms (sequential)`);
let e = 0, m = 0; for (const v of vars) { const a = ref.md[v][1].re, b = co.md[v][1].re; for (let i = 0; i < a.length; i++) { e = Math.max(e, Math.abs(a[i] - b[i])); m = Math.max(m, Math.abs(a[i])); } }
console.log('max state diff', e.toExponential(2), 'scale', m.toExponential(2));
// surface fields: gather from workers' rows
let es = 0; for (const e2 of ws) for (const j of e2.md.rows) for (let i = 0; i < e2.md.nlon; i++) { const p = j * e2.md.nlon + i; es = Math.max(es, Math.abs(e2.ph.Ts[p] - ref.ph.Ts[p])); }
console.log('max Ts diff', es.toExponential(2));
