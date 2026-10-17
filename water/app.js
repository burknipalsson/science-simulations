// Main stage: scene management, the live loop, camera, HUD and controls.
'use strict';

const APP = (() => {
const $ = id => document.getElementById(id);
const cv = $('sky');
const gl = cv.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl || !gl.getExtension('EXT_color_buffer_float')) { $('nogl').hidden = false; return null; }
const viz = new VIZ.Viz(gl);
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const SC = {
  liquid: {
    label: 'Liquid water', model: 'tip4p', T: 298, Tmin: 240, Tmax: 380, Tm: 250, baro: 'iso',
    prep: async T => await SCN.fromState(gl, 'liquid', T) || SCN.PREP.liquid(gl, T, 4096),
    cam: { yaw: 0.6, pitch: 0.32, zoom: 1.45 }, slice: true,
    caption: '<b>4,096 water molecules</b> in a box 5 nanometres wide, the walls wrapping around so the water has no edges. At room temperature each molecule keeps about <b>3.6 hydrogen bonds</b>, breaking and remaking them every few picoseconds. Cool it and the network tightens; heat it and bonds snap faster than they form.',
  },
  ice: {
    label: 'Ice crystal', model: 'tip4p', T: 230, Tmin: 200, Tmax: 360, Tm: 250, baro: 'iso', compress: 1.5e-5,
    prep: async T => SCN.PREP.ice(gl, T),
    cam: { yaw: 0, pitch: 0, zoom: 1.85 }, slice: false,
    caption: '<b>Ordinary ice, "ice Ih"</b>, seen along its six-fold axis. Every molecule donates two hydrogen bonds and accepts two, so the oxygens sit on a tetrahedral scaffold full of <b>hexagonal channels</b>. Which way each hydrogen points is random, but always obeys these "ice rules". This hexagonal symmetry is the reason snowflakes have six arms. Drag to turn it.',
  },
  melt: {
    label: 'Melting ice', model: 'tip4p', T: 290, Tmin: 230, Tmax: 360, Tm: 250, baro: 'z',
    prep: async T => await SCN.fromState(gl, 'melt', T) || SCN.PREP.melt(gl, T),
    cam: { yaw: Math.PI / 2, pitch: 0.12, zoom: 1.2 }, slice: true,
    caption: 'A slab of <b>ice sandwiched between liquid water</b>, ice-like molecules marked in pale blue. Ice melts from its surfaces inward, one molecular layer at a time, as molecules at the face shake loose of the scaffold. Lower the temperature below the model\'s melting point and the front reverses, though freezing is far slower than melting.',
  },
  freeze: {
    label: 'Freezing', model: 'mw', T: 230, Tmin: 200, Tmax: 300, Tm: 274.6, baro: 'iso',
    prep: async T => await SCN.fromState(gl, 'freeze', T) || SCN.PREP.freeze(gl, T),
    cam: { yaw: 0.5, pitch: 0.3, zoom: 1.65 }, slice: false,
    caption: '<b>Supercooled water</b>, about 45 degrees below its melting point and still liquid, with a tiny ice seed at its centre. Pure water can stay liquid like this down to about −38 °C; it needs a seed to start. Watch the crystal grow outward as molecules lock onto its faces (<b>white: hexagonal ice; violet: its cubic cousin</b>). This uses the one-ball mW model, so there are no hydrogens to see.',
  },
};

const state = {
  name: null, e: null, def: null, T: 298, playing: true, pace: 100, spf: 6, acc: 0, since: 0,
  hb: true, slice: false, ice: true, spin: false, cam: { yaw: 0.6, pitch: 0.3, dist: 100, target: [0, 0, 0], fov: 0.62 },
  simT0: 0, rate: 0, target: 10, lastM: null, stats: null, lastHud: 0, lastStats: 0, visible: true, frameDt: 16.7,
};

// ---------- scenes ----------
function setStatus(txt) { const s = $('status'); if (!txt) { s.hidden = true; return; } s.hidden = false; s.querySelector('span').textContent = txt; }
function loadScene(name, o = {}) {
  const def = SC[name];
  state.name = name; state.def = def;
  state.T = o.T ?? def.T;
  const temp = $('temp'); temp.min = def.Tmin; temp.max = def.Tmax; temp.value = state.T;
  state.slice = o.slice ?? def.slice; setPressed('tSlice', state.slice);
  if (o.hb !== undefined) { state.hb = o.hb; setPressed('tHB', state.hb); }
  $('tHB').hidden = def.model !== 'tip4p';
  [...$('scenes').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.s === name));
  $('caption').innerHTML = def.caption;
  updateTempLabel();
  setStatus('preparing ' + def.label.toLowerCase() + ' …');
  if (state.e) { state.e.dispose?.(); state.e = null; }
  // let the status paint before the (blocking) preparation
  const token = (state.token = (state.token || 0) + 1);
  setTimeout(async () => {
    try {
      const e = await def.prep(state.T);
      if (token !== state.token) { e.dispose(); return; }
      state.e = e; state.simT0 = e.time; state.since = 0; state.lastM = null;
      const L = Math.max(...e.box), c = o.cam || def.cam;
      state.cam = { yaw: c.yaw, pitch: c.pitch, dist: L * c.zoom * 1.25, target: e.box.map(x => x / 2), fov: 0.62 };
      state.zoom0 = state.cam.dist;
      setStatus(null);
      updateKey();
    } catch (err) { console.error(err); setStatus('error: ' + err.message); }
  }, 40);
}

