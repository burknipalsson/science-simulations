const P = require('./phys.js'), E = require('./eclipse.js');
const eph = new P.Ephemeris(P.initial(require('./data/state0.json'), require('./data/moon_delta.json')));
eph.growTo(-3000, 1200, 1e9);
const fmt = jd => { const c = P.jdToCal(P.tdbToUt(jd)), hh = c.frac * 24, h = Math.floor(hh), m = Math.round((hh - h) * 60); return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')} ${h}:${String(m).padStart(2, '0')} UT`; };
let t = P.calToJd(2022, 1, 1) - P.EPOCH, t0 = Date.now();
for (let i = 0; i < 14; i++) {
  const ev = E.next(eph, t, 1); t = ev.t;
  console.log(fmt(ev.jd), ev.kind, ev.type, ev.kind === 'lunar' ? `mag ${ev.mag.toFixed(3)}` + (ev.duration ? ` totality ${(ev.duration / 60).toFixed(0)} min` : '') : (ev.lat !== undefined ? `${ev.lat.toFixed(1)},${ev.lon.toFixed(1)} ${(ev.duration / 60).toFixed(2)} min` : `gamma ${ev.gamma.toFixed(3)}`));
}
console.log('ms', Date.now() - t0);
