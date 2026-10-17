// Page sections: show-me presets, the lift-curve experiment, Strouhal chart and singing wire,
// drag table, and the artery (centre-line profile, pressure-drop numbers, stethoscope sound).

const NACA2412_REF = [[-6, -0.42], [-4, -0.2], [-2, 0.01], [0, 0.22], [2, 0.43], [4, 0.64], [6, 0.85], [8, 1.06], [10, 1.25], [12, 1.42], [14, 1.55], [16, 1.6], [18, 1.45], [20, 1.25]];
// Strouhal number of a circular cylinder: Roshko's laminar fit, then the long plateau near 0.2
const stRef = re => re < 47 ? null : re < 180 ? 0.212 * (1 - 21.2 / re) : re < 300 ? 0.19 + 0.01 * (re - 180) / 120 : re < 2e5 ? 0.2 + 0.01 * Math.exp(-Math.pow(Math.log10(re / 2000), 2)) : 0.2;

const DRAG_ROWS = [
  { scene: 'sphere', name: 'Ball', sub: 'subcritical, a kicked football', real: '0.4 – 0.5', setup: { re: 100000 }, here: '0.51', note: 'Laminar boundary layer separates near the equator: wide wake.' },
  { scene: 'cylinder', name: 'Cylinder', sub: 'wire, mast, chimney', real: '1.0 – 1.2', setup: { re: 100000 }, here: '1.32', note: 'Per unit length, across the flow.' },
  { scene: 'wing', name: 'Wing section, 4°', sub: 'NACA 2412', real: '0.007', setup: { angle: 4 }, here: '0.029', note: 'Mostly skin friction in reality; the tunnel\'s wake is too thick.' },
  { scene: 'car', name: 'Car', sub: 'fastback saloon', real: '0.25 – 0.30', setup: {}, here: '0.70', note: 'Real cars: smooth underbody, wheel arches, sealed gaps.' },
  { scene: 'cyclist', name: 'Cyclist, upright', sub: 'CdA ≈ 0.35–0.40 m²', real: '≈ 0.9', setup: { posture: 0 }, here: '0.99', note: 'Rider and bike; CdA 0.41 m² here, so 40 km/h takes ~340 W against the air.' },
  { scene: 'cyclist', name: 'Cyclist, tucked', sub: 'CdA ≈ 0.25–0.30 m²', real: '≈ 0.8', setup: { posture: 1 }, here: '1.01', note: 'Frontal area falls by a third (CdA 0.41 → 0.30 m² here): about 100 W saved at 40 km/h.' },
  { scene: 'tower', name: 'Square tower', sub: 'tower + neighbour, wind at the top', real: '≈ 1.0 – 1.3', setup: {}, here: '1.03', note: 'Sharp corners fix the separation: Cd hardly changes with speed.' },
];

