// Run the Cosmic Web's validated CPU particle-mesh engine to z = 0 and save positions (box units, Float32).
// usage: node run_web.js NP NG STEPS SEED
const PM = require('../../cosmic-web/pm_cpu.js'), C = require('../../cosmic-web/cosmo.js'), fs = require('fs');
const [Np, Ng, nSteps, seed] = process.argv.slice(2).map(Number);
const t0 = Date.now();
const S = PM.makeSim({ Np, Ng, seed, zStart: 50 });
const sch = PM.schedule(S.aStart, nSteps);
let aPrevHalf = S.aStart;
for (let i = 0; i < nSteps; i++) {
  aPrevHalf = PM.step(S, sch[i], sch[i + 1], aPrevHalf);
  const z = 1 / S.a - 1, zs = [3, 2, 1, 0.5, 0.25];
  for (const zt of zs) { const zp = 1 / sch[i] - 1; if (zp > zt && z <= zt) fs.writeFileSync(`web_${Np}_${Ng}_${seed}_z${zt}.f32`, Buffer.from(S.pos.buffer)); }
  if (i % 10 === 9) console.log(`step ${i + 1}/${nSteps} z=${(1 / S.a - 1).toFixed(3)} ${((Date.now() - t0) / 1e3).toFixed(0)} s`);
}
fs.writeFileSync(`web_${Np}_${Ng}_${seed}.f32`, Buffer.from(S.pos.buffer));
const ps = PM.powerSpec(S, 128, 1);
for (const [k, P, Pl] of ps.filter((_, i) => i % 6 === 0)) console.log(`k=${k.toFixed(3)} /Mpc  P=${P.toExponential(3)}  Plin=${Pl.toExponential(3)}  ratio ${(P / Pl).toFixed(2)}`);
