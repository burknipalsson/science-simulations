// node test_mw.js : mW moment-method energy vs brute force, forces vs finite differences,
// pressure vs finite-difference volume derivative, NVE conservation
const { MWater, MW } = require('./mw_cpu.js');
const { iceIhLattice } = require('./ice.js');
let seed = 7; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// start from ice (a for mW ice ~ O–O 2.75) then disorder it
const ice = iceIhLattice(4, 2, 3, 4.52, rng);
const s = new MWater(ice.n, ice.box); s.x.set(ice.O);
for (let i = 0; i < s.x.length; i++) s.x[i] += 0.25 * (rng() - 0.5);
for (let k = 0; k < 5; k++) s.solute[Math.floor(rng() * s.N)] = 1;
s.forces(); const d = s.energyDirect();
console.log('N', s.N, 'moments e2', s.e2.toFixed(6), 'e3', s.e3.toFixed(6), '| direct', d.e2.toFixed(6), d.e3.toFixed(6));
const h = 1e-6;
for (const i of [3, 50]) {
  s.forces(); const f = Array.from(s.f.slice(3*i, 3*i+3)), fd = [];
  for (let c = 0; c < 3; c++) { s.x[3*i+c] += h; const ep = s.forces(); s.x[3*i+c] -= 2*h; const em = s.forces(); s.x[3*i+c] += h; fd.push(-(ep - em) / (2*h)); }
  console.log('force', i, f.map(x => x.toFixed(5)).join(' '), '| fd', fd.map(x => x.toFixed(5)).join(' '));
}
// virial vs -dE/dlnL per axis (scale coordinates along axis c)
s.forces(); const W = s.vir.slice(), wd = [];
for (let c = 0; c < 3; c++) {
  const x0 = Float64Array.from(s.x), b0 = s.box.slice(), sc = l => { for (let i = 0; i < s.N; i++) s.x[3*i+c] = x0[3*i+c] * l; s.box[c] = b0[c] * l; };
  sc(1 + h); const ep = s.forces(); sc(1 - h); const em = s.forces(); sc(1); s.x.set(x0); s.box = b0;
  wd.push(-(ep - em) / (2*h));
}
console.log('virial', W.map(x => x.toFixed(4)).join(' '), '| fd', wd.map(x => x.toFixed(4)).join(' '));
// NVE
s.forces(); s.thermalize(250, rng); s.forces();
for (const dt of [0.005, 0.01]) {
  const c = new MWater(s.N, s.box); c.x.set(s.x); c.v.set(s.v); c.solute.set(s.solute); c.forces();
  const E = () => (c.epot + c.kinetic().k) / c.N, e0 = E(), out = [];
  const n = Math.round(10 / dt);
  for (let k = 1; k <= n; k++) { c.step(dt); if (k % (n / 5) === 0) out.push(E().toFixed(4)); }
  console.log(`NVE dt=${dt*1000}fs E0=${e0.toFixed(4)} ->`, out.join(' '), 'T', c.measure().T.toFixed(1));
}
