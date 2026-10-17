// Main stage: the live 2D Schrödinger solver firing electrons one at a time at a slit screen.
'use strict';

const APP = (() => {
const $ = id => document.getElementById(id);
const cv = $('sky'), plate = $('plate'), pctx = plate.getContext('2d');
const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__DEV });
if (!gl || !gl.getExtension('EXT_color_buffer_float')) { $('nogl').hidden = false; return null; }
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const AU_FS = 0.02418884, BOHR_NM = 0.0529177, HA_EV = 27.211386;
const view = WaveView(gl);

const SC = {
  double: {
    label: 'Two slits', scene: 'double', watch: false,
    caption: 'Electrons leave the gun on the left <b>one at a time</b>, each as a wave about a nanometre wide. The wave passes through <b>both slits at once</b>, and the two halves overlap and interfere: bright where crests meet crests, dark where crests meet troughs. Yet each electron lands as <b>a single dot</b>. Only after many electrons does the striped pattern appear.',
  },
  watch: {
    label: 'Watch which slit', scene: 'double', watch: true,
    caption: 'Now a detector at the slits checks <b>which one each electron goes through</b>. When it catches one, the wave collapses into that slit (it lights up) and no longer interferes with itself. The stripes vanish; the dots pile up in one plain hump. About two electrons in three find no slit at all and <b>bounce off the wall</b>; the detector sees nothing, and they never reach the screen.',
  },
  single: {
    label: 'One slit', scene: 'single', watch: false,
    caption: 'A single slit about <b>0.2 nm</b> wide, close to the electron\'s own wavelength. Squeezing the wave through a narrow gap makes it fan out: the narrower the slit, the wider the spread. This is the <b>uncertainty principle</b> in action: pin down where the electron is across the slit, and its sideways momentum becomes uncertain.',
  },
  barrier: {
    label: 'Through a wall', scene: 'barrier', watch: false,
    caption: 'A wall one tenth of a nanometre thick whose energy, <b>58 eV</b>, is higher than the electron\'s. A thrown ball would bounce straight back every time. The wave does not stop dead at the wall: it decays inside, and if the wall is thin enough, some of it comes out the other side. That part is an electron <b>tunnelling</b> through.',
  },
};

const state = {
  name: 'double', S: null, E: null, N: 1024, playing: true, pace: 100, spf: 30, fast: false, pred: false,
  el: null, fired: 0, landed: 0, dots: [], cache: new Map(), flash: 0, eV: 54.4, d: 20, visible: true, rate: 0,
  pause: 0, hold: 0, tally: { up: 0, down: 0, back: 0 },
};

