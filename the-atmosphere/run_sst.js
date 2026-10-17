const { makeEarth, initState, gmean } = require('./earth.js');
const days = +process.argv[2] || 30;
const E = makeEarth(); const { md, ph, S } = E;
ph.sstMode = true;
initState(E, 0);
const perDay = 86400 / md.dt; let t0 = performance.now();
const accP = new Float64Array(md.nG);
for (let d = 0; d < days; d++) {
  ph.setMonth(d % 365.2422);
  accP.fill(0);
  for (let s = 0; s < perDay; s++) { md.step(); for (let p = 0; p < md.nG; p++) accP[p] += ph.prec[p] / perDay; }
  let umax = 0; for (let q = 0; q < md.U.length; q++) umax = Math.max(umax, Math.abs(md.U[q]));
  if (!isFinite(umax)) { console.log('BLOWUP day', d); break; }
  const P = gmean(E, accP) * 86400, Pc = gmean(E, ph.precConv) * 86400;
  console.log(`day ${d + 1}: Ts ${gmean(E, ph.Ts).toFixed(1)} t2 ${gmean(E, ph.t2).toFixed(1)} P ${P.toFixed(2)} mm/d (conv ${Pc.toFixed(2)}) E ${(gmean(E, ph.evap) * 86400).toFixed(2)} OLR ${gmean(E, ph.olr).toFixed(0)} SWsfc ${gmean(E, ph.swsfc).toFixed(0)} SH ${gmean(E, ph.shf).toFixed(0)} PW ${gmean(E, ph.pw).toFixed(1)} umax ${umax.toFixed(0)} ${((performance.now() - t0) / ((d + 1) * perDay)).toFixed(1)}ms/step`);
}
module.exports = E;
