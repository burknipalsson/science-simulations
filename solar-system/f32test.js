// emulate the GLSL float32 Kepler drift to measure secular drift in a
const f = Math.fround, mu = f(0.00029591220828411956);
function kepler(x, v, dt, fix) {
  const r0 = f(Math.hypot(x[0], x[1], x[2])), v2 = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2])), u = f(f(f(x[0] * v[0]) + f(x[1] * v[1])) + f(x[2] * v[2]));
  const ia = f(f(2 / r0) - f(v2 / mu)); const a = f(1 / ia), n = f(Math.sqrt(f(mu * f(ia * f(ia * ia)))));
  const ec = f(1 - f(r0 * ia)), es = f(u / f(n * f(a * a))), dM = f(n * dt);
  let dE = dM;
  for (let i = 0; i < 16; i++) { const s = f(Math.sin(dE)), c = f(2 * f(f(Math.sin(f(0.5 * dE))) * f(Math.sin(f(0.5 * dE))))); const F = f(f(f(dE - f(ec * s)) + f(es * c)) - dM), fp = f(f(1 - f(ec * f(1 - c))) + f(es * s)); const d = f(F / fp); dE = f(dE - d); if (Math.abs(d) < 1e-7) break; }
  const s = f(Math.sin(dE)), omc = f(2 * f(f(Math.sin(f(0.5 * dE))) * f(Math.sin(f(0.5 * dE)))));
  const smd = f(-dE * dE * dE / 6 * (1 - dE * dE / 20 * (1 - dE * dE / 42)));
  const F = f(1 - f(f(a / r0) * omc)), g = f(dt + f(smd / n));
  const r = f(a * f(f(1 - f(ec * f(1 - omc))) + f(es * s)));
  const fd = f(f(-a * a * n * s) / f(r * r0)), gd = f(1 - f(f(a / r) * omc));
  const x1 = [0, 1, 2].map(k => f(f(F * x[k]) + f(g * v[k])));
  const v1 = [0, 1, 2].map(k => f(f(fd * x[k]) + f(gd * v[k])));
  if (fix) { const rn = f(Math.hypot(...x1)), vv = f(v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2]); const tgt = f(mu * f(f(2 / rn) - ia)); const sc = f(Math.sqrt(f(tgt / vv))); for (let k = 0; k < 3; k++) v1[k] = f(v1[k] * sc); }
  for (let k = 0; k < 3; k++) { x[k] = x1[k]; v[k] = v1[k]; }
}
const A = require('./ast.js');
for (const fix of [false, true]) for (const a0 of [2.2, 2.8, 3.4]) {
  const s = A.elemToState(a0, 0.08, 3, 40, 70, 10).map(f); const x = s.slice(0, 3), v = s.slice(3);
  for (let k = 0; k < 400000; k++) kepler(x, v, 10, fix);
  const e = A.stateToElem([...x, ...v]); console.log(fix ? 'energy-fixed' : 'plain', a0, '->', e.a.toFixed(5), 'e', e.e.toFixed(4));
}
