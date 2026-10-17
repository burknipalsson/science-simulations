// D3Q19 lattice Boltzmann reference solver (CPU, runs in node).
// Same scheme as the GPU engine: pull streaming, populations stored shifted (g = f - w),
// BGK collision + Smagorinsky LES, Bouzidi interpolated bounce-back off a
// signed-distance field (phi > 0 fluid), momentum-exchange forces, velocity inlet at x = 0,
// pressure outlet (rho = 1, non-equilibrium extrapolated) at x = nx-1 with a viscous sponge, and per-axis y/z edges that are
// periodic, free-slip, or no-slip walls (optionally moving, e.g. a rolling road).

const C = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  [1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
const Q = 19;
const W = C.map(c => { const s = c[0]*c[0] + c[1]*c[1] + c[2]*c[2]; return s === 0 ? 1/3 : s === 1 ? 1/18 : 1/36; });
const find = (x, y, z) => C.findIndex(c => c[0] === x && c[1] === y && c[2] === z);
const OPP = C.map(c => find(-c[0], -c[1], -c[2]));
const REFY = C.map(c => find(c[0], -c[1], c[2]));
const REFZ = C.map(c => find(c[0], c[1], -c[2]));

function geq(i, rho, ux, uy, uz) {
  const c = C[i], cu = c[0]*ux + c[1]*uy + c[2]*uz;
  return W[i] * ((rho - 1) + rho * (3*cu + 4.5*cu*cu - 1.5*(ux*ux + uy*uy + uz*uz)));
}

class LBM {
  // opts: nx, ny, nz, nu, cs (Smagorinsky), absorb: {inLen, outLen, sigma}, bcY/bcZ ('periodic'|'slip'|'wall'),
  // wallU: {ylo,yhi,zlo,zhi: [ux,uy,uz]} moving-wall velocities, uIn(y,z) -> [ux,uy,uz],
  // sdf(x,y,z) -> distance (cells, >0 fluid), sponge: {len, nu}
  constructor(o) {
    Object.assign(this, { cs: 0, bcY: 'periodic', bcZ: 'periodic', wallU: {}, sponge: null }, o);
    const { nx, ny, nz } = this, N = this.N = nx * ny * nz;
    this.g = new Float32Array(Q * N); this.g2 = new Float32Array(Q * N);
    this.phi = new Float32Array(N).fill(1e9); this.solid = new Uint8Array(N);
    if (this.sdf) for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = x + nx * (y + ny * z), d = this.sdf(x, y, z);
      this.phi[k] = d; this.solid[k] = d <= 0 ? 1 : 0;
    }
    this.tau0 = new Float32Array(nx);
    for (let x = 0; x < nx; x++) {
      let nu = this.nu;
      if (this.sponge) { const r = (x - (nx - this.sponge.len)) / this.sponge.len; if (r > 0) nu += (this.sponge.nu - this.nu) * r * r; }
      this.tau0[x] = 3 * nu + 0.5;
    }
    this.uInCache = new Float32Array(3 * ny * nz);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) this.uInCache.set(this.uIn(y, z), 3 * (y + ny * z));
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = x + nx * (y + ny * z); if (this.solid[k]) continue;
      const u = this.uInCache.subarray(3 * (y + ny * z));
      for (let i = 0; i < Q; i++) this.g[i * N + k] = geq(i, 1, u[0], u[1], u[2]);
    }
    this.force = [0, 0, 0]; this.t = 0;
  }

  step() {
    const { nx, ny, nz, N, g, g2, solid, phi, bcY, bcZ, cs } = this;
    const fin = new Float64Array(Q);
    let Fx = 0, Fy = 0, Fz = 0;
    const uyLo = this.wallU.ylo, uyHi = this.wallU.yhi, uzLo = this.wallU.zlo, uzHi = this.wallU.zhi;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = x + nx * (y + ny * z);
      if (solid[k]) { for (let i = 0; i < Q; i++) g2[i * N + k] = 0; continue; }
      // own previous state (moments survive collision): inlet density and outlet extrapolation
      let r0 = 1, vx = 0, vy = 0, vz = 0;
      if (x === 0 || x === nx - 1) {
        for (let i = 0; i < Q; i++) { const v = g[i * N + k]; r0 += v; vx += C[i][0]*v; vy += C[i][1]*v; vz += C[i][2]*v; }
        vx /= r0; vy /= r0; vz /= r0;
      }
      for (let i = 0; i < Q; i++) {
        const c = C[i];
        let sx = x - c[0], sy = y - c[1], sz = z - c[2], ii = i, val, wall = null;
        if (sy < 0 || sy >= ny) {
          if (bcY === 'periodic') sy = (sy + ny) % ny;
          else if (bcY === 'slip') { sy = y; ii = REFY[ii]; }
          else wall = sy < 0 ? (uyLo || [0, 0, 0]) : (uyHi || [0, 0, 0]);
        }
        if (!wall && (sz < 0 || sz >= nz)) {
          if (bcZ === 'periodic') sz = (sz + nz) % nz;
          else if (bcZ === 'slip') { sz = z; ii = REFZ[ii]; }
          else wall = sz < 0 ? (uzLo || [0, 0, 0]) : (uzHi || [0, 0, 0]);
        }
        if (wall) {
          val = g[OPP[i] * N + k] + 6 * W[i] * (c[0]*wall[0] + c[1]*wall[1] + c[2]*wall[2]);
        } else if (sx < 0) {
          const u = this.uInCache.subarray(3 * (y + ny * z));
          val = geq(i, r0, u[0], u[1], u[2]);
        } else if (sx >= nx) {
          // pressure outlet: rho = 1 equilibrium plus this cell's non-equilibrium part
          val = geq(i, 1, vx, vy, vz) + g[i * N + k] - geq(i, r0, vx, vy, vz);
        } else {
          const s = sx + nx * (sy + ny * sz);
          if (solid[s]) {
            // Bouzidi interpolated bounce-back; q = fraction of the link from x to the wall
            const o = OPP[i], q = phi[k] / (phi[k] - phi[s]);
            if (q < 0.5) {
              const fx = x + c[0], fy = y + c[1], fz = z + c[2];
              const f2 = fx >= 0 && fx < nx && fy >= 0 && fy < ny && fz >= 0 && fz < nz ? fx + nx * (fy + ny * fz) : -1;
              val = f2 >= 0 && !solid[f2] ? 2*q*g[o * N + k] + (1 - 2*q) * g[o * N + f2] : g[o * N + k];
            } else val = g[o * N + k] / (2*q) + (2*q - 1) / (2*q) * g[i * N + k];
            const m = g[o * N + k] + val; // gauge pressure (ambient term dropped)
            Fx -= c[0] * m; Fy -= c[1] * m; Fz -= c[2] * m;
          } else val = g[ii * N + s];
        }
        fin[i] = val;
      }
      // collide: BGK + Smagorinsky (the non-equilibrium stress sets the eddy viscosity)
      let rho = 1, jx = 0, jy = 0, jz = 0, pxx = 0, pyy = 0, pzz = 0, pxy = 0, pxz = 0, pyz = 0;
      for (let i = 0; i < Q; i++) {
        const c = C[i], v = fin[i];
        rho += v; jx += c[0]*v; jy += c[1]*v; jz += c[2]*v;
        pxx += c[0]*c[0]*v; pyy += c[1]*c[1]*v; pzz += c[2]*c[2]*v;
        pxy += c[0]*c[1]*v; pxz += c[0]*c[2]*v; pyz += c[1]*c[2]*v;
      }
      const ux = jx / rho, uy = jy / rho, uz = jz / rho, d3 = (rho - 1) / 3;
      pxx -= rho*ux*ux + d3; pyy -= rho*uy*uy + d3; pzz -= rho*uz*uz + d3;
      pxy -= rho*ux*uy; pxz -= rho*ux*uz; pyz -= rho*uy*uz;
      let tau = this.tau0[x];
      if (cs > 0) {
        const Qn = Math.sqrt(pxx*pxx + pyy*pyy + pzz*pzz + 2*(pxy*pxy + pxz*pxz + pyz*pyz));
        tau = 0.5 * (tau + Math.sqrt(tau*tau + 18 * Math.SQRT2 * cs*cs * Qn / rho));
      }
      const om = 1 - 1 / tau, usq = 1.5 * (ux*ux + uy*uy + uz*uz);
      // absorbing layers: relax toward rho = 1 and the inflow velocity near the inlet, toward rho = 1 near the outlet
      let sig = 0, rt = 1, tx = ux, ty = uy, tz = uz;
      const ab = this.absorb;
      if (ab && x < ab.inLen) { const a = 1 - x / ab.inLen; sig = ab.sigma * a * a; [tx, ty, tz] = this.uInCache.subarray(3 * (y + ny * z)); }
      else if (ab && x > nx - ab.outLen) { const a = (x - (nx - ab.outLen)) / ab.outLen; sig = ab.sigma * a * a; }
      for (let i = 0; i < Q; i++) {
        const c = C[i], cu = c[0]*ux + c[1]*uy + c[2]*uz;
        const eq = W[i] * ((rho - 1) + rho * (3*cu + 4.5*cu*cu - usq));
        let v = eq + om * (fin[i] - eq);
        if (sig > 0) v -= sig * (v - geq(i, rt, tx, ty, tz));
        g2[i * N + k] = v;
      }
    }
    this.g = g2; this.g2 = g; this.force = [Fx, Fy, Fz]; this.t++;
  }

  macro(x, y, z) {
    const k = x + this.nx * (y + this.ny * z), N = this.N;
    let rho = 1, jx = 0, jy = 0, jz = 0;
    for (let i = 0; i < Q; i++) { const v = this.g[i * N + k]; rho += v; jx += C[i][0]*v; jy += C[i][1]*v; jz += C[i][2]*v; }
    return { rho, ux: jx / rho, uy: jy / rho, uz: jz / rho };
  }
}

if (typeof module !== 'undefined') module.exports = { LBM, C, W, OPP, REFY, REFZ, Q, geq };
