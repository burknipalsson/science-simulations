// Browser side: red cells in a nailfold capillary's arterial limb (7.4 µm, Andrade 1990 via refs_inner.md), single
// file at the resting red-cell speed of 0.65 mm/s (Fagrell 1977). The blood sim's fine-grid engine (dx 0.25 µm,
// 2,562-vertex Skalak membranes, viscosity contrast 5), periodic along the vessel. Records cell shapes for the page.
async function capCase(o) {
  const sleep0 = () => new Promise(r => setTimeout(r, 0));
  const gl = document.getElementById('c').getContext('webgl2', { antialias: false });
  const P = { eta: 1.2e-3, kappa: 2e-19 };
  const U = new Units({ dx: 0.25e-6, GsL: 5e-4 });
  const R = U.len(o.D * 1e-6) / 2, R1 = Math.max(R, U.len(4.6e-6)), n = Math.ceil(2 * R1) + 4, nx = Math.round(U.len(o.L * 1e-6)), cc = (n - 1) / 2;
  const sp = icosphere(4), top = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: top.E });
  const sim = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: 5, mob: 0.03, cellRadius: U.len(9e-6), maxCells: o.ncell, tables: buildMeshTables(top, [X0]),
    SP: [R1, 0, 0, 0], krep: 10 * U.GsL, rcut: 1, sdf: `return SP.x - length(p.yz - vec2(${cc.toFixed(4)}));` });
  const rotY = X => X.map(p => [p[2], p[1], -p[0]]);
  const cells = [];
  for (let i = 0; i < o.ncell; i++) {
    const x0 = nx * (i + 0.5) / o.ncell + (i % 2 ? 0.6 : -0.6) * U.len(1e-6), Xl = rotY(X0).map(p => [p[0] + x0, p[1] + cc + 0.15 * (i - 1.5), p[2] + cc]);
    const c = [0, 1, 2].map(d => Xl.reduce((a, p) => a + p[d], 0) / Xl.length), an = c.map(Math.round);
    cells.push({ X: Xl.map(p => [p[0] - an[0], p[1] - an[1], p[2] - an[2]]), anchor: an, Gs: U.GsL, C: 10, kb: 2 * U.energy(P.kappa) / Math.sqrt(3),
      kA: 100 * U.GsL, kV: 1000 * U.GsL, A0: ref.A, V0: ref.V, push: 30 * U.GsL, scale: 1, type: 0 });
  }
  sim.setCells(cells); sim.computeIndicator();
  console.log(`vessel ${o.D} µm x ${o.L} µm, grid ${nx}x${n}x${n}, ${o.ncell} cells (tube haematocrit ${(o.ncell * ref.V / (Math.PI * R * R * nx)).toFixed(3)}), dt ${(U.dt * 1e9).toFixed(1)} ns/step`);
  const run = async steps => { while (steps > 0) { const k = Math.min(steps, 400); sim.step(k); sim.sync(); steps -= k; if (gl.isContextLost()) throw new Error('context lost'); await sleep0(); } };
  for (let s = 1; s <= 40; s++) { sim.setSP([R1 + (R - R1) * s / 40, 0, 0, 0]); await run(Math.round(U.steps(4e-3) / 40)); }
  // drive: pressure gradient for the target cell speed, adjusted during the spin-up, then held
  let G = o.G || 8 * P.eta * o.u * 1e-3 / (o.D * 1e-6 / 2) ** 2 * 1.3; sim.o.body = [U.gradP(G), 0, 0];
  const speed = async ms => {
    const a = sim.readCentres(), t0 = sim.t; await run(Math.round(U.steps(ms * 1e-3)));
    const b = sim.readCentres(); let d = 0; b.forEach((c, i) => { let dd = c.c[0] - a[i].c[0]; dd -= nx * Math.round(dd / nx); d += dd; });
    const mean = sim.sumMacro()[0] / nx / (Math.PI * R * R);
    return { cell: d / b.length / (sim.t - t0) * U.V * 1e3, mean: mean * U.V * 1e3 };
  };
  for (let k = 0; k < o.tune; k++) {
    const v = await speed(2);
    console.log(`  tune ${k}: cells ${v.cell.toFixed(3)} mm/s, mean flow ${v.mean.toFixed(3)} mm/s (ratio ${(v.cell / v.mean).toFixed(3)}), G ${(G / 1e6).toFixed(3)} MPa/m`);
    G *= Math.pow(o.u / Math.max(v.cell, 0.05), 0.8); sim.o.body = [U.gradP(G), 0, 0];
  }
  for (let k = 0; k < o.settle / 5; k++) { const v = await speed(5); console.log(`  settle ${(k + 1) * 5} ms: cells ${v.cell.toFixed(3)} mm/s, mean ${v.mean.toFixed(3)} mm/s`); }
  // record: every o.every ms, cell centres (unwrapped) + vertex offsets (µm)
  const frames = [], per = Math.round(U.steps(o.every * 1e-3)), nv = sp.V.length;
  let prev = null, vs = [];
  for (let f = 0; f < o.frames; f++) {
    if (f) { const a = sim.readCentres(), t0 = sim.t; await run(per); const b = sim.readCentres(); let d = 0; b.forEach((c, i) => { let dd = c.c[0] - a[i].c[0]; dd -= nx * Math.round(dd / nx); d += dd; }); vs.push(d / b.length / (sim.t - t0) * U.V * 1e3); }
    const X = sim.readCells();
    const cen = X.map(Xc => [0, 1, 2].map(d => Xc.reduce((a, p) => a + p[d], 0) / nv));
    if (prev) cen.forEach((c, i) => { c[0] -= nx * Math.round((c[0] - prev[i][0]) / nx); });
    prev = cen;
    frames.push({ cen: cen.map(c => c.map(x => +(x * 0.25).toFixed(4))), off: X.map((Xc, i) => Xc.map(p => p.map((x, d) => +((x - cen[i][d]) * 0.25).toFixed(4)))) });
  }
  const vm = vs.reduce((a, b) => a + b, 0) / vs.length, mean = sim.sumMacro()[0] / nx / (Math.PI * R * R) * U.V * 1e3;
  console.log(`recorded ${o.frames} frames every ${o.every} ms: mean cell speed ${vm.toFixed(3)} mm/s, plasma+cells mean flow ${mean.toFixed(3)} mm/s, ratio ${(vm / mean).toFixed(3)}, G ${(G / 1e6).toFixed(3)} MPa/m = ${(G * 1e-3 / 133.322).toFixed(2)} mmHg/mm`);
  return { meta: { D: o.D, L: o.L, ncell: o.ncell, every: o.every, vcell: vm, vmean: mean, G, nv, axis: [0, cc * 0.25, cc * 0.25] }, frames };
}
