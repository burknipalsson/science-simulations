// Dev harness: one scene, run + render on demand.
const DEV = {
  setup(o) {
    const cv = document.getElementById('c'), gl = this.gl = cv.getContext('webgl2', { antialias: false });
    const N = o.N || [256, 128, 128], U = o.U || 0.05;
    const sc = this.sc = SCENES[o.scene || 'sphere'](N, o.params || {});
    const L = this.L = new LBMGPU(gl, { nx: N[0], ny: N[1], nz: N[2], nu: U * sc.refLen / (o.Re || 1e5), cs: o.cs ?? 0.1, tauB: o.tauB ?? 1,
      bcY: sc.bcY, bcZ: sc.bcZ, wall: sc.wall || {}, u: U, sponge: { len: Math.round(N[0] * 0.12), nu: 0.05 },
      sdf: sc.sdf, inflow: sc.inflow, lib: GLSL_SDF_LIB + (sc.lib || '') });
    const V = this.V = new Viz(gl, L); V.bakeBody(sc);
    this.rake0 = o.rake; V.initParticles(o.np || 1 << 20, 2.2 * N[0] / U);
    this.U = U; this.o = o; this.N = N;
    this.rake = o.rake || { lo: [1, N[1] * 0.3, N[2] * 0.3], hi: [1, N[1] * 0.7, N[2] * 0.7], ny: 24, nz: 24, life: 2.2 * N[0] / U };
  },
  async run(s) {
    const { L, V, gl, N } = this, steps = s.steps || 0, per = s.per || 10, t0 = performance.now();
    for (let k = 0; k < steps; k += per) {
      L.step(per, true); V.updateFields(); if (V.nPart) V.advect(per, this.rake);
      if (k % 2000 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const F = L.readForceSync(), sc = this.sc, q = 0.5 * this.U * this.U * sc.refArea;
    console.log(`t ${L.t}: Cd ${(F[0] / q).toFixed(4)} Cl ${(F[2] / q).toFixed(4)} Cy ${(F[1] / q).toFixed(4)}  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    const cv = gl.canvas, cam = s.cam || {};
    const view = M4.orbit(cam.target || [N[0] * 0.45, N[1] / 2, N[2] / 2], cam.yaw ?? -2.2, cam.pitch ?? 0.35, cam.dist ?? N[0] * 1.3, cv.width / cv.height);
    view.width = cv.width; view.height = cv.height;
    V.render(view, Object.assign({ mode: 0, smoke: true, rake: this.rake, uRef: this.U, qThr: 1e-5, floor: 1, alpha: 0.06, psize: 1.5 }, s.opt || {}));
    gl.finish();
  },
};
