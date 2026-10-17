// Tunnelling lab: a 1D split-operator solver (CPU, 4096 points over 43 nm) firing a 5 eV electron at a
// smooth-edged barrier, compared with the exact transfer-matrix transmission of that same barrier
// (validated: agreement 0.02–0.4% down to T = 2×10⁻⁵).
const TUNNEL = (() => {
const $ = id => document.getElementById(id);
const cv = $('tunCv'); if (!cv) return null;
const ctx = cv.getContext('2d');
const HA = 27.211386, NM = 18.8973; // eV per Hartree, bohr per nm
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const N = 4096, h = 0.2, Lb = N * h, XB = Lb / 2, S0 = 30, ABS = 60, DT = 0.1;
const g = makeGrid(N, 1, h);
for (let i = 0; i < N; i++){ const x = (i + 0.5) * h; g.W[i] = 0.05 * Math.max(0, (ABS - x) / ABS) ** 2 + 0.05 * Math.max(0, (x - (Lb - ABS)) / ABS) ** 2; }
const S = { V: 8, a: 0.3, E: 5, t: 0, tEnd: 0, k0: 0, runs: [], T: null, Tex: null, visible: false, hold: 0, mag: 1 };

function setup(){
  const V0 = S.V / HA, a = S.a * NM;
  for (let i = 0; i < N; i++) g.V[i] = Scenes.barrierV((i + 0.5) * h - XB, V0, a);
  S.k0 = Math.sqrt(2 * S.E / HA);
  gaussian(g, XB - 150, 0, S0, 0, S.k0, 0);
  // gaussian() puts x at grid points i·h; that half-cell offset is irrelevant here
  S.t = 0; S.tEnd = 280 / S.k0; S.T = null;
  // exact: packet-averaged transfer-matrix transmission
  let num = 0, den = 0;
  for (let j = -30; j <= 30; j++){ const k = S.k0 + j * 6 / (2 * S0) / 30, w = Math.exp(-2 * S0 * S0 * (k - S.k0) ** 2); num += w * Scenes.barrierT(k * k / 2, V0, a); den += w; }
  S.Tex = num / den;
  // magnify the far side so even a tiny transmitted wave shows
  S.mag = Math.pow(10, Math.max(0, Math.floor(-Math.log10(Math.max(S.Tex, 1e-12)) - 0.3)));
  drawChart();
}
function measure(){
  let s = 0; const i0 = Math.ceil((XB + S.a * NM + 3) / h);
  for (let i = i0; i < N; i++) s += g.re[i] ** 2 + g.im[i] ** 2;
  return s * h;
}

let W = 0, Hh = 0, dpr = 1;
function resize(){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect(); W = cv.width = Math.round(r.width * dpr); Hh = cv.height = Math.round(r.height * dpr);
  const c = $('tunChart'), hb = +c.dataset.h, rr = c.getBoundingClientRect();
  c.style.height = hb + 'px'; c.width = Math.round(rr.width * dpr); c.height = Math.round(hb * dpr);
  drawChart();
}
function draw(){
  ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, Hh);
  const x0 = XB - 260, x1 = XB + 260, X = x => (x - x0) / (x1 - x0) * W;
  const base = Hh * 0.82, eMax = 13, Y = eV => base - eV / eMax * Hh * 0.7;
  // grid every nm
  ctx.strokeStyle = 'rgba(230,234,240,0.05)'; ctx.lineWidth = 1;
  for (let x = Math.ceil(x0 / NM) * NM; x < x1; x += NM){ ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), Hh); ctx.stroke(); }
  // barrier
  ctx.strokeStyle = 'rgba(230,234,240,0.18)'; ctx.lineWidth = 1 * dpr;
  ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(W, base); ctx.stroke();
  ctx.fillStyle = 'rgba(155,163,180,0.7)'; ctx.font = `${11 * dpr}px "IBM Plex Mono", monospace`; ctx.fillText('0 eV', 10 * dpr, base - 6 * dpr);
  const bx0 = XB - 3, bx1 = XB + S.a * NM + 3;
  ctx.fillStyle = 'rgba(255,157,92,0.22)'; ctx.strokeStyle = 'rgba(255,157,92,0.9)'; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(X(bx0), base);
  for (let i = Math.floor(bx0 / h); i < bx1 / h; i++){ const x = (i + 0.5) * h; ctx.lineTo(X(x), Y(g.V[i] * HA)); }
  ctx.lineTo(X(bx1), base); ctx.closePath(); ctx.fill(); ctx.stroke();
  // electron energy
  ctx.setLineDash([5 * dpr, 5 * dpr]); ctx.strokeStyle = 'rgba(143,195,236,0.7)'; ctx.lineWidth = 1 * dpr;
  ctx.beginPath(); ctx.moveTo(0, Y(S.E)); ctx.lineTo(W, Y(S.E)); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = `${11 * dpr}px "IBM Plex Mono", monospace`; ctx.fillStyle = 'rgba(143,195,236,0.9)';
  ctx.fillText(`electron energy ${fmt(S.E, 1)} eV`, 10 * dpr, Y(S.E) - 6 * dpr);
  ctx.fillStyle = 'rgba(255,157,92,0.95)'; ctx.fillText(`wall ${fmt(S.V, 1)} eV`, X(XB) + 8 * dpr + S.a * NM / (x1 - x0) * W, Y(S.V) - 6 * dpr);
  // the wave: envelope |ψ| as a glow, Re ψ as a gold line; far side magnified
  const amp = Hh * 0.30 * Math.sqrt(Math.sqrt(2 * Math.PI) * S0), iB = (XB + S.a * NM + 1.5) / h;
  const rot = 0.5 * S.k0 * S.k0 * S.t;
  for (const pass of [0, 1]){
    ctx.beginPath();
    for (let px = 0; px <= W; px += dpr){
      const x = x0 + px / W * (x1 - x0), i = Math.min(N - 1, Math.max(0, Math.round(x / h - 0.5)));
      const m = i > iB ? S.mag : 1, c = Math.cos(rot), s = Math.sin(rot);
      const re = (g.re[i] * c - g.im[i] * s) * m, im = (g.re[i] * s + g.im[i] * c) * m;
      const y = pass === 0 ? Math.hypot(re, im) : re;
      const yy = Y(S.E) - y * amp;
      px === 0 ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
    }
    if (pass === 0){ ctx.strokeStyle = 'rgba(143,195,236,0.55)'; ctx.lineWidth = 1.2 * dpr; ctx.stroke(); }
    else { ctx.strokeStyle = 'rgba(255,196,107,0.95)'; ctx.lineWidth = 1.6 * dpr; ctx.stroke(); }
  }
  if (S.mag > 1){
    ctx.fillStyle = 'rgba(155,163,180,0.9)'; ctx.font = `${12 * dpr}px "IBM Plex Mono", monospace`;
    ctx.fillText(`far side magnified × ${fmt(S.mag, 0)}`, X(XB) + 30 * dpr, Hh - 14 * dpr);
  }
  // 1 nm scale
  ctx.fillStyle = 'rgba(155,163,180,0.9)'; ctx.fillRect(14 * dpr, Hh - 18 * dpr, NM / (x1 - x0) * W, 1 * dpr);
  ctx.fillText('1 nm', 14 * dpr, Hh - 24 * dpr);
}
function labels(){
  $('tunLab').innerHTML = `${fmt(S.t * 0.02418884, 2)} fs`;
  const T = S.T, ex = S.Tex;
  const pct = v => v >= 0.01 ? `${fmt(100 * v, 2)}%` : v >= 1e-6 ? `1 in ${fmt(1 / v, 0)}` : `${v.toExponential(1)}`;
  $('tunK').innerHTML = [
    ['Got through (simulation)', T == null ? '…' : pct(T)],
    ['Exact calculation', pct(ex)],
    ['A classical ball', 'never'],
    ['Wall thickness', `${fmt(S.a, 2)} nm ≈ ${fmt(S.a / 0.1, 1)} atoms`],
  ].map(([k, v]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
}
// T against thickness: exact (monochromatic at the electron's energy) and the simulation's runs
function drawChart(){
  const c = $('tunChart'), x = c.getContext('2d'), w = c.width, hh = c.height;
  if (!w) return;
  x.clearRect(0, 0, w, hh);
  const pl = 52 * dpr, pr = 14 * dpr, pt = 12 * dpr, pb = 30 * dpr;
  const A0 = 0.05, A1 = 0.8, L0 = -8, L1 = 0;
  const X = a => pl + (a - A0) / (A1 - A0) * (w - pl - pr), Y = l => pt + (L1 - l) / (L1 - L0) * (hh - pt - pb);
  x.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
  for (let l = L0; l <= L1; l += 2){ x.strokeStyle = 'rgba(230,234,240,0.07)'; x.beginPath(); x.moveTo(pl, Y(l)); x.lineTo(w - pr, Y(l)); x.stroke(); x.fillStyle = 'rgba(104,112,132,1)'; x.fillText({ 0: '1', '-2': '10⁻²', '-4': '10⁻⁴', '-6': '10⁻⁶', '-8': '10⁻⁸' }[l], 8 * dpr, Y(l) + 4 * dpr); }
  for (let a = 0.1; a <= 0.8001; a += 0.1){ x.fillStyle = 'rgba(104,112,132,1)'; x.fillText(`${fmt(a, 1)}${a > 0.75 ? ' nm' : ''}`, X(a) - (a > 0.75 ? 34 : 8) * dpr, hh - 10 * dpr); }
  const V0 = S.V / HA, E = S.E / HA;
  x.strokeStyle = 'rgba(255,196,107,0.95)'; x.lineWidth = 1.8 * dpr; x.beginPath();
  for (let i = 0; i <= 80; i++){ const a = A0 + (A1 - A0) * i / 80, T = Scenes.barrierT(E, V0, a * NM), l = Math.max(L0, Math.log10(T)); i ? x.lineTo(X(a), Y(l)) : x.moveTo(X(a), Y(l)); }
  x.stroke();
  for (const r of S.runs){
    if (Math.abs(r.V - S.V) > 1e-6 || Math.abs(r.E - S.E) > 1e-6) continue;
    x.fillStyle = 'rgba(143,195,236,1)'; x.beginPath(); x.arc(X(r.a), Y(Math.max(L0, Math.log10(r.T))), 4 * dpr, 0, 6.2832); x.fill();
  }
  // current thickness marker
  x.strokeStyle = 'rgba(230,234,240,0.25)'; x.setLineDash([3 * dpr, 4 * dpr]); x.beginPath(); x.moveTo(X(S.a), pt); x.lineTo(X(S.a), hh - pb); x.stroke(); x.setLineDash([]);
}
let last = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dtSec = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.visible) return;
  if (S.hold > 0){ S.hold -= dtSec; if (S.hold <= 0) setup(); }
  else {
    const t0 = performance.now();
    while (performance.now() - t0 < 9 && S.t < S.tEnd){ step(g, DT); S.t += DT; }
    if (S.T == null && S.t >= S.tEnd){
      S.T = measure();
      S.runs.push({ V: S.V, E: S.E, a: S.a, T: S.T });
      drawChart(); S.hold = 1.6;
    }
  }
  draw(); labels();
}
function bind(id, key, unit, d){
  const el = $(id), out = $(id + 'o');
  const lab = () => { out.textContent = key === 'a' ? `${fmt(S.a, 2)} nm` : `${fmt(S[key], d)} ${unit}`; };
  el.oninput = () => { S[key] = +el.value; lab(); S.hold = 0; setup(); };
  lab();
}
bind('tunV', 'V', 'eV', 1); bind('tunA', 'a', 'nm', 2); bind('tunE', 'E', 'eV', 1);
// real tunnelling, in nature and in machines
const rows = [
  ['Sunlight', 'Protons fusing in the Sun\'s core', 'Two protons repel each other with a barrier of about <b>1 MeV</b>; at 15 million degrees a typical proton has about 1.4 keV. Without tunnelling the core would have to be roughly ten billion degrees for the Sun to shine.'],
  ['Radioactivity', 'Alpha decay of heavy nuclei', 'An alpha particle rattles inside the nucleus and tunnels out. Polonium-212 lets one go in <b>0.3 microseconds</b>; uranium-238 takes <b>4.5 billion years</b>. Its alpha particle has only half the energy, and the barrier is that much harder to cross (Gamow, 1928).'],
  ['Seeing atoms', 'The scanning tunnelling microscope', 'A needle hovers a few tenths of a nanometre above a surface, and electrons tunnel across the gap. The current changes about <b>ten-fold for every 0.1 nm</b>, so the needle feels single atoms (Binnig and Rohrer, Nobel Prize 1986).'],
  ['Your photos', 'Flash memory', 'Each bit is charge trapped on a tiny island sealed in glass about <b>8 nm</b> thick. A strong electric field thins the barrier so electrons tunnel on or off to write or erase; with the field off they stay put for years.'],
  ['Medicine', 'Magnetoencephalography (MEG)', 'SQUID sensors, built on tunnelling through an insulating film a couple of nanometres thick, pick up the magnetic fields of firing neurons: about <b>100 femtotesla</b>, a few hundred million times weaker than the Earth\'s field. MEG helps surgeons locate the source of epileptic seizures.'],
];
$('tunTable').innerHTML = '<tr><th>Where</th><th>What tunnels</th><th>The numbers</th></tr>' + rows.map(r => `<tr><td class="where"><span class="name">${r[0]}</span></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
new IntersectionObserver(es => es.forEach(e => { S.visible = e.isIntersecting; last = performance.now(); }), { rootMargin: '200px' }).observe(cv);
window.addEventListener('resize', resize);
resize(); setup();
requestAnimationFrame(frame);
return { S };
})();
