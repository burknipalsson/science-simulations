// Physical <-> lattice units for the blood sims.
// Stokes flow with elastic cells is set by ratios (capillary number η u / Gs, bending κ / Gs d², geometry), so we
// pick the lattice membrane modulus GsL freely: it fixes how many lattice steps one physical second takes. The fluid
// inertia (Reynolds number) is the one thing this speeds up: it stays well below 1, as in real capillaries.
class Units {
  constructor({ dx = 0.5e-6, eta = 1.2e-3, Gs = 5.3e-6, GsL = 2e-3, tau = 1 } = {}) {
    const etaL = (tau - 0.5) / 3; // lattice density 1
    Object.assign(this, { dx, eta, Gs, GsL, tau, etaL });
    this.V = (Gs / eta) / (GsL / etaL);  // m/s per lattice velocity unit
    this.dt = dx / this.V;               // seconds per step
    this.P = eta * this.V / dx / etaL;   // Pa per lattice stress unit
  }
  len(m) { return m / this.dx; }                              // metres -> lattice
  vel(ms) { return ms / this.V; }                             // m/s -> lattice
  force(N) { return N / (this.P * this.dx * this.dx); }       // newtons -> lattice
  modulus(Nm) { return Nm / (this.P * this.dx); }             // N/m -> lattice
  energy(J) { return J / (this.P * this.dx ** 3); }           // joules -> lattice
  gradP(Pam) { return Pam / (this.P / this.dx); }             // Pa/m -> lattice body force density
  steps(s) { return s / this.dt; }
}
if (typeof module !== 'undefined') module.exports = { Units };