// ---------- scenes ----------
const cacheKey = (outcome) => `${state.name === 'watch' ? 'double' : state.name}|${state.eV}|${state.d}|${outcome}`;
function build(){
  const def = SC[state.name];
  const S = Scenes.build(def.scene, state.N, { eV: state.eV, d: state.d });
  if (!state.E || state.E.N !== state.N) state.E = TDSE(gl, state.N, S.h);
  state.S = S; state.E.setPotential(S.pot); state.E.screenX = S.screenCols;
  state.def = def;
  if (S.slits) state.masks = null;
  // for the barrier: the exact 1D transmission of this packet, ∫|φ(k)|² T(k) dk
  if (def.scene === 'barrier'){
    const V0 = S.opts.barrierEV / HA_EV, a = S.opts.barrierW, s = S.packet.sx;
    let num = 0, den = 0;
    for (let k = S.k0 - 6 / (2 * s); k <= S.k0 + 6 / (2 * s); k += 6 / (2 * s) / 40){ const w = Math.exp(-2 * s * s * (k - S.k0) ** 2); num += w * Scenes.barrierT(k * k / 2, V0, a); den += w; }
    S.Texact = num / den;
    const m = new Float32Array(state.N * state.N);
    for (let j = 0; j < state.N; j++) for (let i = 0; i < state.N; i++) m[i + state.N * j] = (i + 0.5) * S.h > Scenes.XW + a + 2 ? 1 : 0;
    state.E.setMask(m);
  }
}
function loadScene(name){
  state.name = name;
  [...$('scenes').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.s === name));
  $('caption').innerHTML = SC[name].caption;
  $('sepRow').hidden = SC[name].scene !== 'double';
  setPressed('tWatch', SC[name].watch);
  clearScreen();
  build(); newElectron();
}
function setPressed(id, v){ $(id).setAttribute('aria-pressed', v ? 'true' : 'false'); }
function clearScreen(){ state.dots = []; state.fired = 0; state.landed = 0; state.tally = { up: 0, down: 0, back: 0 }; drawPlate(true); }
function newElectron(){
  const P = state.S.packet;
  state.E.gaussian(P.x0, P.y0, P.sx, P.sy, P.kx, P.ky);
  state.E.clearScreen();
  state.el = { t: 0, measured: false, outcome: null, through: null };
  state.fired++;
}
// the electron reached the end of its run: pick where it landed from what the screen absorbed
function finishElectron(){
  const el = state.el, dist = state.E.readScreen();
  let tot = 0; for (const v of dist) tot += v;
  const outcome = el.outcome || 'coherent';
  if (outcome !== 'back') state.cache.set(cacheKey(outcome), { dist, tot, pUp: el.pUp, pDown: el.pDown });
  if (outcome !== 'back' && Math.random() < tot) addDot(sampleRow(dist, tot), true);
}
function sampleRow(dist, tot){
  let u = Math.random() * tot, i = 0;
  while (i < dist.length - 1 && (u -= dist[i]) > 0) i++;
  return (i + Math.random()) * state.S.h; // y in bohr
}
function addDot(y, fresh){
  state.dots.push({ y, x: Math.random(), fresh: fresh ? 1 : 0 });
  state.landed++;
  if (state.dots.length > 60000){ state.dots.splice(0, 10000); drawPlate(true); }
}
// which-path measurement: collapse into the half beyond the wall nearer one slit, or back
function measure(){
  const E = state.E, S = state.S, el = state.el;
  if (!state.masks) state.masks = { up: Scenes.whichMask(S, 'up'), down: Scenes.whichMask(S, 'down') };
  E.setMask(state.masks.up); const pUp = E.moments(true).masked;
  E.setMask(state.masks.down); const pDown = E.moments(true).masked;
  const tot = E.moments().norm;
  el.pUp = pUp / tot; el.pDown = pDown / tot;
  // fast firing needs one electron seen through each slit; until then let the detector catch the
  // missing one (the dots themselves are always drawn with the true probabilities)
  const haveUp = state.cache.has(cacheKey('up')), haveDown = state.cache.has(cacheKey('down'));
  let u = Math.random() * tot;
  if (state.fast && !(haveUp && haveDown)) u = !haveUp ? pUp * Math.random() : pUp + pDown * Math.random();
  if (u < pUp){ el.outcome = 'up'; E.setMask(state.masks.up); E.applyMask(1 / Math.sqrt(pUp)); }
  else if (u < pUp + pDown){ el.outcome = 'down'; E.setMask(state.masks.down); E.applyMask(1 / Math.sqrt(pDown)); }
  else {
    el.outcome = 'back';
    const m = state.masks.back || (state.masks.back = Scenes.whichMask(S, 'back'));
    E.setMask(m); E.applyMask(1 / Math.sqrt(Math.max(1e-9, tot - pUp - pDown)));
  }
  el.measured = true; state.flash = 1; state.tally[el.outcome]++;
}

// ---------- fast mode: every electron has the same wave, so landing spots can be drawn directly ----------
function fastDots(dtSec){
  const watch = state.def.watch;
  const c = watch ? [state.cache.get(cacheKey('up')), state.cache.get(cacheKey('down'))] : [state.cache.get(cacheKey('coherent'))];
  if (c.some(x => !x)) return;
  state.fastRate = Math.min(3000, (state.fastRate || 300) * (1 + dtSec * 0.5));
  const n = Math.floor(dtSec * state.fastRate * 2 * Math.random() + Math.random());
  for (let i = 0; i < n; i++){
    state.fired++;
    if (watch){
      const u = Math.random(), pick = u < c[0].pUp ? c[0] : u < c[0].pUp + c[0].pDown ? c[1] : null;
      if (pick && Math.random() < pick.tot) addDot(sampleRow(pick.dist, pick.tot), false);
    } else if (Math.random() < c[0].tot) addDot(sampleRow(c[0].dist, c[0].tot), false);
  }
}

