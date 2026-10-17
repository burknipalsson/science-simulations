// Validate the exact hydrogen module against textbook and NIST values.
const H = require('./hydrogen.js');
const ok = (name, got, want, rel) => console.log(`${Math.abs(got - want) <= rel * Math.abs(want) ? 'PASS' : 'FAIL'}  ${name}: ${got.toPrecision(7)} vs ${want.toPrecision(7)} (rel ${rel})`);

// normalisation and <r> = (3n² − l(l+1))/2 for a few states
for (const [n, l] of [[1, 0], [2, 0], [2, 1], [3, 2], [4, 3], [5, 1]]){
  ok(`norm R_${n}${l}`, H.radInt(n, l, n, l, 2), 1, 1e-9);
  ok(`<r> ${n}${'spdfg'[l]}`, H.radInt(n, l, n, l, 3), (3 * n * n - l * (l + 1)) / 2, 1e-9);
}
// orthonormality of real orbitals: 3D quadrature of ψ_2px·ψ_2px and ψ_2px·ψ_2py on a grid
{
  let a = 0, b = 0, c = 0; const h = 0.25, L = 30;
  for (let x = -L; x < L; x += h) for (let y = -L; y < L; y += h) for (let z = -L; z < L; z += h){
    const p = H.psiReal(2, 1, 1, x + h / 2, y + h / 2, z + h / 2), q = H.psiReal(2, 1, -1, x + h / 2, y + h / 2, z + h / 2), s = H.psiReal(3, 2, 0, x + h / 2, y + h / 2, z + h / 2);
    a += p * p; b += p * q; c += s * s;
  }
  ok('<2p+1|2p+1> on a 3D grid', a * h ** 3, 1, 2e-3);
  console.log(`     <2p+1|2p−1> = ${(b * h ** 3).toExponential(2)} (should be 0);  <3d0|3d0> = ${(c * h ** 3).toFixed(5)}`);
}
// dipole <1s|z|2p0> = 128√2/243 (infinite mass)
ok('<1s|z|2p0> = 128√2/243', H.radInt(2, 1, 1, 0) / Math.sqrt(3), 128 * Math.SQRT2 / 243, 1e-9);
// Einstein A coefficients vs NIST ASD (Wiese & Fuhr 2009), s⁻¹
const A = [
  ['2p→1s (Lyman α)', 2, 1, 1, 0, 6.2649e8],
  ['3p→1s (Lyman β)', 3, 1, 1, 0, 1.6725e8],
  ['3s→2p', 3, 0, 2, 1, 6.3143e6],
  ['3p→2s', 3, 1, 2, 0, 2.2449e7],
  ['3d→2p', 3, 2, 2, 1, 6.4651e7],
  ['4d→2p (H β)', 4, 2, 2, 1, 2.0625e7],
  ['4f→3d', 4, 3, 3, 2, 1.3789e7],
];
for (const [name, n1, l1, n2, l2, ref] of A) ok(`A ${name}`, H.einsteinA(n1, l1, n2, l2), ref, 2e-3);
ok('2p lifetime (ns)', 1e9 / H.einsteinA(2, 1, 1, 0), 1.5961, 2e-3);
// wavelengths: NIST Ritz values (air above 200 nm), fine structure averaged
ok('Lyman α vac (nm)', H.lambdaVac_nm(2, 1), 121.567, 2e-5);
ok('H α air (nm)', H.lambdaAir_nm(3, 2), 656.279, 2e-5);
ok('H β air (nm)', H.lambdaAir_nm(4, 2), 486.135, 2e-5);
ok('H γ air (nm)', H.lambdaAir_nm(5, 2), 434.047, 2e-5);
ok('H δ air (nm)', H.lambdaAir_nm(6, 2), 410.174, 2e-5);
ok('Paschen α air (nm)', H.lambdaAir_nm(4, 3), 1875.10, 5e-5);
ok('ionisation energy (eV)', -H.Emu(1) * H.Ha_eV, 13.598, 1e-4);
