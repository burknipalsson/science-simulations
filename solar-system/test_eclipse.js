const P = require('./phys.js'), E = require('./eclipse.js');
const eph = new P.Ephemeris(P.initial(require('./data/state0.json'), require('./data/moon_delta.json')));
const fmt = ev => {
  const ut = P.tdbToUt(ev.jd), c = P.jdToCal(ut), hh = c.frac * 24, h = Math.floor(hh), m = Math.floor((hh - h) * 60), sec = Math.round(((hh - h) * 60 - m) * 60);
  let str = `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} UT  ${ev.kind} ${ev.type}`;
  if (ev.kind === 'solar') str += `  gamma ${ev.gamma.toFixed(4)}` + (ev.lat !== undefined ? `  at ${ev.lat.toFixed(2)}, ${ev.lon.toFixed(2)}  dur ${Math.floor(ev.duration / 60)}m${(ev.duration % 60).toFixed(0)}s  width ${ev.width.toFixed(0)} km` : '');
  else str += `  mag ${ev.mag.toFixed(3)}` + (ev.duration ? ` totality ${(ev.duration / 60).toFixed(1)} min` : '');
  return str;
};
const checks = [
  ['2017-08-21', '18:25:32 UT total, 36.97N 87.67W, 2m40s, gamma 0.4367'],
  ['2024-04-08', '18:17:16 UT total, 25.29N 104.14W, 4m28s, gamma 0.3431'],
  ['2026-08-12', '17:46:06 UT total, 65.2N 25.2W, 2m18s, gamma 0.8977'],
  ['2027-08-02', '10:07:50 UT total, 25.5N 33.2E, 6m23s, gamma 0.1421'],
  ['1999-08-11', '11:03:04 UT total, 45.07N 24.3E, 2m23s, gamma 0.5062'],
  ['2009-07-22', '02:35:21 UT total, 24.2N 144.1E, 6m39s, gamma 0.0698'],
  ['1919-05-29', '13:08 UT total, 4.4N 16.7W, 6m51s'],
  ['1715-05-03', "Halley's eclipse over London ~09:08 UT"],
  ['-584-05-28', 'Thales eclipse (Julian calendar)'],
];
const t0 = Date.now();
for (const [d, ref] of checks) {
  const [y, m, dd] = d.startsWith('-') ? [-(+d.slice(1, 4)), +d.slice(5, 7), +d.slice(8, 10)] : d.split('-').map(Number);
  const jd = P.utToTdb(P.calToJd(y, m, dd) + 0.5), t = jd - P.EPOCH;
  eph.growTo(Math.min(t - 40, 0), Math.max(t + 40, 0), 1e9);
  const ev = E.solarAt(eph, t);
  console.log(ev ? fmt(ev) : 'none', '\n   NASA:', ref);
}
console.log((Date.now() - t0) / 1000, 's');
