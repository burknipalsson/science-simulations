// Scene preparation: build starting configurations in the browser (no CPU force calls) and
// equilibrate them on the GPU.  Each prep returns a ready GW.Engine.
'use strict';

const SCN = (() => {
const { Engine, BODY, T4, MW, KB } = GW;
const GCC = 1.66053907;

function gauss(rng) { let u, v, s; do { u = 2 * rng() - 1; v = 2 * rng() - 1; s = u * u + v * v; } while (s >= 1 || s === 0); return u * Math.sqrt(-2 * Math.log(s) / s); }
function randQuat(rng) {
  const u1 = rng(), u2 = rng() * 2 * Math.PI, u3 = rng() * 2 * Math.PI, a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}
function Pk(k, a) { return k === 1 ? [-a[1], a[0], a[3], -a[2]] : k === 2 ? [-a[2], -a[3], a[0], a[1]] : [-a[3], a[2], -a[1], a[0]]; }
// thermal translational + angular momenta for rigid TIP4P molecules (arrays in place)
function thermalT4(n, v, q, p, T, rng) {
  const sv = Math.sqrt(KB * T / T4.mass * 100), m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) { v[3*i+d] = sv * gauss(rng); m[d] += v[3*i+d]; }
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) v[3*i+d] -= m[d] / n;
  for (let i = 0; i < n; i++) {
    const qi = [q[4*i], q[4*i+1], q[4*i+2], q[4*i+3]]; const pi = [0, 0, 0, 0];
    for (let k = 1; k <= 3; k++) { const L = Math.sqrt(BODY.I[k - 1] * KB * T * 100) * gauss(rng), t = Pk(k, qi); for (let c = 0; c < 4; c++) pi[c] += 2 * L * t[c]; }
    p.set(pi, 4 * i);
  }
}
function matToQuat(R) {
  const tr = R[0] + R[4] + R[8]; let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [s / 4, (R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s]; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; q = [(R[7] - R[5]) / s, s / 4, (R[1] + R[3]) / s, (R[2] + R[6]) / s]; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; q = [(R[2] - R[6]) / s, (R[1] + R[3]) / s, s / 4, (R[5] + R[7]) / s]; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; q = [(R[3] - R[1]) / s, (R[2] + R[6]) / s, (R[5] + R[7]) / s, s / 4]; }
  const n = Math.hypot(...q); return q.map(x => x / n);
}
function rotMat(q) {
  const [a, b, c, d] = q;
  return [a*a+b*b-c*c-d*d, 2*(b*c-a*d), 2*(b*d+a*c), 2*(b*c+a*d), a*a-b*b+c*c-d*d, 2*(c*d-a*b), 2*(b*d-a*c), 2*(c*d+a*b), a*a-b*b-c*c+d*d];
}
// ice molecules (centres of mass + quaternions) from an ice lattice
function iceMolecules(ice) {
  const n = ice.n, com = new Float64Array(3 * n), q = new Float64Array(4 * n);
  for (let i = 0; i < n; i++) {
    const d = [];
    for (let k = 0; k < 2; k++) {
      const j = ice.donors[2 * i + k], r = [];
      for (let c = 0; c < 3; c++) { let dd = ice.O[3*j+c] - ice.O[3*i+c]; dd -= ice.box[c] * Math.round(dd / ice.box[c]); r.push(dd); }
      const l = Math.hypot(...r); d.push(r.map(x => x / l));
    }
    const qi = matToQuat(waterFrame(d[0], d[1])), R = rotMat(qi), o = BODY.O;
    for (let c = 0; c < 3; c++) com[3*i+c] = ice.O[3*i+c] - (R[3*c]*o[0] + R[3*c+1]*o[1] + R[3*c+2]*o[2]);
    q.set(qi, 4 * i);
  }
  return { com, q };
}

// cubic-lattice liquid filling [z0, z1) of a box, density rho
function liquidSlab(box, z0, z1, rho, rng) {
  const V = box[0] * box[1] * (z1 - z0), n = Math.round(V * rho / GCC / T4.mass);
  const a = Math.cbrt(V / n), nx = Math.max(1, Math.round(box[0] / a)), ny = Math.max(1, Math.round(box[1] / a)), nz = Math.ceil(n / (nx * ny));
  const com = [], q = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (com.length / 3 >= n) break;
    com.push((x + 0.5) * box[0] / nx, (y + 0.5) * box[1] / ny, z0 + (z + 0.5) * (z1 - z0) / nz);
    q.push(...randQuat(rng));
  }
  return { com, q, n: com.length / 3 };
}

