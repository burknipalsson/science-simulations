// TIP4P/2005 rigid water, CPU reference (runs in node and the browser).
// Units: Å, ps, amu, kJ/mol, e, K.  Rigid bodies: centre of mass + quaternion, integrated with
// NO_SQUISH (Miller et al. 2002).  Electrostatics: damped shifted force (Fennell & Gezelter 2006).
'use strict';

const KB = 0.0083144626;            // kJ/mol/K
const KC = 1389.35458;              // Coulomb constant, kJ/mol·Å/e²
const BAR = 1 / 16605.39;           // 1 bar in kJ/mol/Å³
const AMU_A3_TO_GCC = 1.66053907;   // amu/Å³ -> g/cm³

// ---- TIP4P/2005 parameters (Abascal & Vega 2005) ----
const T4 = {
  rOH: 0.9572, theta: 104.52 * Math.PI / 180, dOM: 0.1546,
  qH: 0.5564, sigma: 3.1589, eps: 93.2 * KB,
  mO: 15.9994, mH: 1.008,
};
T4.qM = -2 * T4.qH;
T4.mass = T4.mO + 2 * T4.mH;

// Body frame: z along the HOH bisector (towards the H's), x in plane, y normal to the plane.
// Origin at the centre of mass.  These axes are the principal axes by symmetry.
const BODY = (() => {
  const hx = T4.rOH * Math.sin(T4.theta / 2), hz = T4.rOH * Math.cos(T4.theta / 2);
  const zc = 2 * T4.mH * hz / T4.mass;            // COM height above O
  const O = [0, 0, -zc], H1 = [hx, 0, hz - zc], H2 = [-hx, 0, hz - zc], M = [0, 0, T4.dOM - zc];
  const I = [0, 0, 0];
  for (const [m, s] of [[T4.mO, O], [T4.mH, H1], [T4.mH, H2]]) {
    I[0] += m * (s[1] * s[1] + s[2] * s[2]);
    I[1] += m * (s[0] * s[0] + s[2] * s[2]);
    I[2] += m * (s[0] * s[0] + s[1] * s[1]);
  }
  return { O, H1, H2, M, I };
})();

// ---- quaternion helpers (q = [q0,q1,q2,q3], R(q) maps body -> lab) ----
function rotMat(q0, q1, q2, q3, R) {
  R[0] = q0*q0+q1*q1-q2*q2-q3*q3; R[1] = 2*(q1*q2-q0*q3);         R[2] = 2*(q1*q3+q0*q2);
  R[3] = 2*(q1*q2+q0*q3);         R[4] = q0*q0-q1*q1+q2*q2-q3*q3; R[5] = 2*(q2*q3-q0*q1);
  R[6] = 2*(q1*q3-q0*q2);         R[7] = 2*(q2*q3+q0*q1);         R[8] = q0*q0-q1*q1-q2*q2+q3*q3;
  return R;
}
function matToQuat(R) {  // rows of R: R[0..2] = first row
  const tr = R[0] + R[4] + R[8];
  let q0, q1, q2, q3;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q0 = s / 4; q1 = (R[7] - R[5]) / s; q2 = (R[2] - R[6]) / s; q3 = (R[3] - R[1]) / s; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; q0 = (R[7] - R[5]) / s; q1 = s / 4; q2 = (R[1] + R[3]) / s; q3 = (R[2] + R[6]) / s; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; q0 = (R[2] - R[6]) / s; q1 = (R[1] + R[3]) / s; q2 = s / 4; q3 = (R[5] + R[7]) / s; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; q0 = (R[3] - R[1]) / s; q1 = (R[2] + R[6]) / s; q2 = (R[5] + R[7]) / s; q3 = s / 4; }
  const n = Math.hypot(q0, q1, q2, q3);
  return [q0 / n, q1 / n, q2 / n, q3 / n];
}
// P_k applied to a 4-vector (right-multiplication by the unit quaternions i, j, k)
function Pk(k, a, o) {
  if (k === 1) { o[0] = -a[1]; o[1] = a[0]; o[2] = a[3]; o[3] = -a[2]; }
  else if (k === 2) { o[0] = -a[2]; o[1] = -a[3]; o[2] = a[0]; o[3] = a[1]; }
  else { o[0] = -a[3]; o[1] = a[2]; o[2] = -a[1]; o[3] = a[0]; }
  return o;
}

