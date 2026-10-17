// The atom section: orbital explorer, a two-state superposition that sloshes at the light's frequency,
// and a glowing gas of atoms cascading down by quantum jumps (real Einstein A rates) that builds a spectrum.
const ATOM = (() => {
const $ = id => document.getElementById(id);
const cv = $('atomCv'); if (!cv) return null;
const V = AtomView(cv);
if (!V){ cv.parentNode.insertAdjacentHTML('beforeend', '<div class="nogl">This view needs WebGL2.</div>'); return null; }
const ov = $('atomOv'), octx = ov.getContext('2d');
const D = ATOM_DATA, HA_EV = 27.211386, BOHR_A = 0.529177;
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const LN = 'spdfghik';
const REAL = { 1: { 0: 'z', 1: 'x', '-1': 'y' }, 2: { 0: 'z²', 1: 'xz', '-1': 'yz', 2: 'x²−y²', '-2': 'xy' }, 3: { 0: 'z³', 1: 'xz²', '-1': 'yz²', 2: 'z(x²−y²)', '-2': 'xyz', 3: 'x(x²−3y²)', '-3': 'y(3x²−y²)' } };
const oname = (n, l, m) => `${n}${LN[l]}${l > 0 && l <= 3 ? `<sub>${REAL[l][m]}</sub>` : l > 3 ? `<sub>m=${m}</sub>` : ''}`;
const otext = (n, l, m) => oname(n, l, m).replace(/<\/?sub>/g, '');
const E_eV = n => D.E[n];

// wavelength (nm) → display colour
function lamRGB(nm){
  if (nm < 380) return [176, 150, 255];
  if (nm > 750) return [205, 92, 80];
  let r, g, b;
  if (nm < 440){ r = -(nm - 440) / 60; g = 0; b = 1; }
  else if (nm < 490){ r = 0; g = (nm - 440) / 50; b = 1; }
  else if (nm < 510){ r = 0; g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580){ r = (nm - 510) / 70; g = 1; b = 0; }
  else if (nm < 645){ r = 1; g = -(nm - 645) / 65; b = 0; }
  else { r = 1; g = 0; b = 0; }
  const f = nm < 420 ? 0.4 + 0.6 * (nm - 380) / 40 : nm > 700 ? 0.4 + 0.6 * (750 - nm) / 50 : 1;
  return [r, g, b].map(v => Math.round(255 * Math.pow(Math.max(0, v * f), 0.8)));
}
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const LINE_NAMES = { '2-1': 'Lyman α', '3-1': 'Lyman β', '3-2': 'H-α', '4-2': 'H-β', '5-2': 'H-γ', '6-2': 'H-δ', '4-3': 'Paschen α', '5-3': 'Paschen β', '5-4': 'Brackett α' };

const S = {
  mode: 'orbit', n: 3, l: 2, m: 0, pair: 'ha', mix: 0.5, t: 0, visible: false, drag: null,
  atom: null, wait: 0, life: 0, fade: 0, prev: null, photons: [], counts: {}, tube: false, total: 0, lastLine: null,
};
const PAIRS = {
  lya: { a: [1, 0, 0], b: [2, 1, 0], label: 'Lyman α', sub: '1s ↔ 2p' },
  lyb: { a: [1, 0, 0], b: [3, 1, 0], label: 'Lyman β', sub: '1s ↔ 3p' },
  ha: { a: [2, 1, 0], b: [3, 2, 0], label: 'H-α', sub: '2p ↔ 3d' },
  hb: { a: [2, 1, 0], b: [4, 2, 0], label: 'H-β', sub: '2p ↔ 4d' },
};
const MODES = {
  orbit: { label: 'Orbitals', cap: 'Each orbital is labelled by its <b>energy level n</b>, its <b>shape</b> (s, p, d, f… for 0, 1, 2, 3… units of angular momentum) and its <b>orientation</b>. Gold and blue are the two signs of the wave, crest and trough; where they meet, on a <b>node</b>, the electron is never found. Higher levels hold the electron farther out and less tightly.' },
  mix: { label: 'Between two states', cap: 'A stationary orbital does not radiate: its cloud is perfectly still. But an electron can be in <b>two states at once</b>. Then the two waves beat against each other and the cloud <b>sloshes</b> up and down at exactly the frequency of the light that connects the two levels. The atom has become a tiny antenna. A laser tuned to that frequency is what pushes it into the mixture.' },
  glow: { label: 'Glowing hydrogen', cap: 'A spark knocks the electron up to a high level. From there it falls back down in <b>quantum jumps</b>, each jump giving off one photon whose colour is fixed by the energy gap. Which jump comes next, and when, is random; the odds are the real decay rates of hydrogen. The colours add up to hydrogen\'s <b>spectrum</b>, the same lines astronomers see in glowing nebulae.' },
};

// ---------- controls ----------
function chip(label, on, fn, small){ const b = document.createElement('button'); b.className = 'chip'; b.innerHTML = label + (small ? ` <small>${small}</small>` : ''); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.onclick = fn; return b; }
function buildModes(){
  const box = $('atomModes'); box.innerHTML = '';
  for (const k in MODES) box.appendChild(chip(MODES[k].label, S.mode === k, () => setMode(k)));
}
function setMode(k){
  S.mode = k; S.t = 0;
  buildModes(); buildCtl();
  $('atomCap').innerHTML = MODES[k].cap;
  if (k === 'glow' && !S.atom) spark();
}
function buildCtl(){
  const c = $('atomCtl'); c.innerHTML = '';
  const row = (label, kids) => { const g = document.createElement('div'); g.className = 'group atomrow'; g.innerHTML = `<div class="group-label">${label}</div>`; const ch = document.createElement('div'); ch.className = 'chips'; kids.forEach(x => ch.appendChild(x)); g.appendChild(ch); c.appendChild(g); };
  if (S.mode === 'orbit'){
    row('Energy level n', [1, 2, 3, 4, 5, 6].map(n => chip(String(n), S.n === n, () => { S.n = n; S.l = Math.min(S.l, n - 1); S.m = Math.max(-S.l, Math.min(S.l, S.m)); buildCtl(); })));
    row('Shape', Array.from({ length: S.n }, (_, l) => chip(LN[l], S.l === l, () => { S.l = l; S.m = 0; buildCtl(); })));
    const ms = []; for (let m = -S.l; m <= S.l; m++) ms.push(m);
    if (S.l > 0) row('Orientation', ms.map(m => chip(S.l <= 3 ? `${LN[S.l]}<sub>${REAL[S.l][m]}</sub>` : `m = ${m}`, S.m === m, () => { S.m = m; buildCtl(); })));
  } else if (S.mode === 'mix'){
    row('Transition', Object.keys(PAIRS).map(k => chip(PAIRS[k].label, S.pair === k, () => { S.pair = k; buildCtl(); }, PAIRS[k].sub)));
    const g = document.createElement('div'); g.className = 'group atomrow';
    const P = PAIRS[S.pair];
    g.innerHTML = `<div class="group-label">How much of each</div><label class="sl">${otext(...P.a)} <input type="range" id="mixR" min="0" max="100" value="${Math.round(S.mix * 100)}" aria-label="Mixture"><output id="mixO">${otext(...P.b)} ${Math.round(S.mix * 100)}%</output></label>`;
    c.appendChild(g);
    $('mixR').oninput = e => { S.mix = e.target.value / 100; $('mixO').textContent = `${otext(...P.b)} ${e.target.value}%`; };
  } else {
    const b1 = chip('Spark another atom', false, () => spark()); b1.classList.add('act');
    const b2 = chip('A whole tube of gas', S.tube, () => { S.tube = !S.tube; buildCtl(); });
    const b3 = chip('Clear the spectrum', false, () => { S.counts = {}; S.total = 0; drawSpec(); });
    row('Atoms', [b1, b2, b3]);
  }
  facts();
}

// ---------- the glowing gas: Monte Carlo cascades with the real rates ----------
function excite(){
  // a discharge leaves atoms in high levels; take n = 3…8 with odds ∝ 1/n, then l, m by their counts
  const ws = []; let s = 0;
  for (let n = 3; n <= 8; n++){ s += 1 / n; ws.push([n, s]); }
  const u = Math.random() * s, n = ws.find(w => u <= w[1])[0];
  let v = Math.random() * n * n, l = 0;
  while (v > 2 * l + 1){ v -= 2 * l + 1; l++; }
  const m = Math.floor(Math.random() * (2 * l + 1)) - l;
  return { n, l, m };
}
// next jump from (n,l,m): returns { to, tau (s), line } where line is "n-n'" or null for 2s → 1s (two photons)
function decay(st){
  const key = `${st.n}${st.l}`, tot = D.total[key];
  if (!tot){ // 2s: decays by emitting two photons together, lifetime 0.122 s
    return { to: { n: 1, l: 0, m: 0 }, tau: -Math.log(Math.random()) * 0.1216, line: null };
  }
  let u = Math.random() * tot, pick = null;
  for (const k in D.A){
    if (!k.startsWith(key + '-')) continue;
    u -= D.A[k]; if (u <= 0){ pick = k; break; }
  }
  if (!pick) pick = Object.keys(D.A).filter(k => k.startsWith(key + '-')).pop();
  const n2 = +pick[3], l2 = +pick[4];
  const br = D.branch[`${st.l},${st.m}>${l2}`];
  let m2 = 0;
  if (br){ let w = Math.random(); m2 = -l2; for (let i = 0; i < br.length; i++){ w -= br[i]; if (w <= 0){ m2 = i - l2; break; } } }
  return { to: { n: n2, l: l2, m: m2 }, tau: -Math.log(Math.random()) / tot, line: `${st.n}-${n2}` };
}
function spark(){
  S.atom = excite(); S.fade = 0; S.prev = null;
  S.next = decay(S.atom); S.wait = 0; S.life = displayWait(S.next.tau);
}
// lifetimes span nanoseconds to a tenth of a second; on screen they are compressed logarithmically
const displayWait = tau => Math.min(3.2, Math.max(0.6, 1.0 + 0.55 * Math.log10(tau / 1e-9)));
function count(line, k = 1){ S.counts[line] = (S.counts[line] || 0) + k; S.total += k; }
function stepGlow(dt){
  if (!S.atom) return;
  S.fade = Math.min(1, S.fade + dt * 3);
  S.wait += dt;
  if (S.wait >= S.life){
    const j = S.next;
    if (j.line){
      count(j.line);
      const lam = D.lam[j.line][1];
      const ang = Math.random() * 2 * Math.PI;
      S.photons.push({ lam, a: ang, r: 0, line: j.line });
      S.lastLine = j.line;
    }
    S.lastJump = { from: S.atom, to: j.to, line: j.line, tau: j.tau, age: 0 };
    S.prev = S.atom; S.atom = j.to; S.fade = 0;
    if (S.atom.n === 1){ S.next = null; S.life = 1e9; S.restart = 2.2; }
    else { S.next = decay(S.atom); S.wait = 0; S.life = displayWait(S.next.tau); }
    facts();
  }
  if (S.restart != null && S.atom.n === 1){ S.restart -= dt; if (S.restart <= 0){ S.restart = null; spark(); } }
  // a whole tube: thousands of atoms cascading each second (only their photons are counted)
  if (S.tube) for (let i = 0; i < 300; i++){
    let st = excite(), guard = 0;
    while (st.n > 1 && guard++ < 40){ const j = decay(st); if (j.line) count(j.line); st = j.to; }
  }
}

// ---------- facts ----------
function facts(){
  const f = []; let name = '';
  if (S.mode === 'orbit'){
    const { n, l, m } = S, r = (3 * n * n - l * (l + 1)) / 2;
    name = `${oname(n, l, m)}<small>orbital</small>`;
    f.push(['Energy', `${fmt(E_eV(n), 3)} eV`], ['To pull the electron free', `${fmt(-E_eV(n), 2)} eV`], ['Average distance from the proton', `${fmt(r * BOHR_A, 2)} Å`],
      ['Spherical nodes (n − l − 1)', `${n - l - 1}`], ['Flat or conical nodes (l)', `${l}`], [`Orbitals at this level (n²)`, `${n * n}`]);
    if (n > 1){ const tau = D.total[`${n}${l}`]; f.push(['Lifetime before it decays', tau ? fmtTime(1 / tau) : '0.12 s (two-photon)']); }
    else f.push(['Lifetime', 'forever: the ground state']);
  } else if (S.mode === 'mix'){
    const P = PAIRS[S.pair], na = P.a[0], nb = P.b[0], dE = E_eV(nb) - E_eV(na);
    const nu = dE / 4.135667696e-15, lam = D.lam[`${nb}-${na}`];
    name = `${otext(...P.a)} + ${otext(...P.b)}<small>${P.label}</small>`;
    f.push(['Energy gap', `${fmt(dE, 3)} eV`], ['Sloshing frequency', `${fmt(nu / 1e15, 3)} × 10¹⁵ per second`], ['One slosh takes', `${fmt(1e15 / nu, 3)} fs`],
      ['Light it sends out', `${fmt(lam[na === 1 ? 0 : 1], 1)} nm${na === 1 ? ' (ultraviolet)' : ''}`], ['Slowed down on screen by', `${fmt(nu / 0.6 / 1e15, 1)} × 10¹⁵`]);
  } else {
    const a = S.atom;
    name = a ? `${oname(a.n, a.l, a.m)}<small>${a.n === 1 ? 'ground state' : 'excited'}</small>` : '';
    if (a){
      f.push(['Energy level', `n = ${a.n}  (${fmt(E_eV(a.n), 2)} eV)`]);
      if (S.next) f.push(['This jump came after', fmtTime(S.next.tau)]);
      if (S.lastJump && S.lastJump.line) f.push(['Last photon', `${fmt(D.lam[S.lastJump.line][1], 1)} nm ${LINE_NAMES[S.lastJump.line] ? '· ' + LINE_NAMES[S.lastJump.line] : ''}`]);
      else if (S.lastJump) f.push(['Last jump', '2s → 1s, two photons at once']);
      f.push(['Photons counted', fmt(S.total, 0)]);
    }
  }
  $('atomName').innerHTML = name;
  $('atomFacts').innerHTML = f.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
}
function fmtTime(s){
  if (s < 1e-6) return `${fmt(s * 1e9, s < 1e-8 ? 2 : 1)} ns`;
  if (s < 1e-3) return `${fmt(s * 1e6, 2)} µs`;
  return `${fmt(s, 3)} s`;
}

// ---------- drawing ----------
let dpr = 1;
function resize(){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  ov.width = cv.width; ov.height = cv.height;
  const sc = $('specCv'), hb = +sc.dataset.h, rr = sc.getBoundingClientRect();
  sc.style.height = hb + 'px'; sc.width = Math.round(rr.width * dpr); sc.height = Math.round(hb * dpr);
  drawSpec();
}
function render(dt){
  let states, B, dotZ = 0, gain = 1;
  if (S.mode === 'orbit'){
    B = V.boxFor(S.n); states = [{ n: S.n, l: S.l, m: S.m, c: [1, 0] }];
  } else if (S.mode === 'mix'){
    const P = PAIRS[S.pair];
    B = V.boxFor(P.b[0]);
    S.t += dt;
    // relative phase advances at the beat frequency, slowed to 0.6 cycles per second
    const ph = 2 * Math.PI * 0.6 * S.t, ca = Math.sqrt(1 - S.mix), cb = Math.sqrt(S.mix);
    states = [{ n: P.a[0], l: P.a[1], m: 0, c: [ca, 0] }, { n: P.b[0], l: P.b[1], m: 0, c: [cb * Math.cos(ph), -cb * Math.sin(ph)] }];
    // dipole ⟨z⟩ = 2 Re(ca* cb e^{-iφ}) <a|z|b>
    const zab = H.radInt(P.b[0], P.b[1], P.a[0], P.a[1]) * (Math.max(P.a[1], P.b[1]) / Math.sqrt((2 * P.a[1] + 1) * (2 * P.b[1] + 1)));
    dotZ = 2 * ca * cb * Math.cos(ph) * zab;
    S.zab = zab;
  } else {
    const a = S.atom || { n: 1, l: 0, m: 0 };
    B = V.boxFor(Math.max(a.n, S.prev ? S.prev.n : 1, 4));
    // a jump: the old cloud fades as the new one appears (the jump itself is instantaneous; this is for the eye)
    if (S.prev && S.fade < 1){
      const f = S.fade;
      states = [{ n: S.prev.n, l: S.prev.l, m: S.prev.m, c: [Math.sqrt(1 - f), 0] }, { n: a.n, l: a.l, m: a.m, c: [Math.sqrt(f), 0] }];
    } else states = [{ n: a.n, l: a.l, m: a.m, c: [1, 0] }];
    // keep the exposure steady while the cloud changes size
    gain = 1;
  }
  V.draw(states, B, gain, dotZ);
  overlay(B, dt);
  // scale bar: 1 Å at the origin's depth
  const p0 = V.project([0, 0, 0], B), p1 = V.project([0, 1 / BOHR_A, 0].map((v, i) => i === 1 ? v : 0), B);
  const ex = [-Math.sin(V.yaw), Math.cos(V.yaw), 0], q = V.project(ex.map(v => v / BOHR_A), B);
  const px = Math.hypot(q[0] - p0[0], q[1] - p0[1]) / dpr;
  const len = [1, 2, 5, 10, 20].find(v => v * px > 46) || 20;
  $('atomScale').style.width = len * px + 'px'; $('atomScale').lastChild.textContent = `${len} Å`;
}
function overlay(B, dt){
  const w = ov.width, h = ov.height;
  octx.clearRect(0, 0, w, h);
  if (S.mode === 'glow'){
    // photons fly out from the nucleus
    const c = V.project([0, 0, 0], B);
    S.photons = S.photons.filter(p => p.r < 1.3);
    for (const p of S.photons){
      p.r += dt * 0.55;
      const R = p.r * Math.max(w, h) * 0.5, x = c[0] + Math.cos(p.a) * R, y = c[1] + Math.sin(p.a) * R;
      const col = lamRGB(p.lam), a = Math.max(0, 1 - p.r / 1.3);
      // a short wave packet: a few wiggles along the direction of travel
      octx.strokeStyle = rgba(col, a); octx.lineWidth = 2 * dpr; octx.beginPath();
      for (let s = -18; s <= 18; s++){
        const u = s * 2.2 * dpr, amp = 6 * dpr * Math.exp(-(s * s) / 90) * Math.sin(s * 0.9);
        const xx = x + Math.cos(p.a) * u - Math.sin(p.a) * amp, yy = y + Math.sin(p.a) * u + Math.cos(p.a) * amp;
        s === -18 ? octx.moveTo(xx, yy) : octx.lineTo(xx, yy);
      }
      octx.stroke();
      octx.fillStyle = rgba(col, a); octx.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
      octx.fillText(`${Math.round(p.lam)} nm`, x + 14 * dpr, y - 10 * dpr);
    }
    levels(w, h);
  }
}
// energy-level diagram (Grotrian): levels by n (height) and shape l (column); the last jump as an arrow
function levels(w, h){
  // levels spaced as 1/n for legibility (the true energies, −13.6/n² eV, crowd together near the top)
  const x0 = 18 * dpr, y0 = 46 * dpr, colW = 17 * dpr, H0 = Math.min(h * 0.55, 380 * dpr);
  const Y = n => y0 + H0 * (1 / n - 1 / 8) / (1 - 1 / 8);
  octx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  octx.fillStyle = 'rgba(230,234,240,0.45)';
  for (let l = 0; l < 8; l++) octx.fillText(LN[l], x0 + l * colW + 2 * dpr, y0 - 10 * dpr);
  for (let n = 1; n <= 8; n++){
    for (let l = 0; l < n; l++){
      const on = S.atom && S.atom.n === n && S.atom.l === l;
      octx.fillStyle = on ? 'rgba(255,196,107,1)' : 'rgba(230,234,240,0.32)';
      octx.fillRect(x0 + l * colW, Y(n) - (on ? 1.5 : 0.5) * dpr, colW - 4 * dpr, on ? 3 * dpr : 1 * dpr);
    }
    if (true){ octx.fillStyle = 'rgba(230,234,240,0.4)'; octx.fillText(`n=${n}`, x0 + 8 * colW + 2 * dpr, Y(n) + 3 * dpr); }
  }
  const J = S.lastJump;
  if (J){
    J.age = (J.age || 0) + 1 / 60;
    const a = Math.max(0, 1 - J.age / 2.5);
    if (a > 0){
      const xa = x0 + J.from.l * colW + colW / 2 - 2 * dpr, ya = Y(J.from.n), xb = x0 + J.to.l * colW + colW / 2 - 2 * dpr, yb = Y(J.to.n);
      const col = J.line ? lamRGB(D.lam[J.line][1]) : [200, 200, 200];
      octx.strokeStyle = rgba(col, a); octx.lineWidth = 1.6 * dpr; octx.beginPath(); octx.moveTo(xa, ya); octx.lineTo(xb, yb); octx.stroke();
      const an = Math.atan2(yb - ya, xb - xa); octx.fillStyle = rgba(col, a); octx.beginPath();
      octx.moveTo(xb, yb); octx.lineTo(xb - 7 * dpr * Math.cos(an - 0.4), yb - 7 * dpr * Math.sin(an - 0.4)); octx.lineTo(xb - 7 * dpr * Math.cos(an + 0.4), yb - 7 * dpr * Math.sin(an + 0.4)); octx.fill();
    }
  }
}
// spectrum: log wavelength axis 90 nm – 8 µm, lines grouped by n → n'
function drawSpec(){
  const sc = $('specCv'), c = sc.getContext('2d'), w = sc.width, h = sc.height;
  c.clearRect(0, 0, w, h);
  const padL = 10 * dpr, padR = 10 * dpr, top = 26 * dpr, bot = 30 * dpr;
  const lo = Math.log10(90), hi = Math.log10(8000), X = nm => padL + (Math.log10(nm) - lo) / (hi - lo) * (w - padL - padR);
  // the visible band as a faint rainbow
  for (let nm = 380; nm < 750; nm += 2){ c.fillStyle = rgba(lamRGB(nm), 0.10); c.fillRect(X(nm), top, X(nm + 2) - X(nm) + 1, h - top - bot); }
  c.font = `${11 * dpr}px "IBM Plex Mono", monospace`; c.fillStyle = 'rgba(155,163,180,0.9)';
  c.fillText('ultraviolet', X(95), top - 9 * dpr); c.fillText('visible', X(400), top - 9 * dpr); c.fillText('infrared', X(900), top - 9 * dpr);
  c.strokeStyle = 'rgba(230,234,240,0.18)'; c.lineWidth = 1; c.beginPath(); c.moveTo(padL, h - bot); c.lineTo(w - padR, h - bot); c.stroke();
  c.fillStyle = 'rgba(104,112,132,1)';
  for (const t of [100, 200, 500, 1000, 2000, 5000]){ const x = X(t); c.fillRect(x, h - bot, 1, 4 * dpr); c.fillText(t >= 1000 ? `${t / 1000} µm` : `${t}`, x - 10 * dpr, h - bot + 16 * dpr); }
  let mx = 0; for (const k in S.counts) mx = Math.max(mx, S.counts[k]);
  const lab = [];
  for (const k in D.lam){
    const lam = D.lam[k][1], n = S.counts[k] || 0, x = X(lam);
    if (x < padL || x > w - padR) continue;
    // faint tick where every line would appear; bright bar for counted photons
    c.fillStyle = 'rgba(230,234,240,0.10)'; c.fillRect(x, h - bot - 6 * dpr, 1, 6 * dpr);
    if (!n) continue;
    const hh = (h - top - bot) * Math.sqrt(n / mx), col = lamRGB(lam);
    c.fillStyle = rgba(col, 0.95); c.fillRect(x - 1 * dpr, h - bot - hh, 2 * dpr, hh);
    if (LINE_NAMES[k] && n / mx > 0.03) lab.push([x, h - bot - hh, LINE_NAMES[k], col]);
  }
  c.font = `${11 * dpr}px "IBM Plex Sans", sans-serif`;
  // label the tallest lines first, skipping any that would collide with one already placed
  lab.sort((a, b) => a[1] - b[1]);
  const placed = [];
  for (const [x, y, t, col] of lab){
    const tw = c.measureText(t).width, ly = Math.max(top + 10 * dpr, y + 10 * dpr);
    if (placed.some(p => x + 4 * dpr < p[0] + p[2] + 6 * dpr && p[0] < x + 4 * dpr + tw + 6 * dpr && Math.abs(p[1] - ly) < 16 * dpr)) continue;
    c.fillStyle = rgba(col, 1); c.fillText(t, x + 4 * dpr, ly); placed.push([x + 4 * dpr, ly, tw]);
  }
  if (!S.total){ c.fillStyle = 'rgba(155,163,180,0.9)'; c.font = `${13 * dpr}px "IBM Plex Sans", sans-serif`; c.fillText('Choose "Glowing hydrogen" above: every photon the atoms give off lands here.', padL + 8 * dpr, top + 40 * dpr); }
}

// ---------- loop, input ----------
let last = performance.now(), specT = 0, factT = 0;
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.visible) return;
  if (!S.drag) V.yaw += dt * 0.12;
  if (S.mode === 'glow') stepGlow(dt);
  render(dt);
  if (now - specT > 250){ drawSpec(); specT = now; }
  if (S.mode === 'glow' && S.tube && now - factT > 500){ facts(); factT = now; }
}
cv.addEventListener('pointerdown', e => { S.drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (!S.drag) return; V.yaw -= (e.clientX - S.drag.x) * 0.008; V.pitch = Math.max(-1.4, Math.min(1.4, V.pitch + (e.clientY - S.drag.y) * 0.008)); S.drag = { x: e.clientX, y: e.clientY }; });
cv.addEventListener('pointerup', () => { S.drag = null; });
new IntersectionObserver(es => es.forEach(e => { S.visible = e.isIntersecting; last = performance.now(); }), { rootMargin: '200px' }).observe(cv);
window.addEventListener('resize', resize);
resize(); buildModes(); setMode('orbit');
requestAnimationFrame(frame);
return { S, setMode, spark, V };
})();
