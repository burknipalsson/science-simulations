// run the Earth model and print a zonal-mean climate summary
const { makeEarth, initState, gmean } = require('./earth.js');
const fs = require('fs');
function run(opts) {
  const E = makeEarth(opts.make || {}); const { md, ph, S } = E;
  Object.assign(ph, opts.ph || {});
  initState(E, opts.doy0 || 0);
  if (opts.restart) loadState(E, opts.restart);
  const perDay = 86400 / md.dt, nG = md.nG, L = md.L, nlat = md.nlat, nlon = md.nlon;
  const acc = {}; const keys = ['prec', 'precConv', 'evap', 'Ts', 'olr', 'asr', 'swtoa', 'swsfc', 'shf', 'netSfc', 'cldL', 'cldM', 'cldH', 'pw', 'slp', 't2', 'snow', 'hice', 'W'];
  for (const k of keys) acc[k] = new Float64Array(nG);
  const uz = new Float64Array(L * nlat), tz = new Float64Array(L * nlat), vz = new Float64Array(L * nlat), rhz = new Float64Array(L * nlat);
  let na = 0, nz = 0;
  const t0 = performance.now();
  for (let d = 0; d < opts.days; d++) {
    const doy = ((opts.doy0 || 0) + md.time / 86400) % 365.2422;
    if (ph.sstMode) ph.setMonth(doy);
    for (let s = 0; s < perDay; s++) {
      md.step();
      if (d >= opts.avgFrom) {
        na++; for (const k of keys) { const a = acc[k], b = ph[k]; for (let p = 0; p < nG; p++) a[p] += b[p]; }
        if (s % 6 === 0) { nz++; for (let k = 0; k < L; k++) for (let j = 0; j < nlat; j++) { let su = 0, st = 0, sv = 0, sr = 0; const ic = 1 / Math.sqrt(md.cm[j]); for (let i = 0; i < nlon; i++) { const q = k * nG + j * nlon + i; su += md.U[q] * ic; sv += md.V[q] * ic; st += md.TG[q]; sr += ph.RH[q]; } uz[k * nlat + j] += su / nlon; vz[k * nlat + j] += sv / nlon; tz[k * nlat + j] += st / nlon + md.T0; rhz[k * nlat + j] += sr / nlon; } }
      }
    }
    if (opts.log && (d + 1) % opts.log === 0) console.log(`day ${d + 1} Ts ${gmean(E, ph.Ts).toFixed(2)} ice ${gmean(E, ph.hice).toFixed(3)} ${((performance.now() - t0) / ((d + 1) * perDay)).toFixed(1)}ms/step`);
  }
  for (const k of keys) for (let p = 0; p < nG; p++) acc[k][p] /= na;
  const G = (k, m) => gmean(E, acc[k], m);
  console.log(`GLOBAL: Ts ${G('Ts').toFixed(1)} t2 ${G('t2').toFixed(1)} P ${(G('prec') * 86400).toFixed(2)} (conv ${(G('precConv') * 86400).toFixed(2)}) E ${(G('evap') * 86400).toFixed(2)} mm/d | TOA in ${G('swtoa').toFixed(0)} ASR ${G('asr').toFixed(1)} OLR ${G('olr').toFixed(1)} net ${(G('asr') - G('olr')).toFixed(1)} | SWsfc ${G('swsfc').toFixed(0)} SH ${G('shf').toFixed(0)} LH ${(G('evap') * 2.5e6).toFixed(0)} netSfc ${G('netSfc').toFixed(1)} atmSW ${(G('asr') - G('swsfc')).toFixed(0)} | cld L/M/H ${G('cldL').toFixed(2)}/${G('cldM').toFixed(2)}/${G('cldH').toFixed(2)} PW ${G('pw').toFixed(1)}`);
  // zonal means
  const zm = (a, j) => { let s = 0; for (let i = 0; i < nlon; i++) s += a[j * nlon + i]; return s / nlon; };
  const kl = (sg) => { let b = 0; for (let k = 0; k < L; k++) if (Math.abs(md.sf[k] - sg) < Math.abs(md.sf[b] - sg)) b = k; return b; };
  const k250 = kl(0.25), k850 = kl(0.85), kb = L - 1;
  console.log(' lat   P(mm/d)  E   Ts     OLR  ASR  u250  u850  usfc  vsfc  T250  RH850 cldL cldH  slp');
  for (let j = 0; j < nlat; j += 2) {
    const r = (x, d = 0) => x.toFixed(d).padStart(6);
    console.log(`${r(S.lat[j] * 180 / Math.PI)}${r(zm(acc.prec, j) * 86400, 1)}${r(zm(acc.evap, j) * 86400, 1)}${r(zm(acc.Ts, j), 1)}${r(zm(acc.olr, j))}${r(zm(acc.asr, j))}${r(uz[k250 * nlat + j] / nz, 1)}${r(uz[k850 * nlat + j] / nz, 1)}${r(uz[kb * nlat + j] / nz, 1)}${r(vz[kb * nlat + j] / nz, 2)}${r(tz[k250 * nlat + j] / nz, 1)}${r(rhz[k850 * nlat + j] / nz, 2)}${r(zm(acc.cldL, j), 2)}${r(zm(acc.cldH, j), 2)}${r(zm(acc.slp, j) / 100, 1)}`);
  }
  return { E, acc, uz, tz, vz, nz };
}
function saveState(E, fn) {
  const { md, ph } = E; const o = { time: md.time };
  for (const v of ['Z', 'D', 'T', 'Q']) o[v] = [0, 1].map(c => [Array.from(md[v][c].re), Array.from(md[v][c].im)]);
  o.LP = [0, 1].map(c => [Array.from(md.LP[c].re), Array.from(md.LP[c].im)]);
  for (const f of ['Ts', 'Tml', 'hice', 'W', 'snow', 'qflux']) o[f] = Array.from(ph[f]);
  fs.writeFileSync(fn, JSON.stringify(o));
}
function loadState(E, fn) {
  const { md, ph } = E; const o = JSON.parse(fs.readFileSync(fn));
  for (const v of ['Z', 'D', 'T', 'Q', 'LP']) for (const c of [0, 1]) { md[v][c].re.set(o[v][c][0]); md[v][c].im.set(o[v][c][1]); }
  for (const f of ['Ts', 'Tml', 'hice', 'W', 'snow', 'qflux']) if (o[f]) ph[f].set(o[f]);
  md.time = o.time; md.first = true;
}
module.exports = { run, saveState, loadState };
if (require.main === module) {
  const days = +process.argv[2] || 30;
  const r = run({ days, avgFrom: +process.argv[3] || 10, log: 10, ph: { sstMode: true } });
  if (process.argv[4]) saveState(r.E, process.argv[4]);
}