// erfc: Abramowitz & Stegun 7.1.26 (|err| < 1.5e-7), same formula as the GPU shader
function erfcAS(x) {
  const t = 1 / (1 + 0.3275911 * x);
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
}

// ---- the system ----
class Tip4p {
  constructor(N, box, opt = {}) {
    this.N = N;
    this.box = box.slice();                // [Lx, Ly, Lz]
    this.rc = opt.rc || 9.0;
    this.alpha = opt.alpha ?? 0.2;
    this.com = new Float64Array(3 * N); this.v = new Float64Array(3 * N);
    this.q = new Float64Array(4 * N); this.p = new Float64Array(4 * N);
    this.f = new Float64Array(3 * N); this.tq = new Float64Array(3 * N);   // force, lab torque
    this.sites = new Float64Array(12 * N);     // O, H1, H2, M lab positions (absolute)
    this.vir = [0, 0, 0]; this.epot = 0;
    const a = this.alpha, rc = this.rc, sp = 2 * a / Math.sqrt(Math.PI);
    this.ec = erfcAS(a * rc) / rc;                                   // shift
    this.fc = erfcAS(a * rc) / (rc * rc) + sp * Math.exp(-a * a * rc * rc) / rc;   // force shift
  }

  // lab-frame site positions of every molecule
  buildSites() {
    const R = new Float64Array(9), B = BODY;
    for (let i = 0; i < this.N; i++) {
      rotMat(this.q[4*i], this.q[4*i+1], this.q[4*i+2], this.q[4*i+3], R);
      const c = 3 * i;
      [B.O, B.H1, B.H2, B.M].forEach((s, k) => {
        const o = 12 * i + 3 * k;
        this.sites[o]   = this.com[c]   + R[0]*s[0] + R[1]*s[1] + R[2]*s[2];
        this.sites[o+1] = this.com[c+1] + R[3]*s[0] + R[4]*s[1] + R[5]*s[2];
        this.sites[o+2] = this.com[c+2] + R[6]*s[0] + R[7]*s[1] + R[8]*s[2];
      });
    }
  }

