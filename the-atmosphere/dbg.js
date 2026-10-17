const { makeEarth, initState, gmean } = require('./earth.js');
const E = makeEarth(); const { md, ph, S } = E;
ph.sstMode = true; initState(E, 0);
for (let s = 0; s < 40; s++) {
  md.step();
  const bad = (a, n) => { for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) return `${n}[${i}] lev ${Math.floor(i / md.nG)} p ${i % md.nG}`; return null; };
  const r = bad(md.pT, 'pT') || bad(md.pQ, 'pQ') || bad(md.pU, 'pU') || bad(ph.Ts, 'Ts') || bad(md.TG, 'TG') || bad(md.U, 'U');
  let mx = 0, mq = 0; for (let q = 0; q < md.pT.length; q++) { mx = Math.max(mx, Math.abs(md.pT[q])); }
  console.log(s, r, 'max|pT| K/day', (mx * 86400).toFixed(1), 'Ts range', Math.min(...ph.Ts).toFixed(0), Math.max(...ph.Ts).toFixed(0));
  if (r) { const p = +r.split(' p ')[1]; console.log('land', ph.land[p], 'zs', ph.zs[p], 'Ts', ph.Ts[p], 'ps', Math.exp(md.LPp[p])); for (let k = 0; k < md.L; k++) console.log(k, (md.Tp[k*md.nG+p]+md.T0).toFixed(1), md.Qp[k*md.nG+p].toExponential(2), md.pT[k*md.nG+p]); break; }
}
