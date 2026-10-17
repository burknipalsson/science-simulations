// Browser side: today's wind around the person on Hallgrímstorg, with the Wind Tunnel's GPU lattice-Boltzmann
// solver (lbm_gpu.js, BGK + Smagorinsky, absorbing layers, wall model) and its smoke particles (viz.js).
// Records the drag on the body and the paths of smoke tracers released upstream. Driven by wind_run.js.
async function windCase(o) {
  const sleep0 = () => new Promise(r => setTimeout(r, 0));
  const gl = document.getElementById('c').getContext('webgl2', { antialias: false });
  console.log('GPU:', gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL));
  const P = PTEN_PERSON, dx = o.dx, cpm = 1 / dx;
  const nx = Math.round(o.Lx / dx), ny = Math.round(o.Ly / dx), nz = Math.round(o.Lz / dx);
  const xp = Math.round(o.up / dx), yc = ny / 2 - 0.5, zg = o.slipFloor ? -0.5 : 1.5;                  // person origin (lattice); ground plane at z = 1.5
  // lattice x = wind direction; person frame = Rz(theta) * lattice
  const th = o.theta, c = Math.cos(th), s = Math.sin(th);
  const lib = P.glslLBM(1, [0, 0, 0]).lib;
  const body = `vec3 q = (vec3(p) - vec3(${xp.toFixed(1)}, ${yc.toFixed(1)}, ${zg.toFixed(1)})) / ${cpm.toFixed(4)};
    q = vec3(${c.toFixed(8)} * q.x - ${s.toFixed(8)} * q.y, ${s.toFixed(8)} * q.x + ${c.toFixed(8)} * q.y, q.z);
    float d = ${o.noBody ? '1e3' : `pp_body(q) * ${cpm.toFixed(4)}`};
    return ${o.slipFloor ? 'd' : `min(d, p.z - ${zg.toFixed(1)})`};`;
  // log-law profile, normalised at the reference height zr (m)
  const z0 = o.z0, zr = o.zr;
  const inflow = o.uniform ? 'return vec3(1., 0., 0.);' : `float z = max((float(p.z) - ${zg.toFixed(1)}) / ${cpm.toFixed(4)}, ${(z0 * 1.01).toFixed(5)});
    return vec3(log(z / ${z0.toFixed(5)}) / ${Math.log(zr / z0).toFixed(6)}, 0., 0.);`;
  const U = o.U, Re = o.uReal * 0.4 / 1.51e-5, nu = U * 0.4 * cpm / Re;
  const L = new LBMGPU(gl, { nx, ny, nz, nu, cs: 0.1, u: U, bcY: 1, bcZ: 1, wall: {},
    sponge: { len: Math.round(nx * 0.1), nu: 0.04 },
    absorb: { inLen: Math.round(nx * 0.05), outLen: Math.round(nx * 0.1), sigma: 0.2, side: [12, 12, 0, 12] },
    nuWall: 0, sdf: body, inflow, lib: GLSL_SDF_LIB + lib, wallModel: true });
  const dt = dx * U / o.uReal;                                         // seconds per step
  console.log(`grid ${nx}x${ny}x${nz} (${(nx * ny * nz / 1e6).toFixed(1)} M cells), dx ${dx * 100} cm, U ${U}, Re ${Re.toFixed(0)}, nu_lattice ${nu.toExponential(2)}, dt ${(dt * 1e3).toFixed(4)} ms/step`);
  const V = new Viz(gl, L);
  V.bakeBody({ bbox: [[xp - 0.5 * cpm, yc - 0.5 * cpm, 0], [xp + 0.5 * cpm, yc + 0.5 * cpm, zg + 1.9 * cpm]], sdf: body, lib });
  const rake = { lo: [Math.round(nx * 0.05) + 8, yc - o.rakeY * cpm, zg + 0.05 * cpm], hi: [0, yc + o.rakeY * cpm, zg + o.rakeZ * cpm], ny: 32, nz: 64, life: 1e9, jitter: 0.9 };
  V.initParticles(o.nPart, Math.round(1.2 / dt));   // first releases staggered over 1.2 s of air
  const sub = o.sub, perFrame = Math.round(1 / o.fps / dt / sub) * sub, subSteps = perFrame / sub;
  const run = async (nFrames, rec) => {
    const frames = [], forces = [];
    for (let f = 0; f < nFrames; f++) {
      let Fx = 0, Fy = 0;
      for (let k = 0; k < sub; k++) {
        L.step(subSteps - 1, false); L.step(1, true);
        V.updateFields(); V.advect(subSteps, rake);
        if (rec) { const F = L.readForceSync(); Fx += F[0] / sub; Fy += F[1] / sub; }
      }
      if (rec) {
        forces.push([Fx, Fy]);
        const buf = new Float32Array(4 * V.PW * V.PH);
        gl.bindFramebuffer(gl.FRAMEBUFFER, V.pfbo[V.pcur]); gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(0, 0, V.PW, V.PH, gl.RGBA, gl.FLOAT, buf);
        frames.push(Array.from(buf));
      } else { const b = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, V.pfbo[V.pcur]); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, b); }
      if (gl.isContextLost()) throw new Error('context lost');
      await sleep0();
    }
    return { frames, forces };
  };
  const t0 = performance.now();
  await run(Math.round(o.spin * o.fps), false);
  console.log(`spin-up ${o.spin} s of air in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const t1 = performance.now();
  const r = await run(Math.round(o.rec * o.fps), true);
  console.log(`recorded ${o.rec} s in ${((performance.now() - t1) / 1000).toFixed(1)} s, ${perFrame} steps per frame`);
  // drag: lattice force -> CdA (m^2) against the reference wind
  const Fm = r.forces.reduce((a, f) => [a[0] + f[0] / r.forces.length, a[1] + f[1] / r.forces.length], [0, 0]);
  console.log(`mean force (lattice) ${Fm[0].toExponential(4)} ${Fm[1].toExponential(4)}; as CdA ${(Fm[0] * dx * dx / (0.5 * U * U)).toFixed(4)} m^2`);
  return { meta: { nx, ny, nz, dx, xp, yc, zg, theta: th, U, uReal: o.uReal, dt, perFrame, fps: o.fps, PW: V.PW, PH: V.PH, Fmean: Fm, z0, zr }, frames: r.frames, forces: r.forces };
}
