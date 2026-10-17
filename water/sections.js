// Page sections: field guide, the two side-by-side labs, density chart, comparison table, how it works.
'use strict';

(() => {
if (!APP) return;
const $ = id => document.getElementById(id);
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------------- field guide ----------------
const GUIDE = [
  { where: 'one molecule', h: 'A bent little magnet',
    p: 'The oxygen hogs the shared electrons, leaving each hydrogen slightly positive and the oxygen slightly negative, with the two hydrogens set at <b>104.5°</b>. In TIP4P/2005 the negative charge sits on a point just in front of the oxygen, a neat trick that reproduces water\'s electrical shape.',
    go: () => APP.show('liquid', { slice: true, cam: { yaw: 0.6, pitch: 0.3, zoom: 0.55 }, hb: false, T: 298 }), btn: 'Zoom in on molecules' },
  { where: 'the amber dashes', h: 'The hydrogen bond',
    p: 'A hydrogen pointing at a neighbour\'s oxygen, about <b>1.9 Å</b> away. Each bond is weak, roughly <b>20 kJ/mol</b> against 460 for the covalent O–H bond inside the molecule, but there are so many that they hold water together: they are why water boils at 100 °C, while its chemical cousin hydrogen sulphide, a heavier molecule, boils at −60 °C.',
    go: () => APP.show('liquid', { slice: true, hb: true, cam: { yaw: 0.6, pitch: 0.3, zoom: 0.8 }, T: 298 }), btn: 'Show the bonds' },
  { where: 'watch any one bond', h: 'A network that never rests',
    p: 'A hydrogen bond in room-temperature water lasts only a <b>few picoseconds</b> before the molecules swivel to new partners. The whole network rewires about a trillion times a second, yet at any instant almost every molecule is held by three or four bonds. Slow the pace right down to watch them flicker.',
    go: () => APP.show('liquid', { slice: true, hb: true, cam: { yaw: 0.6, pitch: 0.3, zoom: 0.6 }, pace: 35, T: 298 }), btn: 'Slow motion' },
  { where: 'heat it up', h: 'Hot water, loose water',
    p: 'Heat speeds the molecules up, so bonds break faster than they reform. In this simulation the hydrogen-bond count falls from 3.84 per molecule at 250 K to 3.64 at room temperature and 3.50 at 330 K; watch the readout as you heat it. The liquid expands and grows thinner, which is why hot water pours more easily.',
    go: () => APP.show('liquid', { slice: true, hb: true, T: 370, cam: { yaw: 0.6, pitch: 0.3, zoom: 1.0 } }), btn: 'Heat to 370 K' },
  { where: 'ice, end-on', h: 'Six-sided by nature',
    p: 'In ordinary ice each oxygen bonds to four others at tetrahedral angles. Seen down its main axis, the result is a honeycomb of <b>hexagonal channels</b>. That six-fold lattice is why every snowflake, however intricate, has six arms.',
    go: () => APP.show('ice', { cam: { yaw: 0, pitch: 0, zoom: 1.85 } }), btn: 'Look down the channels' },
  { where: 'ice, side-on', h: 'Puckered layers',
    p: 'Turned on its side, the same crystal shows <b>puckered sheets</b> of hexagons stacked like egg boxes, each layer bonded to the next. Depending on the temperature, a snow crystal grows faster along these sheets (flat plates and stars) or across them (needles and columns).',
    go: () => APP.show('ice', { cam: { yaw: Math.PI / 2, pitch: 0.05, zoom: 1.6 } }), btn: 'Turn it sideways' },
  { where: 'ice meets water', h: 'Melting starts at the surface',
    p: 'A crystal can\'t melt all at once from the inside; molecules first escape from its faces, where they have fewer neighbours holding them. Even below 0 °C, real ice has a thin <b>"quasi-liquid" skin</b> one or two molecules thick, part of why ice is slippery.',
    go: () => APP.show('melt', { T: 290, slice: true }), btn: 'Melt the slab' },
  { where: 'below freezing', h: 'Liquid that should be solid',
    p: 'Very pure water doesn\'t freeze at 0 °C; it needs something to start the crystal. Cloud droplets stay liquid down to about <b>−38 °C</b> unless a speck of dust, soot or even a bacterium (<i>Pseudomonas syringae</i>, used in snow machines) gives them a template. Here a 3 nm seed does the job.',
    go: () => APP.show('freeze', { T: 230, fresh: true }), btn: 'Plant a seed' },
  { where: 'warmer, then colder', h: 'Too small to survive',
    p: 'A crystal seed has to be big enough. Its surface costs energy, so tiny clusters melt back faster than they grow. The critical size shrinks as the water gets colder. Warm this supercooled water by 20 degrees and watch the same seed lose the race.',
    go: () => APP.show('freeze', { T: 255, fresh: true }), btn: 'Warm it to 255 K' },
];
$('guide').innerHTML = GUIDE.map((g, i) => `<div class="entry"><div class="where">${g.where}</div><h3>${g.h}</h3><p>${g.p}</p><button class="show" data-i="${i}">${g.btn} →</button></div>`).join('');
$('guide').addEventListener('click', ev => { const b = ev.target.closest('.show'); if (b) GUIDE[+b.dataset.i].go(); });

// ---------------- side-by-side labs ----------------
class Duo {
  constructor(canvas, make, opts) {
    this.cv = canvas; this.make = make; this.opts = opts;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    this.ok = !!(this.gl && this.gl.getExtension('EXT_color_buffer_float'));
    if (!this.ok) return;
    this.viz = new VIZ.Viz(this.gl);
    this.visible = false; this.started = false; this.spf = 4; this.since = [0, 0];
    this.cam = { yaw: 0.55, pitch: 0.35, dist: 100, target: [0, 0, 0], fov: 0.5 };
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; if (this.visible && !this.started) this.start(); }, { threshold: 0.05 }).observe(canvas);
    const ptr = new Map();
    canvas.addEventListener('pointerdown', ev => { canvas.setPointerCapture(ev.pointerId); ptr.set(ev.pointerId, [ev.clientX, ev.clientY]); });
    canvas.addEventListener('pointermove', ev => { if (!ptr.has(ev.pointerId)) return; const p = ptr.get(ev.pointerId);
      this.cam.yaw -= (ev.clientX - p[0]) * 0.006; this.cam.pitch = Math.max(-1.4, Math.min(1.4, this.cam.pitch + (ev.clientY - p[1]) * 0.006)); ptr.set(ev.pointerId, [ev.clientX, ev.clientY]); });
    const up = ev => ptr.delete(ev.pointerId); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    requestAnimationFrame(t => this.frame(t));
  }
  async start() {
    this.started = true;
    const tok = (this.tok = (this.tok || 0) + 1);
    const old = this.E; this.E = null;
    if (old) old.forEach(e => e.dispose());
    const E = await this.make(this.gl);
    if (tok !== this.tok) { E.forEach(e => e.dispose()); return; }
    this.E = E;
    this.t0 = this.E.map(e => e.time);
    this.since = [0, 0];
  }
  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    if (!this.visible || !this.E) return;
    const cv = this.cv, dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const w0 = performance.now(), n = Math.max(1, Math.floor(this.spf));
    this.M = this.E.map((e, k) => {
      for (let s = 0; s < n; s++) e.step();
      this.since[k] += n;
      const m = e.measure();
      if (this.since[k] >= e.rebuildEvery) { e.couple(m, Object.assign({ every: this.since[k] }, this.opts.couple(k))); this.since[k] = 0; }
      return m;
    });
    const work = performance.now() - w0;
    this.spf = Math.max(1, Math.min(300, this.spf * Math.min(1.15, Math.max(0.8, Math.sqrt(8 / Math.max(work, 0.5))))));
    // both boxes with the same camera distance, so their sizes compare directly
    const portrait = h > w * 0.9, L = this.opts.scaleL;
    this.E.forEach((e, k) => {
      e.analyze();
      const vp = portrait ? [0, k === 0 ? Math.floor(h / 2) : 0, w, Math.floor(h / 2)] : [k === 0 ? 0 : Math.floor(w / 2), 0, Math.floor(w / 2), h];
      const cam = Object.assign({}, this.cam, { dist: L * (portrait ? 3.3 : 3.9), target: e.box.map(x => x / 2) });
      this.viz.render(e, cam, w, h, Object.assign({ vp }, this.opts.render));
    });
    if (!this.lastHud || now - this.lastHud > 300) { this.lastHud = now; this.S = this.E.map(e => e.analysisStats()); this.opts.hud(this); }
  }
}

