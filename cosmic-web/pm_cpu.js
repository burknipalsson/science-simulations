// CPU reference particle-mesh simulation. Mirrors the GPU pipeline step by step.
const C = require('./cosmo.js');

// ---------- FFT (in place, complex interleaved, radix-2) ----------
function fft1d(re, im, n, inv){
  for (let i = 1, j = 0; i < n; i++){
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1){
    const ang = 2*Math.PI/len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len){
      let cr = 1, ci = 0;
      for (let j = 0; j < len/2; j++){
        const ar = re[i+j], ai = im[i+j], br = re[i+j+len/2]*cr - im[i+j+len/2]*ci, bi = re[i+j+len/2]*ci + im[i+j+len/2]*cr;
        re[i+j] = ar + br; im[i+j] = ai + bi; re[i+j+len/2] = ar - br; im[i+j+len/2] = ai - bi;
        const t = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = t;
      }
    }
  }
}
function fft3d(re, im, N, inv){
  const r = new Float64Array(N), i_ = new Float64Array(N);
  for (let ax = 0; ax < 3; ax++){
    const st = ax === 0 ? 1 : ax === 1 ? N : N*N;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++){
      const base = ax === 0 ? N*(a + N*b) : ax === 1 ? a + N*N*b : a + N*b;
      for (let k = 0; k < N; k++){ r[k] = re[base + k*st]; i_[k] = im[base + k*st]; }
      fft1d(r, i_, N, inv);
      for (let k = 0; k < N; k++){ re[base + k*st] = r[k]; im[base + k*st] = i_[k]; }
    }
  }
  if (inv){ const s = 1/(N*N*N); for (let k = 0; k < re.length; k++){ re[k] *= s; im[k] *= s; } }
}
const freq = (i, N) => i <= N/2 ? i : i - N;

// ---------- RNG ----------
function mulberry(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// same hash as the GPU noise shader, so both produce the identical universe
function pcg(v){ const st = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0; const w = Math.imul(((st >>> ((st >>> 28) + 4)) ^ st) >>> 0, 277803737) >>> 0; return ((w >>> 22) ^ w) >>> 0; }
function whiteNoise(N, seed){
  const w = new Float32Array(N*N*N), sh = Math.imul(seed >>> 0, 0x9E3779B9) >>> 0;
  for (let i = 0; i < w.length; i++){
    const h1 = pcg(((2*i) ^ sh) >>> 0), h2 = pcg(((2*i + 1) ^ sh) >>> 0);
    const u = (h1 + 1) / 4294967296, v = h2 / 4294967296;
    w[i] = Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  }
  return w;
}

// ---------- initial conditions (Zel'dovich) on a grid of Ng, sampled at Np³ lattice ----------
// returns displacement grids Ψx,Ψy,Ψz (box units) for D = 1 (z = 0 linear amplitude)
function displacement(Ng, noise, kCut){
  const L = C.P.boxMpc, n3 = Ng*Ng*Ng;
  const re = Float64Array.from(noise), im = new Float64Array(n3);
  fft3d(re, im, Ng, false);
  // δ_k = W_k sqrt(P(k) N³ / V)   (so δ(x) = ifft(δ_k))
  const out = [0,1,2].map(() => [new Float64Array(n3), new Float64Array(n3)]);
  for (let z = 0; z < Ng; z++) for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++){
    const i = x + Ng*(y + Ng*z);
    const n = [freq(x, Ng), freq(y, Ng), freq(z, Ng)];
    const k2u = n[0]*n[0] + n[1]*n[1] + n[2]*n[2];
    if (k2u === 0) continue;
    const kMpc = 2*Math.PI*Math.sqrt(k2u)/L;
    if (Math.sqrt(k2u) > kCut) continue;
    const amp = Math.sqrt(C.power(kMpc) * n3 / (L*L*L));
    const dr = re[i]*amp, di = im[i]*amp;
    // Ψ_k = i k δ_k / k²  (box units: k = 2π n)
    for (let c = 0; c < 3; c++){
      if (Math.abs(n[c]) === Ng/2) continue;
      const f = n[c] / (2*Math.PI*k2u);
      out[c][0][i] = -di*f; out[c][1][i] = dr*f;
    }
  }
  return out.map(([r, i_]) => { fft3d(r, i_, Ng, true); return Float32Array.from(r); });
}

function trilerp(g, Ng, x, y, z){
  const u = x*Ng, v = y*Ng, w = z*Ng;
  const i0 = Math.floor(u), j0 = Math.floor(v), k0 = Math.floor(w);
  const fu = u - i0, fv = v - j0, fw = w - k0;
  let s = 0;
  for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++){
    const wt = (di ? fu : 1-fu) * (dj ? fv : 1-fv) * (dk ? fw : 1-fw);
    const ii = (i0+di) & (Ng-1), jj = (j0+dj) & (Ng-1), kk = (k0+dk) & (Ng-1);
    s += wt * g[ii + Ng*(jj + Ng*kk)];
  }
  return s;
}

function makeSim({ Np, Ng, seed = 1, zStart = 50, fsrc = 1 }){
  const aStart = 1/(1 + zStart);
  const noise = whiteNoise(Ng, seed);
  const psi = displacement(Ng, noise, Math.min(Ng, Np) / 2);
  const gt = C.growthTable(fsrc);
  const A = C.growth(aStart);                // same starting ripples as the real universe
  const fI = gt.f(aStart);
  const N = Np*Np*Np, pos = new Float32Array(3*N), mom = new Float32Array(3*N);
  const vfac = aStart*aStart*C.E(aStart)*fI*A;
  for (let k = 0, p = 0; k < Np; k++) for (let j = 0; j < Np; j++) for (let i = 0; i < Np; i++, p++){
    const q = [i/Np, j/Np, k/Np];
    for (let c = 0; c < 3; c++){
      const d = trilerp(psi[c], Ng, q[0], q[1], q[2]);
      pos[3*p+c] = ((q[c] + A*d) % 1 + 1) % 1;
      mom[3*p+c] = vfac*d;
    }
  }
  return { Np, Ng, N, pos, mom, a: aStart, aStart, fsrc, rho: new Float64Array(Ng*Ng*Ng), halfKicked: false };
}

