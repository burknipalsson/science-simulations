// Browser-side GPU validation cases, driven by gpu_run.js.
const sleep0 = () => new Promise(r => setTimeout(r, 0));
function mkGL() {
  const gl = document.getElementById('c').getContext('webgl2', { antialias: false });
  console.log('GPU:', gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL));
  return gl;
}
const CASES = {
  // Schäfer & Turek 2D-1 (Re 20) / 2D-2 (Re 100), quasi-2D
  async cylinder(Re = '20', D = '20', ms = '1', sp = '0', reg = '2', rates = '{}') {
    window.REG = +reg; window.RATES = JSON.parse(rates);
    Re = +Re; D = +D; window.MACH_SCALE = +ms;
    const gl = mkGL(), s = D / 0.1, nx = Math.round(2.2 * s), ny = Math.round(0.41 * s);
    const Ubar = (Re === 20 ? 0.02 : 0.04) * (+(window.MACH_SCALE || 1)), nu = Ubar * D / Re, xc = 0.2 * s - 0.5, yc = 0.2 * s - 0.5;
    const L = new LBMGPU(gl, { nx, ny, nz: 1, nu, bcY: 2, bcZ: 0, u: Ubar, reg: window.REG, rates: window.RATES, sponge: +sp ? { len: Math.round(+sp * s), nu: 0.05 } : undefined,
      sdf: `return length(p.xy - vec2(${xc}, ${yc})) - ${D / 2}.;`,
      inflow: `float H = float(N.y), y = float(p.y) + 0.5; return vec3(6. * y * (H - y) / (H * H), 0., 0.);` });
    const coef = 2 / (Ubar * Ubar * D);
    console.log(`Re ${Re}, D ${D}, grid ${nx}x${ny}, atlas ${L.W}x${L.H}`);
    const t0 = performance.now();
    if (Re === 20) {
      for (let k = 1; k <= 200; k++) {
        L.step(500, true);
        const F = L.readForceSync();
        if (k % 10 === 0) console.log(`step ${L.t}: Cd ${(F[0] * coef).toFixed(4)} Cl ${(F[1] * coef).toFixed(4)}`);
        if (k % 20 === 0) await sleep0();
      }
    } else {
      const T = D / (0.3 * Ubar), hist = [];
      for (let i = 0; i < 25 * T; i += 100) { L.step(100, false); if (i % 5000 === 0) await sleep0(); }
      for (let i = 0; i < 6 * T; i++) { L.step(1, true); const F = L.readForceSync(); hist.push([F[0] * coef, F[1] * coef]); }
      const cl = hist.map(h => h[1]), ups = [];
      for (let i = 1; i < cl.length; i++) if (cl[i - 1] < 0 && cl[i] >= 0) ups.push(i - 1 + cl[i - 1] / (cl[i - 1] - cl[i]));
      const per = (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
      console.log(`Cd max ${Math.max(...hist.map(h => h[0])).toFixed(4)} (3.22-3.24)  Cl max ${Math.max(...cl).toFixed(4)} min ${Math.min(...cl).toFixed(4)} (0.99-1.01)  St ${(D / (per * Ubar)).toFixed(4)} (0.295-0.305)`);
    }
    const dt = performance.now() - t0;
    console.log(`${(dt / 1000).toFixed(1)} s, ${(L.t * nx * ny / dt / 1000).toFixed(0)} MLUPS`);
  },
};
CASES.inflowCheck = async (D = '40') => {
  D = +D; const gl = mkGL(), s = D / 0.1, nx = Math.round(2.2 * s), ny = Math.round(0.41 * s), Ubar = 0.02, nu = Ubar * D / 20;
  const xc = 0.2 * s - 0.5, yc = 0.2 * s - 0.5;
  const L = new LBMGPU(gl, { nx, ny, nz: 1, nu, bcY: 2, u: Ubar, sdf: `return length(p.xy - vec2(${xc}, ${yc})) - ${D / 2}.;`,
    inflow: `float H = float(N.y), y = float(p.y) + 0.5; return vec3(6. * y * (H - y) / (H * H), 0., 0.);` });
  for (let k = 0; k < 100; k++) L.step(500, true);
  const F = L.readForceSync(), m = L.readMacroSlice(0);
  console.log('Cd', (F[0] * 2 / (Ubar * Ubar * D)).toFixed(4), 'Cl', (F[1] * 2 / (Ubar * Ubar * D)).toFixed(4));
  for (const x of [0, 1, 5, Math.round(xc), nx - 2, nx - 1]) {
    let flux = 0, mx = 0, rs = 0; for (let y = 0; y < ny; y++) { const k = 4 * (x + nx * y); flux += m[k] * m[k + 3]; mx = Math.max(mx, m[k]); rs += m[k + 3]; }
    console.log(`x ${x}: mean rho*u / Ubar ${(flux / ny / Ubar).toFixed(5)}  umax/Ubar ${(mx / Ubar).toFixed(4)}  mean rho ${(rs / ny).toFixed(5)}`);
  }
};
CASES.blowup = async (D = '40', Ubar = '0.01', Re = '100', cs = '0', every = '1000', pr = '20', sp = '0') => {
  window.EVERY = every; window.PR = +pr;
  D = +D; Ubar = +Ubar; Re = +Re;
  const gl = mkGL(), s = D / 0.1, nx = Math.round(2.2 * s), ny = Math.round(0.41 * s), nu = Ubar * D / Re;
  const xc = 0.2 * s - 0.5, yc = 0.2 * s - 0.5;
  const L = new LBMGPU(gl, { nx, ny, nz: 1, nu, cs: +cs, bcY: 2, u: Ubar, sponge: +sp ? { len: Math.round(+sp * s), nu: 0.05 } : undefined, sdf: `return length(p.xy - vec2(${xc}, ${yc})) - ${D / 2}.;`,
    inflow: `float H = float(N.y), y = float(p.y) + 0.5; return vec3(6. * y * (H - y) / (H * H), 0., 0.);` });
  console.log('tau', 3 * nu + 0.5);
  every = +every;
  for (let k = 0; k < 400; k++) {
    L.step(every, true);
    const m = L.readMacroSlice(0); let bad = -1, mx = 0, at = -1;
    for (let i = 0; i < nx * ny; i++) { const v = Math.hypot(m[4 * i], m[4 * i + 1]); if (!isFinite(v)) { bad = i; break; } if (v > mx) { mx = v; at = i; } }
    let rmin = 1e9, rmax = -1e9, ra = 0; for (let i = 0; i < nx * ny; i++) { const r = m[4 * i + 3]; if (r === 0) continue; if (r < rmin) { rmin = r; } if (r > rmax) { rmax = r; ra = i; } }
    if (k % (window.PR || 20) === 0 || bad >= 0) console.log(L.t, 'max |u|/Ubar', (mx / Ubar).toFixed(3), 'at', at % nx, Math.floor(at / nx), 'rho', rmin.toFixed(4), rmax.toExponential(3), 'at', ra % nx, Math.floor(ra / nx));
    if (bad >= 0) { console.log('NaN at', bad % nx, Math.floor(bad / nx)); break; }
  }
};
// Sphere in a wide box (free-slip sides), 3D. Johnson & Patel 1999: Re 100 Cd 1.08 (steady axisymmetric);
// Re 300 Cd 0.656, St 0.137 (periodic shedding). High Re: subcritical Cd ~0.4-0.5 (stability check).
CASES.sphere = async (Re = '100', D = '24', U = '0.04', cs = '0', steps = '0', box = '0') => {
  Re = +Re; D = +D; U = +U;
  const gl = mkGL(), nx = Math.round(+box ? 12 * D : 16 * D), ny = Math.round(8 * D), nz = ny, nu = U * D / Re;
  const xc = 4 * D, yc = ny / 2 - 0.5 + 0.3, zc = nz / 2 - 0.5 + 0.2; // slight offset breaks symmetry
  const L = new LBMGPU(gl, { nx, ny, nz, nu, cs: +cs, bcY: 1, bcZ: 1, u: U, sponge: { len: Math.round(2 * D), nu: 0.05 }, absorb: { inLen: Math.round(D), outLen: Math.round(2 * D), sigma: 0.2 },
    sdf: `return length(p - vec3(${xc}, ${yc}, ${zc})) - ${D / 2}.;`, inflow: `return vec3(1., 0., 0.);` });
  const coef = 8 / (U * U * Math.PI * D * D), T = D / (0.137 * U);
  const nsteps = +steps || Math.round(Re > 150 ? 30 * T : 25 * D / U);
  console.log(`Re ${Re} D ${D} grid ${nx}x${ny}x${nz} (${(nx * ny * nz / 1e6).toFixed(1)}M) atlas ${L.W}x${L.H} tau ${(3 * nu + .5).toFixed(5)} steps ${nsteps}`);
  const t0 = performance.now(), hist = [];
  const chunk = 50;
  for (let k = 0; k < nsteps; k += chunk) {
    L.step(chunk, true); const F = L.readForceSync(); hist.push([L.t, F[0] * coef, Math.hypot(F[1], F[2]) * coef, F[1] * coef, F[2] * coef]);
    if (!isFinite(F[0])) { console.log('NaN at', L.t); break; }
    if (k % (chunk * 200) === 0) { console.log(`  ${L.t}: Cd ${(F[0] * coef).toFixed(4)} Cl ${(Math.hypot(F[1], F[2]) * coef).toFixed(4)}  ${((performance.now() - t0) / 1000).toFixed(0)} s`); await sleep0(); }
  }
  const dt = performance.now() - t0, tail = hist.slice(Math.floor(hist.length * 0.6));
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  console.log(`Cd mean (last 40%) ${mean(tail.map(h => h[1])).toFixed(4)}  Cl rms ${Math.sqrt(mean(tail.map(h => h[2] * h[2]))).toFixed(4)}`);
  // dominant shedding frequency: peak of the summed power spectrum of the two side-force components
  let best = [0, 0];
  for (let fq = 0.02; fq <= 0.4; fq += 0.0005) {
    const om = 2 * Math.PI * fq * U / D; let pw = 0;
    for (const c of [3, 4, 1]) { const m = mean(tail.map(h => h[c])); let re = 0, im = 0;
      for (const h of tail) { re += (h[c] - m) * Math.cos(om * h[0]); im += (h[c] - m) * Math.sin(om * h[0]); } pw += re * re + im * im; }
    if (pw > best[1]) best = [fq, pw];
  }
  console.log(`St (spectral peak) ${best[0].toFixed(4)}  side-force mean ${mean(tail.map(h => h[3])).toFixed(4)}, ${mean(tail.map(h => h[4])).toFixed(4)}`);
  console.log(`${(dt / 1000).toFixed(1)} s, ${(L.t * nx * ny * nz / dt / 1000).toFixed(0)} MLUPS`);
};
// free-stream noise: rms of (u - U) and of rho-1 in a box upstream / beside the body
CASES.noise = async (cfg = '{}') => {
  const o = Object.assign({ N: [256, 128, 128], U: 0.05, Re: 1e5, cs: 0.1, tauB: 1, body: 1, steps: 5000, d: 0.1 }, JSON.parse(cfg));
  const gl = mkGL(), N = o.N, sc = SCENES.sphere(N, { d: o.d });
  const L = new LBMGPU(gl, { nx: N[0], ny: N[1], nz: N[2], nu: o.U * sc.refLen / o.Re, cs: o.cs, tauB: o.tauB, reg: o.reg, rates: o.rates, inNeq: o.inNeq, bcX: o.bcX, absorb: o.absorb, bcY: o.bc ?? 1, bcZ: o.bc ?? 1, u: o.U,
    sponge: { len: Math.round(N[0] * 0.12), nu: 0.05 }, sdf: o.body ? sc.sdf : 'return 1e3;', inflow: 'return vec3(1., 0., 0.);', lib: GLSL_SDF_LIB });
  const stat = () => {
    // upstream: x 4..40 (body front at ~51); side: x 60..200 within 15% of the top/bottom
    const r = { up: [0, 0, 0], side: [0, 0, 0] };
    for (const z of [Math.round(N[2] * 0.12), Math.round(N[2] * 0.5), Math.round(N[2] * 0.88)]) {
      const m = L.readMacroSlice(z);
      for (let y = 4; y < N[1] - 4; y++) for (let x = 4; x < N[0] * 0.8; x++) {
        const k = 4 * (x + N[0] * y), du = Math.hypot(m[k] - o.U, m[k + 1], m[k + 2]), dr = m[k + 3] - 1;
        const reg = x < 40 ? r.up : (z !== Math.round(N[2] * 0.5) && x > 60) ? r.side : null;
        if (reg) { reg[0] += du * du; reg[1] += dr * dr; reg[2]++; }
      }
    }
    const f = a => `u ${(Math.sqrt(a[0] / a[2]) / o.U).toFixed(4)} p ${(Math.sqrt(a[1] / a[2]) / (o.U * o.U)).toFixed(4)}`;
    return 'upstream ' + f(r.up) + ' | side ' + f(r.side);
  };
  // temporal fluctuation in the upstream box (x 4..40), all z planes through 3 heights, from snapshots 37 steps apart
  const snap = () => [0.12, 0.5, 0.88].map(f => L.readMacroSlice(Math.round(N[2] * f)));
  const tfluc = () => {
    const A = snap(); L.step(37, true); const B = snap(); let su = 0, sp = 0, n = 0;
    for (let j = 0; j < 3; j++) for (let y = 4; y < N[1] - 4; y++) for (let x = 4; x < 40; x++) {
      const k = 4 * (x + N[0] * y); su += (A[j][k] - B[j][k]) ** 2 + (A[j][k + 1] - B[j][k + 1]) ** 2 + (A[j][k + 2] - B[j][k + 2]) ** 2; sp += (A[j][k + 3] - B[j][k + 3]) ** 2; n++; }
    return `temporal upstream: u' ${(Math.sqrt(su / n / 2) / o.U).toFixed(5)} p' ${(Math.sqrt(sp / n / 2) / 3 / (o.U * o.U)).toFixed(5)}`;
  };
  for (let s = 0; s < o.steps; s += 1000) { L.step(1000, true); console.log(`${L.t}: ${stat()} | ${tfluc()}`); }
};
// dump a z-slice of (u - U) to a PGM-like JSON for inspection
CASES.slice = async (cfg = '{}') => {
  const o = Object.assign({ N: [256, 128, 128], U: 0.05, Re: 1e5, cs: 0.1, tauB: 1, steps: 4000, reg: 2, d: 0.1 }, JSON.parse(cfg));
  const gl = mkGL(), N = o.N, sc = SCENES.sphere(N, { d: o.d });
  const L = new LBMGPU(gl, { nx: N[0], ny: N[1], nz: N[2], nu: o.U * sc.refLen / o.Re, cs: o.cs, tauB: o.tauB, reg: o.reg, rates: o.rates, inNeq: o.inNeq, bcX: o.bcX, absorb: o.absorb, bcY: 1, bcZ: 1, u: o.U,
    sponge: { len: Math.round(N[0] * 0.12), nu: 0.05 }, sdf: sc.sdf, inflow: 'return vec3(1., 0., 0.);', lib: GLSL_SDF_LIB });
  L.step(o.steps, true);
  const z = Math.round(N[2] * (o.zf ?? 0.2)), m = L.readMacroSlice(z), out = [];
  for (let y = 0; y < N[1]; y++) { const row = []; for (let x = 0; x < N[0]; x++) { const k = 4 * (x + N[0] * y); row.push(+((m[k] - o.U) / o.U).toFixed(4), +(m[k + 1] / o.U).toFixed(4)); } out.push(row); }
  console.log('SLICE' + JSON.stringify(out));
};
CASES.parity = async () => {
  const P = PARITY, gl = mkGL();
  const L = new LBMGPU(gl, { nx: P.nx, ny: P.ny, nz: P.nz, nu: P.nu, cs: P.cs, bcY: 1, bcZ: 1, u: P.U, sponge: P.sponge, absorb: P.absorb,
    sdf: `return length(p - vec3(${P.xc}, ${P.yc}, ${P.zc})) - ${P.R};`, inflow: 'return vec3(1., 0., 0.);' });
  L.step(P.steps, true);
  const F = L.readForceSync(), m = L.readMacroSlice(20), k = 4 * (40 + P.nx * 16);
  console.log('PARITY' + JSON.stringify([...F, m[k], m[k + 2], m[k + 3]]));
};
// NACA airfoil lift curve in a quasi-2D slab (periodic span). Prints mean Cl, Cd per angle.
CASES.polar = async (cfg = '{}') => {
  const o = Object.assign({ N: [384, 16, 256], code: '2412', Re: 3e6, U: 0.05, cs: 0.1, angles: [0, 4, 8, 12, 16, 20], ft: 3, chord: 0.16, xle: 0.3 }, JSON.parse(cfg));
  const gl = mkGL(), N = o.N;
  for (const al of o.angles) {
    const sc = SCENES.wing(N, { code: o.code, alpha: al, span: 0 });
    // override chord/position via a rescaled scene: rebuild with custom chord
    const c = Math.round(o.chord * N[0]), xLE = o.xle * N[0], zc = N[2] / 2 - 0.5, a = al * Math.PI / 180;
    const sdf = `vec2 q = vec2(p.x - ${(xLE + 0.25 * c).toFixed(3)}, p.z - ${zc.toFixed(3)}); float ca = SP.x, sa = SP.y;
      q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y) / ${c}. + vec2(0.25, 0.); return AF_sd(q) * ${c}.;`;
    const L = new LBMGPU(gl, { nx: N[0], ny: N[1], nz: N[2], nu: o.U * c / o.Re, cs: o.cs, bcY: 0, bcZ: 1, u: o.U, wallModel: o.wm ?? 1, nuWall: o.nuWall, wmP: o.wmP,
      sponge: { len: Math.round(N[0] * 0.1), nu: 0.04 }, absorb: { inLen: Math.round(N[0] * 0.05), outLen: Math.round(N[0] * 0.1), sigma: 0.2, side: [0, 0, o.side ?? 24, o.side ?? 24] },
      sdf, inflow: 'return vec3(1., 0., 0.);', lib: GLSL_SDF_LIB + sc.lib, SP: [Math.cos(a), Math.sin(a), 0, 0] });
    const q = 0.5 * o.U * o.U * c * N[1], steps = Math.round(o.ft * N[0] / o.U), hist = [];
    for (let s = 0; s < steps; s += 100) { L.step(100, true); if (s > steps * 0.4) { const F = L.readForceSync(); hist.push([F[0] / q, F[2] / q]); } if (s % 5000 === 0) await sleep0(); }
    const m = k => hist.reduce((a, h) => a + h[k], 0) / hist.length, sd = k => Math.sqrt(hist.reduce((a, h) => a + (h[k] - m(k)) ** 2, 0) / hist.length);
    console.log(`alpha ${String(al).padStart(3)}: Cl ${m(1).toFixed(3)} (sd ${sd(1).toFixed(3)})  Cd ${m(0).toFixed(4)}  chord ${c} cells`);
    L.dispose();
  }
};
CASES.wingNaN = async (cfg = '{}') => {
  const o = Object.assign({ N: [384, 16, 256], code: '2412', Re: 3e6, U: 0.05, cs: 0.1, alpha: 0, chord: 0.16, xle: 0.3, every: 200, max: 30000 }, JSON.parse(cfg));
  const gl = mkGL(), N = o.N, c = Math.round(o.chord * N[0]), xLE = o.xle * N[0], zc = N[2] / 2 - 0.5, a = o.alpha * Math.PI / 180;
  const sc = SCENES.wing(N, { code: o.code, alpha: o.alpha });
  const sdf = `vec2 q = vec2(p.x - ${(xLE + 0.25 * c).toFixed(3)}, p.z - ${zc.toFixed(3)}); float ca = SP.x, sa = SP.y;
    q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y) / ${c}. + vec2(0.25, 0.); return AF_sd(q) * ${c}.;`;
  const L = new LBMGPU(gl, { nx: N[0], ny: N[1], nz: N[2], nu: o.U * c / o.Re, cs: o.cs, bcY: 0, bcZ: 1, u: o.U, wallModel: 1, nuWall: o.nuWall, wmP: o.wmP,
    sponge: { len: Math.round(N[0] * 0.1), nu: 0.04 }, absorb: { inLen: Math.round(N[0] * 0.05), outLen: Math.round(N[0] * 0.1), sigma: 0.2, side: [0, 0, 24, 24] },
    sdf, inflow: 'return vec3(1., 0., 0.);', lib: GLSL_SDF_LIB + sc.lib, SP: [Math.cos(a), Math.sin(a), 0, 0] });
  let prevMax = 0;
  for (let s = 0; s < o.max; s += o.every) {
    L.step(o.every, true);
    let bad = null, mx = 0, at = null;
    for (let z = 0; z < N[2] && !bad; z++) { const m = L.readMacroSlice(z); for (let i = 0; i < N[0] * N[1]; i++) { const v = Math.hypot(m[4 * i], m[4 * i + 2]); if (!isFinite(v)) { bad = [i % N[0], Math.floor(i / N[0]), z]; break; } if (v > mx) { mx = v; at = [i % N[0], Math.floor(i / N[0]), z]; } } }
    if (mx > 2 * o.U && !window.FIRSTBIG) { window.FIRSTBIG = 1; console.log('first >2U', L.t, at, 'phi?'); }
    if (bad || s % 2000 === 0 || mx > 3 * o.U) console.log(L.t, 'max |u|/U', (mx / o.U).toFixed(2), 'at', at, bad ? 'NaN at ' + bad : '', ' LE x', xLE.toFixed(0), 'TE x', (xLE + c * Math.cos(a)).toFixed(0), 'zc', zc);
    if (bad) break;
  }
};
// Ahmed body (Ahmed, Ramm & Faltin 1984): L 1044, W 389, H 288 mm, nose radius 100 mm, clearance 50 mm,
// rear slant 222 mm long. Measured Cd 0.285 (25 deg), 0.378 (30 deg), 0.257 (35 deg), Re 4.29e6 on length.
CASES.ahmed = async (cfg = '{}') => {
  const o = Object.assign({ Lc: 96, slant: 25, U: 0.05, Re: 4.29e6, wm: 1, ft: 3, cs: 0.1 }, JSON.parse(cfg));
  const gl = mkGL(), m = o.Lc / 1.044, N = [Math.round(4 * o.Lc), Math.round(1.6 * o.Lc), Math.round(1.1 * o.Lc)];
  const x0 = 0.25 * N[0], yc = N[1] / 2 - 0.5, gz = -0.5, cl = 0.05 * m, H = 0.288 * m, W = 0.389 * m, L = o.Lc, r = 0.1 * m, ls = 0.222 * m;
  const a = o.slant * Math.PI / 180, f = v => (+v).toFixed(4);
  // box with rounded front (radius r on front edges), sharp rear, slant cut on the rear top
  const sdf = `vec3 q = p - vec3(${f(x0 + L / 2)}, ${f(yc)}, ${f(gz + cl + H / 2)});
    vec3 b = vec3(${f(L / 2)}, ${f(W / 2)}, ${f(H / 2)});
    // rounded at the front only: shift the rounding box forward
    float front = sdRoundBox(q - vec3(${f(r)}, 0., 0.), b + vec3(${f(r)}, 0., 0.), ${f(r)});
    float d = max(front, q.x - ${f(L / 2)});
    d = max(d, dot(q - vec3(${f(L / 2 - ls)}, 0., ${f(H / 2)}), vec3(${f(Math.sin(a))}, 0., ${f(Math.cos(a))})));
    return d;`;
  const L_ = new LBMGPU(gl, { nx: N[0], ny: N[1], nz: N[2], nu: o.U * L / o.Re, cs: o.cs, bcY: 1, bcZ: 2, u: o.U, wallModel: o.wm, wall: { zhi: [o.U, 0, 0] },
    sponge: { len: Math.round(N[0] * 0.1), nu: 0.04 }, absorb: { inLen: Math.round(N[0] * 0.05), outLen: Math.round(N[0] * 0.1), sigma: 0.2, side: [12, 12, 0, 12] },
    sdf, inflow: 'return vec3(1., 0., 0.);', lib: GLSL_SDF_LIB });
  L_.step(1, true); { const zz = Math.round(gz + cl + H / 2), mm = L_.readMacroSlice(zz); let ns = 0; for (let i = 0; i < N[0] * N[1]; i++) if (mm[4 * i + 3] === 0) ns++; console.log('solid cells in slice z=' + zz + ':', ns, 'expected ~', Math.round(L * W)); }
  const A = W * H, q = 0.5 * o.U * o.U * A, steps = Math.round(o.ft * N[0] / o.U), hist = [];
  for (let s = 0; s < steps; s += 100) { L_.step(100, true); if (s > steps * 0.45) { const F = L_.readForceSync(); hist.push([F[0] / q, F[2] / q]); }
    if (s % 5000 === 0) { const F = L_.readForceSync(); console.log(`  ${L_.t}: Cd ${(F[0] / q).toFixed(3)} Cl ${(F[2] / q).toFixed(3)} lost ${gl.isContextLost()}`); await sleep0(); } }
  const mean = k => hist.reduce((s, h) => s + h[k], 0) / hist.length;
  console.log(`Ahmed ${o.slant} deg, L ${L} cells, grid ${N.join('x')}, wall model ${o.wm}: Cd ${mean(0).toFixed(3)}  Cl ${mean(1).toFixed(3)}`);
};
