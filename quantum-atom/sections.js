// Field guide entries (with "show me" buttons that drive the main stage) and the comparison table.
(() => {
const $ = id => document.getElementById(id);
const stage = () => $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
const setRange = (id, v) => { const el = $(id); el.value = v; el.oninput(); };
const show = (scene, opts = {}) => () => {
  if (!APP) return;
  if (opts.eV) setRange('energy', opts.eV);
  if (opts.sep) setRange('sep', opts.sep);
  APP.loadScene(scene);
  if (opts.fast && !APP.state.fast) $('fast').click();
  stage();
};
const G = [
  ['Two slits', 'One electron, one dot', 'Each electron is a wave that passes through both slits, yet it lands at a single spot. The stripes only build up over thousands of electrons. In 1989 Akira Tonomura\'s team at Hitachi filmed exactly this build-up with real electrons, arriving one at a time.', show('double', { eV: 54.4, sep: 20, fast: true }), 'Fire thousands'],
  ['Watch which slit', 'Looking destroys the stripes', 'A detector that learns which slit each electron used collapses its wave to one side. A plain hump replaces the stripes. The electron hasn\'t been pushed; what changed is the information.', show('watch', { eV: 54.4, sep: 20, fast: true }), 'Watch the slits'],
  ['Wavelength', 'Faster electrons, finer stripes', 'An electron\'s wavelength is Planck\'s constant divided by its momentum. Speed it up and the stripes crowd together. At 54 eV (the energy Davisson and Germer used in 1927 to prove electrons are waves) it is 0.167 nm; at 150 eV, 0.100 nm.', show('double', { eV: 150, sep: 20 }), 'Fire 150 eV electrons'],
  ['Spacing', 'Slits apart, stripes together', 'The stripes sit where the paths from the two slits differ by whole wavelengths. Spread the slits and the angle between stripes shrinks: θ ≈ λ/d.', show('double', { eV: 54.4, sep: 38 }), 'Spread the slits'],
  ['One slit', 'Squeeze it and it spreads', 'Confine the wave to a 0.2 nm gap and it fans out widely. Pin down where something is and you lose track of where it is going: Heisenberg\'s uncertainty principle.', show('single', { eV: 54.4 }), 'Show one slit'],
  ['Barrier', 'Through a wall it cannot climb', 'A wall taller than the electron\'s energy still lets part of the wave through. Each electron either bounces or appears on the far side; the odds come from the wave.', show('barrier', { eV: 54.4 }), 'Show tunnelling'],
];
$('guide').innerHTML = G.map((g, i) => `<div class="entry"><div class="where">${g[0]}</div><h3>${g[1]}</h3><p>${g[2]}</p><button class="show" data-i="${i}">${g[4]} →</button></div>`).join('');
[...$('guide').querySelectorAll('.show')].forEach(b => { b.onclick = G[+b.dataset.i][3]; });

const C = [
  ['Double-slit stripe spacing', '2.30 nm', '2.32 nm', 'sin θ = λ/d with λ 0.166 nm, d 1.06 nm; the effective screen distance is uncertain by ~1%'],
  ['Stripe contrast, slits unwatched → watched', '0.995 → none', '1 → none', 'watched, the stripes vanish and only a smooth hump remains'],
  ['Tunnelling, 58 eV wall, 0.1 nm thick', '28.5%', '28.5%', 'exact transfer-matrix calculation for the same wall'],
  ['Tunnelling lab, down to 1 in 50,000', 'within 0.4%', 'exact', 'over the whole range of the sliders'],
  ['Energy to ionise hydrogen', '13.598 eV', '13.598 eV', 'NIST'],
  ['H-α line (red, in air)', '656.29 nm', '656.28 nm', 'NIST; the 0.01 nm is spin and relativity, left out'],
  ['Lyman α line (ultraviolet)', '121.57 nm', '121.57 nm', 'NIST'],
  ['Lifetime of the 2p state', '1.596 ns', '1.596 ns', 'NIST, from the measured decay rate'],
  ['Lifetime of the 3d state', '15.47 ns', '15.47 ns', 'NIST'],
  ['H₂⁺ bond length', '1.0569 Å', '1.0569 Å', 'exact Born–Oppenheimer value'],
  ['H₂⁺ energy to break the bond', '2.650 eV', '2.651 eV', 'measured; the rest is from protons not being infinitely heavy'],
  ['H₂⁺ vibration frequency', '2191 cm⁻¹', '2191 cm⁻¹', 'measured fundamental'],
  ['Proton precession at 3 T', '127.73 MHz', '127.73 MHz', 'CODATA gyromagnetic ratio'],
  ['Spin-echo strength at TE', 'e^(−TE/T2)', 'e^(−TE/T2)', 'to 1 part in 10,000 for a voxel of 20,000 spins'],
];
$('cmpTable').innerHTML = '<tr><th>Quantity</th><th>This page</th><th>Exact or measured</th></tr>' + C.map(r => `<tr><td>${r[0]}<span class="why">${r[3]}</span></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
})();
