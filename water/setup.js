// Initial configurations shared by the tests and the page: liquid boxes, ice Ih crystals.
'use strict';
(function () {
const { Tip4p, BODY, T4, AMU_A3_TO_GCC, matToQuat, rotMat } = typeof require !== 'undefined' ? require('./tip4p_cpu.js') : self;
const { iceIhLattice, waterFrame } = typeof require !== 'undefined' ? require('./ice.js') : self;

function randQuat(rng) {
  const u1 = rng(), u2 = rng() * 2 * Math.PI, u3 = rng() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

// N molecules on a simple-cubic lattice at density rho (g/cm³), random orientations
function liquidBox(N, rho, T, rng = Math.random, opt = {}) {
  const V = N * T4.mass / (rho / AMU_A3_TO_GCC), L = Math.cbrt(V);
  const n = Math.ceil(Math.cbrt(N)), a = L / n;
  const s = new Tip4p(N, [L, L, L], opt);
  let k = 0;
  for (let z = 0; z < n && k < N; z++) for (let y = 0; y < n && k < N; y++) for (let x = 0; x < n && k < N; x++, k++) {
    s.com.set([(x + 0.5) * a, (y + 0.5) * a, (z + 0.5) * a], 3 * k);
    s.q.set(randQuat(rng), 4 * k);
  }
  s.thermalize(T, rng);
  s.forces();
  return s;
}

// ice Ih (nx×ny×nz orthorhombic cells of 8 molecules) at hexagonal lattice constant a
function iceBox(nx, ny, nz, a, T, rng = Math.random, opt = {}) {
  const ice = iceIhLattice(nx, ny, nz, a, rng);
  const s = new Tip4p(ice.n, ice.box, opt);
  placeIce(s, ice, 0);
  s.thermalize(T, rng);
  s.forces();
  return s;
}

// write the molecules of an ice lattice into s starting at index off
function placeIce(s, ice, off, shift = [0, 0, 0]) {
  const R = new Float64Array(9);
  for (let i = 0; i < ice.n; i++) {
    const d = [];
    for (let k = 0; k < 2; k++) {
      const j = ice.donors[2 * i + k], r = [];
      for (let c = 0; c < 3; c++) { let dd = ice.O[3*j+c] - ice.O[3*i+c]; dd -= ice.box[c] * Math.round(dd / ice.box[c]); r.push(dd); }
      const l = Math.hypot(...r); d.push(r.map(x => x / l));
    }
    const M = waterFrame(d[0], d[1]);
    const q = matToQuat(M);
    rotMat(q[0], q[1], q[2], q[3], R);
    const o = BODY.O;
    for (let c = 0; c < 3; c++) s.com[3 * (off + i) + c] = ice.O[3*i+c] + shift[c] - (R[3*c]*o[0] + R[3*c+1]*o[1] + R[3*c+2]*o[2]);
    s.q.set(q, 4 * (off + i));
  }
}

const ex = { liquidBox, iceBox, placeIce, randQuat };
if (typeof module !== 'undefined') module.exports = ex; else Object.assign(self, ex);
})();
