// The Atmosphere: planet controls, presets, zonal-mean cross-sections, field guide, validation.
(function () {
  'use strict';
  const A = window.ATM, $ = (id) => document.getElementById(id);
  const DAY = 86400, DEG = Math.PI / 180;
  const YEAR_SID = 365.25636 * DAY;           // sidereal year (tidal lock: one turn per orbit)
  const NORB = 2 * Math.PI / YEAR_SID;

  // ---------------- planet controls ----------------
  // day-length slider: sidereal rotation period, log scale, 6 h ... 23.93 h (at 50) ... tidally locked (100)
  const PMIN = 8, PE = 23.934, PMAX = YEAR_SID / 3600;
  const sidPeriod = (v) => v <= 50 ? Math.exp(Math.log(PMIN) + (Math.log(PE) - Math.log(PMIN)) * v / 50) : Math.exp(Math.log(PE) + (Math.log(PMAX) - Math.log(PE)) * (v - 50) / 50);
  const sliderOf = (P) => P <= PE ? 50 * (Math.log(P) - Math.log(PMIN)) / (Math.log(PE) - Math.log(PMIN)) : 50 + 50 * (Math.log(P) - Math.log(PE)) / (Math.log(PMAX) - Math.log(PE));
  function solarDayText(Ph) {
    const om = 2 * Math.PI / (Ph * 3600);
    if (Math.abs(om - NORB) < 1e-9) return 'locked';
    const sd = 2 * Math.PI / (om - NORB) / 3600;
    if (sd < 48) return sd.toFixed(sd < 10 ? 1 : 0) + ' h';
    if (sd < 24 * 400) return (sd / 24).toFixed(sd < 240 ? 1 : 0) + ' days';
    return 'locked';
  }
  const cur = { P: PE, sun: 100, gh: 100, tilt: 23.44, world: 'earth', mld: 50 };
  A.planet = cur;
  function setRot(Ph) {
    const locked = Ph >= PMAX * 0.999;
    const om = locked ? NORB : 2 * Math.PI / (Ph * 3600);
    A.send({ type: 'params', params: { rot: om } }); // the workers ramp the rotation; the page follows their state
    cur.P = Ph;
  }
  function paramsMsg(o) { A.send({ type: 'params', params: o }); }
  function updateOutputs() {
    $('oDay').textContent = solarDayText(cur.P);
    $('oSun').textContent = cur.sun + '%';
    $('oGH').textContent = cur.gh + '%';
    $('oTilt').textContent = (+cur.tilt).toFixed(1) + '°';
  }
  function setSliders() { $('sDay').value = sliderOf(cur.P); $('sSun').value = cur.sun; $('sGH').value = cur.gh; $('sTilt').value = cur.tilt; updateOutputs(); }
  const notes = {
    earth: 'Back to the real Earth: its continents, mountains, 24-hour day and today’s sunshine and greenhouse gases, restarted from the model’s own spun-up weather.',
    aqua: 'A planet covered by ocean. Without continents to disturb them, the storm tracks and jets become almost perfectly symmetric around the pole.',
    flat: 'The continents stay but the mountains are gone. The Rockies and the Himalaya normally bend the jet stream into standing waves; watch the winter weather reorganise.',
    fast: 'An 8-hour day. The Coriolis effect triples, storms shrink, and the single jet stream breaks into several, like the bands on Jupiter.',
    slow: 'A 10-day day. The Coriolis effect is weak, the Hadley cells stretch towards the poles, and days scorch while nights freeze.',
    locked: 'One side always faces the sun, as on many planets around red dwarf stars. A permanent storm sits under the sun, and the air carries heat to the frozen night side.',
    snowball: 'Sunshine turned down by 12 percent. As ice spreads it reflects more sunlight, which cools the planet further: the ice–albedo runaway that froze Earth over 700 million years ago.',
    tilt: 'The axis tipped over onto its side. Each pole now takes turns facing the sun for months at a time, and the hottest place on the planet moves with the seasons.',
    hothouse: 'The greenhouse effect nearly doubled. The poles lose their ice, the air holds far more water, and rain becomes heavier.',
  };
  const PRESET_LABEL = { earth: 'Earth', aqua: 'water world', flat: 'no mountains', fast: '8-hour day', slow: '10-day day', locked: 'tidally locked', snowball: 'less sunshine', hothouse: 'more greenhouse', tilt: 'tilted 90°' };
  function preset(name) {
    EMA.reset = true;
    if (name !== 'earth') A.markHist(PRESET_LABEL[name] || name);
    document.querySelectorAll('#presets .chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.preset === name));
    $('planetNote').textContent = notes[name] || '';
    const fastOcean = ['snowball', 'hothouse'].includes(name);
    if (name === 'earth') {
      Object.assign(cur, { P: PE, sun: 100, gh: 100, tilt: 23.44, world: 'earth', mld: 50 }); A.E.aqua = false;
      A.restart(A.season || 0);
      setSliders(); return;
    }
    let world = cur.world;
    if (name === 'aqua' || name === 'flat') world = name;
    if (['fast', 'slow', 'locked'].includes(name)) world = cur.world === 'aqua' ? 'aqua' : cur.world;
    const p = {};
    if (name === 'fast') setRot(8.0);
    if (name === 'slow') setRot(240);
    if (name === 'locked') setRot(PMAX);
    if (name === 'snowball') { cur.sun = 88; p.S0 = 1361 * 0.88; }
    if (name === 'hothouse') { cur.gh = 190; p.green = 1.9; }
    if (name === 'tilt') { cur.tilt = 90; p.obl = 90; }
    if (fastOcean) { p.mld = name === 'snowball' ? 5 : 8; cur.mld = p.mld; }
    if (world !== cur.world) { cur.world = world; A.E.aqua = world === 'aqua'; A.send({ type: 'reset', world, params: p, run: A.sim.running }); }
    else if (Object.keys(p).length) paramsMsg(p);
    setSliders();
  }
  A.preset = preset;
  A.setupPlanet = function () {
    $('sDay').oninput = () => { const P = sidPeriod(+$('sDay').value); cur.P = P; updateOutputs(); };
    $('sDay').onchange = () => { setRot(sidPeriod(+$('sDay').value)); A.markHist('day ' + solarDayText(cur.P)); };
    $('sSun').onchange = () => A.markHist('sunshine ' + cur.sun + '%');
    $('sGH').onchange = () => A.markHist('greenhouse ' + cur.gh + '%');
    $('sTilt').onchange = () => A.markHist('tilt ' + Math.round(cur.tilt) + '°');
    $('sSun').oninput = () => { EMA.reset = true; cur.sun = +$('sSun').value; updateOutputs(); paramsMsg({ S0: 1361 * cur.sun / 100 }); };
    $('sGH').oninput = () => { EMA.reset = true; cur.gh = +$('sGH').value; updateOutputs(); paramsMsg({ green: cur.gh / 100 }); };
    $('sTilt').oninput = () => { cur.tilt = +$('sTilt').value; A.prm.obl = cur.tilt; updateOutputs(); paramsMsg({ obl: cur.tilt }); };
    document.querySelectorAll('#presets .chip').forEach((b) => b.onclick = () => preset(b.dataset.preset));
    setSliders();
  };

  // ---------------- zonal-mean cross-sections ----------------
  // running averages of zonal-mean u, v, T, RH and latent heating with a ~15-day memory
  const Z = { n: 0, u: null, v: null, T: null, rh: null, q: null, lastT: null };
  A.onZonal = function (zm, t) {
    const L = A.meta.L, nlat = A.nlat, N = L * nlat;
    if (!Z.u || (Z.lastT !== null && t < Z.lastT - 3600)) { Z.u = new Float64Array(N); Z.v = new Float64Array(N); Z.T = new Float64Array(N); Z.rh = new Float64Array(N); Z.q = new Float64Array(N); Z.n = 0; Z.w = 0; }
    const dt = Z.lastT === null ? 3600 : Math.max(0, t - Z.lastT); Z.lastT = t;
    const tau = 15 * DAY, a = Z.w === 0 ? 1 : Math.min(1, dt / tau / Math.max(0.05, 1 - Math.exp(-Z.w / tau)) );
    const al = Z.w === 0 ? 1 : Math.min(1, dt / (Z.w + dt) > dt / tau ? dt / (Z.w + dt) : dt / tau);
    Z.w += dt;
    for (let j = 0; j < nlat; j++) for (let k = 0; k < L; k++) {
      const b = (j * L + k) * 5, o = k * nlat + j;
      Z.u[o] += al * (zm[b] - Z.u[o]); Z.v[o] += al * (zm[b + 1] - Z.v[o]); Z.T[o] += al * (zm[b + 2] - Z.T[o]); Z.rh[o] += al * (zm[b + 3] - Z.rh[o]); Z.q[o] += al * (zm[b + 4] - Z.q[o]);
    }
    Z.n++; Z.dirty = true;
  };
  A.Z = Z;
  let xsecMode = 'wind';
  // colour palettes (value -> [r,g,b])
  const lerp3 = (stops, x) => { x = Math.max(0, Math.min(1, x)); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(x * n)), f = x * n - i, a = stops[i], b = stops[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  const PAL = {
    wind: (u) => u < 0 ? lerp3([[14, 20, 32], [38, 84, 170], [110, 170, 255]], -u / 25) : lerp3([[14, 20, 32], [120, 60, 30], [230, 120, 40], [255, 190, 90], [255, 240, 190]], u / 50),
    temp: (t) => lerp3([[40, 30, 110], [50, 90, 200], [80, 170, 210], [200, 200, 170], [240, 150, 60], [200, 50, 40]], (t + 75) / 105),
    rh: (r) => lerp3([[14, 20, 32], [30, 60, 90], [40, 130, 150], [150, 220, 210]], r / 100),
  };
  function drawXsec() {
    const cv = $('xsec'); if (!cv || !Z.u) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    const L = A.meta.L, nlat = A.nlat, S = A.S, sf = A.sf, sh = A.sh;
    const padL = 52, padR = 14, padT = 14, padB = 30;
    const pw = W - padL - padR, ph = H - padT - padB;
    const XL = (lat) => padL + (lat + 90) / 180 * pw;
    const Y = (sig) => padT + sig * ph;
    const src = xsecMode === 'wind' ? Z.u : xsecMode === 'temp' ? Z.T : Z.rh;
    const off = xsecMode === 'temp' ? -273.15 : 0, sc = xsecMode === 'rh' ? 100 : 1, pal = PAL[xsecMode];
    // latitude (deg, south->north) and sigma of grid centres
    const lats = Array.from(S.lat, (x) => x / DEG).reverse(); // ascending
    const sample = (lat, sig) => {
      let j = 0; while (j < nlat - 2 && lats[j + 1] < lat) j++;
      const fj = Math.max(0, Math.min(1, (lat - lats[j]) / (lats[j + 1] - lats[j])));
      let k = 0; while (k < L - 2 && sf[k + 1] < sig) k++;
      const fk = Math.max(0, Math.min(1, (sig - sf[k]) / (sf[k + 1] - sf[k])));
      const g = (kk, jj) => src[kk * nlat + (nlat - 1 - jj)];
      return ((g(k, j) * (1 - fj) + g(k, j + 1) * fj) * (1 - fk) + (g(k + 1, j) * (1 - fj) + g(k + 1, j + 1) * fj) * fk) * sc + off;
    };
    const iw = Math.round(pw * dpr), ih = Math.round(ph * dpr), img = c.createImageData(iw, ih), d = img.data;
    for (let y = 0; y < ih; y++) {
      const sig = (y + 0.5) / ih;
      for (let x = 0; x < iw; x++) {
        const lat = -90 + (x + 0.5) / iw * 180;
        const [r, g, b] = pal(sample(lat, sig));
        const o = (y * iw + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    c.putImageData(img, Math.round(padL * dpr), Math.round(padT * dpr));
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // meridional overturning streamfunction on half levels, upsampled for smooth contours
    const psi = new Float64Array((L + 1) * nlat);
    for (let j = 0; j < nlat; j++) { let s = 0; for (let k = 0; k < L; k++) { s += Z.v[k * nlat + j] * (sh[k + 1] - sh[k]); psi[(k + 1) * nlat + j] = 2 * Math.PI * 6.371e6 * S.coslat[j] * 1e5 / 9.81 * s / 1e9; } }
    const NX = 180, NY = 60, G = new Float64Array(NX * NY);
    for (let y = 0; y < NY; y++) {
      const sig = y / (NY - 1);
      let k = 0; while (k < L - 1 && sh[k + 1] < sig) k++;
      const fk = (sig - sh[k]) / (sh[k + 1] - sh[k]);
      for (let x = 0; x < NX; x++) {
        const lat = -90 + x / (NX - 1) * 180;
        let j = 0; while (j < nlat - 2 && lats[j + 1] < lat) j++;
        const fj = Math.max(0, Math.min(1, (lat - lats[j]) / (lats[j + 1] - lats[j])));
        const g = (kk, jj) => psi[kk * nlat + (nlat - 1 - jj)];
        G[y * NX + x] = (g(k, j) * (1 - fj) + g(k, j + 1) * fj) * (1 - fk) + (g(k + 1, j) * (1 - fj) + g(k + 1, j + 1) * fj) * fk;
      }
    }
    const gx = (x) => padL + x / (NX - 1) * pw, gy = (y) => padT + y / (NY - 1) * ph;
    c.lineWidth = 1.2;
    for (const lv of [-200, -160, -120, -80, -60, -40, -20, 20, 40, 60, 80, 120, 160, 200]) {
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.setLineDash(lv > 0 ? [] : [4, 3]);
      c.beginPath();
      for (let y = 0; y < NY - 1; y++) for (let x = 0; x < NX - 1; x++) {
        const v = [G[y * NX + x], G[y * NX + x + 1], G[(y + 1) * NX + x + 1], G[(y + 1) * NX + x]];
        const P = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]], pts = [];
        for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a - lv) * (b - lv) < 0) { const f = (lv - a) / (b - a); pts.push([gx(P[e][0] + f * (P[(e + 1) % 4][0] - P[e][0])), gy(P[e][1] + f * (P[(e + 1) % 4][1] - P[e][1]))]); } }
        if (pts.length >= 2) { c.moveTo(pts[0][0], pts[0][1]); c.lineTo(pts[1][0], pts[1][1]); if (pts.length === 4) { c.moveTo(pts[2][0], pts[2][1]); c.lineTo(pts[3][0], pts[3][1]); } }
      }
      c.stroke();
    }
    c.setLineDash([]);
    // axes
    c.fillStyle = 'rgba(230,234,240,0.6)'; c.font = '11px "IBM Plex Mono", monospace'; c.textAlign = 'center';
    for (const la of [-60, -30, 0, 30, 60]) { const x = XL(la); c.fillText(la === 0 ? 'equator' : `${Math.abs(la)}°${la > 0 ? 'N' : 'S'}`, x, H - 10); c.fillRect(x, padT + ph, 1, 4); }
    if (W > 560) { c.fillText('South Pole', padL + 30, H - 10); c.fillText('North Pole', padL + pw - 30, H - 10); }
    c.textAlign = 'right';
    for (const p of [200, 400, 600, 800, 1000]) { const y = Y(p / 1000); c.fillText(p + '', padL - 6, Math.min(y + 4, padT + ph)); }
    c.save(); c.translate(12, padT + ph / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('pressure (hPa) · height →', 0, 0); c.restore();
    if (xsecMode === 'wind') {
      c.textAlign = 'center'; c.font = '500 12px "IBM Plex Sans", sans-serif';
      for (const hemi of [1, -1]) {
        let best = -1e9, bj = 0, bk = 0;
        for (let k = 0; k < L; k++) for (let j = 0; j < nlat; j++) { if (Math.sign(S.lat[j]) !== hemi) continue; const u = Z.u[k * nlat + j]; if (u > best) { best = u; bj = j; bk = k; } }
        const x = XL(S.lat[bj] / DEG), y = Y(sf[bk]);
        c.fillStyle = 'rgba(4,6,10,0.7)'; c.fillRect(x - 40, y + 8, 80, 18); c.fillStyle = '#fff'; c.fillText(`jet ${best.toFixed(0)} m/s`, x, y + 21);
      }
    }
    // cell labels
    if (W < 560) return;
    c.font = 'italic 15px Newsreader, Georgia, serif'; c.fillStyle = 'rgba(255,255,255,0.85)'; c.textAlign = 'center';
    // label the strongest positive and negative cells within the tropics as Hadley cells
    const kmid = Math.round(L * 0.55); let pmx = 0, pla = 0, nmx = 0, nla = 0;
    for (let j = 0; j < nlat; j++) { const la = S.lat[j] / DEG, v = psi[kmid * nlat + j]; if (Math.abs(la) > 35) continue; if (v > pmx) { pmx = v; pla = la; } if (v < nmx) { nmx = v; nla = la; } }
    if (pmx > 20) c.fillText('Hadley cell', XL(pla), Y(0.66));
    if (-nmx > 20 && Math.abs(nla - pla) > 14) c.fillText('Hadley cell', XL(nla), Y(0.66));
    c.fillText('Ferrel cell', XL(50), Y(0.72)); c.fillText('Ferrel cell', XL(-50), Y(0.72));
  }
  A.drawXsec = drawXsec;
  function setupXsec() {
    document.querySelectorAll('#xsecModes .chip').forEach((b) => b.onclick = () => { document.querySelectorAll('#xsecModes .chip').forEach((x) => x.setAttribute('aria-pressed', x === b)); xsecMode = b.dataset.mode; drawXsec(); xsecLegend(); });
    xsecLegend();
  }
  function xsecLegend() {
    const el = $('xsecLegend'); if (!el) return;
    const d = { wind: ['wind', 'linear-gradient(90deg,#6eaaff,#2654aa,#0e1420,#783c1e,#e67828,#ffbe5a,#fff0be)', ['25 m/s from the east', 'calm', '50 m/s from the west']], temp: ['temperature', 'linear-gradient(90deg,#281e6e,#325ac8,#50aad2,#c8c8aa,#f0963c,#c83228)', ['−75 °C', '', '30 °C']], rh: ['relative humidity', 'linear-gradient(90deg,#0e1420,#1e3c5a,#288296,#96dcd2)', ['0%', '', '100%']] }[xsecMode];
    el.innerHTML = `<span><i class="sq" style="width:80px;height:8px;background:${d[1]}"></i>${d[0]}: ${d[2].join(' · ')}</span><span><i style="background:#fff"></i>overturning: solid clockwise, dashed anticlockwise (lines every 20 billion kg of air per second)</span>`;
  }


  // ---------------- field guide ----------------
  function stage() { const el = $('stage'); const r = el.getBoundingClientRect(); if (r.top < -40 || r.top > innerHeight * 0.4) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function layer(n) { const b = document.querySelector(`#layers [data-layer="${n}"]`); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); }
  function overlay(key, on) {
    const b = key === 'wind1' ? document.querySelector('#overlays [data-wind="1"]') : key === 'wind2' ? document.querySelector('#overlays [data-wind="2"]') : document.querySelector(`#overlays [data-key="${key}"]`);
    if (b && (b.getAttribute('aria-pressed') === 'true') !== on) b.click();
  }
  function globe() { if (A.E.view.map) $('mapBtn').click(); }
  function winterHemi() { const d = A.dateOf(A.sim.time).getUTCMonth(); return (d >= 3 && d <= 8) ? -1 : 1; }
  function deepestLow(hemi) {
    const f = A.fields[6], S = A.S, nlon = A.nlon; let b = 1e9, bp = 0;
    for (let j = 0; j < A.nlat; j++) { if (Math.sign(S.lat[j]) !== hemi || Math.abs(S.lat[j]) > 75 * DEG || Math.abs(S.lat[j]) < 20 * DEG) continue; for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (f[p] < b) { b = f[p]; bp = p; } } }
    return [S.lon[bp % nlon], S.lat[Math.floor(bp / nlon)], b + 1000];
  }
  const GUIDE = [
    { where: 'Tropics · 30°N to 30°S', title: 'The trade winds', text: 'Air that sinks around 30° of latitude flows back toward the equator along the surface. The Earth turns beneath it, so it arrives <b>from the northeast</b> in the north and <b>from the southeast</b> in the south. Sailing ships crossed the Atlantic on these winds for centuries.', go() { stage(); globe(); layer(0); overlay('wind1', true); A.flyTo(-35 * DEG, 8 * DEG, 2.6); } },
    { where: 'Near the equator', title: 'The rain belt', text: 'Where the two trade winds meet, moist air is forced upward into towering thunderstorms. This <b>Intertropical Convergence Zone</b> circles the planet and follows the sun north in July and south in January. It brings the monsoon rains.', go() { stage(); globe(); layer(2); overlay('wind1', false); A.flyTo(-150 * DEG, 5 * DEG, 2.9); } },
    { where: 'Around 30°N and 30°S', title: 'Deserts under sinking air', text: 'The air that rose at the equator comes down again near 30°, dried out by the rain it has already dropped. Sinking air warms and stays clear, so this is where the <b>great deserts</b> lie: the Sahara, Arabia, the Kalahari and inland Australia.', go() { stage(); globe(); layer(3); A.flyTo(15 * DEG, 22 * DEG, 2.7); } },
    { where: 'Mid-latitudes', title: 'Storms that spin', text: 'A low-pressure centre pulls air inward, and the Coriolis effect turns it aside: <b>counter-clockwise</b> around lows in the north, clockwise in the south. Each storm lifts warm, moist air over cold air and carries heat toward the pole. This flies you to the deepest storm in the winter hemisphere right now.', go() { stage(); globe(); layer(0); overlay('isobars', true); overlay('wind1', true); const [lo, la] = deepestLow(winterHemi()); A.flyTo(lo, la, 1.9); } },
    { where: 'About 10 km up', title: 'The jet stream', text: 'Where cold polar air meets warm tropical air, the wind high up races eastward at up to <b>70 m/s</b>. The jet meanders in great waves, and the storms below form and travel along it. Airliners flying east ride it and save an hour.', go() { stage(); globe(); layer(0); overlay('wind2', true); A.flyTo(-60 * DEG, 42 * DEG * winterHemi(), 3.3); } },
    { where: 'North Atlantic', title: 'Iceland’s weather', text: 'On weather maps the <b>Icelandic Low</b> looks like a permanent fixture, but it is really an average: storm after storm runs up the Atlantic from Newfoundland and stalls near Iceland. The weather station keeps a 10-day record of pressure, temperature and rain in Reykjavík.', go() { stage(); globe(); layer(0); overlay('isobars', true); $('icelandBtn').click(); } },
    { where: 'Night side of the tropics', title: 'Lightning in the dark', text: 'Over tropical land, storms build through the afternoon and peak after sunset. In the model these are the <b>convective</b> storms, where columns of air overturn faster than the grid can see. On the night side they flicker.', go() { stage(); globe(); layer(0); const si = A.sunInfo(A.sim.time); A.flyTo(si.slon + Math.PI * 0.85, 0, 2.5); } },
    { where: 'Polar regions', title: 'Ice and snow', text: 'The model freezes and melts its own <b>sea ice</b> and lays down snow on land wherever precipitation falls into cold air. Both reflect sunlight, which cools the surface further. Watch the snow line sweep south across Canada and Siberia in the northern autumn.', go() { stage(); globe(); layer(0); A.flyTo(40 * DEG, 72 * DEG * winterHemi(), 2.9); } },
    { where: 'Above the North Pole', title: 'Watch a year go by', text: 'Turn the speed up to full and look down on the Arctic. In autumn the <b>snow line</b> races south across Canada and Siberia and the sea ice thickens; in spring both retreat. A whole simulated year passes in about three minutes.', go() { stage(); globe(); layer(0); const sp = $('speed'); sp.value = 4; sp.oninput(); A.flyTo(-30 * DEG, 88 * DEG, 3.4); } },
    { where: 'The Sahara', title: 'The daily cycle', text: 'Dry sand heats quickly and cools quickly: in the desert the air near the ground can swing by <b>15 °C</b> between dawn and mid-afternoon. The weather station is moved to Tamanrasset in Algeria. Compare it with the sea-level town of Reykjavík, where the ocean holds the temperature steady.', go() { stage(); globe(); layer(1); A.setStation(5.5 * DEG, 22.8 * DEG, 'Tamanrasset'); A.flyTo(5 * DEG, 20 * DEG, 2.4); } },
  ];
  const WORLDS = [
    { k: 'fast', where: 'Day of 8 hours', title: 'A faster spin', text: 'Triple the Coriolis effect and storms shrink. The single jet stream in each hemisphere splits into two or three, and the cross-section sprouts extra cells. This is why the fast-spinning giant planets are striped.' },
    { k: 'slow', where: 'Day of 10 Earth days', title: 'A slower spin', text: 'With little Coriolis effect to stop it, the Hadley cell stretches almost to the pole and the jets weaken. Long days bake the land, and long nights freeze it.' },
    { k: 'locked', where: 'One face to the sun', title: 'Tidally locked', text: 'Many planets around red dwarf stars keep one face to their sun. A permanent storm boils up beneath the sun, and the winds carry heat around to the eternal night side.' },
    { k: 'aqua', where: 'No continents', title: 'Water world', text: 'Without land every longitude looks alike, and the climate becomes almost perfectly symmetric. Here the storm tracks and the rain belt are clearest.' },
    { k: 'flat', where: 'Continents without mountains', title: 'No mountains', text: 'The Rockies and the Tibetan Plateau force the northern jet stream into standing waves that shape winter weather. Take them away and the flow grows much more even.' },
    { k: 'snowball', where: '12 percent less sunshine', title: 'Snowball Earth', text: 'Ice reflects sunlight, so a little cooling spreads ice, which cools the planet further. Earth froze over like this more than once, 700 to 640 million years ago. <b>The ocean is made shallow</b> so this takes minutes rather than decades.' },
    { k: 'tilt', where: 'Axis tilted 90°', title: 'Tilted on its side', text: 'Uranus spins lying on its side. Here each pole gets months of midnight sun, then months of darkness, and the seasons outweigh the difference between the equator and the poles.' },
    { k: 'hothouse', where: 'Greenhouse effect × 1.9', title: 'Hothouse', text: 'Trap more heat and the ice retreats, the air holds more water vapour, and rain falls harder. The ocean is made shallow here too, so the planet warms quickly.' },
  ];
  WORLDS.push({ k: 'earth', where: 'Today\u2019s Earth', title: 'Back to Earth', text: 'Restore the real planet: its continents and mountains, a 24-hour day, a 23.4° tilt and today\u2019s sunshine and greenhouse gases, restarted from the model\u2019s own spun-up weather.' });
  function cards(host, list, isWorld) {
    const el = $(host); if (!el) return;
    el.innerHTML = list.map((g, i) => `<article class="entry"><div class="where">${g.where}</div><h3>${g.title}</h3><p>${g.text}</p><button class="show" data-i="${i}">${isWorld ? 'Try it' : 'Show me'} →</button></article>`).join('');
    el.querySelectorAll('.show').forEach((b) => b.onclick = () => { const g = list[+b.dataset.i]; if (isWorld) { stage(); A.preset(g.k); } else g.go(); });
  }

  // ---------------- live comparison with Earth ----------------
  const EMA = { n: 0, t2: 0, P: 0, pw: 0, slp: null, ice: [0, 0], lastT: null };
  A.onStats = function (t, F) {
    histSample(t, F);
    const S = A.S, nlat = A.nlat, nlon = A.nlon, nG = nlat * nlon;
    if ((EMA.lastT !== null && t < EMA.lastT - 3600) || EMA.reset) { EMA.n = 0; EMA.slp = null; EMA.t0 = t; EMA.reset = false; }
    if (EMA.t0 === undefined) EMA.t0 = t;
    const dt = EMA.lastT === null ? 3600 : Math.max(0, t - EMA.lastT); EMA.lastT = t;
    const al = EMA.n === 0 ? 1 : Math.min(1, dt / (20 * DAY));
    let sw = 0, P = 0, iceN = 0, iceS = 0;
    for (let j = 0; j < nlat; j++) for (let i = 0; i < nlon; i++) { const p = j * nlon + i, w = S.w[j]; sw += w; P += w * F[4][p]; if (F[8][p] > 0.05) { if (S.lat[j] > 0) iceN += w; else iceS += w; } }
    const cellA = 510.07 / (2 * nlon); // million km2 per unit Gaussian weight per longitude cell
    EMA.t2 += al * (A.hud.t2 - EMA.t2); EMA.P += al * (P / sw * 24 - EMA.P); EMA.pw += al * (A.hud.pw - EMA.pw);
    EMA.ice[0] += al * (iceN * cellA - EMA.ice[0]); EMA.ice[1] += al * (iceS * cellA - EMA.ice[1]);
    if (!EMA.slp) EMA.slp = Float32Array.from(F[6]); else for (let p = 0; p < nG; p++) EMA.slp[p] += al * (F[6][p] - EMA.slp[p]);
    EMA.n++;
  };
  // ---------------- experiment history (daily global means) ----------------
  const HIST = { pts: [], marks: [], lastDay: null };
  A.hist = HIST;
  function histSample(t, F) {
    const day = Math.floor(t / DAY);
    if (HIST.lastDay !== null && t < (HIST.pts.length ? HIST.pts[HIST.pts.length - 1].t : t) - 3600) { HIST.pts = []; HIST.marks = []; HIST.lastDay = null; }
    if (day === HIST.lastDay) return;
    HIST.lastDay = day;
    const S = A.S, nlon = A.nlon; let si = 0;
    for (let j = 0; j < A.nlat; j++) for (let i = 0; i < nlon; i++) if (F[8][j * nlon + i] > 0.05) si += S.w[j];
    HIST.pts.push({ t, T: A.hud.t2, ice: si * 510.07 / (2 * nlon) });
    if (HIST.pts.length > 3000) HIST.pts.splice(0, HIST.pts.length - 3000);
    HIST.dirty = true;
  }
  A.onRestart = () => { HIST.pts = []; HIST.marks = []; HIST.lastDay = null; HIST.dirty = true; EMA.reset = true; Z.u = null; Z.lastT = null; };
  A.markHist = (label) => { HIST.marks.push({ t: A.sim.time, label }); HIST.dirty = true; };
  function drawHist() {
    const cv = $('expChart'); if (!cv || HIST.pts.length < 2) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const P = HIST.pts, t0 = P[0].t, t1 = Math.max(P[P.length - 1].t, t0 + 30 * DAY);
    let Tmin = 1e9, Tmax = -1e9, Imax = 1;
    for (const p of P) { Tmin = Math.min(Tmin, p.T); Tmax = Math.max(Tmax, p.T); Imax = Math.max(Imax, p.ice); }
    const tc = (Tmin + Tmax) / 2, ts = Math.max(4, (Tmax - Tmin) * 1.2);
    const pl = 40, pr = 44, pt = 10, pb = 22, w = W - pl - pr, h = H - pt - pb;
    const X = (t) => pl + (t - t0) / (t1 - t0) * w, YT = (T) => pt + (0.5 - (T - tc) / ts) * h, YI = (I) => pt + (1 - I / (Imax * 1.15)) * h;
    c.font = '11px "IBM Plex Mono", monospace';
    c.strokeStyle = 'rgba(230,234,240,0.08)'; c.fillStyle = 'rgba(230,234,240,0.45)';
    const span = (t1 - t0) / DAY, stepD = span > 700 ? 180 : span > 250 ? 60 : span > 90 ? 30 : 10;
    c.textAlign = 'center';
    for (let d = 0; d <= span; d += stepD) { const x = X(t0 + d * DAY); c.beginPath(); c.moveTo(x, pt); c.lineTo(x, pt + h); c.stroke(); c.fillText('day ' + d, x, H - 6); }
    c.textAlign = 'right'; c.fillStyle = '#ff9d5c';
    for (const T of [tc - ts * 0.4, tc, tc + ts * 0.4]) c.fillText(T.toFixed(1) + '°', pl - 4, YT(T) + 4);
    c.textAlign = 'left'; c.fillStyle = '#8fc3ec';
    for (const I of [0, Imax * 0.5, Imax]) c.fillText(I.toFixed(0), W - pr + 4, YI(I) + 4);
    const line = (key, Y, col) => { c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); P.forEach((p, i) => { const x = X(p.t), y = Y(p[key]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); };
    line('ice', YI, '#8fc3ec'); line('T', YT, '#ff9d5c');
    c.font = '12px "IBM Plex Sans", sans-serif';
    for (const m of HIST.marks) { if (m.t < t0) continue; const x = X(m.t); c.strokeStyle = 'rgba(255,196,107,0.7)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, pt); c.lineTo(x, pt + h); c.stroke(); c.setLineDash([]); c.fillStyle = '#ffc46b'; c.textAlign = x > W - 120 ? 'right' : 'left'; c.fillText(m.label, x + (x > W - 120 ? -4 : 4), pt + 12); }
  }
  function boxExt(f, la0, la1, lo0, lo1, max) {
    const S = A.S, nlon = A.nlon; let b = max ? -1e9 : 1e9;
    for (let j = 0; j < A.nlat; j++) { const la = S.lat[j] / DEG; if (la < la0 || la > la1) continue; for (let i = 0; i < nlon; i++) { let lo = S.lon[i] / DEG; if (lo > 180) lo -= 360; if (lo < lo0 || lo > lo1) continue; const v = f[j * nlon + i]; if (max ? v > b : v < b) b = v; } }
    return b + 1000;
  }
  // monthly climatology references (approximate; 20th-century NOAA global mean + recent warming, ERA5/GPCP)
  const T_OBS = [12.9, 13.1, 13.7, 14.7, 15.7, 16.4, 16.7, 16.5, 15.9, 14.9, 13.9, 13.2];
  function jetStats() {
    const Z = A.Z; if (!Z.u) return null; const L = A.meta.L, nlat = A.nlat, S = A.S, sh = A.sh;
    const out = {};
    for (const h of [1, -1]) { let b = -1e9, bj = 0; for (let k = 0; k < L; k++) for (let j = 0; j < nlat; j++) { if (Math.sign(S.lat[j]) !== h) continue; const u = Z.u[k * nlat + j]; if (u > b) { b = u; bj = j; } } out[h] = [b, S.lat[bj] / DEG]; }
    // Hadley: max |psi| within 30 degrees of the equator
    let hmax = 0;
    for (let j = 0; j < nlat; j++) { if (Math.abs(S.lat[j]) > 30 * DEG) continue; let s = 0; for (let k = 0; k < L; k++) { s += Z.v[k * nlat + j] * (sh[k + 1] - sh[k]); const psi = 2 * Math.PI * 6.371e6 * S.coslat[j] * 1e5 / 9.81 * s / 1e9; if (Math.abs(psi) > hmax) hmax = Math.abs(psi); } }
    // trades: mean surface zonal wind between 15S and 15N
    let tr = 0, tw = 0; for (let j = 0; j < nlat; j++) if (Math.abs(S.lat[j]) < 15 * DEG) { tr += S.w[j] * Z.u[(L - 1) * nlat + j]; tw += S.w[j]; }
    out.hadley = hmax; out.trades = tr / tw;
    return out;
  }
  function updateNumbers() {
    const js = jetStats(); const mo = A.dateOf(A.sim.time).getUTCMonth();
    if (js) {
      $('kJetN').textContent = `${js[1][0].toFixed(0)} m/s · ${js[1][1].toFixed(0)}°N`;
      $('kJetS').textContent = `${js[-1][0].toFixed(0)} m/s · ${Math.abs(js[-1][1]).toFixed(0)}°S`;
      $('kHadley').textContent = js.hadley.toFixed(0);
      $('kTrades').textContent = `${Math.abs(js.trades).toFixed(1)} m/s ${js.trades < 0 ? 'from the east' : 'from the west'}`;
    }
    const tb = document.querySelector('#cmpTable tbody'); if (!tb || !EMA.n) return;
    const span = (A.sim.time - EMA.t0) / DAY;
    if (span < 5) { tb.innerHTML = `<tr><td colspan="3">Averaging the model's weather… ${Math.max(0, span).toFixed(1)} of 5 simulated days</td></tr>`; return; }
    const nh = mo >= 11 || mo <= 2 ? 'win' : mo >= 5 && mo <= 7 ? 'sum' : 'mid';
    const rows = [
      ['World average air temperature', EMA.t2.toFixed(1) + ' °C', T_OBS[mo].toFixed(1) + ' °C', 'this month, 2014–2023'],
      ['Average rain and snow', EMA.P.toFixed(2) + ' mm/day', '2.7 mm/day', 'GPCP, world average'],
      ['Water vapour overhead', EMA.pw.toFixed(1) + ' mm', '25 mm', 'if it all fell as rain'],
      ['Northern jet stream', js ? `${js[1][0].toFixed(0)} m/s at ${js[1][1].toFixed(0)}°N` : '—', nh === 'win' ? '40 m/s at 30°N' : nh === 'sum' ? '22 m/s at 43°N' : '30 m/s at 38°N', 'zonal average, ~200 hPa'],
      ['Southern jet stream', js ? `${js[-1][0].toFixed(0)} m/s at ${Math.abs(js[-1][1]).toFixed(0)}°S` : '—', nh === 'sum' ? '35 m/s at 30°S' : '28 m/s at 42°S', 'zonal average'],
      ['Hadley cell strength', js ? `${js.hadley.toFixed(0)} × 10⁹ kg/s` : '—', nh === 'mid' ? '~120 × 10⁹ kg/s' : '~200 × 10⁹ kg/s', 'winter-hemisphere cell'],
      ['Trade winds, 15°S–15°N', js ? `${Math.abs(js.trades).toFixed(1)} m/s` : '—', '~5 m/s from the east', 'zonal-mean surface wind'],
      ['Icelandic Low', EMA.slp ? boxExt(EMA.slp, 50, 72, -50, 0, false).toFixed(0) + ' hPa' : '—', nh === 'win' ? '~997 hPa' : nh === 'sum' ? '~1009 hPa' : '~1004 hPa', 'monthly-mean sea-level pressure'],
      ['Azores High', EMA.slp ? boxExt(EMA.slp, 25, 45, -50, -10, true).toFixed(0) + ' hPa' : '—', nh === 'sum' ? '~1025 hPa' : '~1022 hPa', 'monthly-mean sea-level pressure'],
      ['Arctic sea ice', EMA.ice[0].toFixed(1) + ' million km²', ['13.8', '14.6', '14.9', '14.2', '12.8', '11.2', '8.4', '5.9', '4.9', '6.9', '9.9', '12.1'][mo] + ' million km²', 'extent this month, 2014–2023'],
      ['Antarctic sea ice', EMA.ice[1].toFixed(1) + ' million km²', ['5.3', '2.9', '3.9', '6.9', '10.3', '13.6', '16.1', '17.8', '18.4', '17.9', '15.3', '10.1'][mo] + ' million km²', 'extent this month, 2014–2023'],
    ];
    tb.innerHTML = rows.map((r) => `<tr><td>${r[0]}<span class="why">${r[3]}</span></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  }

  // ---------------- frame hook ----------------
  let lastDraw = 0;
  let lastNum = 0;
  A.onFrame = function (now) {
    if (now - lastDraw > 1000 && Z.dirty) { lastDraw = now; Z.dirty = false; drawXsec(); }
    if (now - lastNum > 2000) { lastNum = now; updateNumbers(); }
    if (HIST.dirty && now - (HIST.drawn || 0) > 1000) { HIST.drawn = now; HIST.dirty = false; drawHist(); }
  };

  // ---------------- init once the model grid is known ----------------
  const wait = setInterval(() => {
    if (!A.meta || !A.S) return;
    clearInterval(wait);
    // sigma levels (same formula as model.js)
    const L = A.meta.L, sh = [], sf = [];
    for (let k = 0; k <= L; k++) { const s = k / L; sh.push(0.5 * (s + (1 - Math.cos(Math.PI * s)) / 2)); }
    for (let k = 0; k < L; k++) { const ds = sh[k + 1] - sh[k]; sf.push(k === 0 ? sh[1] / 2 : sh[k + 1] * Math.exp(-(1 - sh[k] / ds * Math.log(sh[k + 1] / sh[k])))); }
    A.sh = sh; A.sf = sf;
    setupXsec();
    cards('guide', GUIDE, false); cards('worldCards', WORLDS, true);
    if ($('howCores')) $('howCores').textContent = (A.sim.W || 'several') + '';
  }, 50);
})();
