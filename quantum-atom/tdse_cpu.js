// CPU reference time-dependent Schrödinger solver (split-operator FFT), 1D and 2D, atomic units
// (ħ = mₑ = e = 1). Mirrors the GPU pipeline: half potential kick, full kinetic step in k-space,
// half potential kick. The potential may carry an imaginary absorbing part W (V − iW) so outgoing
// waves leave the box instead of wrapping around.
const AU = {
  bohr_nm: 0.0529177210903, // length
  time_fs: 0.02418884326585747, // time
  Ha_eV: 27.211386245988, // energy
  c: 137.035999084, // speed of light
};

function fft1d(re, im, n, inv, off = 0, st = 1){
  for (let i = 1, j = 0; i < n; i++){
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j){
      const a = off + i * st, b = off + j * st;
      let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1){
    const h = len >> 1;
    for (let j = 0; j < h; j++){
      const ang = 2 * Math.PI * j / len * (inv ? 1 : -1), cr = Math.cos(ang), ci = Math.sin(ang);
      for (let i = 0; i < n; i += len){
        const a = off + (i + j) * st, b = a + h * st;
        const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
      }
    }
  }
}
const freq = (i, N) => i < N / 2 ? i : i - N;

// Grid: nx × ny points (ny = 1 for 1D), spacing h (bohr), origin at index 0.
function makeGrid(nx, ny, h){
  const n = nx * ny;
  return { nx, ny, h, n, re: new Float64Array(n), im: new Float64Array(n), V: new Float64Array(n), W: new Float64Array(n) };
}
function fft2(g, inv){
  const { nx, ny, re, im } = g;
  for (let y = 0; y < ny; y++) fft1d(re, im, nx, inv, y * nx, 1);
  if (ny > 1) for (let x = 0; x < nx; x++) fft1d(re, im, ny, inv, x, nx);
  if (inv){ const s = 1 / (nx * ny); for (let k = 0; k < g.n; k++){ re[k] *= s; im[k] *= s; } }
}
// exp(-i (V - iW) dt/2) = exp(-W dt/2) · exp(-i V dt/2)
function kick(g, dt){
  const { re, im, V, W } = g;
  for (let k = 0; k < g.n; k++){
    const a = -V[k] * dt, d = Math.exp(-W[k] * dt), c = Math.cos(a) * d, s = Math.sin(a) * d;
    const r = re[k], i = im[k];
    re[k] = r * c - i * s; im[k] = r * s + i * c;
  }
}
function drift(g, dt){
  const { nx, ny, h, re, im } = g;
  fft2(g, false);
  const dkx = 2 * Math.PI / (nx * h), dky = 2 * Math.PI / (ny * h);
  for (let y = 0; y < ny; y++){
    const ky = ny > 1 ? freq(y, ny) * dky : 0;
    for (let x = 0; x < nx; x++){
      const kx = freq(x, nx) * dkx, a = -0.5 * (kx * kx + ky * ky) * dt, k = x + nx * y;
      const c = Math.cos(a), s = Math.sin(a), r = re[k], i = im[k];
      re[k] = r * c - i * s; im[k] = r * s + i * c;
    }
  }
  fft2(g, true);
}
function step(g, dt){ kick(g, dt / 2); drift(g, dt); kick(g, dt / 2); }

function norm(g){
  let s = 0; for (let k = 0; k < g.n; k++) s += g.re[k] ** 2 + g.im[k] ** 2;
  return s * g.h ** (g.ny > 1 ? 2 : 1);
}
// <H> with the real potential only
function energy(g){
  const { nx, ny, h } = g, c = { ...g, re: g.re.slice(), im: g.im.slice() };
  let ev = 0, nn = 0;
  for (let k = 0; k < g.n; k++){ const p = g.re[k] ** 2 + g.im[k] ** 2; ev += p * g.V[k]; nn += p; }
  fft2(c, false);
  const dkx = 2 * Math.PI / (nx * h), dky = 2 * Math.PI / (ny * h);
  let et = 0, nk = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++){
    const kx = freq(x, nx) * dkx, ky = ny > 1 ? freq(y, ny) * dky : 0, k = x + nx * y;
    const p = c.re[k] ** 2 + c.im[k] ** 2; et += 0.5 * (kx * kx + ky * ky) * p; nk += p;
  }
  return et / nk + ev / nn;
}
// Gaussian wave packet exp(-(r-r0)²/(4σ²) + i k0·r), normalised
function gaussian(g, x0, y0, sx, sy, kx, ky){
  const { nx, ny, h } = g;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++){
    const X = x * h - x0, Y = ny > 1 ? y * h - y0 : 0, k = x + nx * y;
    const amp = Math.exp(-X * X / (4 * sx * sx) - (ny > 1 ? Y * Y / (4 * sy * sy) : 0)), ph = kx * X + ky * Y;
    g.re[k] = amp * Math.cos(ph); g.im[k] = amp * Math.sin(ph);
  }
  const s = 1 / Math.sqrt(norm(g));
  for (let k = 0; k < g.n; k++){ g.re[k] *= s; g.im[k] *= s; }
}
// absorbing layer of width w (bohr) on the given edges: W = Wmax ((d)/w)² inside the layer
function absorber(g, w, Wmax, edges = 'xy'){
  const { nx, ny, h } = g, Lx = nx * h, Ly = ny * h;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++){
    const X = x * h, Y = y * h;
    let d = 0;
    if (edges.includes('x')) d = Math.max(d, w - X, X - (Lx - w));
    if (ny > 1 && edges.includes('y')) d = Math.max(d, w - Y, Y - (Ly - w));
    g.W[x + nx * y] = d > 0 ? Wmax * (d / w) ** 2 : 0;
  }
}

// exact transmission through a rectangular barrier of height V0, width a, at energy E (a.u., m = 1)
function rectT(E, V0, a){
  if (Math.abs(E - V0) < 1e-12) return 1 / (1 + V0 * a * a / 2 * 1 / 1); // limit: 1/(1 + m V0 a²/2ħ²)
  if (E < V0){
    const kap = Math.sqrt(2 * (V0 - E)), s = Math.sinh(kap * a);
    return 1 / (1 + V0 * V0 * s * s / (4 * E * (V0 - E)));
  }
  const q = Math.sqrt(2 * (E - V0)), s = Math.sin(q * a);
  return 1 / (1 + V0 * V0 * s * s / (4 * E * (E - V0)));
}

if (typeof module !== "undefined") module.exports = { AU, fft1d, freq, makeGrid, fft2, kick, drift, step, norm, energy, gaussian, absorber, rectT };