function updateTempLabel() {
  const T = state.T, def = state.def; if (!def) return;
  $('tVal').textContent = `${Math.round(T)} K`;
  $('tC').textContent = `${fmt(T - 273.15, 0)} °C`;
  const rel = Math.round(T - def.Tm);
  let s;
  if (state.name === 'liquid') s = T < def.Tm ? 'supercooled: below this model\'s freezing point' : T < 285 ? 'ice-cold water' : T < 310 ? 'about room / body temperature' : T < 345 ? 'hot water' : 'near boiling (held at 1 atm)';
  else s = `${rel >= 0 ? '+' : '−'}${Math.abs(rel)} K ${rel >= 0 ? 'above' : 'below'} this model's melting point (${def.Tm} K)`;
  $('tRel').textContent = s;
}

function updateKey() {
  const k = $('stagekey');
  if (state.def.model === 'tip4p') k.innerHTML = '<span><i style="background:#e8553f"></i>oxygen</span><span><i style="background:#f2efe9"></i>hydrogen</span><span><i class="dash"></i>hydrogen bond</span>' + (state.ice ? '<span><i style="background:#9fe3ff"></i>ice-like molecule</span>' : '');
  else k.innerHTML = '<span><i style="background:#3d5f8a"></i>liquid</span><span><i style="background:#e6f6ff"></i>hexagonal ice</span><span><i style="background:#b9a4ff"></i>cubic ice</span><span><i style="background:#8fc3e6"></i>ice surface</span>';
}

// ---------- loop ----------
let lastT = performance.now();
function paceRate() {   // target simulated ps per wall second (Infinity = as fast as possible)
  if (state.pace >= 100) return Infinity;
  return 0.03 * Math.pow(10, state.pace / 100 * 3.2);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dtw = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  state.frameDt = 0.9 * state.frameDt + 0.1 * dtw * 1000;
  state.base = Math.min((state.base || 16.7) + 0.01, Math.max(dtw * 1000, 4));   // display frame interval
  const e = state.e; if (!e || !state.visible) return;
  resize();
  if (state.playing) {
    let n = Math.max(1, Math.floor(state.spf));
    const r = paceRate();
    if (r < Infinity) { state.acc += r * dtw / e.dt; n = Math.min(n, Math.floor(state.acc)); state.acc -= n; if (state.acc > 5) state.acc = 5; }
    const t0 = e.time, w0 = performance.now();
    for (let k = 0; k < n; k++) e.step();
    state.since += n;
    // one synchronous readback per frame: the wait tells us how much GPU work the frame took
    const m = e.measure(); state.lastM = m;
    const work = performance.now() - w0; state.work = 0.9 * (state.work || work) + 0.1 * work;
    if (r === Infinity && n > 0) state.spf = Math.max(1, Math.min(600, state.spf * Math.min(1.15, Math.max(0.8, Math.sqrt(state.target / Math.max(work, 0.5))))));
    if (state.since >= e.rebuildEvery) {
      const def = state.def;
      e.couple(m, { T: state.T, tauT: 0.4, every: state.since, P: 1, tauP: 2, mode: def.baro, compress: def.compress });
      state.since = 0;
    }
    state.rate = 0.95 * state.rate + 0.05 * (e.time - t0) / Math.max(dtw, 1e-3);
  }
  if (state.spin) state.cam.yaw += 0.12 * dtw;
  e.analyze();
  viz.render(e, state.cam, cv.width, cv.height, {
    showHB: state.hb, slab: state.slice ? (e.model === 'mw' ? 14 : 11) : 0, colorMode: state.ice ? 1 : 0,
    latticeBonds: e.model === 'mw' && state.ice, liqRad: 0.34, mwRad: 0.9,
  });
  if (now - state.lastStats > 400) { state.stats = e.analysisStats(); state.lastStats = now; }
  if (now - state.lastHud > 250) { hud(); state.lastHud = now; }
}

