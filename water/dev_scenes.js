const cv = document.getElementById('c'), gl = cv.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
let seed = 99; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const SCENES = {
  liquid(steps = 3000, slab = 0) {
    const s = liquidBox(2048, 0.997, 300, rng);
    const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005 });
    e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
    for (let k = 0; k < 400; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: 300, tauT: 0.01, every: 8 }); }
    e.dt = 0.002;
    for (let k = 0; k < +steps; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: 300, tauT: 0.1, every: 8 }); }
    e.analyze(); console.log(JSON.stringify(e.analysisStats()), JSON.stringify(e.measure().T));
    const v = new VIZ.Viz(gl), L = e.box[0];
    v.render(e, { yaw: 0.5, pitch: 0.35, dist: L * 2.2, target: e.box.map(x => x / 2) }, cv.width, cv.height, { showHB: true, slab: +slab || 0, colorMode: 1 });
  },
  ice(T = 250, slab = 0) {
    const s = iceBox(6, 4, 4, 4.50, +T, rng);
    const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005 });
    e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
    for (let k = 0; k < 400; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: +T, tauT: 0.01, every: 8 }); }
    e.dt = 0.002;
    for (let k = 0; k < 2000; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: +T, tauT: 0.1, every: 8 }); }
    e.analyze(); console.log(JSON.stringify(e.analysisStats()));
    const v = new VIZ.Viz(gl);
    v.render(e, { yaw: 0.0, pitch: 0.0, dist: e.box[2] * 2.6, target: e.box.map(x => x / 2) }, cv.width, cv.height, { showHB: true, slab: +slab || 0, colorMode: 1 });
  },
};
SCENES.dbg = (N = 2048, slab = 10, hb = 1, sc = 1) => {
  const s = liquidBox(+N, 0.997, 300, rng);
  const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005 });
  e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
  for (let k = 0; k < 200; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: 300, tauT: 0.01, every: 8 }); }
  e.analyze();
  const v = new VIZ.Viz(gl), L = e.box[0];
  v.render(e, { yaw: 0.5, pitch: 0.35, dist: L * 2.2, target: e.box.map(x => x / 2) }, cv.width, cv.height, { showHB: !!+hb, slab: +slab, colorMode: 1, scale: +sc });
  console.log('glerr', gl.getError());
};
SCENES.prep = (name, T, ps = 0, slab = 0, yaw = 0.5, pitch = 0.3, cm = 1) => {
  const t0 = performance.now();
  const e = SCN.PREP[name](gl, +T, rng);
  console.log('prep', name, 'N', e.N, 'box', e.box.map(x => x.toFixed(1)).join('x'), ((performance.now() - t0) / 1000).toFixed(1), 's');
  const nst = Math.round(+ps / e.dt), ev = e.rebuildEvery;
  for (let k = 0; k < nst; k++) { e.step(); if (k % ev === ev - 1) e.couple(e.measure(), { T: +T, tauT: 0.5, every: ev, P: 1, tauP: 2, mode: name === 'melt' ? 'z' : 'iso' });
    if (k % Math.round(nst / 5) === 0) { e.analyze(); const a = e.analysisStats(); console.log('t', (k * e.dt).toFixed(0), 'ps', JSON.stringify(a)); } }
  e.analyze(); const a = e.analysisStats(), m = e.measure();
  console.log('final', JSON.stringify(a), 'T', m.T.toFixed(1), 'rho', m.rho.toFixed(4));
  const v = new VIZ.Viz(gl), L = Math.max(...e.box);
  v.render(e, { yaw: +yaw, pitch: +pitch, dist: L * 2.0, target: e.box.map(x => x / 2) }, cv.width, cv.height, { showHB: true, slab: +slab, colorMode: +cm, latticeBonds: true, liqRad: 0.32 });
};
