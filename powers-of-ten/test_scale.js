// Scale truth: the frame chain must reproduce real directions and distances.
const S = require('./scale.js');
const H = require('./data/horizons.json');
const D = S.D; let fail = 0;
function check(name, got, want, tol, unit = '') {
  const ok = Math.abs(got - want) <= tol; if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got.toFixed(4)} vs ${want} ${unit} (tol ${tol})`);
}
const norm = v => Math.hypot(...v);
// alt/az of a body seen from the site: vector site->body in the ENU frame
function altaz(body) {
  const b = S.bodies[body], v = S.rel([0, 0, 0], 'site', b.pos, b.frame, 'site');
  const alt = Math.asin(v[2] / norm(v)) / D; let az = Math.atan2(v[0], v[1]) / D; if (az < 0) az += 360;
  return { alt, az, d: norm(v) };
}
const sun = altaz('sun'), moon = altaz('moon');
const hs = H.sky.sun.line, hm = H.sky.moon.line;
check('Sun altitude from Hallgrimskirkja', sun.alt, +hs[4], 0.02, 'deg');
check('Sun azimuth', sun.az, +hs[3], 0.03, 'deg');
check('Sun distance', sun.d / S.AU, +hs[5], 1e-5, 'AU');
check('Moon altitude (tests geocentric radius + parallax)', moon.alt, +hm[4], 0.02, 'deg');
check('Moon azimuth', moon.az, +hm[3], 0.03, 'deg');
// Horizons topocentric VECTORS range at the epoch (the observer table's delta is light-time apparent)
check('Moon topocentric distance', moon.d / 1e3, 406478.53, 1.0, 'km');
// site radius from Earth's centre (WGS84 at 64.14 N: ~6360.4 km)
check('Site distance from Earth centre', norm(S.nodes.site.pos) / 1e3, 6360.5, 0.5, 'km');
// galaxy-scale geometry
check('Sun to Galactic centre', norm(S.rel([0, 0, 0], 'sol', [0, 0, 0], 'gc', 'gc')) / S.KPC, 8.178, 1e-3, 'kpc');
check('Sun to M31', norm(S.rel([0, 0, 0], 'sol', S.bodies.m31.pos, 'gc', 'gc')) / S.KPC, 765, 0.01, 'kpc');
check('M31 from the Galactic centre', norm(S.bodies.m31.pos) / S.KPC, 769.5, 3, 'kpc'); // ~770 kpc (van der Marel 2012)
// ecliptic pole in Galactic coordinates: l = 96.38, b = 29.81 (IAU)
const pole = S.app(S.nodes.sol.rot, [0, 0, 1]);
check('Ecliptic north pole Galactic b', Math.asin(pole[2]) / D, 29.81, 0.02, 'deg');
check('Ecliptic north pole Galactic l', (Math.atan2(pole[1], pole[0]) / D + 360) % 360, 96.38, 0.02, 'deg');
// Galactic centre seen from Reykjavik: RA 266.405, Dec -28.936 -> must be below the horizon at this latitude always
const gc = S.rel([0, 0, 0], 'site', [0, 0, 0], 'gc', 'site');
check('Galactic centre altitude < 0 (never rises at 64 N: max 90-64.14-28.94 = -3.1)', Math.asin(gc[2] / norm(gc)) / D < -3.0 ? 1 : 0, 1, 0);
// precision: a point 1e-11 m from the site, expressed in the site frame, must survive the round trip via Earth frame
const p = S.toAncestor([1e-11, 0, 0], 'site', 'site');
check('Round-trip sub-atomic offset (site frame)', p[0] / 1e-11, 1, 1e-12);
// Kepler clock: a full sidereal year returns Earth close to its start (two-body, ~ planetary perturbations)
const e0 = S.bodies.earth.pos.slice(); S.setTime(365.25636);
check('Earth after one sidereal year (two-body)', norm(S.bodies.earth.pos.map((x, i) => x - e0[i])) / 1e3, 0, 2e4, 'km');
// one sidereal day later the site faces the same way in the ecliptic frame (to precession, ~0.0001 deg)
S.setTime(0); const u0 = S.app(S.rotToAncestor('site', 'sol'), [0, 0, 1]); S.setTime(0.99726957);
const u1 = S.app(S.rotToAncestor('site', 'sol'), [0, 0, 1]);
check('Site vertical after one sidereal day', Math.acos(Math.min(1, u0[0] * u1[0] + u0[1] * u1[1] + u0[2] * u1[2])) / D, 0, 1e-3, 'deg');
S.setTime(0);
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
