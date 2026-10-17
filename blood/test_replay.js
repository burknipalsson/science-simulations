// round trip of the replay frame encoding: positions to within the int16 step, interpolation across the periodic edge
const { rpEncode, rpDecode, rpEncodeTracers, rpDecodeTracers, RP_OFF } = require('./replay.js');
const nv = 50, nc = 3, nx = 200, mk = shift => {
  const pos = new Float32Array(nv * nc * 4), anc = new Float32Array(nc * 4);
  for (let c = 0; c < nc; c++) { anc.set([Math.floor((60 * c + shift) % nx), 40, 41, 0], 4 * c);
    for (let v = 0; v < nv; v++) pos.set([0.3 + 15 * Math.sin(v + c), 0.7 + 7 * Math.cos(2 * v), 0.1 + 3 * Math.sin(3 * v), 0], 4 * (c * nv + v)); }
  return { pos, anc };
};
const a = mk(10), A = rpEncode(a.pos, a.anc, nv, nc, nx, null);
const pos = new Float32Array(nv * nc * 4), anc = new Float32Array(nc * 4);
rpDecode(A, A, 0, nv, nc, nx, pos, anc);
let err = 0; for (let c = 0; c < nc; c++) for (let v = 0; v < nv; v++) for (let d = 0; d < 3; d++) {
  const x0 = a.anc[4 * c + d] + a.pos[4 * (c * nv + v) + d], x1 = anc[4 * c + d] + pos[4 * (c * nv + v) + d];
  err = Math.max(err, Math.abs(x0 - x1)); }
console.log('round trip max error', err.toExponential(2), 'lu (bound', (0.5 / RP_OFF).toExponential(2) + ')', err <= 0.5 / RP_OFF + 1e-5 ? 'OK' : 'FAIL');
// cell 2 sits at x 130; move everything +80 so it wraps past 200: the midpoint must be +40, not a jump back
const b = mk(90), B = rpEncode(b.pos, b.anc, nv, nc, nx, A);
rpDecode(A, B, 0.5, nv, nc, nx, pos, anc);
const cx = c => anc[4 * c] + [...Array(nv).keys()].reduce((s, v) => s + pos[4 * (c * nv + v)], 0) / nv;
const want = c => ((A.cen[3 * c] + 40) % nx);
console.log('wrapped midpoint', [0, 1, 2].map(c => cx(c).toFixed(3) + ' vs ' + want(c).toFixed(3)).join(', '), [0, 1, 2].every(c => Math.abs(cx(c) - want(c)) < 1e-3) ? 'OK' : 'FAIL');
// tracers: one moves, one respawns, one wraps
const tA = rpEncodeTracers(new Float32Array([10, 5, 5, 300, 50, 5, 5, 3, 199.5, 5, 5, 200])), tB = rpEncodeTracers(new Float32Array([12, 5, 5, 299, 120, 30, 9, 500, 0.5, 5, 5, 199]));
const to = new Float32Array(12); rpDecodeTracers(tA, tB, 0.5, nx, to);
console.log('tracers', Array.from(to).map(x => +x.toFixed(2)).join(' '), to[0] === 11 && to[4] === 120 && to[8] === 0.5 ? 'OK' : 'FAIL');
const { rpWindow } = require('./replay.js');
const st = [...Array(10).keys()].map(i => ({ Q: i, flux: i ? 2 * i : null, HT: 1, cfl: 2 }));
const wv = rpWindow(st, 2);
console.log('window', wv.map(r => r.Q).join(','), wv[0].Q === 2 && wv[5].Q === 5 && wv[9].Q === 7 && wv[0].HDflux === 5 ? 'OK' : 'FAIL');