// gentle start: tiny steps with a strong thermostat, then normal steps
function settle(e, T, n1 = 400, n2 = 1500, extra = {}) {
  const dt = e.dt; e.dt = dt / 4;
  for (let k = 0; k < n1; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T, tauT: 0.01, every: 8 }); }
  e.dt = dt;
  for (let k = 0; k < n2; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), Object.assign({ T, tauT: 0.1, every: 8 }, extra)); }
}

const PREP = {
  // liquid TIP4P/2005 box
  liquid(gl, T = 298, N = 4096, rng = Math.random) {
    const V = N * T4.mass / (0.997 / GCC), L = Math.cbrt(V), box = [L, L, L];
    const s = liquidSlab(box, 0, L, 0.997, rng);
    const n = s.n, v = new Float64Array(3 * n), p = new Float64Array(4 * n), q = Float64Array.from(s.q);
    thermalT4(n, v, q, p, T, rng);
    const e = new Engine(gl, 'tip4p', n, box);
    e.upload({ x: s.com, v, q, p });
    settle(e, T, 400, 1500, { P: 1, tauP: 2 });
    return e;
  },
  // bulk ice Ih, c axis along z
  ice(gl, T = 230, rng = Math.random, dims = [8, 5, 6]) {
    const ice = iceIhLattice(...dims, 4.51, rng), m = iceMolecules(ice), n = ice.n;
    const v = new Float64Array(3 * n), p = new Float64Array(4 * n);
    thermalT4(n, v, m.q, p, T, rng);
    const e = new Engine(gl, 'tip4p', n, ice.box);
    e.upload({ x: m.com, v, q: m.q, p, id: Float32Array.from({ length: n }, (_, i) => i) });
    settle(e, T, 200, 800);
    return e;
  },
  // ice slab (basal faces exposed, normal z) sandwiched by liquid water
  melt(gl, T = 290, rng = Math.random, dims = [8, 5, 4], liqThick = 26) {
    const ice = iceIhLattice(...dims, 4.51, rng), m = iceMolecules(ice), ni = ice.n;
    const gap = 1.6, Lz = ice.box[2] + 2 * liqThick + 2 * gap, box = [ice.box[0], ice.box[1], Lz];
    const top = liquidSlab(box, ice.box[2] + gap, Lz - gap, 0.98, rng);
    const nt = top.n, n = ni + nt;
    const com = new Float64Array(3 * n), q = new Float64Array(4 * n), id = new Float32Array(n), flag = new Float32Array(n);
    com.set(m.com); q.set(m.q); com.set(top.com, 3 * ni); q.set(top.q, 4 * ni);
    for (let i = 0; i < n; i++) { id[i] = i; flag[i] = i < ni ? 1 : 0; }
    // centre the ice in z: shift everything up by liqThick/2 (periodic)
    for (let i = 0; i < n; i++) com[3*i+2] = (com[3*i+2] + liqThick / 2 + gap / 2) % Lz;
    const v = new Float64Array(3 * n), p = new Float64Array(4 * n);
    thermalT4(n, v, q, p, 300, rng);
    const e = new Engine(gl, 'tip4p', n, box);
    e.upload({ x: com, v, q, p, id, flag });
    settle(e, 300, 400, 1500, { P: 1, tauP: 2, mode: 'z' });            // liquid relaxes around the pinned ice
    const st = e.download(); st.flag.fill(0);
    thermalT4(ni, st.v, st.q, st.p, T, rng);                            // ice gets thermal motion; the liquid keeps its own
    st.id = id; e.upload(st);
    settle(e, T, 200, 500, { P: 1, tauP: 2, mode: 'z' });
    e.iceCount = ni;
    return e;
  },
  // mW: supercooled liquid with a spherical ice seed (c axis along z) in the middle of a cubic box
  freeze(gl, T = 230, rng = Math.random, L = 92, seedR = 15, solute = 0) {
    const box = [L, L, L], c = [L / 2, L / 2, L / 2];
    const ice = iceIhLattice(6, 4, 5, 4.42, rng), x = [], flag = [];
    for (let i = 0; i < ice.n; i++) {
      const p = [0, 1, 2].map(d => ice.O[3*i+d] - ice.box[d] / 2 + c[d]);
      if (Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < seedR) { x.push(...p); flag.push(1); }
    }
    const nl = Math.round(L ** 3 * 0.997 / GCC / MW.mass), a = Math.cbrt(L ** 3 / nl), m = Math.round(L / a);
    for (let iz = 0; iz < m; iz++) for (let iy = 0; iy < m; iy++) for (let ix = 0; ix < m; ix++) {
      const p = [ix, iy, iz].map(k => (k + 0.5) * L / m + 0.3 * (rng() - 0.5));
      if (Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < seedR + 1.3) continue;
      x.push(...p); flag.push(rng() < solute ? 2 : 0);
    }
    const n = flag.length, id = Float32Array.from({ length: n }, (_, i) => i);
    const e = new Engine(gl, 'mw', n, box, { soluteMass: MW.mass });
    e.upload({ x: Float64Array.from(x), v: new Float64Array(3 * n), flag: Float32Array.from(flag), id });
    const dt = e.dt; e.dt = 0.002;
    for (let k = 0; k < 400; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: 300, tauT: 0.005, every: 4 }); }
    e.dt = dt;
    for (let k = 0; k < 1000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: 300, tauT: 0.05, every: 4, P: 1, tauP: 1 }); }
    for (let k = 0; k < 1000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T, tauT: 0.05, every: 4, P: 1, tauP: 1 }); }
    const st = e.download(); for (let i = 0; i < n; i++) if (st.flag[i] === 1) st.flag[i] = 0; st.id = id; e.upload(st);
    e.seedCount = flag.filter(f => f === 1).length;
    return e;
  },
};

