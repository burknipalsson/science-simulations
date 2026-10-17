// Bloch equations for MRI, in the frame rotating at the Larmor frequency. A voxel is a set of
// isochromats (groups of protons) with slightly different precession rates from field inhomogeneity
// (a Lorentzian spread of width 1/T2′, so the free decay is exactly exp(−t/T2*), 1/T2* = 1/T2 + 1/T2′).
// Each step is exact: precession about z, then T1/T2 relaxation. RF pulses are instantaneous rotations.
const Bloch = (() => {
  const GAMMA_MHZ_T = 42.577478; // proton gyromagnetic ratio / 2π
  // tissues at 3 T, 37 °C: Stanisz et al. 2005 (MRM 54:507) except fat (de Bazelaire et al. 2004,
  // Radiology 230:652) and CSF (typical in-vivo values; literature T2 spans 0.2–2.2 s). PD: relative
  // water (proton) density, approximate.
  const TISSUES = {
    wm: { name: 'White matter', T1: 1084, T2: 69, PD: 0.70 },
    gm: { name: 'Grey matter', T1: 1820, T2: 99, PD: 0.80 },
    csf: { name: 'Cerebrospinal fluid', T1: 4000, T2: 2000, PD: 1.00, approx: true },
    fat: { name: 'Fat', T1: 382, T2: 68, PD: 0.90 },
    blood: { name: 'Blood', T1: 1932, T2: 275, PD: 0.85 },
    muscle: { name: 'Muscle', T1: 1412, T2: 50, PD: 0.75 },
    liver: { name: 'Liver', T1: 818, T2: 42, PD: 0.75 },
  };
  function makeVoxel(n, T1, T2, T2p, seed = 1){
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const iso = [];
    for (let i = 0; i < n; i++){
      // stratified Lorentzian offsets (rad/ms): tan(π(u − ½)) / T2′
      const u = (i + 0.5) / n, dw = Math.tan(Math.PI * (u - 0.5)) / T2p;
      iso.push({ x: 0, y: 0, z: 1, dw, ph: rnd() });
    }
    return { iso, T1, T2, T2p, t: 0 };
  }
  // rotate every isochromat by angle a (radians) about the x axis (an RF pulse along x)
  function pulse(v, a, axis = 'x'){
    const c = Math.cos(a), s = Math.sin(a);
    for (const m of v.iso){
      if (axis === 'x'){ const y = m.y * c - m.z * s, z = m.y * s + m.z * c; m.y = y; m.z = z; }
      else { const x = m.x * c + m.z * s, z = -m.x * s + m.z * c; m.x = x; m.z = z; }
    }
  }
  function free(v, dt){ // dt in ms
    const e2 = Math.exp(-dt / v.T2), e1 = Math.exp(-dt / v.T1);
    for (const m of v.iso){
      const a = m.dw * dt, c = Math.cos(a), s = Math.sin(a);
      const x = m.x * c - m.y * s, y = m.x * s + m.y * c;
      m.x = x * e2; m.y = y * e2; m.z = 1 + (m.z - 1) * e1;
    }
    v.t += dt;
  }
  function signal(v){ let x = 0, y = 0, z = 0; for (const m of v.iso){ x += m.x; y += m.y; z += m.z; } const n = v.iso.length; return { x: x / n, y: y / n, z: z / n, mxy: Math.hypot(x, y) / n }; }
  // steady-state spin-echo signal (90°–180°, TR ≫ TE): the image contrast equation
  const spinEcho = (t, TR, TE) => t.PD * (1 - Math.exp(-TR / t.T1)) * Math.exp(-TE / t.T2);
  const larmorMHz = B => GAMMA_MHZ_T * B;
  // excess fraction of proton spins aligned with the field at body temperature: tanh(ħω/2kT) ≈ ħω/2kT
  const polarisation = (B, T = 310.15) => Math.tanh(6.62607015e-34 * larmorMHz(B) * 1e6 / (2 * 1.380649e-23 * T));
  return { TISSUES, makeVoxel, pulse, free, signal, spinEcho, larmorMHz, polarisation, GAMMA_MHZ_T };
})();
if (typeof module !== 'undefined') module.exports = Bloch;
