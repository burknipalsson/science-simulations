// mW monatomic water (Molinero & Moore 2009), CPU reference.  Units: Å, ps, amu, kJ/mol, K.
// Stillinger–Weber form: two-body + three-body tetrahedral term.  The three-body force is
// computed GPU-style in two passes: per-particle moments (F, V, T) of its neighbour directions,
// then a pair loop that needs only those moments (no neighbour lists, no triple loops).
'use strict';
const KBm = 0.0083144626;
const MW = {
  eps: 6.189 * 4.184, sigma: 2.3925, a: 1.8, lambda: 23.15, gamma: 1.2,
  A: 7.049556277, B: 0.6022245584, cos0: -1 / 3, mass: 18.015,
};
MW.rc = MW.a * MW.sigma;

class MWater {
  constructor(N, box) {
    this.N = N; this.box = box.slice();
    this.x = new Float64Array(3 * N); this.v = new Float64Array(3 * N); this.f = new Float64Array(3 * N);
    this.mom = new Float64Array(11 * N);   // F, Vx,Vy,Vz, Txx,Tyy,Tzz,Txy,Txz,Tyz, Q=Σg²
    this.epot = 0; this.vir = [0, 0, 0];
    this.solute = new Uint8Array(N);       // 1 = solute particle: no three-body term
  }

