// MRI section: a voxel of proton spins under the Bloch equations (tip, dephase, refocus, recover),
// and a head phantom imaged with the spin-echo signal equation using measured 3 T relaxation times.
const MRI = (() => {
const $ = id => document.getElementById(id);
const cv = $('spinCv'); if (!cv) return null;
const ctx = cv.getContext('2d'), sig = $('sigCv'), sctx = sig.getContext('2d'), scan = $('scanCv'), gctx = scan.getContext('2d');
const T = Bloch.TISSUES, fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const T2P = 30; // ms: field inhomogeneity across the voxel (sets T2*)
const S = { tissue: 'wm', v: null, auto: true, TE: 60, TR: 1500, tSeq: 0, hist: [], rate: 50, visible: false, yaw: 0.5, marks: [], TRimg: 500, TEimg: 15, w: 't1' };
function newVoxel(){ const t = T[S.tissue]; S.v = Bloch.makeVoxel(240, t.T1, t.T2, T2P, 7); S.hist = []; S.marks = []; S.tSeq = 0; S.started = false; }
function p90(){ Bloch.pulse(S.v, Math.PI / 2); S.marks.push([S.v.t, '90°']); }
function p180(){ Bloch.pulse(S.v, Math.PI, 'y'); S.marks.push([S.v.t, '180°']); }

let dpr = 1;
function size(c, hb){ const r = c.getBoundingClientRect(); if (hb){ c.style.height = hb + 'px'; } c.width = Math.round(r.width * dpr); c.height = Math.round((hb || r.height) * dpr); }
function resize(){ dpr = Math.min(window.devicePixelRatio || 1, 2); size(cv); size(sig, +sig.dataset.h); size(scan); drawScan(); }

// ---------- the spin voxel ----------
function proj(x, y, z){
  const c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  const X = x * c - y * s, Y = x * s * 0.35 + y * c * 0.35;
  return [X, -z + Y];
}
function drawSpins(){
  const w = cv.width, h = cv.height, R = Math.min(w, h) * 0.44, cx = w / 2, cy = h * 0.6;
  ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, w, h);
  // axes and the transverse plane
  ctx.strokeStyle = 'rgba(230,234,240,0.12)'; ctx.lineWidth = 1 * dpr; ctx.beginPath();
  for (let a = 0; a <= 64; a++){ const [x, y] = proj(Math.cos(a / 64 * 6.2832), Math.sin(a / 64 * 6.2832), 0); a ? ctx.lineTo(cx + x * R, cy + y * R) : ctx.moveTo(cx + x * R, cy + y * R); }
  ctx.stroke();
  const axis = (v, lab) => { const [x, y] = proj(...v); ctx.strokeStyle = 'rgba(230,234,240,0.25)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + x * R * 1.15, cy + y * R * 1.15); ctx.stroke(); ctx.fillStyle = 'rgba(155,163,180,0.9)'; ctx.font = `${11 * dpr}px "IBM Plex Mono", monospace`; ctx.fillText(lab, cx + x * R * 1.2, cy + y * R * 1.2); };
  axis([0, 0, 1], 'B₀ field'); axis([1, 0, 0], 'x'); axis([0, 1, 0], 'y');
  // isochromats: gold precess faster than average, blue slower
  for (let i = 0; i < S.v.iso.length; i += 3){
    const m = S.v.iso[i], [x, y] = proj(m.x, m.y, m.z), f = Math.atan(m.dw * T2P) / Math.PI + 0.5;
    ctx.strokeStyle = `rgba(${Math.round(77 + 178 * f)},${Math.round(140 + 60 * f)},${Math.round(255 - 148 * f)},0.55)`; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + x * R, cy + y * R); ctx.stroke();
  }
  // the net magnetisation
  const s = Bloch.signal(S.v), [x, y] = proj(s.x, s.y, s.z);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + x * R, cy + y * R); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx + x * R, cy + y * R, 4 * dpr, 0, 6.2832); ctx.fill();
  $('spinLab').innerHTML = `${T[S.tissue].name} · seen turning with the spins at 127.7 MHz<br><b>${fmt(S.v.t, 0)} ms</b><br>signal ${fmt(s.mxy * 100, 0)}% · along field ${fmt(s.z * 100, 0)}%`;
}
function drawSignal(){
  const w = sig.width, h = sig.height, span = 3000, t1 = S.v.t, t0 = t1 - span;
  sctx.clearRect(0, 0, w, h);
  const X = t => (t - t0) / span * w, Y = v => h * 0.5 - v * h * 0.42;
  sctx.strokeStyle = 'rgba(230,234,240,0.12)'; sctx.beginPath(); sctx.moveTo(0, Y(0)); sctx.lineTo(w, Y(0)); sctx.stroke();
  sctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  for (const [t, lab] of S.marks){ if (t < t0) continue; sctx.fillStyle = 'rgba(255,157,92,0.8)'; sctx.fillRect(X(t), 4 * dpr, 1 * dpr, h - 8 * dpr); sctx.fillText(lab, X(t) + 3 * dpr, 12 * dpr); }
  for (const [k, col] of [[2, 'rgba(143,211,168,0.9)'], [1, 'rgba(255,196,107,0.95)']]){
    sctx.strokeStyle = col; sctx.lineWidth = 1.5 * dpr; sctx.beginPath(); let first = true;
    for (const p of S.hist){ if (p[0] < t0) continue; first ? sctx.moveTo(X(p[0]), Y(p[k])) : sctx.lineTo(X(p[0]), Y(p[k])); first = false; }
    sctx.stroke();
  }
  sctx.fillStyle = 'rgba(104,112,132,1)'; sctx.fillText('3 s of scanner time ←', w - 150 * dpr, h - 6 * dpr);
}
function stepSpins(dtSec){
  // playback: rate 0…100 maps to 5…500 ms of scanner time per second
  const ms = dtSec * 5 * Math.pow(100, S.rate / 100);
  const sub = Math.max(1, Math.ceil(ms / 0.5)), d = ms / sub;
  for (let i = 0; i < sub; i++){
    if (S.auto){
      // 90° at the start of each repeat, 180° at TE/2, echo at TE
      const before = S.tSeq; S.tSeq += d;
      if (!S.started){ p90(); S.started = true; S.tSeq = 0; }
      else if (before < S.TE / 2 && S.tSeq >= S.TE / 2) p180();
      else if (S.tSeq >= S.TR){ p90(); S.tSeq = 0; }
    }
    Bloch.free(S.v, d);
    const s = Bloch.signal(S.v);
    S.hist.push([S.v.t, s.mxy, s.z]);
  }
  const cut = S.v.t - 3200; while (S.hist.length && S.hist[0][0] < cut) S.hist.shift();
}

