// CPU reference: D3Q19 BGK lattice Boltzmann with Guo forcing + immersed-boundary membranes.
// Walls: Bouzidi interpolated bounce-back from a signed distance (phi > 0 fluid), optional moving walls
// via wallVel(x,y,z). Periodic in all directions otherwise. Used to validate the GPU engine.
const C = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  [1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
const W = C.map(c => { const s = c[0]*c[0] + c[1]*c[1] + c[2]*c[2]; return s === 0 ? 1/3 : s === 1 ? 1/18 : 1/36; });
const OPP = C.map(c => C.findIndex(d => d[0] === -c[0] && d[1] === -c[1] && d[2] === -c[2]));

// 3-point immersed-boundary kernel (Roma, Peskin & Berger 1999)
function phi3(r) {
  r = Math.abs(r);
  if (r <= 0.5) return (1 + Math.sqrt(1 - 3 * r * r)) / 3;
  if (r <= 1.5) return (5 - 3 * r - Math.sqrt(1 - 3 * (1 - r) * (1 - r))) / 6;
  return 0;
}

class LBM {
  constructor(nx, ny, nz, tau, sdf, wallVel) {
    Object.assign(this, { nx, ny, nz, tau, n: nx * ny * nz });
    const n = this.n;
    this.f = new Float64Array(19 * n); this.g = new Float64Array(19 * n);
    this.Fx = new Float64Array(n); this.Fy = new Float64Array(n); this.Fz = new Float64Array(n);
    this.rho = new Float64Array(n).fill(1); this.ux = new Float64Array(n); this.uy = new Float64Array(n); this.uz = new Float64Array(n);
    this.phi = new Float64Array(n); this.body = [0, 0, 0];
    this.wallVel = wallVel || (() => [0, 0, 0]);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) this.phi[this.id(x, y, z)] = sdf ? sdf(x, y, z) : 1;
    for (let c = 0; c < n; c++) for (let i = 0; i < 19; i++) this.f[i * n + c] = W[i];
  }
  id(x, y, z) { return x + this.nx * (y + this.ny * z); }
  step() {
    const { nx, ny, nz, n, f, g, tau, phi } = this, om = 1 / tau, kf = 1 - 0.5 / tau;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = this.id(x, y, z);
      if (phi[c] <= 0) { for (let i = 0; i < 19; i++) g[i * n + c] = 0; this.ux[c] = this.uy[c] = this.uz[c] = 0; continue; }
      const fi = new Array(19);
      for (let i = 0; i < 19; i++) {
        const [cx, cy, cz] = C[i];
        const sx = (x - cx + nx) % nx, sy = (y - cy + ny) % ny, sz = (z - cz + nz) % nz, s = this.id(sx, sy, sz);
        if (phi[s] > 0) { fi[i] = f[i * n + s]; continue; }
        // Bouzidi bounce-back: the wall lies a fraction q of the link from this node
        const q = phi[c] / (phi[c] - phi[s]), o = OPP[i];
        const wv = this.wallVel(x - q * cx, y - q * cy, z - q * cz), mw = 6 * W[i] * this.rho[c] * (cx * wv[0] + cy * wv[1] + cz * wv[2]);
        const fo = f[o * n + c]; // post-collision population leaving towards the wall
        if (q < 0.5) {
          const x2 = (x + cx + nx) % nx, y2 = (y + cy + ny) % ny, z2 = (z + cz + nz) % nz, c2 = this.id(x2, y2, z2);
          fi[i] = (phi[c2] > 0 ? 2 * q * fo + (1 - 2 * q) * f[o * n + c2] : fo) + mw;
        } else fi[i] = fo / (2 * q) + (2 * q - 1) / (2 * q) * f[i * n + c] + mw / (2 * q);
      }
      let r = 0, jx = 0, jy = 0, jz = 0;
      for (let i = 0; i < 19; i++) { r += fi[i]; jx += C[i][0] * fi[i]; jy += C[i][1] * fi[i]; jz += C[i][2] * fi[i]; }
      const Fx = this.Fx[c] + this.body[0], Fy = this.Fy[c] + this.body[1], Fz = this.Fz[c] + this.body[2];
      const ux = (jx + 0.5 * Fx) / r, uy = (jy + 0.5 * Fy) / r, uz = (jz + 0.5 * Fz) / r, usq = ux * ux + uy * uy + uz * uz;
      this.rho[c] = r; this.ux[c] = ux; this.uy[c] = uy; this.uz[c] = uz;
      for (let i = 0; i < 19; i++) {
        const [cx, cy, cz] = C[i], cu = cx * ux + cy * uy + cz * uz;
        const feq = W[i] * r * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * usq);
        const S = kf * W[i] * (3 * ((cx - ux) * Fx + (cy - uy) * Fy + (cz - uz) * Fz) + 9 * cu * (cx * Fx + cy * Fy + cz * Fz));
        g[i * n + c] = fi[i] - om * (fi[i] - feq) + S;
      }
    }
    [this.f, this.g] = [this.g, this.f];
  }
  // immersed boundary: interpolate the velocity at points X (lattice units)
  interp(X, out) {
    const { nx, ny, nz } = this;
    for (let k = 0; k < X.length; k++) {
      const p = X[k], u = out[k]; u[0] = u[1] = u[2] = 0;
      const bx = Math.round(p[0]), by = Math.round(p[1]), bz = Math.round(p[2]);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, y = by + dy, z = bz + dz;
        const w = phi3(p[0] - x) * phi3(p[1] - y) * phi3(p[2] - z), c = this.id((x % nx + nx) % nx, (y % ny + ny) % ny, (z % nz + nz) % nz);
        u[0] += w * this.ux[c]; u[1] += w * this.uy[c]; u[2] += w * this.uz[c];
      }
    }
  }
  spread(X, F) {
    const { nx, ny, nz } = this;
    for (let k = 0; k < X.length; k++) {
      const p = X[k], f = F[k];
      const bx = Math.round(p[0]), by = Math.round(p[1]), bz = Math.round(p[2]);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, y = by + dy, z = bz + dz;
        const w = phi3(p[0] - x) * phi3(p[1] - y) * phi3(p[2] - z), c = this.id((x % nx + nx) % nx, (y % ny + ny) % ny, (z % nz + nz) % nz);
        this.Fx[c] += w * f[0]; this.Fy[c] += w * f[1]; this.Fz[c] += w * f[2];
      }
    }
  }
  clearForce() { this.Fx.fill(0); this.Fy.fill(0); this.Fz.fill(0); }
}

if (typeof module !== 'undefined') module.exports = { LBM, C, W, OPP, phi3 };
