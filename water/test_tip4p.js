// node test_tip4p.js : force/torque vs finite differences, NVE energy conservation
const { Tip4p, BODY, rotMat, matToQuat, KB } = require('./tip4p_cpu.js');
const { liquidBox } = require('./setup.js');

let seed = 12345; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const s = liquidBox(512, 0.997, 300, rng);
// relax a little with a thermostat and small steps so the start is not explosive
for (let i = 0; i < 300; i++) { s.step(0.0005); s.thermostat(300, 0.01, 0.0005); }
for (let i = 0; i < 300; i++) { s.step(0.002); s.thermostat(300, 0.05, 0.002); }
s.forces();
console.log('after equilibration', s.measure());

// ---- finite differences ----
const E = () => { s.forces(); return s.epot; };
const i = 7, h = 1e-5;
E(); const f0 = Array.from(s.f.slice(3*i, 3*i+3)), t0 = Array.from(s.tq.slice(3*i, 3*i+3));
const fd = [], td = [];
for (let d = 0; d < 3; d++) {
  s.com[3*i+d] += h; const ep = E(); s.com[3*i+d] -= 2*h; const em = E(); s.com[3*i+d] += h;
  fd.push(-(ep - em) / (2*h));
  // rotate molecule i about lab axis d by ±h: q' = (cos h/2, sin h/2 e_d) ⊗ q
  const q = Array.from(s.q.slice(4*i, 4*i+4));
  const rot = (ang) => { const c = Math.cos(ang/2), sn = Math.sin(ang/2), e = [0,0,0]; e[d] = sn;
    const r = [c*q[0] - e[0]*q[1] - e[1]*q[2] - e[2]*q[3],
               c*q[1] + e[0]*q[0] + e[1]*q[3] - e[2]*q[2],
               c*q[2] - e[0]*q[3] + e[1]*q[0] + e[2]*q[1],
               c*q[3] + e[0]*q[2] - e[1]*q[1] + e[2]*q[0]];
    s.q.set(r, 4*i); };
  rot(h); const rp = E(); rot(-h); const rm = E(); s.q.set(q, 4*i);
  td.push(-(rp - rm) / (2*h));
}
console.log('force  ', f0.map(x => x.toFixed(5)).join(' '), '| fd', fd.map(x => x.toFixed(5)).join(' '));
console.log('torque ', t0.map(x => x.toFixed(5)).join(' '), '| fd', td.map(x => x.toFixed(5)).join(' '));

// ---- NVE ----
for (const dt of [0.002, 0.001]) {
  const c = new Tip4p(s.N, s.box, { rc: s.rc, alpha: s.alpha });
  c.com.set(s.com); c.v.set(s.v); c.q.set(s.q); c.p.set(s.p); c.forces();
  const etot = () => { const m = c.measure(); return m.epot + m.kt + m.kr; };
  const e0 = etot(); const nst = Math.round(2 / dt);   // 2 ps
  let out = [];
  for (let k = 1; k <= nst; k++) { c.step(dt); if (k % (nst / 4) === 0) { const m = c.measure(); out.push(`${(k*dt).toFixed(1)}ps E=${(etot()/c.N).toFixed(4)} T=${m.T.toFixed(1)}`); } }
  console.log(`dt=${dt*1000}fs  E0=${(e0/c.N).toFixed(4)} kJ/mol/molecule  `, out.join('  '));
}