// ---------- the head phantom ----------
const NP = 220, lab = new Float32Array(NP * NP * 6); // fractions of: bone, fat, csf, gm, wm, blood(none) → 6 slots
const KEYS = ['bone', 'fat', 'csf', 'gm', 'wm', 'muscle'];
(function phantom(){
  const L = new Uint8Array(NP * NP);
  for (let j = 0; j < NP; j++) for (let i = 0; i < NP; i++){
    const x = (i + 0.5) / NP * 2 - 1, y = (j + 0.5) / NP * 2 - 1;
    const r = Math.hypot(x / 0.74, y / 0.9), th = Math.atan2(y, x);
    let k = 255;
    if (r < 1){
      k = 1; // scalp fat
      if (r < 0.955) k = 0; // skull
      if (r < 0.905) k = 2; // CSF over the brain
      const cortex = 0.885 - 0.035 * (0.5 + 0.5 * Math.sin(13 * th + 1.3 * Math.sin(3 * th)));
      if (r < cortex) k = 3; // grey matter
      const wmEdge = cortex - 0.12 - 0.05 * (0.5 + 0.5 * Math.sin(13 * th + 1.3 * Math.sin(3 * th)));
      if (r < wmEdge) k = 4; // white matter
      // sulci: thin CSF clefts into the cortex
      if (r < 0.905 && r > wmEdge && Math.abs(Math.sin(6.5 * th + 0.65 * Math.sin(3 * th))) < 0.06) k = 2;
      // lateral ventricles (two crescents) and deep grey nuclei
      const v1 = Math.hypot((x - 0.11) / 0.07, (y + 0.08) / 0.26), v2 = Math.hypot((x + 0.11) / 0.07, (y + 0.08) / 0.26);
      if (Math.hypot((x - 0.2) / 0.08, (y - 0.1) / 0.13) < 1 || Math.hypot((x + 0.2) / 0.08, (y - 0.1) / 0.13) < 1) k = 3;
      if (v1 < 1 || v2 < 1) k = 2;
      // interhemispheric fissure
      if (Math.abs(x) < 0.012 && Math.abs(y) > 0.36 && r < 0.905) k = 2;
    }
    L[i + NP * j] = k;
  }
  // partial volume: average labels over a small neighbourhood
  for (let j = 0; j < NP; j++) for (let i = 0; i < NP; i++){
    let n = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++){
      const ii = Math.min(NP - 1, Math.max(0, i + a)), jj = Math.min(NP - 1, Math.max(0, j + b)), k = L[ii + NP * jj];
      if (k < 6) lab[6 * (i + NP * j) + k] += 1; n++;
    }
    for (let k = 0; k < 6; k++) lab[6 * (i + NP * j) + k] /= n;
  }
})();
const noise = Float32Array.from({ length: NP * NP }, () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.035);
function drawScan(){
  const w = scan.width, h = scan.height; if (!w) return;
  const img = gctx.createImageData(NP, NP), I = KEYS.map(k => k === 'bone' ? 0 : Bloch.spinEcho(T[k], S.TRimg, S.TEimg));
  let mx = 0; for (const v of I) mx = Math.max(mx, v);
  for (let p = 0; p < NP * NP; p++){
    let v = 0, inside = 0;
    for (let k = 0; k < 6; k++){ v += lab[6 * p + k] * I[k]; inside += lab[6 * p + k]; }
    v = inside > 0 ? v / mx + noise[p] * inside : 0;
    const g = Math.round(255 * Math.max(0, Math.min(1, v)) ** 0.85);
    img.data[4 * p] = g; img.data[4 * p + 1] = g; img.data[4 * p + 2] = g; img.data[4 * p + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = NP; off.height = NP; off.getContext('2d').putImageData(img, 0, 0);
  gctx.fillStyle = '#000'; gctx.fillRect(0, 0, w, h); gctx.imageSmoothingEnabled = true;
  const s = Math.min(w, h) * 0.96; gctx.drawImage(off, (w - s) / 2, (h - s) / 2, s, s);
  $('scanLab').innerHTML = `TR ${fmt(S.TRimg, 0)} ms · TE ${fmt(S.TEimg, 0)} ms<br><b>${{ t1: 'T1-weighted', t2: 'T2-weighted', pd: 'Proton density' }[S.w] || 'Your own mix'}</b>`;
}
const WEIGHTS = {
  t1: { label: 'T1-weighted', TR: 500, TE: 15, cap: 'Short repeat, short echo. Tissues with a short T1 recover between pulses and shine: <b>fat is bright, fluid is dark</b>, and white matter is a shade brighter than grey. The view for anatomy.' },
  t2: { label: 'T2-weighted', TR: 4000, TE: 100, cap: 'Long repeat, long echo. Every tissue has recovered, and what remains is how long its spins stay in step: <b>water is bright</b>. The spinal fluid glows, and so would oedema, inflammation or most tumours.' },
  pd: { label: 'Proton density', TR: 4000, TE: 15, cap: 'Long repeat, short echo. Neither relaxation matters much, so the brightness simply counts <b>how many protons</b> each tissue holds. Contrast is gentle.' },
};
function setWeight(k){
  S.w = k; const W = WEIGHTS[k];
  if (W){ S.TRimg = W.TR; S.TEimg = W.TE; $('mriTR').value = W.TR; $('mriTE').value = W.TE; $('mriCap').innerHTML = W.cap; }
  else $('mriCap').innerHTML = 'Your own timing. Watch which tissues trade places as the echo time grows.';
  [...$('weightChips').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.k === k ? 'true' : 'false'));
  $('mriTRo').textContent = `${fmt(S.TRimg, 0)} ms`; $('mriTEo').textContent = `${fmt(S.TEimg, 0)} ms`;
  drawScan();
}
for (const k in WEIGHTS){ const b = document.createElement('button'); b.className = 'chip'; b.dataset.k = k; b.textContent = WEIGHTS[k].label; b.onclick = () => setWeight(k); $('weightChips').appendChild(b); }
$('mriTR').oninput = e => { S.TRimg = +e.target.value; setWeight('custom'); };
$('mriTE').oninput = e => { S.TEimg = +e.target.value; setWeight('custom'); };
for (const k of ['wm', 'gm', 'csf', 'fat', 'blood']){
  const b = document.createElement('button'); b.className = 'chip'; b.dataset.k = k; b.textContent = T[k].name;
  b.onclick = () => { S.tissue = k; newVoxel(); [...$('tissueChips').children].forEach(c => c.setAttribute('aria-pressed', c.dataset.k === k ? 'true' : 'false')); };
  b.setAttribute('aria-pressed', k === S.tissue ? 'true' : 'false'); $('tissueChips').appendChild(b);
}
$('p90').onclick = () => { S.auto = false; $('pAuto').setAttribute('aria-pressed', 'false'); p90(); };
$('p180').onclick = () => { S.auto = false; $('pAuto').setAttribute('aria-pressed', 'false'); p180(); };
$('pAuto').onclick = () => { S.auto = !S.auto; $('pAuto').setAttribute('aria-pressed', S.auto ? 'true' : 'false'); S.started = false; };
const rate = $('mriRate'), rateLab = () => { const ms = 5 * Math.pow(100, S.rate / 100); $('mriRateO').textContent = `${fmt(1000 / ms, 0)}× (${fmt(ms, 0)} ms per second)`; };
rate.oninput = () => { S.rate = +rate.value; rateLab(); }; S.rate = +rate.value; rateLab();
$('mriTable').innerHTML = '<tr><th>Tissue at 3 T</th><th>T1</th><th>T2</th></tr>' + ['wm', 'gm', 'csf', 'fat', 'blood', 'muscle', 'liver'].map(k => `<tr><td>${T[k].name}${T[k].approx ? '<span class="why">typical value; published T2 varies widely</span>' : ''}</td><td>${fmt(T[k].T1, 0)} ms</td><td>${fmt(T[k].T2, 0)} ms</td></tr>`).join('') + '<tr><td colspan="3"><span class="why">Measured at 37 °C: Stanisz et al. 2005; fat from de Bazelaire et al. 2004.</span></td></tr>';
let last = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.visible) return;
  S.yaw += dt * 0.15;
  stepSpins(dt); drawSpins(); drawSignal();
}
new IntersectionObserver(es => es.forEach(e => { S.visible = e.isIntersecting; last = performance.now(); }), { rootMargin: '200px' }).observe(cv);
window.addEventListener('resize', resize);
newVoxel(); resize(); setWeight('t1');
requestAnimationFrame(frame);
return { S, setWeight };
})();
