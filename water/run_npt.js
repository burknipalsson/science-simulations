// node run_npt.js T [N] [ps] [rc] [alpha] : NPT at 1 bar, prints mean density, energy
const { liquidBox } = require('./setup.js');
const T = +process.argv[2] || 298, N = +(process.argv[3] || 512), ps = +(process.argv[4] || 100);
const rc = +(process.argv[5] || 9), alpha = +(process.argv[6] || 0.2);
const s = liquidBox(N, 0.997, T, Math.random, { rc, alpha });
for (let i = 0; i < 300; i++) { s.step(0.0005); s.thermostat(T, 0.01, 0.0005); }
const dt = 0.002, nst = Math.round(ps / dt), eq = Math.round(nst / 5);
let n = 0, rho = 0, ep = 0, P = 0, Tm = 0;
for (let k = 0; k < nst; k++) {
  s.step(dt);
  if (k % 5 === 0) { s.thermostat(T, 0.1, 5 * dt); s.barostat(1, T, 2.0, 5 * dt); s.wrap(); }
  if (k >= eq && k % 10 === 0) { const m = s.measure(); rho += m.rho; ep += m.epot / N; P += m.P; Tm += m.T; n++; }
}
console.log(JSON.stringify({ T, N, rc, alpha, rho: +(rho/n).toFixed(4), U: +(ep/n).toFixed(3), P: +(P/n).toFixed(1), Tm: +(Tm/n).toFixed(1) }));
