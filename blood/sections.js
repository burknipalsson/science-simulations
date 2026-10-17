// Sections below the stage: "show me" buttons and the Fåhræus–Lindqvist chart.
(() => {
  document.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => {
    if (window.bloodShow) window.bloodShow(b.dataset.show, b.dataset.knobs ? JSON.parse(b.dataset.knobs) : null);
  }));
  document.querySelectorAll('[data-fine]').forEach(b => b.addEventListener('click', () => { if (window.bloodFine) window.bloodFine(); }));

  const cv = document.getElementById('chartThin'); if (!cv) return;
  const C = { hd45: '#e0603e', hd22: '#3a8fd4', ink: '#e6eaf0', muted: '#9ba3b4', faint: '#687084', line: 'rgba(230,234,240,0.12)', surface: '#090c13' };
  // simulated points (tube diameter µm, relative apparent viscosity, discharge haematocrit, grid)
  const PTS = [
    { D: 10, eta: 1.21, HD: 0.229, fine: true }, { D: 20, eta: 1.19, HD: 0.211, fine: true }, { D: 20, eta: 1.35, HD: 0.26, fine: true },
    { D: 20, eta: 1.46, HD: 0.26, fine: false }, { D: 30, eta: 1.59, HD: 0.244, fine: false },
  ];
  const Dmin = 5, Dmax = 300, ymin = 1, ymax = 3.2;
  let hover = null, geo = null;
  const tip = document.createElement('div');
  Object.assign(tip.style, { position: 'absolute', pointerEvents: 'none', background: 'rgba(4,6,10,0.92)', border: '1px solid rgba(230,234,240,0.24)', borderRadius: '4px', padding: '6px 9px', font: '12px/1.45 "IBM Plex Mono", monospace', color: C.ink, display: 'none', whiteSpace: 'nowrap', zIndex: 2 });
  cv.parentElement.style.position = 'relative'; cv.parentElement.appendChild(tip);

  function draw() {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = +cv.dataset.h;
    cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const L = 40, R = 12, T = 10, B = 30, pw = W - L - R, ph = H - T - B;
    const X = D => L + pw * Math.log(D / Dmin) / Math.log(Dmax / Dmin), Y = e => T + ph * (1 - (e - ymin) / (ymax - ymin));
    geo = { L, R, T, B, pw, ph, X, Y, W, H };
    g.font = '11px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    // grid and axes (recessive)
    g.strokeStyle = C.line; g.lineWidth = 1; g.fillStyle = C.faint;
    for (let e = 1; e <= ymax + 1e-9; e += 0.5) { g.beginPath(); g.moveTo(L, Y(e)); g.lineTo(W - R, Y(e)); g.stroke(); g.textAlign = 'right'; g.fillText(e.toFixed(1) + '×', L - 6, Y(e)); }
    g.textAlign = 'center';
    for (const D of [5, 10, 20, 50, 100, 200]) { g.beginPath(); g.moveTo(X(D), T); g.lineTo(X(D), T + ph); g.stroke(); g.fillText(D + ' µm', X(D), H - 12); }
    // experimental fits
    const curve = (HD, col) => {
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i <= 200; i++) { const D = Dmin * Math.pow(Dmax / Dmin, i / 200), y = Y(Math.min(ymax, priesEta(D, HD))); i ? g.lineTo(X(D), y) : g.moveTo(X(D), y); }
      g.stroke();
    };
    curve(0.45, C.hd45); curve(0.22, C.hd22);
    // direct labels on the curves
    g.textAlign = 'left'; g.fillStyle = C.muted;
    g.textAlign = 'right'; g.fillText('45% cells', X(90) - 8, Y(priesEta(90, 0.45)) - 4); g.fillText('22%', X(90) - 6, Y(priesEta(90, 0.22)) - 12);
    // simulated points, with a surface ring so they read over the curves
    for (const p of PTS) {
      const x = X(p.D), y = Y(p.eta);
      g.beginPath(); g.arc(x, y, 6, 0, 2 * Math.PI); g.fillStyle = C.surface; g.fill();
      g.beginPath(); g.arc(x, y, 4.5, 0, 2 * Math.PI);
      if (p.fine) { g.fillStyle = C.ink; g.fill(); } else { g.strokeStyle = C.ink; g.lineWidth = 1.5; g.stroke(); }
    }
    if (hover && hover.type === 'x') {
      g.strokeStyle = 'rgba(230,234,240,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(hover.D), T); g.lineTo(X(hover.D), T + ph); g.stroke();
      for (const [HD, col] of [[0.45, C.hd45], [0.22, C.hd22]]) { const e = priesEta(hover.D, HD); if (e > ymax) continue; g.beginPath(); g.arc(X(hover.D), Y(e), 4, 0, 2 * Math.PI); g.fillStyle = col; g.fill(); g.strokeStyle = C.surface; g.lineWidth = 2; g.stroke(); }
    }
  }
  function onMove(ev) {
    if (!geo) return;
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const near = PTS.map(p => ({ p, d: Math.hypot(geo.X(p.D) - mx, geo.Y(p.eta) - my) })).sort((a, b) => a.d - b.d)[0];
    let html = '';
    if (near.d < 14) {
      const p = near.p; hover = { type: 'p' };
      html = `<b>${p.D} µm tube</b> · ${(p.HD * 100).toFixed(0)}% cells leaving<br>simulation (${p.fine ? '0.25' : '0.5'} µm grid): ${p.eta.toFixed(2)}×<br>glass tubes, same cells: ${priesEta(p.D, p.HD).toFixed(2)}×`;
    } else if (mx > geo.L && mx < geo.W - geo.R && my > geo.T && my < geo.T + geo.ph) {
      const D = Dmin * Math.pow(Dmax / Dmin, (mx - geo.L) / geo.pw); hover = { type: 'x', D };
      html = `<b>${D < 20 ? D.toFixed(1) : D.toFixed(0)} µm</b><br><span style="color:${C.hd45}">●</span> 45% cells: ${priesEta(D, 0.45).toFixed(2)}×<br><span style="color:${C.hd22}">●</span> 22% cells: ${priesEta(D, 0.22).toFixed(2)}×`;
    } else hover = null;
    draw();
    if (html) { tip.innerHTML = html; tip.style.display = 'block'; const tw = tip.offsetWidth; tip.style.left = Math.min(cv.offsetLeft + mx + 14, cv.offsetLeft + geo.W - tw) + 'px'; tip.style.top = (cv.offsetTop + my + 14) + 'px'; }
    else tip.style.display = 'none';
  }
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerleave', () => { hover = null; tip.style.display = 'none'; draw(); });
  new ResizeObserver(draw).observe(cv);
  draw();
})();
