// Pries, Neuhaus & Gaehtgens (1992) in-vitro fits for blood in glass tubes (D in µm); high-shear limit
function priesEta(D, HD) {
  const e45 = 220 * Math.exp(-1.3 * D) + 3.2 - 2.44 * Math.exp(-0.06 * D ** 0.645);
  const q = 1 / (1 + 1e-11 * D ** 12), C = (0.8 + Math.exp(-0.075 * D)) * (-1 + q) + q;
  return 1 + (e45 - 1) * ((1 - HD) ** C - 1) / ((1 - 0.45) ** C - 1);
}
// Fåhræus effect: tube / discharge haematocrit (Pries et al. 1990)
function priesHT(D, HD) { return HD * (HD + (1 - HD) * (1 + 1.7 * Math.exp(-0.415 * D) - 0.6 * Math.exp(-0.011 * D))); }
// invert for HD given HT
function priesHD(D, HT) { let lo = 0, hi = 1; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (priesHT(D, m) < HT) lo = m; else hi = m; } return lo; }
if (typeof module !== 'undefined') module.exports = { priesEta, priesHT, priesHD };
