// H₂⁺, the simplest chemical bond: exact bonding (1sσg) and antibonding (2pσu) clouds for any proton
// spacing, the exact potential curves, and the electron hopping between the protons.
const BOND = (() => {
const $ = id => document.getElementById(id);
const cv = $('bondCv'); if (!cv) return null;
const V = AtomView(cv); if (!V) return null;
const D = BOND_DATA, HA = 27.211386, BA = 0.529177; // eV/Hartree, Å/bohr
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const S = { mode: 'g', R: 1.06 / BA, t: 0, g: null, u: null, texG: null, texU: null, B: 10, visible: false, drag: null, pend: 0 };
const MODES = {
  g: { label: 'Bonding', cap: 'The <b>bonding orbital</b>: the electron\'s wave has the same sign around both protons, so the two halves add up in the middle. The extra charge between the protons pulls both of them inward. At <b>1.06 Å</b> the pull and the protons\' repulsion balance: that is the bond length.' },
  u: { label: 'Antibonding', cap: 'The <b>antibonding orbital</b>: the wave has opposite signs on the two protons and cancels exactly in the middle, a node where the electron is never found. With no glue between them the protons push apart at every spacing. Exciting the electron into this state breaks the molecule.' },
  hop: { label: 'Electron hopping', cap: 'Put the electron on <b>one proton</b>. That is not a stationary state but an even mix of bonding and antibonding, and their slightly different energies make the electron <b>tunnel back and forth</b>. Close together it flips in a fraction of a femtosecond; pull the protons apart and the hop slows exponentially.' },
};
function solve(){
  S.B = S.R / 2 + 7.5;
  S.g = H2p.wavefunction(S.R, 0); S.u = H2p.wavefunction(S.R, 1);
  const pk = w => { let mx = 0, my = 0; for (const v of w.X) mx = Math.max(mx, Math.abs(v)); for (const v of w.Y) my = Math.max(my, Math.abs(v)); return (mx * my) ** 2; };
  S.pkG = pk(S.g); S.pkU = pk(S.u);
  S.texG = V.fieldH2(S.g, S.B, S.texG); S.texU = V.fieldH2(S.u, S.B, S.texU);
  facts(); drawChart();
}
function facts(){
  const R = S.R, Eg = S.g.E, Eu = S.u.E, dE = Eu - Eg;
  const bind = (Eg + 0.5) * HA;
  const f = [['Proton spacing', `${fmt(R * BA, 2)} Å`],
    ['Bonding energy here', `${fmt(bind, 2)} eV`],
    ['Antibonding energy here', `${fmt((Eu + 0.5) * HA, 2)} eV`]];
  // the hop: half a beat period between the two states
  const hop = Math.PI / dE * 0.02418884; // fs
  f.push(['Electron hops across every', hop < 1000 ? `${fmt(hop, hop < 1 ? 3 : 1)} fs` : hop < 1e6 ? `${fmt(hop / 1000, 1)} ps` : `${fmt(hop / 1e6, 1)} ns`]);
  f.push(['Energy to break the bond', `${fmt(-(D.vib[0] + 0.5) * HA, 3)} eV (measured 2.651)`]);
  $('bondFacts').innerHTML = f.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('bondName').innerHTML = `${fmt(R * BA, 2)} Å<small>${S.mode === 'g' ? 'bonding' : S.mode === 'u' ? 'antibonding' : 'hopping'}</small>`;
}
let dpr = 1;
function resize(){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const c = $('bondChart'), hb = +c.dataset.h, rr = c.getBoundingClientRect();
  c.style.height = hb + 'px'; c.width = Math.round(rr.width * dpr); c.height = Math.round(hb * dpr);
  drawChart();
}
function drawChart(){
  const c = $('bondChart'), x = c.getContext('2d'), w = c.width, h = c.height;
  if (!w || !S.g) return;
  x.clearRect(0, 0, w, h);
  const pl = 34 * dpr, pr = 10 * dpr, pt = 10 * dpr, pb = 26 * dpr;
  const R0 = 0.3, R1 = 4.2, E0 = -3.2, E1 = 4;
  const X = r => pl + (r - R0) / (R1 - R0) * (w - pl - pr), Y = e => pt + (E1 - e) / (E1 - E0) * (h - pt - pb);
  x.font = `${11 * dpr}px "IBM Plex Mono", monospace`; x.fillStyle = 'rgba(104,112,132,1)';
  for (let e = -3; e <= 4; e++){ x.strokeStyle = e === 0 ? 'rgba(230,234,240,0.22)' : 'rgba(230,234,240,0.06)'; x.beginPath(); x.moveTo(pl, Y(e)); x.lineTo(w - pr, Y(e)); x.stroke(); if (e % 1 === 0) x.fillText(String(e), 6 * dpr, Y(e) + 4 * dpr); }
  for (let r = 0.5; r <= 4; r += 0.5) x.fillText(r % 1 ? '' : `${r} Å`, X(r) - 10 * dpr, h - 8 * dpr);
  const curve = (arr, col) => {
    x.strokeStyle = col; x.lineWidth = 1.8 * dpr; x.beginPath(); let first = true;
    D.R.forEach((rb, i) => { const r = rb * BA, e = (arr[i] + 0.5) * HA; if (r < R0 || r > R1) return; const y = Y(Math.min(E1 + 1, e)); first ? x.moveTo(X(r), y) : x.lineTo(X(r), y); first = false; });
    x.stroke();
  };
  curve(D.Eg, 'rgba(255,196,107,0.95)'); curve(D.Eu, 'rgba(143,195,236,0.95)');
  // lowest vibrational level: between the classical turning points on the bonding curve
  const ev0 = (D.vib[0] + 0.5) * HA; let ra = null, rb = null;
  D.R.forEach((r, i) => { const e = (D.Eg[i] + 0.5) * HA; if (e <= ev0){ if (ra == null) ra = r; rb = r; } });
  x.strokeStyle = 'rgba(143,211,168,0.95)'; x.lineWidth = 1.5 * dpr; x.beginPath(); x.moveTo(X(ra * BA), Y(ev0)); x.lineTo(X(rb * BA), Y(ev0)); x.stroke();
  x.fillStyle = 'rgba(143,211,168,0.95)'; x.fillText('lowest vibration: 2.65 eV to break', X(ra * BA) + 2 * dpr, Y(ev0) + 16 * dpr);
  // current spacing
  const r = S.R * BA;
  x.strokeStyle = 'rgba(230,234,240,0.3)'; x.setLineDash([3 * dpr, 4 * dpr]); x.beginPath(); x.moveTo(X(r), pt); x.lineTo(X(r), h - pb); x.stroke(); x.setLineDash([]);
  for (const [E, col] of [[S.g.E, '#ffc46b'], [S.u.E, '#8fc3ec']]){ const e = (E + 0.5) * HA; if (e > E1) continue; x.fillStyle = col; x.beginPath(); x.arc(X(r), Y(e), 4.5 * dpr, 0, 6.2832); x.fill(); }
}
function render(dt){
  let states;
  if (S.mode === 'g') states = [{ tex: S.texG, pk: S.pkG, c: [1, 0] }];
  else if (S.mode === 'u') states = [{ tex: S.texU, pk: S.pkU, c: [1, 0] }];
  else {
    // ψ = (g + e^{−iΔE t} u)/√2, one hop shown every 2.5 s whatever the real speed
    S.t += dt;
    const ph = Math.PI * S.t / 2.5, s = Math.SQRT1_2;
    states = [{ tex: S.texG, pk: S.pkG, c: [s, 0] }, { tex: S.texU, pk: Math.max(S.pkG, S.pkU), c: [s * Math.cos(ph), -s * Math.sin(ph)] }];
  }
  // exposure: the density peaks in a sharp cusp at each proton, so lift the bulk of the cloud
  V.draw(states, S.B, S.mode === 'hop' ? 2.2 : 3, 0, [[0, 0, S.R / 2], [0, 0, -S.R / 2]]);
  const p0 = V.project([0, 0, 0], S.B), q = V.project([-Math.sin(V.yaw) / BA, Math.cos(V.yaw) / BA, 0], S.B);
  $('bondScale').style.width = Math.hypot(q[0] - p0[0], q[1] - p0[1]) / dpr + 'px';
}
function setMode(k){
  S.mode = k; S.t = 0;
  const box = $('bondModes'); box.innerHTML = '';
  for (const m in MODES){ const b = document.createElement('button'); b.className = 'chip'; b.textContent = MODES[m].label; b.setAttribute('aria-pressed', m === k ? 'true' : 'false'); b.onclick = () => setMode(m); box.appendChild(b); }
  $('bondCap').innerHTML = MODES[k].cap;
  if (S.g) facts();
}
const rIn = $('bondR');
const rLab = () => { $('bondRo').textContent = `${fmt(+rIn.value, 2)} Å`; };
rIn.oninput = () => { rLab(); clearTimeout(S.pend); S.pend = setTimeout(() => { S.R = +rIn.value / BA; solve(); }, 40); };
rLab();
let last = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.visible) return;
  if (!S.drag) V.yaw += dt * 0.1;
  render(dt);
}
cv.addEventListener('pointerdown', e => { S.drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (!S.drag) return; V.yaw -= (e.clientX - S.drag.x) * 0.008; V.pitch = Math.max(-1.4, Math.min(1.4, V.pitch + (e.clientY - S.drag.y) * 0.008)); S.drag = { x: e.clientX, y: e.clientY }; });
cv.addEventListener('pointerup', () => { S.drag = null; });
new IntersectionObserver(es => es.forEach(e => { S.visible = e.isIntersecting; last = performance.now(); }), { rootMargin: '200px' }).observe(cv);
window.addEventListener('resize', resize);
V.pitch = 0.12; V.dist = 2.1;
setMode('g'); resize(); solve();
requestAnimationFrame(frame);
return { S, setMode };
})();
