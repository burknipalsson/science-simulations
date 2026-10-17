// Powers of Ten, side trip: the Galaxy's central black hole. The 40 S-stars on the Keplerian orbits fitted by
// Gillessen et al. 2017 (ApJ 837, 30, table 7), in a sky-aligned frame at Sgr A* (x east, y north, z away from
// the Sun), and the black hole's mass from GRAVITY 2019 (4.152e6 suns at R0 = 8.178 kpc, the distance this page
// uses). Runs in node and the browser.
(function (root) {
  const S = root.PTEN || require('./scale.js');
  const D = Math.PI / 180;
  const STARS = (root.PTEN_DATA && root.PTEN_DATA.sstars) || (typeof require !== 'undefined' ? require('./data/sstars.json') : []);
  const RA = 266.4168371, DEC = -29.0078106;                         // Sgr A* (ICRS)
  const ra = RA * D, de = DEC * D;
  const s = [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)];
  const e = [-Math.sin(ra), Math.cos(ra), 0], n = [-Math.sin(de) * Math.cos(ra), -Math.sin(de) * Math.sin(ra), Math.cos(de)];
  const G = v => S.app(S.EQ2GAL, v);
  const ex = G(e), ny = G(n), sz = G(s);
  // frame 'sgr' at the centre of the Galaxy, axes (east, north, away from the Sun) expressed in the gc frame
  S.node('sgr', 'gc', [0, 0, 0], [ex[0], ny[0], sz[0], ex[1], ny[1], sz[1], ex[2], ny[2], sz[2]], { size: 1e14 });
  const AS = S.R0 / 206264.806;                                      // metres per arcsecond at the Galactic Centre
  const GM = 6.6743e-11 * 4.152e6 * 1.98847e30, RS = 2 * GM / 299792458 ** 2;
  // position (m, sgr frame) of star k at decimal year t
  function pos(k, t) {
    const [name, a, ec, i, O, w, tp, T] = STARS[k];
    if (!(a > 0) || !(ec < 1)) return null;
    const M = 2 * Math.PI * (t - tp) / T;
    let E = M; for (let it = 0; it < 60; it++) { const d = (E - ec * Math.sin(E) - M) / (1 - ec * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-13) break; }
    const nu = 2 * Math.atan2(Math.sqrt(1 + ec) * Math.sin(E / 2), Math.sqrt(1 - ec) * Math.cos(E / 2)), r = a * (1 - ec * Math.cos(E)) * AS;
    const u = w * D + nu, cO = Math.cos(O * D), sO = Math.sin(O * D), ci = Math.cos(i * D), si = Math.sin(i * D);
    const north = r * (Math.cos(u) * cO - Math.sin(u) * sO * ci), east = r * (Math.cos(u) * sO + Math.sin(u) * cO * ci), away = r * Math.sin(u) * si;
    return [east, north, away];
  }
  const YEAR0 = 2026 + (S.JD - S.jdUTC(2026, 1, 1, 0)) / 365.25;   // the landing moment as a decimal year
  const api = { STARS, pos, AS, GM, RS, YEAR0, frame: { ex, ny, sz } };
  root.PTEN_SGR = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