// ---------- drawing ----------
let W = 0, H = 0, dpr = 1, plateW = 0;
function resize(){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  W = Math.round(r.width * dpr); H = Math.round(r.height * dpr);
  if (cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  plateW = Math.round(Math.max(84, Math.min(170, r.width * 0.12)));
  plate.style.width = plateW + 'px';
  plate.width = Math.round(plateW * dpr); plate.height = H;
  drawPlate(true);
}
// visible part of the box: from just inside the gun's edge to the screen, as tall as the canvas allows
function crop(){
  const S = state.S, L = S.L, x0 = 20, simW = W - plateW * dpr;
  let hgt = (L - x0) * H / simW;
  hgt = Math.min(L - 30, Math.max(140, hgt));
  const y0 = (L - hgt) / 2;
  return { x0, x1: L, y0, y1: y0 + hgt, simW };
}
// the plate: settled dots are baked into an offscreen layer once; fresh ones glow on top until they fade
const base = document.createElement('canvas'), bctx = base.getContext('2d');
let baked = 0;
function dotY(d, c, h){ return h - (d.y - c.y0) / (c.y1 - c.y0) * h; }
function bake(d, c, w, h){
  const y = dotY(d, c, h); if (y < 0 || y > h) return;
  bctx.fillStyle = 'rgba(170,225,255,0.7)';
  bctx.beginPath(); bctx.arc((0.12 + 0.8 * d.x) * w, y, 1.3 * dpr, 0, 6.2832); bctx.fill();
}
function drawPlate(full){
  if (!state.S || !H) return;
  const c = crop(), S = state.S, w = plate.width, h = plate.height;
  if (full || base.width !== w || base.height !== h){
    base.width = w; base.height = h; baked = 0;
    bctx.fillStyle = '#05070b'; bctx.fillRect(0, 0, w, h);
    bctx.fillStyle = 'rgba(255,255,255,0.08)'; bctx.fillRect(0, 0, Math.max(1, dpr), h);
  }
  // bake every dot that has finished glowing (dots only ever settle in order)
  bctx.globalCompositeOperation = 'lighter';
  while (baked < state.dots.length && !state.dots[baked].fresh) bake(state.dots[baked++], c, w, h);
  bctx.globalCompositeOperation = 'source-over';
  pctx.drawImage(base, 0, 0);
  pctx.globalCompositeOperation = 'lighter';
  for (let k = baked; k < state.dots.length; k++){
    const d = state.dots[k], y = dotY(d, c, h);
    if (y < 0 || y > h) continue;
    pctx.fillStyle = `rgba(255,236,190,${0.4 + 0.6 * d.fresh})`;
    pctx.beginPath(); pctx.arc((0.12 + 0.8 * d.x) * w, y, 1.3 * dpr * (1 + 2.5 * d.fresh), 0, 6.2832); pctx.fill();
  }
  pctx.globalCompositeOperation = 'source-over';
  if (state.pred){
    const watch = state.def.watch;
    const parts = watch ? [state.cache.get(cacheKey('up')), state.cache.get(cacheKey('down'))] : [state.cache.get(cacheKey('coherent'))];
    if (parts.every(Boolean)){
      const prob = new Float64Array(state.N);
      parts.forEach((p, k) => { const wgt = watch ? (k === 0 ? p.pUp : p.pDown) : 1; for (let i = 0; i < state.N; i++) prob[i] += wgt * p.dist[i]; });
      let mx = 0; for (let i = 0; i < state.N; i++) mx = Math.max(mx, prob[i]);
      pctx.strokeStyle = 'rgba(255,196,107,0.9)'; pctx.lineWidth = 1.5 * dpr; pctx.beginPath();
      for (let i = 0; i < state.N; i++){
        const y = h - ((i + 0.5) * S.h - c.y0) / (c.y1 - c.y0) * h;
        const x = w * (0.05 + 0.9 * prob[i] / mx);
        i ? pctx.lineTo(x, y) : pctx.moveTo(x, y);
      }
      pctx.stroke();
    }
  }
}
function render(){
  const S = state.S, E = state.E, c = crop(), L = S.L;
  const rot = 0.5 * S.k0 * S.k0 * state.el.t;
  view.draw({ engine: E, crop: [c.x0 / L, c.y0 / L, c.x1 / L, c.y1 / L], rot, lo: -7.6, span: 4.4, wallV: Scenes.WALL_V, L,
    slits: S.slits && state.def.watch && state.el.outcome && state.el.outcome !== 'back'
      ? Array(2).fill(S.slits[state.el.outcome === 'up' ? 1 : 0] / L).concat([(S.XW + S.THICK) / L]) : [0, 0, 0],
    flash: state.el.outcome === 'back' ? 0 : state.flash, vp: [0, 0, c.simW, H] });
  // scale bar: 1 nm
  const pxPerBohr = c.simW / dpr / (c.x1 - c.x0), sb = $('scalebar');
  sb.style.width = (18.897 * pxPerBohr) + 'px'; sb.style.left = ((c.simW / dpr) / 2 - 9.45 * pxPerBohr) + 'px';
}
function hud(){
  const S = state.S, k = S.k0, lam = 2 * Math.PI / k * BOHR_NM, v = k * 2.18769e6; // m/s
  const rows = [
    ['Electron energy', `${fmt(state.eV, 1)} eV`, 'big'],
    ['Wavelength', `${fmt(lam, 3)} nm`],
    ['Speed', `${fmt(v / 1000, 0)} km/s`, 'opt'],
    ['Box', `${fmt(S.L * BOHR_NM, 1)} nm across`, 'opt'],
    ['', '', 'sep'],
    ['Electrons fired', fmt(state.fired, 0)],
    ['Landed on screen', fmt(state.landed, 0), 'rate'],
  ];
  if (state.def.scene === 'barrier'){
    rows.push(['', '', 'sep'], ['Got through (sim)', state.lastT == null ? '…' : `${fmt(100 * state.lastT, 1)}%`, 'rate'], ['Exact calculation', `${fmt(100 * S.Texact, 1)}%`]);
  }
  if (state.def.watch){
    const T = state.tally;
    rows.push(['', '', 'sep'], ['This electron', !state.el.outcome ? 'on its way…' : state.el.outcome === 'up' ? 'caught at the upper slit' : state.el.outcome === 'down' ? 'caught at the lower slit' : 'bounced off the wall'],
      ['Upper · lower · bounced', `${T.up} · ${T.down} · ${T.back}`, 'rate']);
  }
  $('hud').innerHTML = rows.map(([a, b, c]) => c === 'sep' ? '<div class="sep"></div>' : `<dt class="${c === 'opt' ? 'opt' : ''}">${a}</dt><dd class="${c || ''}">${b}</dd>`).join('');
  $('dotsN').textContent = fmt(state.landed, 0);
  $('clockLab').textContent = state.fast ? 'electrons fired, landing spots drawn from the wave' : `electron ${fmt(state.fired, 0)} · since it left the gun`;
  $('clock').querySelector('span').textContent = state.fast ? `≈ ${fmt(state.fastRate || 300, 0)} per second` : `${fmt(state.el.t * AU_FS, 2)} fs`;
}

// ---------- main loop ----------
let last = performance.now(), lastHud = 0;
function frame(now){
  requestAnimationFrame(frame);
  const dtSec = Math.min(0.1, (now - last) / 1000); last = now;
  if (!state.visible || !state.S) return;
  const S = state.S, E = state.E, el = state.el;
  if (state.playing){
    if (state.hold > 0){ state.hold -= dtSec; if (state.hold <= 0) newElectron(); }
    else {
      const t0 = performance.now();
      let n = Math.max(1, Math.round(state.spf * state.pace / 100));
      if (state.def.watch && !el.measured) n = Math.min(n, Math.max(1, Math.round((S.tMeasure - el.t) / S.dt)));
      // a bounced electron (which-path detector saw nothing) ends early: its wave is just heading home
      const tEnd = el.outcome === 'back' ? S.tMeasure + 40 : S.tEnd;
      n = Math.min(n, Math.max(1, Math.round((tEnd - el.t) / S.dt)));
      E.step(S.dt, n); el.t += n * S.dt;
      if (state.def.watch && !el.measured && el.t >= S.tMeasure - 1e-9){
        measure();
      }
      // tunnelling: once the packet has cleared the barrier (and before anything reaches an edge),
      // the share of the wave beyond it is the transmission probability
      if (state.def.scene === 'barrier' && el.through == null && el.t >= (Scenes.XW + 50 - S.packet.x0) / S.k0){
        const m = E.moments(true);
        el.through = m.masked / m.norm; state.lastT = el.through;
      }
      E.finish();
      const ms = performance.now() - t0;
      if (state.pace === 100) state.spf = Math.max(4, Math.min(400, state.spf * Math.min(1.25, Math.max(0.8, 11 / Math.max(ms, 0.5)))));
      if (el.t >= tEnd - 1e-9){ finishElectron(); state.hold = state.fast ? 0.05 : 0.35; }
    }
    if (state.fast) fastDots(dtSec);
  }
  state.flash *= 0.94;
  for (const d of state.dots) if (d.fresh) d.fresh = Math.max(0, d.fresh - dtSec * 0.6);
  render();
  drawPlate();
  if (now - lastHud > 120){ hud(); lastHud = now; }
}

// ---------- controls ----------
function setup(){
  const sc = $('scenes');
  for (const k in SC){
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.s = k; b.textContent = SC[k].label;
    b.onclick = () => loadScene(k); sc.appendChild(b);
  }
  $('play').onclick = () => { state.playing = !state.playing; $('play').textContent = state.playing ? '❚❚ Pause' : '▶ Play'; };
  $('clear').onclick = () => { clearScreen(); hud(); };
  $('fast').onclick = () => { state.fast = !state.fast; state.fastRate = 300; setPressed('fast', state.fast); };
  $('tPred').onclick = () => { state.pred = !state.pred; setPressed('tPred', state.pred); drawPlate(true); };
  $('tWatch').onclick = () => loadScene(state.name === 'watch' ? 'double' : 'watch');
  const pace = $('pace');
  const paceLab = () => { $('paceOut').textContent = state.pace === 100 ? 'full speed' : `${state.pace}% of full speed`; };
  pace.oninput = () => { state.pace = Math.max(1, +pace.value); paceLab(); }; paceLab();
  const en = $('energy'), sep = $('sep');
  const enLab = () => { const k = Scenes.kOfE(state.eV); $('energyOut').textContent = `${fmt(state.eV, 1)} eV · λ ${fmt(2 * Math.PI / k * BOHR_NM, 3)} nm`; };
  const sepLab = () => { $('sepOut').textContent = `${fmt(state.d * BOHR_NM, 2)} nm`; };
  let rebuildT = 0;
  const rebuild = () => { clearTimeout(rebuildT); rebuildT = setTimeout(() => { clearScreen(); build(); newElectron(); }, 150); };
  en.oninput = () => { state.eV = +en.value; enLab(); rebuild(); };
  sep.oninput = () => { state.d = +sep.value; sepLab(); rebuild(); };
  enLab(); sepLab();
  // run only while the stage is on screen and the tab is visible
  let onScreen = true;
  const vis = () => { state.visible = onScreen && !document.hidden; last = performance.now(); };
  document.addEventListener('visibilitychange', vis);
  new IntersectionObserver(es => es.forEach(e => { onScreen = e.isIntersecting; vis(); }), { rootMargin: '100px' }).observe(cv);
  window.addEventListener('resize', resize);
}

// pick the grid: 1024² on a strong GPU, 512² otherwise (decided by timing a few steps)
function chooseSize(){
  try {
    const E = TDSE(gl, 1024, Scenes.L / 1024);
    E.setPotential(new Float32Array(4 * 1024 * 1024)); E.gaussian(100, 200, 9, 20, 2, 0);
    E.step(0.02, 4); E.finish();
    const t0 = performance.now(); E.step(0.02, 20); E.finish();
    const ms = (performance.now() - t0) / 20;
    state.benchMs = ms;
    if (ms < 1.5){ state.E = E; return 1024; }
    return 512;
  } catch (e) { return 512; }
}

setup();
state.N = window.__N || chooseSize();
resize();
loadScene('double');
requestAnimationFrame(frame);
return { state, loadScene, $ };
})();