function deposit(S){
  const { Ng, N, pos, rho } = S; rho.fill(0);
  for (let p = 0; p < N; p++){
    const u = pos[3*p]*Ng, v = pos[3*p+1]*Ng, w = pos[3*p+2]*Ng;
    const i0 = Math.floor(u), j0 = Math.floor(v), k0 = Math.floor(w), fu = u-i0, fv = v-j0, fw = w-k0;
    for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++)
      rho[((i0+di)&(Ng-1)) + Ng*(((j0+dj)&(Ng-1)) + Ng*((k0+dk)&(Ng-1)))] += (di ? fu : 1-fu) * (dj ? fv : 1-fv) * (dk ? fw : 1-fw);
  }
  const m = Ng*Ng*Ng/N; for (let i = 0; i < rho.length; i++) rho[i] = rho[i]*m - 1;
}

// solve ∇²ψ = δ and return -∇ψ grids (box units)
function forceGrids(S){
  const { Ng } = S, n3 = Ng*Ng*Ng;
  const re = Float64Array.from(S.rho), im = new Float64Array(n3);
  fft3d(re, im, Ng, false);
  for (let z = 0; z < Ng; z++) for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++){
    const i = x + Ng*(y + Ng*z), nx = freq(x,Ng), ny = freq(y,Ng), nz = freq(z,Ng);
    const k2 = 4*Math.PI*Math.PI*(nx*nx + ny*ny + nz*nz);
    const g = k2 === 0 ? 0 : -1/k2;
    re[i] *= g; im[i] *= g;
  }
  fft3d(re, im, Ng, true);
  const h = 1/Ng, M = Ng-1, id = (x, y, z) => (x&M) + Ng*((y&M) + Ng*(z&M));
  const g = [0,1,2].map(() => new Float32Array(n3));
  for (let z = 0; z < Ng; z++) for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++){
    const i = id(x,y,z);
    const d = (a1, a2, b1, b2) => -(8*(re[a1]-re[b1]) - (re[a2]-re[b2])) / (12*h);
    g[0][i] = d(id(x+1,y,z), id(x+2,y,z), id(x-1,y,z), id(x-2,y,z));
    g[1][i] = d(id(x,y+1,z), id(x,y+2,z), id(x,y-1,z), id(x,y-2,z));
    g[2][i] = d(id(x,y,z+1), id(x,y,z+2), id(x,y,z-1), id(x,y,z-2));
  }
  return g;
}

// schedule: uniform in sqrt(a)
function schedule(aStart, nSteps){
  const s0 = Math.sqrt(aStart); const a = [];
  for (let i = 0; i <= nSteps; i++){ const s = s0 + (1 - s0)*i/nSteps; a.push(s*s); }
  return a;
}

// one KDK step with merged kicks: momenta live at half steps
function step(S, a0, a1, aPrevHalf){
  const aHalf = Math.sqrt(a0*a1);  // geometric midpoint
  deposit(S);
  const g = forceGrids(S);
  const kf = 1.5 * C.P.Om * S.fsrc * C.kickFac(aPrevHalf, aHalf);
  const df = C.driftFac(a0, a1);
  const { N, Ng, pos, mom } = S;
  for (let p = 0; p < N; p++){
    const x = pos[3*p], y = pos[3*p+1], z = pos[3*p+2];
    for (let c = 0; c < 3; c++) mom[3*p+c] += kf * trilerp(g[c], Ng, x, y, z);
    for (let c = 0; c < 3; c++){ let v = pos[3*p+c] + df*mom[3*p+c]; v -= Math.floor(v); pos[3*p+c] = v; }
  }
  S.a = a1;
  return aHalf;
}

// power spectrum of particles (CIC on grid Ng), returns [kMpc, P, Plin(a)]
function powerSpec(S, Ng, a){
  const T = { ...S, Ng, rho: new Float64Array(Ng*Ng*Ng) }; deposit(T);
  const re = T.rho, im = new Float64Array(re.length); fft3d(re, im, Ng, false);
  const L = C.P.boxMpc, V = L*L*L, n3 = Ng*Ng*Ng;
  const bins = new Float64Array(Ng), cnt = new Float64Array(Ng);
  for (let z = 0; z < Ng; z++) for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++){
    const nx = freq(x,Ng), ny = freq(y,Ng), nz = freq(z,Ng), n = Math.sqrt(nx*nx+ny*ny+nz*nz);
    const b = Math.round(n); if (b === 0 || b >= Ng/2) continue;
    const i = x + Ng*(y + Ng*z);
    // deconvolve CIC window
    const sinc = t => t === 0 ? 1 : Math.sin(t)/t;
    const W = (sinc(Math.PI*nx/Ng)*sinc(Math.PI*ny/Ng)*sinc(Math.PI*nz/Ng))**2;
    bins[b] += (re[i]*re[i] + im[i]*im[i]) / (W*W) * V / (n3*n3); cnt[b]++;
  }
  const D = C.growth(a), out = [];
  for (let b = 1; b < Ng/2; b++) if (cnt[b]){ const k = 2*Math.PI*b/L; out.push([k, bins[b]/cnt[b], C.power(k)*D*D]); }
  return out;
}

module.exports = { fft1d, fft3d, whiteNoise, displacement, makeSim, deposit, forceGrids, schedule, step, powerSpec, trilerp };