function hud() {
  const e = state.e, m = state.lastM, st = state.stats; if (!e) return;
  const rows = [];
  const add = (k, v, cls = '') => rows.push(`<dt>${k}</dt><dd class="${cls}">${v}</dd>`);
  if (m) {
    add('temperature', `${fmt(m.T, 0)} K`, 'big');
    add('density', `${fmt(m.rho, 3)} g/cm³`);
  }
  if (st) {
    if (e.model === 'tip4p') add('H-bonds per molecule', fmt(st.hbPerMol, 2));
    const ice = st.hex + st.cubic + (e.model === 'mw' ? 0 : st.interf * 0.5);
    if (state.name !== 'liquid') add(e.model === 'mw' ? 'in crystal' : 'ice-like', `${fmt(100 * (st.hex + st.cubic) / e.N, 1)}%`);
  }
  rows.push('<div class="sep"></div>');
  add(e.model === 'mw' ? 'particles' : 'molecules', e.N.toLocaleString('en-US'), 'opt');
  add('box', `${fmt(e.box[0] / 10, 1)} × ${fmt(e.box[1] / 10, 1)} × ${fmt(e.box[2] / 10, 1)} nm`, 'opt');
  add('1 s on screen', state.playing ? `${fmtTime(state.rate)} simulated` : 'paused', 'rate');
  $('hud').innerHTML = rows.join('');
  const t = e.time - state.simT0;
  $('clock').innerHTML = `<small>simulated time</small><span>${fmtTime(t)}</span>`;
  $('paceOut').textContent = state.pace >= 100 ? 'full speed' : `${fmtTime(paceRate())} per second`;
}
function fmtTime(ps) {
  if (!isFinite(ps)) return '—';
  if (ps < 1) return `${fmt(ps * 1000, 0)} fs`;
  if (ps < 1000) return `${fmt(ps, ps < 10 ? 2 : 1)} ps`;
  return `${fmt(ps / 1000, 3)} ns`;
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}

// ---------- controls ----------
function setPressed(id, v) { $(id).setAttribute('aria-pressed', v ? 'true' : 'false'); }
for (const [k, d] of Object.entries(SC)) {
  const b = document.createElement('button'); b.className = 'chip'; b.dataset.s = k; b.innerHTML = `<span class="dot"></span>${d.label}<small>${d.model === 'mw' ? 'mW' : 'TIP4P/2005'}</small>`;
  b.onclick = () => loadScene(k); $('scenes').appendChild(b);
}
$('temp').oninput = ev => { state.T = +ev.target.value; updateTempLabel(); };
$('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? '❚❚ Pause' : '▶ Play'; };
$('reset').onclick = () => loadScene(state.name, { T: state.T });
$('pace').oninput = ev => { state.pace = +ev.target.value; state.acc = 0; hud(); };
const tog = (id, key, after) => $(id).onclick = () => { state[key] = !state[key]; setPressed(id, state[key]); after && after(); };
tog('tHB', 'hb'); tog('tSlice', 'slice'); tog('tIce', 'ice', updateKey); tog('tSpin', 'spin');

// camera: drag to orbit, wheel / pinch to zoom
const ptrs = new Map(); let pinch0 = 0, dist0 = 0;
cv.addEventListener('pointerdown', ev => { cv.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = state.cam.dist; } });
cv.addEventListener('pointermove', ev => {
  if (!ptrs.has(ev.pointerId)) return;
  const p = ptrs.get(ev.pointerId), dx = ev.clientX - p[0], dy = ev.clientY - p[1];
  ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (ptrs.size === 1) { state.cam.yaw -= dx * 0.006; state.cam.pitch = Math.max(-1.45, Math.min(1.45, state.cam.pitch + dy * 0.006)); }
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) zoomTo(dist0 * pinch0 / d); }
});
const up = ev => { ptrs.delete(ev.pointerId); pinch0 = 0; };
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', ev => { ev.preventDefault(); zoomTo(state.cam.dist * Math.exp(ev.deltaY * 0.001)); }, { passive: false });
function zoomTo(d) { const z0 = state.zoom0 || d; state.cam.dist = Math.max(z0 * 0.15, Math.min(z0 * 2.5, d)); }

new IntersectionObserver(es => { state.visible = es[0].isIntersecting; }, { threshold: 0.02 }).observe($('stage'));

loadScene('liquid');
requestAnimationFrame(frame);

// API for the sections ("show me" buttons)
return {
  state, SC, loadScene,
  show(name, o = {}) {
    const go = () => {
      if (o.ice !== undefined) { state.ice = o.ice; setPressed('tIce', state.ice); }
      if (state.name !== name || o.fresh) loadScene(name, o);
      else {
        if (o.T !== undefined) { state.T = o.T; $('temp').value = o.T; updateTempLabel(); }
        if (o.slice !== undefined) { state.slice = o.slice; setPressed('tSlice', o.slice); }
        if (o.hb !== undefined) { state.hb = o.hb; setPressed('tHB', o.hb); }
        if (o.cam) { const L = Math.max(...state.e.box); Object.assign(state.cam, { yaw: o.cam.yaw, pitch: o.cam.pitch, dist: L * o.cam.zoom * 1.25 }); }
      }
      if (o.pace !== undefined) { state.pace = o.pace; $('pace').value = o.pace; }
    };
    go();
    $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
};
})();
