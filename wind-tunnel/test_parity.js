// CPU reference vs GPU engine on the same 3D case: forces and a velocity sample must agree to float precision.
const { execFileSync } = require('child_process');
const { LBM } = require('./lbm_cpu.js'), { PARITY: P } = require('./parity_cfg.js');
const L = new LBM({ nx: P.nx, ny: P.ny, nz: P.nz, nu: P.nu, cs: P.cs, bcY: 'slip', bcZ: 'slip', sponge: P.sponge, absorb: P.absorb,
  uIn: () => [P.U, 0, 0], sdf: (x, y, z) => Math.hypot(x - P.xc, y - P.yc, z - P.zc) - P.R });
for (let s = 0; s < P.steps; s++) L.step();
const m = L.macro(40, 16, 20);
const cpu = [...L.force, m.ux, m.uz, m.rho];
const gpu = JSON.parse(execFileSync('node', ['gpu_run.js', 'parity'], { cwd: __dirname }).toString().split('\n').find(l => l.startsWith('PARITY')).slice(6));
const names = ['Fx', 'Fy', 'Fz', 'ux', 'uz', 'rho'];
names.forEach((n, i) => console.log(`${n.padEnd(4)} cpu ${cpu[i].toExponential(6)}  gpu ${gpu[i].toExponential(6)}  rel diff ${(Math.abs(cpu[i] - gpu[i]) / (Math.abs(cpu[i]) + 1e-12)).toExponential(2)}`));
