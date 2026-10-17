const P = require('./phys.js');
const epoch = require('./data/state0.json'), md = require('./data/moon_delta.json'), refs = require('./data/refs.json');
const opts = { gr: +(process.env.GR ?? 1), tides: +(process.env.TIDES ?? 1), j2: +(process.env.J2 ?? 1) };
const H = +(process.env.H || 0.5);
const s0 = P.initial(epoch, process.env.NOFIT ? null : md); Object.assign(s0, opts);
const E0 = P.energy(s0);
const jds = refs.Sun.rows.map(r => r.jd);
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const as = x => (x * 206264.806).toFixed(1).padStart(8);
let s = P.copy(P.makeSystem(), s0), sB = P.copy(P.makeSystem(), s0);
const order = jds.map((jd, i) => i).filter(i => !only || only.includes(i)).sort((a, b) => Math.abs(jds[a] - P.EPOCH) - Math.abs(jds[b] - P.EPOCH));
const t0 = Date.now();
for (const i of order) {
  const jd = jds[i], t = jd - P.EPOCH, st = t >= 0 ? s : sB;
  const n = Math.ceil(Math.abs(t - st.t) / H); const h = (t - st.t) / n;
  for (let k = 0; k < n; k++) P.step(st, h);
  const line = [];
  const ref = name => { const r = refs[name].rows.find(r => r.jd === jd); return r && r.s; };
  const e = ref('Earth');
  for (const [bi, name] of [[1, 'Mercury'], [2, 'Venus'], [5, 'Mars'], [6, 'Jupiter'], [7, 'Saturn'], [8, 'Uranus'], [9, 'Neptune'], [10, 'Pluto'], [11, 'Ceres']]) {
    const r = ref(name); if (!r) { line.push(name.slice(0, 4) + '     —'); continue; }
    // geocentric angular error
    const gx = [0, 1, 2].map(k => st.x[3 * bi + k] - st.x[9 + k]), gr = [0, 1, 2].map(k => r[k] - e[k]);
    const d = Math.hypot(...gr), err = Math.hypot(...gx.map((v, k) => v - gr[k])) / d;
    line.push(name.slice(0, 4) + as(err));
  }
  const m = ref('Moon'); const mg = [0, 1, 2].map(k => st.x[12 + k] - st.x[9 + k]), rg = [0, 1, 2].map(k => m[k] - e[k]);
  const merr = Math.hypot(...mg.map((v, k) => v - rg[k])) / Math.hypot(...rg);
  const cal = P.jdToCal(jd);
  console.log(String(cal.year).padStart(5), 'Moon', as(merr), '"', line.join(' '), ' dE/E', ((P.energy(st) - E0) / E0).toExponential(1));
}
console.log('time', Date.now() - t0, 'ms');
