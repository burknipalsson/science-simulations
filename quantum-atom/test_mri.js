// Validate the Bloch-equation voxel against the analytic results MRI is built on.
const B = require('./bloch.js');
const ok = (name, got, want, tol) => console.log(`${Math.abs(got - want) <= tol ? 'PASS' : 'FAIL'}  ${name}: ${got.toPrecision(6)} vs ${want.toPrecision(6)} (tol ${tol})`);
ok('Larmor frequency at 3 T (MHz)', B.larmorMHz(3), 127.732, 0.001);
ok('Larmor frequency at 1.5 T (MHz)', B.larmorMHz(1.5), 63.866, 0.001);
ok('excess spins at 3 T, 37 °C (per million)', B.polarisation(3) * 1e6, 9.88, 0.05);
const T1 = 1084, T2 = 69, T2p = 30, n = 20000;
// free induction decay: |Mxy| = exp(−t/T2*) for a Lorentzian spread
{ const v = B.makeVoxel(n, T1, T2, T2p); B.pulse(v, Math.PI / 2);
  for (let i = 0; i < 200; i++) B.free(v, 0.1);
  const T2s = 1 / (1 / T2 + 1 / T2p);
  ok('FID at 20 ms = exp(−t/T2*)', B.signal(v).mxy, Math.exp(-20 / T2s), 3e-3); }
// spin echo: 90° – TE/2 – 180° – TE/2 → |Mxy| = exp(−TE/T2), independent of T2′
for (const TE of [20, 60, 120]){
  const v = B.makeVoxel(n, T1, T2, T2p); B.pulse(v, Math.PI / 2);
  for (let i = 0; i < 100; i++) B.free(v, TE / 200);
  B.pulse(v, Math.PI, 'y');
  for (let i = 0; i < 100; i++) B.free(v, TE / 200);
  ok(`spin echo at TE = ${TE} ms = exp(−TE/T2)`, B.signal(v).mxy, Math.exp(-TE / T2), 2e-3);
}
// inversion recovery: Mz(t) = 1 − 2 exp(−t/T1), null at T1 ln 2
{ const v = B.makeVoxel(200, T1, T2, T2p); B.pulse(v, Math.PI);
  const tn = T1 * Math.log(2); for (let i = 0; i < 100; i++) B.free(v, tn / 100);
  ok('inversion-recovery null at T1·ln2', B.signal(v).z, 0, 1e-9); }
// contrast: CSF dark on T1-weighted, bright on T2-weighted; fat bright on T1-weighted
const T = B.TISSUES, w1 = k => B.spinEcho(T[k], 500, 15), w2 = k => B.spinEcho(T[k], 4000, 100);
console.log('T1-weighted (TR 500, TE 15):', Object.keys(T).map(k => `${k} ${w1(k).toFixed(3)}`).join('  '));
console.log('T2-weighted (TR 4000, TE 100):', Object.keys(T).map(k => `${k} ${w2(k).toFixed(3)}`).join('  '));
console.log(w1('csf') < w1('gm') && w1('gm') < w1('wm') && w1('fat') > w1('wm') ? 'PASS  T1w order: CSF < GM < WM < fat' : 'FAIL  T1w order');
console.log(w2('csf') > w2('gm') && w2('gm') > w2('wm') ? 'PASS  T2w order: CSF > GM > WM' : 'FAIL  T2w order');
