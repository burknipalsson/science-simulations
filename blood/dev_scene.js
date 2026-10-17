// dev scene: a train of red cells in a capillary, rendered live
(async () => {
  const q = new URLSearchParams(location.search), cv = document.getElementById('c');
  const dpr = window.devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  const gl = cv.getContext('webgl2', { antialias: true });
  const Dt = +(q.get('D') || 7), dxum = +(q.get('dx') || 0.5), U = new Units({ dx: dxum * 1e-6 });
  const R = U.len(Dt * 1e-6) / 2, R1 = Math.max(R, U.len(4.75e-6)), n = Math.ceil(2 * R1) + 4, nx = Math.round(U.len(+(q.get('L') || 40) * 1e-6)), cc = (n - 1) / 2;
  const sp = icosphere(+(q.get('level') || 3)), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const ncell = +(q.get('n') || 3);
  const L = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, maxCells: ncell, tables: buildMeshTables(mesh, [X0]), SP: [R1, 0, 0, 0], krep: 10 * U.GsL, rcut: 1,
    sdf: `return SP.x - length(p.yz - vec2(${cc.toFixed(4)}));` });
  const Gs = U.GsL, rot = X0.map(p => [p[2], p[1], -p[0]]);
  const cells = []; for (let i = 0; i < ncell; i++) cells.push(cellAt(rot, [nx * (i + 0.5) / ncell, cc, cc], { Gs, C: 10, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * Gs, kV: 1000 * Gs, A0: ref.A, V0: ref.V, push: 30 * Gs, scale: 1 }));
  L.setCells(cells);
  const V = new BloodView(gl, L, { faces: sp.F });
  V.setColours(cells.map((_, i) => [0.62 + 0.06 * Math.sin(i * 2.1), 0.07, 0.06, 1]));
  V.cam.target = [nx / 2, cc, cc]; V.cam.dist = nx * 1.15; V.cam.yaw = +(q.get('yaw') || -0.35); V.cam.pitch = +(q.get('pitch') || 0.25);
  for (let k = 1; k <= 40; k++) { L.setSP([R1 + (R - R1) * k / 40, 0, 0, 0]); L.step(150); }
  const G = 8 * U.eta * 1e-3 / (Dt * 1e-6 / 2) ** 2; L.o.body = [U.gradP(G), 0, 0];
  const warm = +(q.get('warm') || 20000); for (let s = 0; s < warm; s += 1000) { L.step(1000); }
  window.READY = false; let frames = 0;
  const loop = () => { L.step(+(q.get('spf') || 60)); V.render(cv.width, cv.height); if (++frames > 30) window.READY = true; requestAnimationFrame(loop); };
  loop();
})();
function cellAt(X, c, par) { const anchor = c.map(Math.round); return Object.assign({ X: X.map(p => [p[0] + c[0] - anchor[0], p[1] + c[1] - anchor[1], p[2] + c[2] - anchor[2]]), anchor }, par); }