// ---- embedded pre-equilibrated states (gzip + base64 float32), decoded with DecompressionStream ----
const cache = {};
async function decode(name) {
  if (cache[name]) return cache[name];
  const S = (self.WATER_STATES || {})[name]; if (!S) return null;
  const bin = Uint8Array.from(atob(S.b64), c => c.charCodeAt(0));
  const buf = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return (cache[name] = { meta: S.meta, f: new Float32Array(buf) });
}
// build an engine from an embedded state; o.solute (mW): keep only this fraction of solute particles
async function fromState(gl, name, T, o = {}) {
  const st = await decode(name); if (!st) return null;
  const { meta, f } = st, n = meta.n, rng = Math.random;
  const e = new Engine(gl, meta.model, n, meta.box);
  const x = new Float64Array(3 * n), v = new Float64Array(3 * n), id = Float32Array.from({ length: n }, (_, i) => i);
  if (meta.model === 'tip4p') {
    const q = new Float64Array(4 * n), p = new Float64Array(4 * n);
    for (let i = 0; i < n; i++) { for (let d = 0; d < 3; d++) x[3*i+d] = f[7*i+d]; for (let d = 0; d < 4; d++) q[4*i+d] = f[7*i+3+d]; }
    thermalT4(n, v, q, p, T, rng);
    e.upload({ x, v, q, p, id });
    settle(e, T, 120, 120, meta.box[2] > 1.5 * meta.box[0] ? { P: 1, tauP: 2, mode: 'z' } : { P: 1, tauP: 2 });
  } else {
    const flag = new Float32Array(n), sv = Math.sqrt(KB * T / MW.mass * 100);
    let ns = 0; for (let i = 0; i < n; i++) if (f[4*i+3] > 1.5) ns++;
    const keep = o.solute === undefined ? 1 : Math.min(1, o.solute * n / Math.max(ns, 1));
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < 3; d++) { x[3*i+d] = f[4*i+d]; v[3*i+d] = sv * gauss(rng); }
      flag[i] = f[4*i+3] > 1.5 && rng() < keep ? 2 : 0;
    }
    e.upload({ x, v, flag, id });
    for (let k = 0; k < 200; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T, tauT: 0.05, every: 4 }); }
  }
  Object.assign(e, meta.extra || {}, meta.iceCount ? { iceCount: meta.iceCount } : {});
  return e;
}

return { PREP, thermalT4, iceMolecules, liquidSlab, settle, randQuat, fromState, decode };
})();
