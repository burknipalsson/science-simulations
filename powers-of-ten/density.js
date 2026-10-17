// Powers of Ten: the electron density of a water molecule from CCSD natural orbitals (data/qc/h2o_export.py),
// evaluated analytically: rho(r) = sum_k n_k |phi_k(r)|^2, phi_k = sum_mu C_k,mu chi_mu(r). Also emits GLSL.
// Units: bohr, electrons per bohr^3. Runs in node and the browser.
(function (root) {
  const SH = [[0.282094791773878], [0.488602511902920, 0.488602511902920, 0.488602511902920],
    [1.092548430592079, 1.092548430592079, 0.315391565252520, 1.092548430592079, 0.546274215296040]];
  function make(Q) {
    const nbf = Q.shells.reduce((a, s) => a + 2 * s.l + 1, 0);
    function basis(p, out) {
      let i = 0;
      for (const s of Q.shells) {
        const A = Q.atoms[s.atom], x = p[0] - A[0], y = p[1] - A[1], z = p[2] - A[2], r2 = x * x + y * y + z * z;
        let rad = 0; for (let k = 0; k < s.exp.length; k++) rad += s.coef[k] * Math.exp(-s.exp[k] * r2);
        if (s.l === 0) out[i++] = SH[0][0] * rad;
        else if (s.l === 1) { out[i++] = SH[1][0] * rad * x; out[i++] = SH[1][1] * rad * y; out[i++] = SH[1][2] * rad * z; }
        else { out[i++] = SH[2][0] * rad * x * y; out[i++] = SH[2][1] * rad * y * z; out[i++] = SH[2][2] * rad * (2 * z * z - x * x - y * y); out[i++] = SH[2][3] * rad * x * z; out[i++] = SH[2][4] * rad * (x * x - y * y); }
      }
    }
    const chi = new Float64Array(nbf);
    function rho(p) { basis(p, chi); let s = 0; for (let k = 0; k < Q.occ.length; k++) { let v = 0; const c = Q.C[k]; for (let m = 0; m < nbf; m++) v += c[m] * chi[m]; s += Q.occ[k] * v * v; } return s; }
    // GLSL: float rhoAt(vec3 p) with p in bohr (molecular frame: O at the origin, H at +-x, +z)
    function glsl() {
      const f = x => (x === 0 ? '0.0' : x.toExponential(8));
      const lines = [`float rhoAt(vec3 p) {`, `  float chi[${nbf}]; vec3 d; float r2, rad;`];
      let i = 0;
      for (const s of Q.shells) {
        const A = Q.atoms[s.atom];
        lines.push(`  d = p - vec3(${A.map(f).join(', ')}); r2 = dot(d, d); rad = ${s.exp.map((e, k) => `${f(s.coef[k])} * exp(${f(-e)} * r2)`).join(' + ')};`);
        if (s.l === 0) lines.push(`  chi[${i++}] = ${f(SH[0][0])} * rad;`);
        else if (s.l === 1) { lines.push(`  chi[${i}] = ${f(SH[1][0])} * rad * d.x; chi[${i + 1}] = ${f(SH[1][0])} * rad * d.y; chi[${i + 2}] = ${f(SH[1][0])} * rad * d.z;`); i += 3; }
        else { lines.push(`  chi[${i}] = ${f(SH[2][0])} * rad * d.x * d.y; chi[${i + 1}] = ${f(SH[2][1])} * rad * d.y * d.z; chi[${i + 2}] = ${f(SH[2][2])} * rad * (2.0 * d.z * d.z - d.x * d.x - d.y * d.y); chi[${i + 3}] = ${f(SH[2][3])} * rad * d.x * d.z; chi[${i + 4}] = ${f(SH[2][4])} * rad * (d.x * d.x - d.y * d.y);`); i += 5; }
      }
      lines.push('  float s = 0.0, v;');
      Q.C.forEach((c, k) => { lines.push(`  v = ${c.map((x, m) => Math.abs(x) < 1e-7 ? null : `${f(x)} * chi[${m}]`).filter(Boolean).join(' + ')}; s += ${f(Q.occ[k])} * v * v;`); });
      lines.push('  return s;', '}');
      return lines.join('\n');
    }
    return { rho, glsl, nbf };
  }
  const api = { make };
  root.PTEN_DENSITY = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