const Sections = {
  results: {},
  init() {
    document.querySelectorAll('canvas.chart[height]').forEach(cv => { cv.dataset.h = cv.getAttribute('height'); cv.style.height = cv.dataset.h + 'px'; });
    document.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => this.show(b.dataset.show)));
    const pf = document.getElementById('ctlPuffs');
    pf.addEventListener('click', () => { App.puffs = !App.puffs; this.syncPuffs(); });
    document.getElementById('sweepLift').addEventListener('click', () => this.sweepLift());
    document.getElementById('sweepSt').addEventListener('click', () => this.sweepSt());
    this.buildDragTable();
    this.bindWire();
    document.getElementById('stethoscope').addEventListener('click', () => this.toggleSteth());
    this.liftPts = {}; this.stPts = {};
    setInterval(() => this.tick(), 500);
    this.drawLift(); this.drawSt();
  },
  syncPuffs() { const pf = document.getElementById('ctlPuffs'); pf.textContent = App.puffs ? 'Smoke puffs: on' : 'Smoke puffs: off'; pf.setAttribute('aria-pressed', !!App.puffs); },

  // ---------------------------------------------------------------- presets
  show(k) {
    const go = (scene, args = {}, view = 'smoke', cam) => {
      App.puffs = !!args.puffs; delete args.puffs; this.syncPuffs();
      Object.assign(App.args, args);
      if ('re' in args) App.args.reFor = scene;
      if (scene === 'wing' && !('tips' in args)) App.args.tips = false;
      App.view = view;
      if (App.scene !== scene || 'tips' in args || 'posture' in args || 'severity' in args || !App.L) App.load(scene);
      else { if ('angle' in args) App.setArg('angle', args.angle); if ('re' in args) App.setArg('re', args.re); App.updateUI(); }
      if (cam) App.cam = Object.assign({}, cam);
      App.updateUI();
      document.getElementById('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const P = {
      'wing-8': () => go('wing', { angle: 8 }),
      'wing-stall': () => go('wing', { angle: 20 }),
      'wing-puffs': () => go('wing', { angle: 6, puffs: true }),
      'wing-tips': () => go('wing', { angle: 10, tips: true }, 'vortices'),
      'cyl-150': () => go('cylinder', { re: 150 }),
      'cyl-high': () => go('cylinder', { re: 20000 }, 'vortices'),
      'tower-vort': () => go('tower', {}, 'vortices', { yaw: -2.6, pitch: 0.25, dist: 0.7 }),
      'sphere-300': () => go('sphere', { re: 300 }, 'vortices'),
      'sphere-turb': () => go('sphere', { re: 100000 }, 'vortices'),
      'car-cp': () => go('car', {}, 'surface'),
      'cyc-tuck': () => go('cyclist', { posture: 1 }),
      'art-0': () => go('artery', { severity: 0 }, 'speed'),
      'art-75': () => go('artery', { severity: 0.75 }, 'speed'),
      'art-90': () => go('artery', { severity: 0.9 }, 'speed'),
      'art-75-speed': () => go('artery', { severity: 0.75 }, 'swirl'),
    };
    P[k] && P[k]();
  },

  // settled = run long enough after the last change for the flow to forget its start
  settled(chords = 10) {
    if (!App.L || !App.hist.length) return false;
    return App.L.t - (App.changeT ?? App.t0) > chords * App.sc.refLen / App.L.o.u;
  },
  meanSince(k, steps) {
    const h = App.hist, t1 = App.L.t - steps, sel = h.filter(v => v[0] >= t1);
    return sel.length ? sel.reduce((a, v) => a + v[k], 0) / sel.length : null;
  },

  // ---------------------------------------------------------------- periodic bookkeeping
  tick() {
    if (!App.L) return;
    const sc = App.scene, chordSteps = App.sc.refLen / App.L.o.u;
    // lift points: whenever the wing has settled at an angle (2D wing only)
    if (sc === 'wing' && !App.args.tips && this.settled(10)) {
      const cl = this.meanSince(2, 4 * chordSteps); if (cl != null) { this.liftPts[App.args.angle] = cl; this.drawLift(); }
    }
    if (sc === 'cylinder' && this.settled(40) && App.st) { this.stPts[App.args.re] = App.st; this.drawSt(); document.getElementById('wireSt').textContent = App.st.toFixed(3); this.updateWire(); }
    // drag results
    if (this.settled(sc === 'wing' ? 10 : 6)) {
      const key = sc + (sc === 'cyclist' ? App.args.posture : '') + (sc === 'wing' ? App.args.angle : '') + (sc === 'sphere' || sc === 'cylinder' ? Math.round(Math.log10(App.args.re)) : '');
      const cd = this.meanSince(1, 3 * chordSteps); if (cd != null) { this.results[key] = cd; this.fillDrag(); }
    }
    if (sc === 'artery') this.artTick();
  },

  // ---------------------------------------------------------------- lift
  async sweepLift() {
    if (this.sweeping) { this.sweeping = false; return; }
    const btn = document.getElementById('sweepLift'), st = document.getElementById('sweepLiftStatus');
    this.sweeping = true; btn.textContent = 'Stop'; App.keepRunning = true;
    App.args.tips = false; App.puffs = false; this.syncPuffs();
    if (App.scene !== 'wing' || App.args.tips) App.load('wing');
    for (const a of [-4, 0, 4, 8, 10, 12, 16, 20]) {
      if (!this.sweeping) break;
      App.setArg('angle', a); App.updateUI();
      while (this.sweeping && !this.settled(8)) { st.textContent = `settling at ${a}°…`; await new Promise(r => setTimeout(r, 300)); }
      const t0 = App.L.t, need = 4 * App.sc.refLen / App.L.o.u;
      while (this.sweeping && App.L.t - t0 < need) { st.textContent = `measuring at ${a}°…`; await new Promise(r => setTimeout(r, 300)); }
      const cl = this.meanSince(2, need); if (cl != null) { this.liftPts[a] = cl; this.drawLift(); }
    }
    this.sweeping = false; App.keepRunning = false; btn.textContent = 'Sweep the angle'; st.textContent = 'done · try a single angle by hand';
  },
  drawLift() {
    chart2d('liftChart', { x: [-6, 22], y: [-0.6, 1.8], xt: [-5, 0, 5, 10, 15, 20], yt: [-0.5, 0, 0.5, 1, 1.5], xl: v => `${v}°`, yl: v => v.toFixed(1) }, (c, X, Y) => {
      c.setLineDash([4, 4]); c.strokeStyle = '#687084'; c.beginPath(); c.moveTo(X(-6), Y(2 * Math.PI * (-6 + 2.1) * Math.PI / 180)); c.lineTo(X(16), Y(2 * Math.PI * (16 + 2.1) * Math.PI / 180)); c.stroke(); c.setLineDash([]);
      c.strokeStyle = '#8fd3a8'; c.lineWidth *= 1.5; c.beginPath(); NACA2412_REF.forEach(([a, l], i) => i ? c.lineTo(X(a), Y(l)) : c.moveTo(X(a), Y(l))); c.stroke();
      const pts = Object.entries(this.liftPts).map(([a, l]) => [+a, l]).sort((p, q) => p[0] - q[0]);
      c.strokeStyle = '#ffc46b'; c.beginPath(); pts.forEach(([a, l], i) => i ? c.lineTo(X(a), Y(l)) : c.moveTo(X(a), Y(l))); c.stroke();
      c.fillStyle = '#ffc46b'; for (const [a, l] of pts) { c.beginPath(); c.arc(X(a), Y(l), 4 * (devicePixelRatio || 1), 0, 7); c.fill(); }
    });
  },

  // ---------------------------------------------------------------- Strouhal and the singing wire
  async sweepSt() {
    if (this.stSweep) { this.stSweep = false; return; }
    const btn = document.getElementById('sweepSt'), st = document.getElementById('sweepStStatus');
    this.stSweep = true; btn.textContent = 'Stop'; App.keepRunning = true;
    for (const re of [60, 100, 150, 300, 1000, 10000, 100000]) {
      if (!this.stSweep) break;
      if (App.scene !== 'cylinder') { App.args.re = re; App.args.reFor = 'cylinder'; App.load('cylinder'); } else App.setArg('re', re);
      App.changeT = App.L.t;
      let waited = 0;
      while (this.stSweep && !(this.settled(40) && App.st) && waited < 240) { st.textContent = `Re ${fmtRe(re)}: waiting for the wake…`; await new Promise(r => setTimeout(r, 500)); waited++; }
      if (App.st) { this.stPts[re] = App.st; this.drawSt(); }
    }
    this.stSweep = false; App.keepRunning = false; btn.textContent = 'Sweep the Reynolds number'; st.textContent = 'done';
  },
  drawSt() {
    const lx = v => Math.log10(v);
    chart2d('stChart', { x: [1.5, 5.3], y: [0.08, 0.3], xt: [2, 3, 4, 5], yt: [0.1, 0.15, 0.2, 0.25], xl: v => ['', '', '100', '1,000', '10,000', '100,000'][v], yl: v => v.toFixed(2) }, (c, X, Y) => {
      c.strokeStyle = '#8fd3a8'; c.lineWidth *= 1.5; c.beginPath(); let first = true;
      for (let e = 1.68; e <= 5.3; e += 0.01) { const s = stRef(10 ** e); if (s == null) continue; first ? c.moveTo(X(e), Y(s)) : c.lineTo(X(e), Y(s)); first = false; }
      c.stroke();
      c.fillStyle = '#ffc46b'; for (const [re, s] of Object.entries(this.stPts)) { c.beginPath(); c.arc(X(lx(+re)), Y(s), 4.5 * (devicePixelRatio || 1), 0, 7); c.fill(); }
    });
  },
  bindWire() {
    const u = document.getElementById('wireU'), d = document.getElementById('wireD');
    [u, d].forEach(e => e.addEventListener('input', () => this.updateWire()));
    document.getElementById('wirePlay').addEventListener('click', () => this.toggleWire());
    this.updateWire();
  },
  wireFreq() {
    const st = +(document.getElementById('wireSt').textContent) || 0.2;
    return st * (+document.getElementById('wireU').value) / (+document.getElementById('wireD').value / 1000);
  },
  updateWire() {
    document.getElementById('wireUOut').textContent = `${document.getElementById('wireU').value} m/s`;
    document.getElementById('wireDOut').textContent = `${document.getElementById('wireD').value} mm`;
    const f = this.wireFreq(); document.getElementById('wireF').textContent = `${Math.round(f)} Hz`;
    if (this.wire) { this.wire.osc.frequency.setTargetAtTime(f, this.ac.currentTime, 0.05); this.wire.osc2.frequency.setTargetAtTime(2 * f, this.ac.currentTime, 0.05); }
  },
  audio() { if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)(); this.ac.resume(); return this.ac; },
  toggleWire() {
    const btn = document.getElementById('wirePlay');
    if (this.wire) { const w = this.wire; w.g.gain.setTargetAtTime(0, this.ac.currentTime, 0.08); setTimeout(() => { w.osc.stop(); w.osc2.stop(); w.lfo.stop(); }, 400); this.wire = null; btn.textContent = 'Play the wire'; return; }
    const ac = this.audio(), f = this.wireFreq();
    const osc = ac.createOscillator(), osc2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    osc.frequency.value = f; osc2.frequency.value = 2 * f; g2.gain.value = 0.12;
    // shedding is not perfectly regular: a slow wobble in loudness
    lfo.frequency.value = 0.7; lg.gain.value = 0.05; lfo.connect(lg); lg.connect(g.gain);
    g.gain.value = 0; osc.connect(g); osc2.connect(g2); g2.connect(g); g.connect(ac.destination);
    osc.start(); osc2.start(); lfo.start(); g.gain.setTargetAtTime(0.12, ac.currentTime, 0.1);
    this.wire = { osc, osc2, g, lfo }; btn.textContent = 'Stop';
  },

  // ---------------------------------------------------------------- drag table
  buildDragTable() {
    document.getElementById('dragRows').innerHTML = DRAG_ROWS.map((r, i) => `<tr><td><span class="name">${r.name}</span><span class="sub">${r.sub}</span><button class="show" data-drag="${i}">Run it</button></td>
      <td class="num">${r.real}</td><td class="num" id="dragHere${i}">${r.here ? `(${r.here})` : '—'}</td><td>${r.note}</td></tr>`).join('');
    document.querySelectorAll('[data-drag]').forEach(b => b.addEventListener('click', () => {
      const r = DRAG_ROWS[+b.dataset.drag]; Object.assign(App.args, r.setup);
      if ('re' in r.setup) App.args.reFor = r.scene;
      if (r.scene === 'wing') App.args.tips = false;
      App.view = 'smoke'; App.load(r.scene);
      document.getElementById('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  },
  fillDrag() {
    DRAG_ROWS.forEach((r, i) => {
      const key = r.scene + (r.scene === 'cyclist' ? r.setup.posture : '') + (r.scene === 'wing' ? r.setup.angle : '') + (r.setup.re ? Math.round(Math.log10(r.setup.re)) : '');
      const v = this.results[key]; if (v != null) document.getElementById('dragHere' + i).innerHTML = `<b style="color:var(--sun)">${v.toFixed(r.scene === 'wing' ? 3 : 2)}</b>${r.here ? ` <span class="sub">(${r.here})</span>` : ''}`;
    });
  },

  // ---------------------------------------------------------------- artery
  artTick() {
    const L = App.L, sc = App.sc, N = App.N, u = App.units(), def = App.def;
    if (!L || App.scene !== 'artery') return;
    const yc = Math.round(N[1] / 2 - 0.5), zc = Math.round(N[2] / 2 - 0.5);
    const line = L.readMacroLine(yc, zc), ps = (def.fluid.rho * (u.Ureal / u.U) ** 2) / 133.32; // lattice pressure -> mmHg
    const xs = [], sp = [], pr = [];
    for (let x = 2; x < N[0] - Math.round(N[0] * 0.12); x++) { const r = line[4 * x + 3]; if (!r) continue; xs.push(x * u.dx * 1000); sp.push(line[4 * x] * u.Ureal / u.U); pr.push((r - 1) / 3 * ps); }
    if (!xs.length) return;
    // smooth over time
    this.artAvg = this.artAvg && this.artAvg.sp.length === sp.length && this.artAvg.sev === App.args.severity ? this.artAvg : { sp: sp.slice(), pr: pr.slice(), sev: App.args.severity };
    const k = 0.15; for (let i = 0; i < sp.length; i++) { this.artAvg.sp[i] += k * (sp[i] - this.artAvg.sp[i]); this.artAvg.pr[i] += k * (pr[i] - this.artAvg.pr[i]); }
    const xsMM = sc.xs * u.dx * 1000, LsMM = sc.R0 * 2 * u.dx * 1000;
    // reference: just upstream of the narrowing (clear of the inlet layer)
    let i0 = xs.findIndex(x => x >= xsMM - LsMM - 0.8); if (i0 < 0) i0 = 3;
    const S = this.artAvg.sp, Pp = this.artAvg.pr, vmax = Math.max(...S), pUp = Pp[i0], pMin = Math.min(...Pp), pEnd = Pp[Pp.length - 1];
    chart2d('artChart', { x: [0, xs[xs.length - 1]], y: [Math.min(0, pMin - pUp) - 2, Math.max(vmax * 10 + 2, 10)], xt: [0, 10, 20, 30, 40, 50, 60, 70].filter(v => v < xs[xs.length - 1]), yt: [], xl: v => `${v}`, yl: v => v }, (c, X, Y, w, h) => {
      c.fillStyle = 'rgba(230,234,240,.08)'; c.fillRect(X(xsMM - LsMM), 0, X(xsMM + LsMM) - X(xsMM - LsMM), h);
      // speed axis: scaled by 10 (so 1 m/s = 10 on the shared axis); pressure in mmHg relative to upstream
      c.strokeStyle = '#ff9d5c'; c.lineWidth *= 1.5; c.beginPath(); S.forEach((v, i) => i ? c.lineTo(X(xs[i]), Y(v * 10)) : c.moveTo(X(xs[i]), Y(v * 10))); c.stroke();
      c.strokeStyle = '#8fc3ec'; c.beginPath(); Pp.forEach((v, i) => i ? c.lineTo(X(xs[i]), Y(v - pUp)) : c.moveTo(X(xs[i]), Y(v - pUp))); c.stroke();
      c.fillStyle = '#9ba3b4'; c.font = `${11 * (devicePixelRatio || 1)}px IBM Plex Mono`;
      c.fillText(`speed ${vmax.toFixed(2)} m/s`, X(xs[S.indexOf(vmax)]) + 6, Y(vmax * 10) + 14 * (devicePixelRatio || 1));
      c.fillText(`${(pMin - pUp).toFixed(1)} mmHg`, X(xs[Pp.indexOf(pMin)]) + 6, Y(pMin - pUp) - 6);
    });
    const v = vmax, bern = 4 * v * v - 4 * (S[i0] || 0) ** 2;
    document.getElementById('aJet').textContent = `${v.toFixed(2)} m/s`;
    document.getElementById('aDrop').textContent = `${(pUp - pMin).toFixed(1)} mmHg`;
    document.getElementById('aBern').textContent = `${bern.toFixed(1)} mmHg`;
    document.getElementById('aNet').textContent = `${(pUp - pEnd).toFixed(1)} mmHg`;
    const sev = App.args.severity, row = { 0: 0, 0.5: 1, 0.75: 2, 0.9: 3 }[sev];
    if (row != null && this.settled(8)) document.querySelectorAll('#stenRows tr')[row].children[2].textContent = `${v.toFixed(2)} m/s`;
    this.jet = { v, d: 2 * sc.R0 * Math.sqrt(1 - sev) * u.dx };
  },
  setupProbes() {
    const sc = App.sc, N = App.N, yc = N[1] / 2 - 0.5, zc = N[2] / 2 - 0.5, cells = [];
    for (const xd of [2, 3, 4, 5]) for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4, r = sc.R0 * 0.88;
      cells.push([Math.round(sc.xs + xd * 2 * sc.R0 * 0.5), Math.round(yc + r * Math.cos(a)), Math.round(zc + r * Math.sin(a))]);
    }
    App.L.setProbes(cells); this.probeBuf = []; this.probeL = App.L;
  },
  stethTick() {
    if (!this.steth) return;
    if (this.probeL !== App.L) this.setupProbes();
    const rows = App.L.readProbes();
    for (const r of rows) { let s = 0; for (let k = 0; k < 16; k++) s += r[4 * k]; this.probeBuf.push(s / 16); }
    if (this.probeBuf.length > 8192) this.probeBuf.splice(0, this.probeBuf.length - 8192);
    if (this.probeBuf.length >= 2048) this.resynth();
  },
  toggleSteth() {
    const btn = document.getElementById('stethoscope');
    if (this.steth) { this.steth = false; App.L.setProbes(null); btn.textContent = 'Listen to the artery'; if (this.sGain) this.sGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.1); return; }
    if (App.scene !== 'artery') { this.show('art-75'); }
    this.steth = true; btn.textContent = 'Stop listening'; this.audio(); this.setupProbes();
    clearInterval(this.stethIv); this.stethIv = setInterval(() => { if (!this.steth) return clearInterval(this.stethIv); if (App.scene === 'artery') this.stethTick(); }, 250);
    if (!this.sGain) { this.sGain = this.ac.createGain(); this.sGain.connect(this.ac.destination); }
    this.sGain.gain.setTargetAtTime(1, this.ac.currentTime, 0.1);
  },
  // turn the probe spectrum into a continuous sound at true pitch: random-phase noise shaped by the measured spectrum
  resynth() {
    const now = this.ac.currentTime; if (this.nextAt && now < this.nextAt - 0.25) return;
    const u = App.units(), def = App.def, n = 2048, x = this.probeBuf.slice(-n), m = x.reduce((a, b) => a + b, 0) / n;
    const ps = def.fluid.rho * (u.Ureal / u.U) ** 2 / 3; // density fluctuation -> Pa
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (x[i] - m) * ps * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
    fft(re, im);
    const dfSim = 1 / (n * u.dt), mag = new Float64Array(n / 2);
    for (let k = 1; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    let rms = 0; for (let i = 0; i < n; i++) rms += ((x[i] - m) * ps) ** 2; rms = Math.sqrt(rms / n);
    this.drawSpec(mag, dfSim, rms);
    // synthesis: 65536-sample buffer at the audio rate
    const sr = this.ac.sampleRate, M = 65536, R = new Float64Array(M), I = new Float64Array(M);
    for (let k = 1; k < M / 2; k++) {
      const f = k * sr / M, kk = f / dfSim; if (kk >= n / 2 - 1 || f < 20) continue;
      const k0 = Math.floor(kk), a = mag[k0] * (1 - (kk - k0)) + mag[k0 + 1] * (kk - k0), ph = Math.random() * 2 * Math.PI;
      R[k] = a * Math.cos(ph); I[k] = a * Math.sin(ph); R[M - k] = R[k]; I[M - k] = -I[k];
    }
    fft(R, I, true);
    let pk = 1e-12; for (let i = 0; i < M; i++) pk = Math.max(pk, Math.abs(R[i]));
    const loud = Math.min(0.9, Math.pow(rms / 60, 0.6)) / pk;
    const buf = this.ac.createBuffer(1, M, sr), d = buf.getChannelData(0), fade = 2048;
    for (let i = 0; i < M; i++) d[i] = R[i] * loud * Math.min(1, i / fade, (M - 1 - i) / fade);
    const src = this.ac.createBufferSource(); src.buffer = buf; src.connect(this.sGain);
    const t = Math.max(now + 0.05, this.nextAt || 0); src.start(t); this.nextAt = t + (M - fade) / sr;
  },
  drawSpec(mag, df, rms) {
    const fb = this.jet ? this.jet.v / this.jet.d : null;
    chart2d('specChart', { x: [Math.log10(50), Math.log10(5000)], y: [-60, 0], xt: [2, 3], yt: [], xl: v => ({ 2: '100 Hz', 3: '1 kHz' })[v], yl: v => v }, (c, X, Y) => {
      let mx = 1e-12; for (let k = 1; k < mag.length; k++) mx = Math.max(mx, mag[k]);
      c.strokeStyle = '#ff9d5c'; c.lineWidth *= 1.3; c.beginPath(); let first = true;
      for (let k = 1; k < mag.length; k++) { const f = k * df; if (f < 50 || f > 5000) continue; const db = 20 * Math.log10(mag[k] / mx + 1e-9); first ? c.moveTo(X(Math.log10(f)), Y(db)) : c.lineTo(X(Math.log10(f)), Y(db)); first = false; }
      c.stroke();
      if (fb && fb > 50 && fb < 5000) { c.setLineDash([4, 4]); c.strokeStyle = '#8fd3a8'; c.beginPath(); c.moveTo(X(Math.log10(fb)), Y(0)); c.lineTo(X(Math.log10(fb)), Y(-60)); c.stroke(); c.setLineDash([]); }
    });
    document.getElementById('specNote').innerHTML = `Wall pressure fluctuations: <b>${rms < 1 ? rms.toFixed(2) : rms.toFixed(0)} Pa rms</b>. Lees and Dewey (1970) found the bruit spectrum rolls off above a <b>break frequency</b> f ≈ U / d set by the jet; here U / d ≈ <b>${fb ? Math.round(fb) : '—'} Hz</b> (dashed line).`;
  },
};

// small chart helper: frame + axes, then a draw callback with data->pixel mappers
function chart2d(id, ax, draw) {
  const cv = document.getElementById(id); if (!cv || !cv.offsetWidth) return;
  // the CSS height comes from the markup once; setting cv.height overwrites the attribute, so never re-read it
  if (!cv.dataset.h) cv.dataset.h = cv.getAttribute('height');
  const H0 = +cv.dataset.h, dpr = Math.min(devicePixelRatio || 1, 2), w = cv.width = cv.offsetWidth * dpr, h = cv.height = H0 * dpr;
  cv.style.height = H0 + 'px';
  const c = cv.getContext('2d'), padL = 38 * dpr, padB = 22 * dpr, padT = 8 * dpr, padR = 8 * dpr;
  const X = v => padL + (v - ax.x[0]) / (ax.x[1] - ax.x[0]) * (w - padL - padR), Y = v => h - padB - (v - ax.y[0]) / (ax.y[1] - ax.y[0]) * (h - padB - padT);
  c.font = `${11 * dpr}px IBM Plex Mono, monospace`; c.fillStyle = '#687084'; c.strokeStyle = 'rgba(230,234,240,0.08)'; c.lineWidth = dpr;
  for (const v of ax.yt) { c.beginPath(); c.moveTo(padL, Y(v)); c.lineTo(w - padR, Y(v)); c.stroke(); c.fillText(ax.yl(v), 2 * dpr, Y(v) + 4 * dpr); }
  for (const v of ax.xt) { c.beginPath(); c.moveTo(X(v), padT); c.lineTo(X(v), h - padB); c.stroke(); const s = ax.xl(v); c.fillText(s, X(v) - c.measureText(s).width / 2, h - 6 * dpr); }
  c.save(); c.beginPath(); c.rect(padL, padT, w - padL - padR, h - padB - padT); c.clip(); c.lineWidth = 1.5 * dpr; draw(c, X, Y, w, h); c.restore();
}

// in-place radix-2 FFT (inverse scales by 1/n)
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], k = i + j + len / 2, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[k] = ur - vr; im[k] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      } }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

window.addEventListener('DOMContentLoaded', () => Sections.init());