// --- ice vs liquid at the same T and P (TIP4P/2005, at the model's melting point) ---
const FLOAT_T = 250;
const floatDuo = new Duo($('floatCv'), async gl => {
  const ice = await SCN.fromState(gl, 'float_ice', FLOAT_T) || SCN.PREP.ice(gl, FLOAT_T, Math.random, [6, 4, 4]);
  const liq = await SCN.fromState(gl, 'float_liq', FLOAT_T) || SCN.PREP.liquid(gl, FLOAT_T, ice.N);
  return [ice, liq];
}, {
  scaleL: 30,
  couple: k => ({ T: FLOAT_T, tauT: 0.4, P: 1, tauP: 2, compress: k === 0 ? 1.5e-5 : 4.5e-5 }),
  render: { showHB: true, colorMode: 1, scale: 1 },
  hud(d) {
    const [mi, ml] = d.M, vi = mi.V, vl = ml.V;
    $('floatL').innerHTML = `<b>Ice</b><br>${d.E[0].N} molecules<br>density <span class="v">${fmt(mi.rho, 3)}</span> g/cm³<br>volume ${fmt(vi / 1000, 2)} nm³`;
    $('floatR').innerHTML = `<b>Liquid water</b><br>${d.E[1].N} molecules<br>density <span class="v">${fmt(ml.rho, 3)}</span> g/cm³<br>volume ${fmt(vl / 1000, 2)} nm³`;
    d.avg = d.avg || { i: 0, l: 0, n: 0 }; d.avg.i += mi.rho; d.avg.l += ml.rho; d.avg.n++;
    if (d.avg.n > 40) { d.avg.i *= 0.975; d.avg.l *= 0.975; d.avg.n *= 0.975; }
    const ri = d.avg.i / d.avg.n, rl = d.avg.l / d.avg.n;
    $('floatKpis').innerHTML = [
      [`${fmt(100 * (rl / ri - 1), 1)}%`, 'ice takes up more room (this simulation)'],
      ['9.1%', 'real ice vs real water at 0 °C'],
      [`${fmt(ri / rl * 100, 0)}%`, 'of a floating chunk of ice sits under water (sim)'],
      ['92%', 'real ice in fresh water (89% in the sea)'],
    ].map(([v, k]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  },
});

// --- pure water vs solution freezing (mW) ---
let soluteFrac = 0.08;
const BODY_T = 240;
const bodyDuo = new Duo($('bodyCv'), async gl => [
  await SCN.fromState(gl, 'body_pure', BODY_T) || SCN.PREP.freeze(gl, BODY_T, Math.random, 62, 13, 0),
  await SCN.fromState(gl, 'body_sol', BODY_T, { solute: soluteFrac }) || SCN.PREP.freeze(gl, BODY_T, Math.random, 62, 13, soluteFrac),
], {
  scaleL: 62,
  couple: () => ({ T: BODY_T, tauT: 0.4, P: 1, tauP: 2 }),
  render: { colorMode: 1, latticeBonds: true, liqRad: 0.3, mwRad: 0.9 },
  hud(d) {
    const f = d.S.map((s, k) => (s.hex + s.cubic) / d.E[k].N);
    const t = d.E[0].time - d.t0[0];
    $('bodyL').innerHTML = `<b>Pure water</b><br>in crystal <span class="v">${fmt(100 * f[0], 1)}%</span>`;
    $('bodyR').innerHTML = `<b>${fmt(soluteFrac * 100, 0)}% dissolved particles</b><br>in crystal <span class="v">${fmt(100 * f[1], 1)}%</span>`;
    const m = soluteFrac / ((1 - soluteFrac) * 0.018);
    $('bodyKpis').innerHTML = [
      [`${fmt(t / 1000, 2)} ns`, 'simulated so far'],
      [`${fmt(m, 1)} mol/kg`, 'solute concentration (right box)'],
      [`−${fmt(1.86 * m, 0)} °C`, 'freezing point it would give real water (1.86 °C per mol/kg, ideal)'],
      ['−0.52 °C', 'blood plasma (≈ 0.29 osmol/kg)'],
    ].map(([v, k]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  },
});
$('solute').oninput = ev => { soluteFrac = ev.target.value / 100; $('soluteOut').textContent = ev.target.value + '%'; };
$('solute').onchange = () => bodyDuo.ok && bodyDuo.start();
$('bodyRestart').onclick = () => bodyDuo.ok && bodyDuo.start();

// ---------------- density chart ----------------
const DATA = window.WATER_DATA;
function chart() {
  const c = $('rhoChart'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = c.clientWidth, H = +c.dataset.h;
  c.width = W * dpr; c.height = H * dpr; c.style.height = H + 'px';
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const pad = { l: 50, r: 12, t: 10, b: 30 }, x0 = 235, x1 = 335, y0 = 0.905, y1 = 1.01;
  const X = t => pad.l + (t - x0) / (x1 - x0) * (W - pad.l - pad.r), Y = r => pad.t + (y1 - r) / (y1 - y0) * (H - pad.t - pad.b);
  g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = '#687084'; g.strokeStyle = 'rgba(230,234,240,0.08)'; g.lineWidth = 1;
  for (let r = 0.91; r <= 1.0101; r += 0.01) { g.beginPath(); g.moveTo(pad.l, Y(r)); g.lineTo(W - pad.r, Y(r)); g.stroke(); g.fillText(r.toFixed(2), 4, Y(r) + 4); }
  for (let t = 240; t <= 330; t += 20) { g.fillText(`${t} K`, X(t) - 14, H - 10); }
  g.fillText('0 °C', X(273.15) - 12, pad.t + 12);
  g.setLineDash([3, 4]); g.beginPath(); g.moveTo(X(273.15), pad.t); g.lineTo(X(273.15), H - pad.b); g.stroke(); g.setLineDash([]);
  const line = (pts, col, w = 2, dash = []) => { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash); g.beginPath(); pts.forEach(([t, r], i) => i ? g.lineTo(X(t), Y(r)) : g.moveTo(X(t), Y(r))); g.stroke(); g.setLineDash([]); };
  const dots = (pts, col, err) => { g.fillStyle = col; pts.forEach(([t, r, e]) => { g.beginPath(); g.arc(X(t), Y(r), 3.5, 0, 7); g.fill(); if (e) { g.strokeStyle = col; g.beginPath(); g.moveTo(X(t), Y(r - e)); g.lineTo(X(t), Y(r + e)); g.stroke(); } }); };
  line(DATA.real.liquid, '#e6eaf0', 2);
  line(DATA.real.ice, '#e6eaf0', 2, [6, 4]);
  line(DATA.tip4p.liquid, '#ffc46b', 1.5); dots(DATA.tip4p.liquid, '#ffc46b');
  dots(DATA.tip4p.ice, '#9fe3ff');
  line(DATA.mw.liquid, '#b99cff', 1.5); dots(DATA.mw.liquid, '#b99cff');
  dots(DATA.mw.ice, '#b99cff');
  $('rhoLegend').innerHTML = '<span><i style="background:#e6eaf0"></i>real water (ice dashed)</span><span><i style="background:#ffc46b"></i>TIP4P/2005 liquid, this engine</span><span><i class="sq" style="background:#9fe3ff"></i>TIP4P/2005 ice</span><span><i style="background:#b99cff"></i>mW liquid and ice</span>';
}
if (DATA) { chart(); let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(chart, 150); }); }

// ---------------- comparison table ----------------
if (DATA) $('cmpTable').innerHTML = '<tr><th>Property</th><th>Real water</th><th>This page: TIP4P/2005</th><th>This page: mW</th></tr>' +
  DATA.table.map(r => `<tr><td>${r[0]}${r[4] ? `<span class="why">${r[4]}</span>` : ''}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('');

// ---------------- how it works ----------------
const HOW = [
  ['the forces', 'Charges and contact', 'Each TIP4P/2005 molecule carries +0.556 e on each hydrogen and −1.11 e on a site 0.15 Å in front of the oxygen; the oxygens also repel at close range and attract weakly beyond (a Lennard-Jones term). Every pair of molecules within 9 Å interacts: about 100 neighbours, 10 atom pairs each.'],
  ['the electricity', 'Taming long-range charges', 'Electric forces fade slowly with distance, so they are smoothly damped and shifted to zero at the cutoff (the "damped shifted force" method of Fennell and Gezelter), which reproduces the full long-range answer for water\'s structure to within a fraction of a percent.'],
  ['the motion', 'Rigid molecules, exact turns', 'Molecules move as rigid bodies: their centres by Newton\'s laws, their orientations by quaternions turned with the NO_SQUISH scheme, which conserves energy over millions of steps. Each step is 2 femtoseconds; the readout shows how many are packed into each second you watch.'],
  ['temperature &amp; pressure', 'A heat bath and a piston', 'A stochastic thermostat (Bussi–Donadio–Parrinello) nudges the molecules\' speeds towards the chosen temperature, and a stochastic barostat (Bernetti–Bussi) lets the box breathe until the pressure is 1 atmosphere. That is how density comes out of the simulation instead of going in.'],
  ['the graphics card', 'Sorting molecules into boxes', 'Every few steps the molecules are sorted by which small cell of space they are in (a bitonic sort on the GPU), so each one only has to check its neighbours. 25 GPU threads share each molecule\'s neighbour search; with 4,096 molecules that is about 30 billion pair interactions per second.'],
  ['spotting ice', 'Is this molecule frozen?', 'Ice is found the way researchers do it, with the CHILL+ method: each molecule\'s arrangement of neighbours is compared with each neighbour\'s, using l = 3 spherical harmonics. Four "staggered" bonds mean cubic ice; three staggered and one "eclipsed" mean the ordinary hexagonal kind.'],
  ['the mW shortcut', 'Water without hydrogens', 'The mW model replaces hydrogen bonds with a three-body force that rewards tetrahedral angles (109.5°) between neighbours. It is the same Stillinger–Weber form used for silicon, which also expands when it freezes. Without hydrogens it can take 10 fs steps and is cheap enough to watch a crystal grow.'],
  ['checked first', 'Validated before drawn', 'Forces were checked against numerical derivatives of the energy, energy conservation was confirmed, and the GPU was matched against an independent CPU version (forces agree to 1 part in 100,000). Then densities, the density maximum, the melting points, structure and diffusion were measured and are compared in the table above.'],
  ['what\'s missing', 'Honest limits', 'Real hydrogens are quantum particles that never sit still (zero-point motion); real molecules polarise each other; real water occasionally splits into H₃O⁺ and OH⁻. None of that is here. And everything you see spans picoseconds to nanoseconds: a single real second would take this simulation thousands of years.'],
];
$('how').innerHTML = HOW.map(([w, h, p]) => `<div class="entry"><div class="where">${w}</div><h3>${h}</h3><p>${p}</p></div>`).join('');
})();
