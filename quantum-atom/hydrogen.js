// Exact hydrogen: eigenfunctions ψ_nlm, energies with the reduced-mass correction, electric-dipole
// matrix elements and Einstein A coefficients, all from the analytic solution (atomic units).
const H = (() => {
  const mp_me = 1836.15267343, mu = mp_me / (1 + mp_me); // reduced mass / mₑ
  const Ha_eV = 27.211386245988, c = 137.035999084, au_s = 2.4188843265857e-17;
  const R_inf_cm = 109737.31568160, R_H_cm = R_inf_cm * mu; // Rydberg constants, cm⁻¹

  // energy of level n in Hartree (infinite nuclear mass) and with the reduced mass
  const E = n => -0.5 / (n * n);
  const Emu = n => -0.5 * mu / (n * n);
  const fact = k => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
  // generalised Laguerre L_k^α(x)
  function laguerre(k, a, x){
    if (k === 0) return 1;
    let l0 = 1, l1 = 1 + a - x;
    for (let i = 1; i < k; i++){ const l2 = ((2 * i + 1 + a - x) * l1 - (i + a) * l0) / (i + 1); l0 = l1; l1 = l2; }
    return l1;
  }
  // normalised radial function R_nl(r), ∫ R² r² dr = 1
  function radial(n, l, r){
    const rho = 2 * r / n, N = Math.sqrt((2 / n) ** 3 * fact(n - l - 1) / (2 * n * fact(n + l)));
    return N * Math.exp(-rho / 2) * rho ** l * laguerre(n - l - 1, 2 * l + 1, rho);
  }
  // associated Legendre P_l^m(x), m ≥ 0, Condon–Shortley phase
  function legendre(l, m, x){
    let pmm = 1;
    if (m > 0){ const s = Math.sqrt((1 - x) * (1 + x)); let f = 1; for (let i = 1; i <= m; i++){ pmm *= -f * s; f += 2; } }
    if (l === m) return pmm;
    let pm1 = x * (2 * m + 1) * pmm;
    if (l === m + 1) return pm1;
    let pl = 0;
    for (let ll = m + 2; ll <= l; ll++){ pl = (x * (2 * ll - 1) * pm1 - (ll + m - 1) * pmm) / (ll - m); pmm = pm1; pm1 = pl; }
    return pl;
  }
  // real spherical harmonics (m > 0: cos mφ, m < 0: sin |m|φ), orthonormal
  function Yreal(l, m, th, ph){
    const am = Math.abs(m), N = Math.sqrt((2 * l + 1) / (4 * Math.PI) * fact(l - am) / fact(l + am));
    const P = legendre(l, am, Math.cos(th));
    if (m === 0) return N * P;
    return Math.SQRT2 * N * P * (m > 0 ? Math.cos(am * ph) : Math.sin(am * ph)) * (am % 2 ? -1 : 1);
  }
  function psiReal(n, l, m, x, y, z){
    const r = Math.hypot(x, y, z), th = r > 0 ? Math.acos(z / r) : 0, ph = Math.atan2(y, x);
    return radial(n, l, r) * Yreal(l, m, th, ph);
  }
  // radial integral ∫ R_nl R_n'l' r³ dr by Gauss–Laguerre-free brute quadrature (smooth integrand)
  function radInt(n1, l1, n2, l2, pw = 3){
    const rmax = 8 * Math.max(n1, n2) ** 2 + 40, N = 20000, h = rmax / N;
    let s = 0;
    for (let i = 1; i < N; i++){ const r = i * h; s += (i % 2 ? 4 : 2) * radial(n1, l1, r) * radial(n2, l2, r) * r ** pw; }
    return s * h / 3;
  }
  // angular factor of the dipole between complex-m states, summed over polarisations:
  // Σ_q |<l m|C_q|l' m'>|² summed over m' = max(l,l')/(2l+1) for l' = l ± 1
  // line strength-based Einstein A for n l → n' l' (summed over final m, averaged over initial m)
  function einsteinA(n1, l1, n2, l2){
    if (Math.abs(l1 - l2) !== 1) return 0;
    const dE = Emu(n1) - Emu(n2); // Hartree, >0 for emission
    if (dE <= 0) return 0;
    // reduced-mass scaling: lengths scale 1/μ, the radial integral as 1/μ
    const Rint = radInt(n1, l1, n2, l2) / mu, lmax = Math.max(l1, l2);
    const d2 = Rint * Rint * lmax / (2 * l1 + 1); // |<f|r|i>|² summed over final m, averaged over initial
    const w = dE; // angular frequency in a.u.
    return 4 * w ** 3 * d2 / (3 * c ** 3) / au_s; // s⁻¹
  }
  // vacuum wavenumber and wavelengths of n1 → n2 (with the reduced mass)
  const wavenumber = (n1, n2) => R_H_cm * (1 / (n2 * n2) - 1 / (n1 * n1));
  const lambdaVac_nm = (n1, n2) => 1e7 / wavenumber(n1, n2);
  // refractive index of standard air (Edlén 1966 / Morton 2000), σ in µm⁻¹
  function nAir(lam_vac_nm){
    const s2 = (1e3 / lam_vac_nm) ** 2;
    return 1 + 8.34254e-5 + 2.406147e-2 / (130 - s2) + 1.5998e-4 / (38.9 - s2);
  }
  const lambdaAir_nm = (n1, n2) => { const l = lambdaVac_nm(n1, n2); return l > 200 ? l / nAir(l) : l; };
  return { mu, Ha_eV, c, au_s, R_H_cm, E, Emu, laguerre, radial, legendre, Yreal, psiReal, radInt, einsteinA, wavenumber, lambdaVac_nm, lambdaAir_nm, nAir };
})();
if (typeof module !== 'undefined') module.exports = H;