  // linked cells; calls fn(i, j, rx, ry, rz, r) for every ordered pair within rc
  eachPair(fn) {
    const N = this.N, L = this.box, rc = MW.rc;
    const nc = L.map(l => Math.max(3, Math.floor(l / rc)));
    const head = new Int32Array(nc[0] * nc[1] * nc[2]).fill(-1), next = new Int32Array(N);
    const cc = (x, d) => { let c = Math.floor((x / L[d] - Math.floor(x / L[d])) * nc[d]); return c >= nc[d] ? nc[d] - 1 : c; };
    const cell = new Int32Array(3 * N);
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 3; d++) cell[3*i+d] = cc(this.x[3*i+d], d);
      const c = (cell[3*i+2] * nc[1] + cell[3*i+1]) * nc[0] + cell[3*i];
      next[i] = head[c]; head[c] = i;
    }
    const rc2 = rc * rc;
    for (let i = 0; i < N; i++) {
      const seen = new Set();
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = (((cell[3*i+2] + dz + nc[2]) % nc[2]) * nc[1] + ((cell[3*i+1] + dy + nc[1]) % nc[1])) * nc[0] + ((cell[3*i] + dx + nc[0]) % nc[0]);
        if (seen.has(c)) continue; seen.add(c);
        for (let j = head[c]; j >= 0; j = next[j]) {
          if (j === i) continue;
          let rx = this.x[3*j] - this.x[3*i], ry = this.x[3*j+1] - this.x[3*i+1], rz = this.x[3*j+2] - this.x[3*i+2];
          rx -= L[0] * Math.round(rx / L[0]); ry -= L[1] * Math.round(ry / L[1]); rz -= L[2] * Math.round(rz / L[2]);
          const r2 = rx*rx + ry*ry + rz*rz;
          if (r2 < rc2) fn(i, j, rx, ry, rz, Math.sqrt(r2));
        }
      }
    }
  }

  forces() {
    const { eps, sigma, a, lambda, gamma, A, B, cos0: c } = MW, rc = MW.rc;
    const N = this.N, m = this.mom, f = this.f, sol = this.solute;
    m.fill(0); f.fill(0);
    // pass 1: moments of neighbour directions (r_ij from i to j), weighted by g(r)=exp(γσ/(r-aσ))
    this.eachPair((i, j, rx, ry, rz, r) => {
      if (sol[i] || sol[j]) return;
      const g = Math.exp(gamma * sigma / (r - rc)), ux = rx / r, uy = ry / r, uz = rz / r, o = 11 * i;
      m[o] += g; m[o+10] += g*g; m[o+1] += g*ux; m[o+2] += g*uy; m[o+3] += g*uz;
      m[o+4] += g*ux*ux; m[o+5] += g*uy*uy; m[o+6] += g*uz*uz; m[o+7] += g*ux*uy; m[o+8] += g*ux*uz; m[o+9] += g*uy*uz;
    });
    // pass 2: pair loop
    let e2 = 0, e3 = 0; const vir = [0, 0, 0];
    const le = lambda * eps;
    // dE_j/dr_i for centre with moments M (offset o), neighbour at relative vector u*r with weight g
    const grad3 = (o, ux, uy, uz, r, g, out) => {
      const F = m[o], Vx = m[o+1], Vy = m[o+2], Vz = m[o+3];
      const Tu = [m[o+4]*ux + m[o+7]*uy + m[o+8]*uz, m[o+7]*ux + m[o+5]*uy + m[o+9]*uz, m[o+8]*ux + m[o+9]*uy + m[o+6]*uz];
      const uTu = ux*Tu[0] + uy*Tu[1] + uz*Tu[2], Vu = Vx*ux + Vy*uy + Vz*uz;
      const dEdg = le * (uTu - 2*c*Vu + c*c*F - (1-c)*(1-c)*g);
      const gp = -g * gamma * sigma / ((r - rc) * (r - rc));
      // ∂E/∂u = le*(2 g T u - 2 c g V); project perpendicular to u, divide by r
      const wx = le * (2*g*Tu[0] - 2*c*g*Vx), wy = le * (2*g*Tu[1] - 2*c*g*Vy), wz = le * (2*g*Tu[2] - 2*c*g*Vz);
      const wu = wx*ux + wy*uy + wz*uz;
      out[0] = dEdg * gp * ux + (wx - wu*ux) / r;
      out[1] = dEdg * gp * uy + (wy - wu*uy) / r;
      out[2] = dEdg * gp * uz + (wz - wu*uz) / r;
    };
    const ga = [0, 0, 0], gb = [0, 0, 0];
    this.eachPair((i, j, rx, ry, rz, r) => {
      // two-body (each unordered pair seen twice: half energy, force on i only)
      const sr4 = (sigma / r) ** 4, ex = Math.exp(sigma / (r - rc));
      const phi = A * eps * (B * sr4 - 1) * ex;
      const dphi = A * eps * ex * (-4 * B * sr4 / r - (B * sr4 - 1) * sigma / ((r - rc) * (r - rc)));
      e2 += 0.5 * phi;
      // force on i = +dphi * u (u points from i to j)
      let fx = dphi * rx / r, fy = dphi * ry / r, fz = dphi * rz / r;
      ga[0] = ga[1] = ga[2] = 0;
      if (!sol[i] && !sol[j]) {
        const g = Math.exp(gamma * sigma / (r - rc)), ux = rx / r, uy = ry / r, uz = rz / r;
        // i as centre: E_i depends on r_j - x_i; F_i += dE_i/dr_j
        grad3(11 * i, ux, uy, uz, r, g, ga);
        // i as neighbour of centre j: relative vector -u; F_i += -dE_j/d(x_i - x_j)
        grad3(11 * j, -ux, -uy, -uz, r, g, gb);
        fx += ga[0] - gb[0]; fy += ga[1] - gb[1]; fz += ga[2] - gb[2];
      }
      f[3*i] += fx; f[3*i+1] += fy; f[3*i+2] += fz;
      // virial W = -Σ r·∂E/∂r: two-body pairs are visited twice, each centre–neighbour term once
      vir[0] -= 0.5 * rx * dphi * rx / r + rx * ga[0]; vir[1] -= 0.5 * ry * dphi * ry / r + ry * ga[1]; vir[2] -= 0.5 * rz * dphi * rz / r + rz * ga[2];
    });
    for (let i = 0; i < N; i++) {
      if (sol[i]) continue;
      const o = 11 * i, F = m[o], V2 = m[o+1]**2 + m[o+2]**2 + m[o+3]**2;
      const trT2 = m[o+4]**2 + m[o+5]**2 + m[o+6]**2 + 2 * (m[o+7]**2 + m[o+8]**2 + m[o+9]**2);
      e3 += 0.5 * le * (trT2 - 2*c*V2 + c*c*F*F - (1-c)*(1-c)*m[o+10]);
    }
    this.e2 = e2; this.e3 = e3; this.epot = e2 + e3; this.vir = vir;
    return this.epot;
  }

  // brute-force energy (for tests): explicit triples
  energyDirect() {
    const { eps, sigma, lambda, gamma, A, B, cos0: c } = MW, rc = MW.rc;
    const nb = Array.from({ length: this.N }, () => []);
    let e2 = 0;
    this.eachPair((i, j, rx, ry, rz, r) => {
      e2 += 0.5 * A * eps * (B * (sigma / r) ** 4 - 1) * Math.exp(sigma / (r - rc));
      nb[i].push([rx, ry, rz, r, j]);
    });
    let e3 = 0;
    for (let j = 0; j < this.N; j++) {
      if (this.solute[j]) continue;
      const l = nb[j].filter(n => !this.solute[n[4]]);
      for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) {
        const [x1, y1, z1, r1] = l[a], [x2, y2, z2, r2] = l[b];
        const ct = (x1*x2 + y1*y2 + z1*z2) / (r1 * r2);
        e3 += lambda * eps * (ct - c) ** 2 * Math.exp(gamma * sigma / (r1 - rc)) * Math.exp(gamma * sigma / (r2 - rc));
      }
    }
    return { e2, e3 };
  }

  kinetic() { let k = 0; const kd = [0, 0, 0]; for (let i = 0; i < 3 * this.N; i++) { const e = 0.005 * MW.mass * this.v[i] ** 2; k += e; kd[i % 3] += e; } return { k, kd }; }

  measure() {
    const { k, kd } = this.kinetic(), V = this.box[0] * this.box[1] * this.box[2];
    const T = 2 * k / ((3 * this.N - 3) * KBm);
    const P = (2 * k + this.vir[0] + this.vir[1] + this.vir[2]) / (3 * V) * 16605.39;
    const Pd = [0, 1, 2].map(d => (2 * kd[d] + this.vir[d]) / V * 16605.39);
    return { T, P, Pd, epot: this.epot, k, V, rho: this.N * MW.mass / V * 1.66053907 };
  }

  step(dt) {
    const s = 100 / MW.mass, N3 = 3 * this.N;
    for (let i = 0; i < N3; i++) { this.v[i] += 0.5 * dt * s * this.f[i]; this.x[i] += dt * this.v[i]; }
    this.forces();
    for (let i = 0; i < N3; i++) this.v[i] += 0.5 * dt * s * this.f[i];
  }

  thermostat(T0, tau, dt) {
    const { csvr } = (typeof require !== 'undefined' ? require('./tip4p_cpu.js') : self);
    const K = this.kinetic().k, nf = 3 * this.N - 3;
    const s = Math.sqrt(csvr(K, 0.5 * nf * KBm * T0, nf, tau, dt));
    for (let i = 0; i < 3 * this.N; i++) this.v[i] *= s;
  }

  barostat(P0, T0, tauP, dt, mode = 'iso', compress = 4.5e-5) {
    const { gauss } = (typeof require !== 'undefined' ? require('./tip4p_cpu.js') : self);
    const m = this.measure(), BAR = 1 / 16605.39, beta = compress / BAR, kT = KBm * T0;
    const Pin = (mode === 'iso' ? m.P : m.Pd[2]) * BAR;
    const deps = -beta / tauP * (P0 * BAR - Pin) * dt + Math.sqrt(2 * kT * beta * dt / (m.V * tauP)) * gauss();
    if (mode === 'iso') {
      const mu = Math.exp(deps / 3);
      for (let d = 0; d < 3; d++) this.box[d] *= mu;
      for (let i = 0; i < 3 * this.N; i++) { this.x[i] *= mu; this.v[i] /= mu; }
    } else {
      const mu = Math.exp(deps); this.box[2] *= mu;
      for (let i = 0; i < this.N; i++) { this.x[3*i+2] *= mu; this.v[3*i+2] /= mu; }
    }
  }

  thermalize(T0, rng = Math.random) {
    const { gauss } = (typeof require !== 'undefined' ? require('./tip4p_cpu.js') : self);
    const sv = Math.sqrt(KBm * T0 / MW.mass * 100), mom = [0, 0, 0];
    for (let i = 0; i < 3 * this.N; i++) { this.v[i] = sv * gauss(rng); mom[i % 3] += this.v[i]; }
    for (let i = 0; i < 3 * this.N; i++) this.v[i] -= mom[i % 3] / this.N;
  }
}

if (typeof module !== 'undefined') module.exports = { MWater, MW }; else Object.assign(self, { MWater, MW_CPU: MW });