  // forces, torques, potential energy, molecular virial tensor diagonal
  forces() {
    const N = this.N, L = this.box, rc = this.rc, rc2 = rc * rc, a = this.alpha;
    const sp = 2 * a / Math.sqrt(Math.PI), ec = this.ec, fc = this.fc;
    const sig2 = T4.sigma * T4.sigma, eps4 = 4 * T4.eps;
    const qs = [0, T4.qH, T4.qH, T4.qM];
    this.buildSites();
    this.f.fill(0); this.tq.fill(0);
    let epot = 0; const vir = [0, 0, 0];
    // linked cells on COM, cell size >= rc + 2 Å (sites are within ~1 Å of the COM)
    const rs = rc + 2.0;
    const nc = L.map(l => Math.max(3, Math.floor(l / rs)));
    const head = new Int32Array(nc[0] * nc[1] * nc[2]).fill(-1), next = new Int32Array(N);
    const cellOf = (x, d) => { let c = Math.floor((x / L[d] - Math.floor(x / L[d])) * nc[d]); return c >= nc[d] ? nc[d] - 1 : c; };
    for (let i = 0; i < N; i++) {
      const c = (cellOf(this.com[3*i+2], 2) * nc[1] + cellOf(this.com[3*i+1], 1)) * nc[0] + cellOf(this.com[3*i], 0);
      next[i] = head[c]; head[c] = i;
    }
    const S = this.sites, fi = [0, 0, 0];
    const pairs = [];
    for (let i = 0; i < N; i++) {
      const cx = cellOf(this.com[3*i], 0), cy = cellOf(this.com[3*i+1], 1), cz = cellOf(this.com[3*i+2], 2);
      const seen = new Set();
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const c = (((cz + dz + nc[2]) % nc[2]) * nc[1] + ((cy + dy + nc[1]) % nc[1])) * nc[0] + ((cx + dx + nc[0]) % nc[0]);
        if (seen.has(c)) continue; seen.add(c);
        for (let j = head[c]; j >= 0; j = next[j]) {
          if (j <= i) continue;
          // minimum image on the COM separation; same shift for all sites
          const sh = [0, 0, 0];
          for (let d = 0; d < 3; d++) { const dd = this.com[3*i+d] - this.com[3*j+d]; sh[d] = -L[d] * Math.round(dd / L[d]); }
          const fij = [0, 0, 0];
          for (let sa = 0; sa < 4; sa++) for (let sb = 0; sb < 4; sb++) {
            const lj = sa === 0 && sb === 0;
            if (!lj && (sa === 0 || sb === 0)) continue;
            const oa = 12*i + 3*sa, ob = 12*j + 3*sb;
            const rx = S[oa] - S[ob] + sh[0], ry = S[oa+1] - S[ob+1] + sh[1], rz = S[oa+2] - S[ob+2] + sh[2];
            const r2 = rx*rx + ry*ry + rz*rz;
            if (r2 >= rc2) continue;
            let fr;   // force/r on site a
            if (lj) {
              const s6 = (sig2 / r2) ** 3;
              epot += eps4 * (s6 * s6 - s6);
              fr = eps4 * (12 * s6 * s6 - 6 * s6) / r2;
            } else {
              const r = Math.sqrt(r2), qq = KC * qs[sa] * qs[sb], ar = a * r, ef = erfcAS(ar);
              epot += qq * (ef / r - ec + fc * (r - rc));
              fr = qq * (ef / r2 + sp * Math.exp(-ar * ar) / r - fc) / r;
            }
            const fx = fr * rx, fy = fr * ry, fz = fr * rz;
            fij[0] += fx; fij[1] += fy; fij[2] += fz;
            // torques about each COM
            const ax = S[oa] - this.com[3*i], ay = S[oa+1] - this.com[3*i+1], az = S[oa+2] - this.com[3*i+2];
            this.tq[3*i] += ay*fz - az*fy; this.tq[3*i+1] += az*fx - ax*fz; this.tq[3*i+2] += ax*fy - ay*fx;
            const bx = S[ob] - this.com[3*j], by = S[ob+1] - this.com[3*j+1], bz = S[ob+2] - this.com[3*j+2];
            this.tq[3*j] -= by*fz - bz*fy; this.tq[3*j+1] -= bz*fx - bx*fz; this.tq[3*j+2] -= bx*fy - by*fx;
          }
          for (let d = 0; d < 3; d++) {
            this.f[3*i+d] += fij[d]; this.f[3*j+d] -= fij[d];
            vir[d] += (this.com[3*i+d] - this.com[3*j+d] + sh[d]) * fij[d];
          }
        }
      }
    }
    // DSF self term (constant for fixed charges; keeps energies comparable with Ewald)
    const q2 = 2 * T4.qH * T4.qH + T4.qM * T4.qM;
    this.eself = -N * KC * q2 * (ec / 2 + a / Math.sqrt(Math.PI));
    this.epot = epot; this.vir = vir;
    return epot;
  }

  // LJ long-range tail corrections (energy total, pressure)
  tail() {
    const V = this.box[0] * this.box[1] * this.box[2], rho = this.N / V, s3 = T4.sigma ** 3, x3 = (T4.sigma / this.rc) ** 3;
    return {
      e: this.N * (8 / 3) * Math.PI * rho * T4.eps * s3 * (x3 ** 3 / 3 - x3),
      p: (16 / 3) * Math.PI * rho * rho * T4.eps * s3 * (2 / 3 * x3 ** 3 - x3),
    };
  }

  kinetic() {
    let kt = 0, kr = 0; const kd = [0, 0, 0], B = BODY;
    for (let i = 0; i < this.N; i++) {
      for (let d = 0; d < 3; d++) { const e = 0.5 * T4.mass * this.v[3*i+d] ** 2; kt += e; kd[d] += e; }
      const q = this.q.subarray(4*i, 4*i+4), p = this.p.subarray(4*i, 4*i+4), t = [0, 0, 0, 0];
      for (let k = 1; k <= 3; k++) { const Lk = 0.5 * dot4(p, Pk(k, q, t)); kr += Lk * Lk / (2 * B.I[k - 1]); }
    }
    return { kt, kr, kd };   // kJ/mol (mass in amu, v in Å/ps -> amu Å²/ps² = 0.01 kJ/mol), converted below
  }

  // instantaneous temperature and pressure (bar)
  measure() {
    const k = this.kinetic(), kt = k.kt * 0.01, kr = k.kr * 0.01;
    const V = this.box[0] * this.box[1] * this.box[2], nf = 6 * this.N - 3;
    const T = 2 * (kt + kr) / (nf * KB);
    const tl = this.tail();
    const P = (2 * kt + this.vir[0] + this.vir[1] + this.vir[2]) / (3 * V) + tl.p;
    const Pd = [0, 1, 2].map(d => (2 * k.kd[d] * 0.01 + this.vir[d]) / V + tl.p);
    const rho = this.N * T4.mass / V * AMU_A3_TO_GCC;
    return { T, P: P / BAR, Pd: Pd.map(x => x / BAR), epot: this.epot + tl.e, kt, kr, rho, V };
  }

  // half kick: v += dt/2 F/m, p += dt/2 * 2 S(q) (0, tau_body)
  kick(h) {
    const R = new Float64Array(9), t = [0, 0, 0, 0];
    const fs = h / T4.mass * 100;     // kJ/mol/Å / amu -> 100 Å/ps²
    for (let i = 0; i < this.N; i++) {
      for (let d = 0; d < 3; d++) this.v[3*i+d] += fs * this.f[3*i+d];
      const q = this.q.subarray(4*i, 4*i+4), p = this.p.subarray(4*i, 4*i+4);
      rotMat(q[0], q[1], q[2], q[3], R);
      const tx = this.tq[3*i], ty = this.tq[3*i+1], tz = this.tq[3*i+2];
      const tb = [R[0]*tx + R[3]*ty + R[6]*tz, R[1]*tx + R[4]*ty + R[7]*tz, R[2]*tx + R[5]*ty + R[8]*tz];
      // p carries units of amu·Å²/ps (angular momentum); torque kJ/mol -> ×100
      for (let k = 1; k <= 3; k++) { Pk(k, q, t); const s = 2 * h * 100 * tb[k - 1]; for (let m = 0; m < 4; m++) p[m] += s * t[m]; }
    }
  }

  // free rotation (NO_SQUISH symmetric split) and translation drift
  drift(dt) {
    const L = this.box;
    for (let i = 0; i < this.N; i++) {
      for (let d = 0; d < 3; d++) this.com[3*i+d] += dt * this.v[3*i+d];
      freeRotate(this.q.subarray(4*i, 4*i+4), this.p.subarray(4*i, 4*i+4), dt);
    }
  }

  step(dt) {
    this.kick(dt / 2);
    this.drift(dt);
    this.forces();
    this.kick(dt / 2);
  }

  // Bussi CSVR thermostat applied to all DOF (trans + rot) with one factor
  thermostat(T0, tau, dt) {
    const k = this.kinetic(), K = (k.kt + k.kr) * 0.01, nf = 6 * this.N - 3;
    const K0 = 0.5 * nf * KB * T0;
    const lam = csvr(K, K0, nf, tau, dt) ;
    const s = Math.sqrt(lam);
    for (let i = 0; i < 3 * this.N; i++) this.v[i] *= s;
    for (let i = 0; i < 4 * this.N; i++) this.p[i] *= s;
  }

  // stochastic cell rescaling (Bernetti & Bussi 2020); mode 'iso' or 'z' (z only, for slabs)
  barostat(P0bar, T0, tauP, dt, mode = 'iso', compress = 4.5e-5) {
    const m = this.measure(), V = m.V;
    const beta = compress / BAR;          // 1/bar -> Å³ mol/kJ
    const P0 = P0bar * BAR, kT = KB * T0;
    const Pin = (mode === 'iso' ? m.P : m.Pd[2]) * BAR;
    const deps = -beta / tauP * (P0 - Pin) * dt + Math.sqrt(2 * kT * beta * dt / (V * tauP)) * gauss();
    if (mode === 'iso') {
      const mu = Math.exp(deps / 3);
      for (let d = 0; d < 3; d++) this.box[d] *= mu;
      for (let i = 0; i < 3 * this.N; i++) { this.com[i] *= mu; this.v[i] /= mu; }
    } else {
      const mu = Math.exp(deps);
      this.box[2] *= mu;
      for (let i = 0; i < this.N; i++) { this.com[3*i+2] *= mu; this.v[3*i+2] /= mu; }
    }
  }

  wrap() {
    for (let i = 0; i < this.N; i++) for (let d = 0; d < 3; d++) {
      const L = this.box[d]; this.com[3*i+d] -= L * Math.floor(this.com[3*i+d] / L);
    }
  }

  // set orientation from a lab rotation matrix, random thermal velocities
  thermalize(T0, rng = Math.random) {
    const B = BODY;
    const sv = Math.sqrt(KB * T0 / T4.mass * 100);
    const mom = [0, 0, 0];
    for (let i = 0; i < this.N; i++) for (let d = 0; d < 3; d++) { this.v[3*i+d] = sv * gauss(rng); mom[d] += this.v[3*i+d]; }
    for (let i = 0; i < this.N; i++) for (let d = 0; d < 3; d++) this.v[3*i+d] -= mom[d] / this.N;
    const t = [0, 0, 0, 0];
    for (let i = 0; i < this.N; i++) {
      const q = this.q.subarray(4*i, 4*i+4), p = this.p.subarray(4*i, 4*i+4);
      p.fill(0);
      for (let k = 1; k <= 3; k++) {
        const Lk = Math.sqrt(B.I[k - 1] * KB * T0 * 100) * gauss(rng);   // amu Å²/ps
        Pk(k, q, t); for (let m = 0; m < 4; m++) p[m] += 2 * Lk * t[m];
      }
    }
  }
}

