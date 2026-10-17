// Milky Way - Andromeda relative orbit: two Hernquist haloes, mutual gravity of the enclosed masses, Chandrasekhar
// dynamical friction on each galaxy in the other's halo (Hernquist 1990 density and isotropic dispersion).
// usage: node orbit.js [vtan km/s] [lnL]  ->  first pericentre time/distance, merger time
const G = 4.30091e-6;                        // kpc (km/s)^2 / Msun
const KMS_KPC_GYR = 1.02271;                 // 1 km/s = 1.02271 kpc/Gyr
function hern(M, a) {
  return { M, a, m: r => M * r * r / ((r + a) ** 2), rho: r => M * a / (2 * Math.PI * r * (r + a) ** 3),
    sigma: r => { // isotropic 1D dispersion (Hernquist 1990, eq. 10), in km/s
      const x = r / a, t1 = 12 * x * (x + 1) ** 3 * Math.log((x + 1) / x), t2 = -x / (x + 1) * (25 + 52 * x + 42 * x * x + 12 * x ** 3);
      return Math.sqrt(Math.max(G * M / (12 * a) * (t1 + t2), 1)); } };
}
const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
function run(o) {
  const A = hern(o.M1, o.a1), B = hern(o.M2, o.a2);
  let r = [o.d, 0, 0], v = [o.vr, o.vt, 0];     // relative position/velocity of M31 w.r.t. MW (kpc, km/s)
  const dt = 0.0005, out = { peri: [], merge: null, path: [] };
  let t = 0, prevR = o.d, dec = false;
  while (t < o.tmax) {
    const acc = (r, v) => {
      const R = Math.hypot(...r), V = Math.hypot(...v);
      const gm = G * (A.m(R) + B.m(R)) / (R * R);                         // relative acceleration from both haloes
      let a = r.map(x => -gm * x / R);
      // friction: M31 (as a whole, mass m(<rt) ~ its bound mass) in the MW halo, and vice versa; the relative
      // deceleration is the sum of both terms divided by each one's own mass, i.e. 4 pi G^2 lnL (M_A rho_B + M_B rho_A) ...
      const fric = (host, sat) => { const X = V / (Math.SQRT2 * host.sigma(R)); return 4 * Math.PI * G * G * o.lnL * sat * host.rho(R) / (V * V) * (erf(X) - 2 * X / Math.sqrt(Math.PI) * Math.exp(-X * X)); };
      const f = fric(A, B.m(Math.max(R, 1)) ) + fric(B, A.m(Math.max(R, 1)));
      a = a.map((x, i) => x - f * v[i] / V);
      return a;                                                          // (km/s)^2 / kpc
    };
    // RK4 in Gyr with conversion
    const k = (r, v) => [v.map(x => x * KMS_KPC_GYR), acc(r, v).map(x => x * KMS_KPC_GYR)];
    const [r1, v1] = k(r, v), [r2, v2] = k(r.map((x, i) => x + 0.5 * dt * r1[i]), v.map((x, i) => x + 0.5 * dt * v1[i]));
    const [r3, v3] = k(r.map((x, i) => x + 0.5 * dt * r2[i]), v.map((x, i) => x + 0.5 * dt * v2[i]));
    const [r4, v4] = k(r.map((x, i) => x + dt * r3[i]), v.map((x, i) => x + dt * v3[i]));
    r = r.map((x, i) => x + dt / 6 * (r1[i] + 2 * r2[i] + 2 * r3[i] + r4[i])); v = v.map((x, i) => x + dt / 6 * (v1[i] + 2 * v2[i] + 2 * v3[i] + v4[i]));
    t += dt; const R = Math.hypot(...r);
    if (R > prevR && dec) out.peri.push([t, prevR]);
    dec = R < prevR; prevR = R;
    if (!out.merge && R < 15 && Math.hypot(...v) < 60) out.merge = t;
    if (Math.round(t / dt) % 20 === 0) out.path.push([t, ...r, ...v]);
  }
  return out;
}
const base = { M1: 1.0e12, a1: 38, M2: 1.5e12, a2: 44, d: 770, vr: -109.3, vt: 17.0, tmax: 12 };
if (require.main === module) {
  const vt = +(process.argv[2] || 17), lnL = +(process.argv[3] || 3);
  const o = run(Object.assign({}, base, { vt, lnL }));
  console.log(`vtan ${vt} km/s, lnL ${lnL}: pericentres ${o.peri.slice(0, 3).map(p => `${p[0].toFixed(2)} Gyr at ${p[1].toFixed(0)} kpc`).join('; ')}; merged (r<15 kpc, v<60 km/s) at ${o.merge ? o.merge.toFixed(2) + ' Gyr' : 'not within ' + base.tmax + ' Gyr'}`);
}
module.exports = { run, base, hern };
