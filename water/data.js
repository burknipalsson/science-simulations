// Validation data measured with this engine (gpu_cases.js: t4_npt, mw_npt, t4_dyn, *_coex) and real-water references.
window.WATER_DATA = {
  real: {
    // IAPWS-95 at 1 atm; below 0 °C supercooled water (Hare & Sorensen 1987)
    liquid: [[243.15, 0.98389], [253.15, 0.99349], [263.15, 0.99815], [273.15, 0.99984], [277.13, 0.99997], [283.15, 0.99970], [293.15, 0.99820], [298.15, 0.99705], [303.15, 0.99565], [313.15, 0.99222], [323.15, 0.98803], [333.15, 0.98320]],
    ice: [[243.15, 0.9203], [253.15, 0.9194], [263.15, 0.9182], [273.15, 0.9167]],
  },
  // TIP4P/2005 with damped shifted force electrostatics (rc 9 Å), 2048 molecules, 1 ns each at 1 bar; ±0.0003
  tip4p: {
    liquid: [[250, 0.9936], [260, 0.9968], [270, 0.9984], [280, 0.9982], [290, 0.9969], [298, 0.9946], [310, 0.9898], [320, 0.9858], [330, 0.9810]],
    ice: [[200, 0.9294], [250, 0.9217]],
  },
  // mW, 1920 particles, 1 ns (liquid) / 0.3 ns (ice)
  mw: {
    liquid: [[240, 1.0034], [250, 1.0042], [260, 1.0034], [270, 1.0019], [280, 1.0008], [298, 0.9973], [320, 0.9925]],
    ice: [[250, 0.9800], [273, 0.9785]],
  },
  table: [
    ['Liquid density at 25 °C', '0.997 g/cm³', '0.995 <span class="why">published TIP4P/2005: 0.998</span>', '0.997', 'grams per cubic centimetre at 1 atm'],
    ['Temperature of maximum density', '277 K (4 °C)', '≈ 275 K <span class="why">published: 278 K</span>', '250 K <span class="why">published: 250 K</span>', 'why lakes freeze from the top'],
    ['Density of ice', '0.917 g/cm³ <span class="why">at 0 °C</span>', '0.922 <span class="why">at 250 K; published 0.921</span>', '0.979 <span class="why">at 273 K; published 0.978</span>', 'ordinary hexagonal ice, 1 atm'],
    ['Ice is lighter than water by', '9.1%', '7.8% <span class="why">both at 250 K, the model\'s melting point</span>', '2.4%', 'liquid density ÷ ice density − 1, at the melting point'],
    ['Melting point', '273.15 K (0 °C)', '250–255 K <span class="why">published: 250–252 K</span>', '274–278 K <span class="why">published: 274.6 K</span>', 'found by putting ice and water in contact and seeing which grows'],
    ['Nearest-neighbour distance', '2.80 Å', '2.79 Å', '—', 'first peak of the oxygen–oxygen distribution, X-ray data'],
    ['Height of that peak', '2.57', '3.22', '—', 'classical models are too ordered: real hydrogens\' quantum jitter blurs the structure'],
    ['Self-diffusion at 25 °C', '2.30 × 10⁻⁹ m²/s', '2.41 <span class="why">2.27 in the 5 nm box, corrected for its size</span>', '≈ 6.5 <span class="why">published; mW molecules slide too easily</span>', 'how fast a molecule wanders through the liquid'],
    ['Hydrogen bonds per molecule, 25 °C', '— <span class="why">not directly measurable</span>', '3.64', '—', 'counted with O–O < 3.5 Å and angle < 30°'],
  ],
};