function dot4(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]; }

function rotStep(k, q, p, h, I) {
  const t = [0, 0, 0, 0], u = [0, 0, 0, 0];
  Pk(k, q, t);
  const zeta = h * dot4(p, t) / (4 * I);
  const c = Math.cos(zeta), s = Math.sin(zeta);
  Pk(k, p, u);
  for (let m = 0; m < 4; m++) { q[m] = c * q[m] + s * t[m]; p[m] = c * p[m] + s * u[m]; }
}
function freeRotate(q, p, dt) {
  const I = BODY.I;
  rotStep(3, q, p, dt / 2, I[2]); rotStep(2, q, p, dt / 2, I[1]);
  rotStep(1, q, p, dt, I[0]);
  rotStep(2, q, p, dt / 2, I[1]); rotStep(3, q, p, dt / 2, I[2]);
}

let _g2 = null;
function gauss(rng = Math.random) {
  if (_g2 !== null) { const g = _g2; _g2 = null; return g; }
  let u, v, s;
  do { u = 2 * rng() - 1; v = 2 * rng() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s); _g2 = v * m; return u * m;
}
// sum of n squared gaussians (chi-square), via gamma(n/2, 2)
function chi2(n, rng = Math.random) {
  if (n === 0) return 0;
  const g = gamma(n / 2, rng); return 2 * g;
}
function gamma(a, rng = Math.random) {   // Marsaglia–Tsang
  if (a < 1) return gamma(a + 1, rng) * Math.pow(rng(), 1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gauss(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
// Bussi–Donadio–Parrinello: returns the factor by which kinetic energy K is multiplied
function csvr(K, K0, nf, tau, dt, rng = Math.random) {
  const c = tau > 0 ? Math.exp(-dt / tau) : 0;
  const r1 = gauss(rng), s = chi2(nf - 1, rng);
  const Knew = c * K + (1 - c) * K0 / nf * (r1 * r1 + s) + 2 * r1 * Math.sqrt(c * (1 - c) * K0 / nf * K);
  return Knew / K;
}

const TIP4P_EXPORTS = { Tip4p, T4, BODY, KB, KC, BAR, AMU_A3_TO_GCC, rotMat, matToQuat, Pk, erfcAS, freeRotate, gauss, chi2, csvr };
if (typeof module !== 'undefined') module.exports = TIP4P_EXPORTS; else Object.assign(self, TIP4P_EXPORTS);
