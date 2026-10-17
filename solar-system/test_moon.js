const P = require('./phys.js');
const ep = require('./data/state0.json'), md = require('./data/moon_delta.json'), rows = require('./data/moongeo.json');
const H = +(process.env.H || 0.25), s = P.initial(ep, md); s.gr = +(process.env.GR ?? 1); s.tides = +(process.env.TIDES ?? 1); s.j2 = +(process.env.J2 ?? 1);
const sB = P.copy(P.makeSystem(), s);
const out = [];
for (const dir of [1, -1]) {
  const st = dir > 0 ? s : sB;
  for (const r of rows.filter(r => (r.jd - P.EPOCH) * dir >= 0).sort((a, b) => dir * (a.jd - b.jd))) {
    P.advance(st, r.jd - P.EPOCH);
    const m = [0, 1, 2].map(k => st.x[12 + k] - st.x[9 + k]), mv = [0, 1, 2].map(k => st.v[12 + k] - st.v[9 + k]);
    const rr = r.s.slice(0, 3), rv = r.s.slice(3);
    const d = m.map((x, k) => x - rr[k]); const R = Math.hypot(...rr);
    const ur = rr.map(x => x / R); const hv = [rr[1] * rv[2] - rr[2] * rv[1], rr[2] * rv[0] - rr[0] * rv[2], rr[0] * rv[1] - rr[1] * rv[0]];
    const hn = Math.hypot(...hv), un = hv.map(x => x / hn); const ut = [un[1] * ur[2] - un[2] * ur[1], un[2] * ur[0] - un[0] * ur[2], un[0] * ur[1] - un[1] * ur[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    out.push([P.jdToCal(r.jd).year + (r.jd % 365.25) / 365.25, dot(d, ur) * P.AU_KM, dot(d, ut) / R * 206265, dot(d, un) / R * 206265]);
  }
}
out.sort((a, b) => a[0] - b[0]);
for (const o of out) console.log(o[0].toFixed(0), 'radial km', o[1].toFixed(1).padStart(8), ' along "', o[2].toFixed(1).padStart(8), ' normal "', o[3].toFixed(1).padStart(7));
