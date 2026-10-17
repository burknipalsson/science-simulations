// Liquid water at body temperature (310 K, 1 bar): TIP4P/2005 with The Hydrogen Bond's CPU reference engine
// (rigid bodies, NO_SQUISH, DSF electrostatics rc 9 Å, CSVR thermostat, stochastic cell rescaling barostat).
// Equilibrates under NPT, then records 2 ps under NVE-like gentle NVT, a frame every 10 fs.
// Checks density, the O-O radial distribution peak, hydrogen bonds per molecule and self-diffusion.
// usage: node md310.js [N] [eq_ps]  -> md310.json
const W = '../../../water/';
const { liquidBox } = require(W + 'setup.js');
const T4X = require(W + 'tip4p_cpu.js');
const N = +(process.argv[2] || 512), EQ = +(process.argv[3] || 40), T = 310;
const s = liquidBox(N, 0.993, T, Math.random, { rc: 9, alpha: 0.2 });
for (let i = 0; i < 300; i++) { s.step(0.0005); s.thermostat(T, 0.01, 0.0005); }
const dt = 0.002;
let rho = 0, nr = 0;
const t0 = Date.now();
for (let k = 0; k < EQ / dt; k++) {
  s.step(dt);
  if (k % 5 === 0) { s.thermostat(T, 0.1, 5 * dt); s.barostat(1, T, 2.0, 5 * dt); s.wrap(); }
  if (k > EQ / dt / 3 && k % 10 === 0) { rho += s.measure().rho; nr++; }
  if (k % 2000 === 0) console.log(`eq ${(k * dt).toFixed(0)} ps: rho ${s.measure().rho.toFixed(4)} T ${s.measure().T.toFixed(1)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
console.log(`mean density over the last ${(EQ * 2 / 3).toFixed(0)} ps: ${(rho / nr).toFixed(4)} g/cm3 (real water at 37 C: 0.99333)`);
// production: 1 fs steps, gentle thermostat, frame every 10 fs for 2 ps; also a 10 ps diffusion run
const frames = [], dtp = 0.001;
const unwrap = s.com.slice(), last = s.com.slice();
const track = () => { for (let i = 0; i < 3 * N; i++) { let d = s.com[i] - last[i]; const L = s.box[i % 3]; d -= L * Math.round(d / L); unwrap[i] += d; last[i] = s.com[i]; } };
const start = unwrap.slice();
for (let k = 0; k <= 2000; k++) {
  if (k % 10 === 0) frames.push({ com: Array.from(s.com, x => +x.toFixed(4)), q: Array.from(s.q, x => +x.toFixed(5)) });
  s.step(dtp); if (k % 10 === 0) s.thermostat(T, 1.0, 10 * dtp);
  track();
}
// structure from the frames: O-O g(r) peak and H-bonds (r_OO < 3.5 Å, angle < 30°)
const R = new Float64Array(9), box = s.box.slice();
const { BODY, rotMat } = T4X;
function sites(f) {
  const O = [], H = [];
  for (let i = 0; i < N; i++) {
    rotMat(f.q[4 * i], f.q[4 * i + 1], f.q[4 * i + 2], f.q[4 * i + 3], R);
    const c = f.com.slice(3 * i, 3 * i + 3), ap = b => [0, 1, 2].map(r => c[r] + R[3 * r] * b[0] + R[3 * r + 1] * b[1] + R[3 * r + 2] * b[2]);
    O.push(ap(BODY.O)); H.push([ap(BODY.H1), ap(BODY.H2)]);
  }
  return { O, H };
}
const nb = 200, hist = new Float64Array(nb), dr = 0.05; let hb = 0, nf = 0;
for (let fi = 0; fi < frames.length; fi += 20) {
  const { O, H } = sites(frames[fi]); nf++;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const d = [0, 1, 2].map(r => { let x = O[j][r] - O[i][r]; return x - box[r] * Math.round(x / box[r]); }), r = Math.hypot(...d);
    if (r < nb * dr) hist[Math.floor(r / dr)] += 2;
    if (r < 3.5) for (const [a, b, dv] of [[i, j, d], [j, i, d.map(x => -x)]]) for (const h of H[a]) {
      const oh = [0, 1, 2].map(k => { let x = h[k] - O[a][k]; return x; }), c = (oh[0] * dv[0] + oh[1] * dv[1] + oh[2] * dv[2]) / (Math.hypot(...oh) * r);
      if (c > Math.cos(30 * Math.PI / 180)) hb++;
    }
  }
}
const V = box[0] * box[1] * box[2], g = Array.from(hist, (h, k) => h / nf / N / (N / V) / (4 / 3 * Math.PI * (((k + 1) * dr) ** 3 - (k * dr) ** 3)));
let pk = 0; for (let k = 40; k < 80; k++) if (g[k] > g[pk]) pk = k;
console.log(`O-O g(r) first peak at ${((pk + 0.5) * dr).toFixed(2)} Å, height ${g[pk].toFixed(2)} (X-ray: 2.80 Å); H-bonds per molecule ${(2 * hb / nf / N).toFixed(2)}`);
// self-diffusion over the 2 ps run (short: indicative) plus 8 ps more
for (let k = 0; k < 8000; k++) { s.step(dtp); if (k % 10 === 0) s.thermostat(T, 1.0, 10 * dtp); track(); }
let msd = 0; for (let i = 0; i < 3 * N; i++) msd += (unwrap[i] - start[i]) ** 2;
const Dif = msd / N / 6 / 10 * 1e-8;   // Å^2/ps -> m^2/s (1 Å^2/ps = 1e-8 m^2/s)
console.log(`self-diffusion (10 ps, no finite-size correction) ${(Dif * 1e9).toFixed(2)} e-9 m2/s (real water at 37 C: 3.04)`);
require('fs').writeFileSync('md310.json', JSON.stringify({ N, box, T, rho: rho / nr, gpeak: (pk + 0.5) * dr, hb: 2 * hb / nf / N, D: Dif, every_fs: 10, frames }));
