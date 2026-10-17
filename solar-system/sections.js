/* The Clockwork: the sections below the main view. Eclipses, Mercury's perihelion, the asteroid belt and
   the resonance lab, the live model checks and the catalogue. Uses window.CW from app.js. */
(() => {
  const $ = id => document.getElementById(id);
  const CW = window.CW, P = CW.P, eph = CW.eph, AU = P.AU_KM, DEG = Math.PI / 180;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w: r.width, h: r.height, d };
  }
  // Grow the ephemeris to cover [a, b] without freezing the page.
  function ensure(a, b, onProgress) {
    return new Promise(res => {
      const step = () => {
        if (eph.growTo(Math.min(a, 0), Math.max(b, 0), 40)) return res();
        if (onProgress) onProgress(a < eph.lo ? eph.lo : eph.hi);
        setTimeout(step, 0);
      };
      step();
    });
  }
  const yearLabel = t => CW.yearStr(CW.calUT(t).year);

  /* ================================================================
     Eclipses
     ================================================================ */
  const globeCv = $('globe'), lunarCv = $('lunar');
  let globe = null;
  const ggl = globeCv.getContext('webgl2', { antialias: true });
  if (ggl) { try { globe = GlobeGL(ggl, { day: DATA.texDay, night: DATA.texNight }); } catch (e) { console.error(e); } }
  const FAMOUS = [
    { label: '585 BC · 28 May', y: -584, m: 5, d: 28, kind: 'solar', title: 'The eclipse of Thales', note: 'Herodotus says Thales of Miletus foretold it, and that it stopped a battle between the Lydians and the Medes, who made peace. Ancient eclipses depend on ΔT, the slow braking of Earth’s spin: without it this path would fall in the wrong continent.' },
    { label: '1504 · 29 Feb', y: 1504, m: 2, d: 29, kind: 'lunar', title: 'Columbus’s eclipse', note: 'Stranded on Jamaica and running out of food, Christopher Columbus used an almanac’s prediction of this total lunar eclipse to convince the islanders that God was angry. The dimming Moon did the rest.' },
    { label: '1715 · 3 May', y: 1715, m: 5, d: 3, kind: 'solar', title: 'Halley’s eclipse', note: 'Edmond Halley printed a map predicting the shadow’s path over England and asked people to report what they saw. His path was off by only about 30 km.' },
    { label: '1919 · 29 May', y: 1919, m: 5, d: 29, kind: 'solar', title: 'Eddington’s eclipse', note: 'Expeditions to Príncipe and Sobral photographed stars near the darkened Sun and found them shifted by the amount Einstein predicted, making him world-famous overnight.' },
    { label: '1999 · 11 Aug', y: 1999, m: 8, d: 11, kind: 'solar', title: 'Europe’s last eclipse of the millennium', note: 'Crossed Cornwall, France, Germany, Austria, Hungary and Romania, and was seen by hundreds of millions of people.' },
    { label: '2017 · 21 Aug', y: 2017, m: 8, d: 21, kind: 'solar', title: 'The Great American Eclipse', note: 'The first total eclipse to cross the United States from coast to coast since 1918.' },
    { label: '2024 · 8 Apr', y: 2024, m: 4, d: 8, kind: 'solar', title: 'Mexico, the United States and Canada', note: 'Totality lasted up to 4 minutes 28 seconds near Torreón, Mexico, and some 32 million people lived inside the path.' },
    { label: '2025 · 7 Sep', y: 2025, m: 9, d: 7, kind: 'lunar', title: 'A red Moon over Asia', note: 'A total lunar eclipse of 82 minutes, seen from Asia, Australia, Africa and Europe: more people could see it than any eclipse in years.' },
    { label: '2026 · 12 Aug', y: 2026, m: 8, d: 12, kind: 'solar', title: 'Greenland, Iceland and Spain', note: 'The first total eclipse over mainland Europe since 1999. Totality crossed Iceland in the late afternoon and reached Spain just before sunset.' },
    { label: '2027 · 2 Aug', y: 2027, m: 8, d: 2, kind: 'solar', title: 'The eclipse of the century', note: 'The shadow crosses southern Spain, Morocco, Algeria, Tunisia, Libya, Egypt, Saudi Arabia and Yemen. Near Luxor totality lasts 6 minutes 23 seconds, the longest seen from land between 1991 and 2114.' },
    { label: '2045 · 12 Aug', y: 2045, m: 8, d: 12, kind: 'solar', title: 'America again', note: 'A long total eclipse from northern California to Florida, over six minutes at its best.' },
  ];
  const E = { ev: null, t: 0, span: 0.13, kinds: { solar: true, lunar: true }, samples: null, busy: false, famous: null };
  function famousList() {
    $('eFamous').innerHTML = FAMOUS.map((f, i) => `<li><button data-i="${i}"><span class="d">${f.label}</span><span>${esc(f.title)}</span><span class="ty">${f.kind}</span></button></li>`).join('');
    $('eFamous').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { const f = FAMOUS[+b.dataset.i]; loadNear(P.calToJd(f.y, f.m, f.d) + 0.5, f.kind, f); }));
  }
  famousList();
  function setBusy(msg) { E.busy = !!msg; if (msg) { $('eKind').textContent = msg; } }
  async function loadNear(jdUT, kind, famous) {
    const t = P.utToTdb(jdUT) - P.EPOCH;
    setBusy('computing the orbits to ' + CW.yearStr(P.jdToCal(jdUT).year) + '…');
    await ensure(t - 40, t + 40, x => setBusy('computing the orbits · ' + yearLabel(x)));
    const ev = kind === 'lunar' ? ECL.lunarAt(eph, t) : ECL.solarAt(eph, t);
    setBusy(null);
    if (!ev) { $('eKind').textContent = 'no eclipse at that new or full moon'; return; }
    show(ev, famous || FAMOUS.find(f => Math.abs(P.calToJd(f.y, f.m, f.d) + 0.5 - P.tdbToUt(ev.jd)) < 1.5 && f.kind === ev.kind));
  }
  async function step(dir) {
    if (E.busy) return;
    const base = E.ev ? E.ev.t : CW.S.t;
    const kinds = Object.keys(E.kinds).filter(k => E.kinds[k]); if (!kinds.length) return;
    setBusy('searching…');
    await ensure(base - 400, base + 400);
    const ev = ECL.next(eph, base, dir, kinds);
    setBusy(null);
    if (ev) show(ev, FAMOUS.find(f => Math.abs(P.calToJd(f.y, f.m, f.d) + 0.5 - P.tdbToUt(ev.jd)) < 1.5 && f.kind === ev.kind));
  }
  $('ePrev').addEventListener('click', () => step(-1));
  $('eNext').addEventListener('click', () => step(1));
  $('eReplay').addEventListener('click', () => { if (E.ev) E.t = E.ev.t - E.span; });
  [['eKindSolar', 'solar'], ['eKindLunar', 'lunar']].forEach(([id, k]) => $(id).addEventListener('click', () => { E.kinds[k] = !E.kinds[k]; $(id).setAttribute('aria-pressed', E.kinds[k] ? 'true' : 'false'); }));
  document.addEventListener('cw-eclipse', e => { const { y, m, d, scroll } = e.detail; loadNear(P.calToJd(y, m, d) + 0.5, 'solar'); if (scroll) $('eclipses').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); });

  const hemi = lat => lat >= 0 ? 'N' : 'S', ew = lon => lon >= 0 ? 'E' : 'W';
  const fmtLL = (lat, lon) => `${Math.abs(lat).toFixed(1)}° ${hemi(lat)}, ${Math.abs(lon).toFixed(1)}° ${ew(lon)}`;
  function utStr(ev) { const c = P.jdToCal(P.tdbToUt(ev.jd)); const s = Math.round(c.frac * 86400) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} UT`; }
  function dateStr(ev) { const c = P.jdToCal(P.tdbToUt(ev.jd)); return `${c.day} ${CW.MONTHS[c.month - 1]} ${CW.yearStr(c.year)}`; }
  function show(ev, famous) {
    E.ev = ev; E.t = ev.t - E.span;
    const solar = ev.kind === 'solar';
    $('eKind').textContent = `${ev.type} ${ev.kind} eclipse`;
    $('eTitle').textContent = famous ? famous.title : dateStr(ev);
    $('eNote').innerHTML = famous ? `<b>${dateStr(ev)}.</b> ${esc(famous.note)}` : solar ? (ev.lat !== undefined ? `The Moon’s shadow touches Earth; the path of totality or annularity is outlined in amber.` : `Only the Moon’s outer shadow reaches Earth, so the Sun is partly covered for those under it.`) : `The full Moon passes through Earth’s shadow. Anyone on the night side of Earth can watch.`;
    const f = [];
    f.push(['Greatest eclipse', utStr(ev)]);
    if (solar) {
      if (ev.lat !== undefined) {
        f.push(['Where', fmtLL(ev.lat, ev.lon)]);
        f.push([ev.type === 'total' ? 'Totality there' : 'Annularity there', CW.fmtDur(ev.duration)]);
        f.push(['Path width', Math.round(ev.width) + ' km']);
        f.push(['Sun’s height there', Math.round(ev.alt) + '°']);
        f.push(['Moon/Sun apparent size', ev.ratio.toFixed(4)]);
      }
      f.push(['Gamma (miss distance, Earth radii)', ev.gamma.toFixed(4)]);
    } else {
      if (ev.type === 'penumbral') f.push(['Penumbral magnitude', ev.penMag.toFixed(3)]); else f.push(['Umbral magnitude', ev.mag.toFixed(3)]);
      if (ev.duration) f.push(['Totality lasts', CW.fmtDur(ev.duration)]);
      const g = ECL.geo(eph.at(ev.t)), M = ECL.earthFixed(ev.jd), m = ECL.mul(M, g.moon), ll = ECL.latlon(m);
      f.push(['Moon overhead at', fmtLL(ll.lat, ll.lon)]);
    }
    $('eFacts').innerHTML = f.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('eFamous').querySelectorAll('button').forEach(b => b.setAttribute('aria-current', famous && FAMOUS[+b.dataset.i] === famous ? 'true' : 'false'));
    globeCv.hidden = !solar; lunarCv.hidden = solar; $('globeKey').hidden = !solar;
    if (solar) buildMaps(ev); else E.samples = null;
  }
  // Per-time shadow geometry (Earth-fixed km) and the eclipse maps.
  function shadowAt(t) {
    const s = eph.at(t), g = ECL.geo(s), M = ECL.earthFixed(t + P.EPOCH);
    const S = ECL.mul(M, g.sun), Mo = ECL.mul(M, g.moon);
    const d = [Mo[0] - S[0], Mo[1] - S[1], Mo[2] - S[2]], dl = Math.hypot(...d), u = d.map(v => v / dl);
    return { S, Mo, u, tu: Math.tan(Math.asin((ECL.R_S - ECL.K_UMB) / dl)), tp: Math.tan(Math.asin((ECL.R_S + ECL.K_PEN) / dl)), M };
  }
  function obscAt(sh, p) {
    const t = (p[0] - sh.Mo[0]) * sh.u[0] + (p[1] - sh.Mo[1]) * sh.u[1] + (p[2] - sh.Mo[2]) * sh.u[2];
    const px = p[0] - sh.Mo[0] - sh.u[0] * t, py = p[1] - sh.Mo[1] - sh.u[1] * t, pz = p[2] - sh.Mo[2] - sh.u[2] * t;
    const rho = Math.hypot(px, py, pz), ru = ECL.K_UMB - t * sh.tu, rp = ECL.K_PEN + t * sh.tp;
    if (rho >= rp) return 0; if (rho < Math.abs(ru)) return ru > 0 ? 1 : 0.9;
    return (rp - rho) / (rp - Math.abs(ru)) * (ru > 0 ? 1 : 0.9);
  }
  function buildMaps(ev) {
    const RE = ECL.R_E, n = 150, t0 = ev.t - 0.16, t1 = ev.t + 0.16;
    const sams = []; for (let k = 0; k <= n; k++) sams.push(shadowAt(t0 + (t1 - t0) * k / n));
    E.samples = { t0, t1, sams };
    // largest obscuration anywhere on the lit Earth (1° grid)
    const ow = 360, oh = 180, obs = new Uint8Array(ow * oh);
    const sunDir = sams.map(s => { const l = Math.hypot(...s.S); return s.S.map(v => v / l); });
    for (let j = 0; j < oh; j++) {
      const lat = (90 - (j + 0.5)) * DEG, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i < ow; i++) {
        const lon = ((i + 0.5) - 180) * DEG, p = [RE * cl * Math.cos(lon), RE * cl * Math.sin(lon), RE * sl];
        let best = 0;
        for (let k = 0; k <= n; k++) { const sd = sunDir[k]; if (p[0] * sd[0] + p[1] * sd[1] + p[2] * sd[2] <= 0) continue; const o = obscAt(sams[k], p); if (o > best) best = o; }
        obs[j * ow + i] = Math.round(best * 255);
      }
    }
    // path of totality/annularity: footprint of the umbra, stepped every 20 s (0.25° grid)
    const tw = 1440, th = 720, tot = new Uint8Array(tw * th), line = [];
    if (ev.lat !== undefined) {
      for (let tt = t0; tt <= t1; tt += 20 / 86400) {
        const s = eph.at(tt), sh = ECL.shadow(s, tt + P.EPOCH); if (!sh.hit) continue;
        const la = sh.hit.lat, lo = sh.hit.lon;
        if (Math.round((tt - t0) * 86400 / 20) % 3 === 0) { const c = Math.cos(la * DEG); line.push(c * Math.cos(lo * DEG), c * Math.sin(lo * DEG), Math.sin(la * DEG)); }
        const L = ECL.local(s, tt + P.EPOCH, sh.hit.p);
        const rad = Math.abs(sh.hit.rU) / Math.max(0.15, Math.sin(Math.max(L.alt, 0.02))) * 1.05 + 5;
        const dLat = rad / 111.2, dLon = dLat / Math.max(0.05, Math.cos(la * DEG));
        const shd = shadowAt(tt);
        for (let y = Math.floor((90 - la - dLat) * 4); y <= Math.ceil((90 - la + dLat) * 4); y++) {
          if (y < 0 || y >= th) continue;
          const lat = (90 - (y + 0.5) / 4) * DEG, cl = Math.cos(lat), sl = Math.sin(lat);
          for (let x = Math.floor((lo - dLon + 180) * 4); x <= Math.ceil((lo + dLon + 180) * 4); x++) {
            const xi = ((x % tw) + tw) % tw, lon = ((xi + 0.5) / 4 - 180) * DEG;
            const p = [RE * cl * Math.cos(lon), RE * cl * Math.sin(lon), RE * sl];
            if (obscAt(shd, p) >= 0.9) tot[y * tw + xi] = 255;
          }
        }
      }
    }
    E.line = new Float32Array(line);
    if (globe) globe.setMaps(obs, ow, oh, tot, tw, th);
  }
  function globeFrame(dt) {
    if (!E.ev) return;
    if (!reduceMotion) E.t += dt * (E.ev.kind === 'solar' ? 1 / 86400 * 900 : 1 / 86400 * 1500);
    if (E.t > E.ev.t + E.span) E.t = E.ev.t - E.span;
    if (E.ev.kind === 'solar') drawGlobe(); else drawLunar();
  }
  function drawGlobe() {
    if (!globe) return;
    const { w, h, d } = fitCanvas(globeCv);
    const ev = E.ev, sh = shadowAt(E.t);
    // centre of view: greatest eclipse point (or the sub-solar-ish point for partial eclipses)
    let lat = ev.lat, lon = ev.lon;
    if (lat === undefined) { const g = ECL.shadow(eph.at(ev.t), ev.jd); const c = g.u.map(v => -v); const k = Math.hypot(...c); lat = Math.asin(c[2] / k) / DEG * 0.6; lon = Math.atan2(c[1], c[0]) / DEG; }
    const la = lat * DEG, lo = lon * DEG;
    const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], east = [-Math.sin(lo), Math.cos(lo), 0];
    const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
    const toFixed = [east[0], east[1], east[2], north[0], north[1], north[2], up[0], up[1], up[2]]; // columns
    const toView = [east[0], north[0], up[0], east[1], north[1], up[1], east[2], north[2], up[2]];
    const sl = Math.hypot(...sh.S);
    const lines = [];
    if (E.line && E.line.length) lines.push({ data: E.line, col: [1, 0.78, 0.45, 0.9] });
    globe.render({ W: globeCv.width, H: globeCv.height, toFixed, toView, sun: sh.S.map(v => v / sl), ms: sh.Mo, ax: sh.u, ku: ECL.K_UMB, tu: sh.tu, kp: ECL.K_PEN, tp: sh.tp, zoom: 0.94, lines });
    // HUD: time, and what the shadow centre is doing now
    const s = eph.at(E.t), g = ECL.shadow(s, E.t + P.EPOCH);
    let txt = `<b>${CW.fmtClock(E.t)} UT</b> · ${dateStr(ev)}<br>`;
    if (g.hit) { const L = ECL.local(s, E.t + P.EPOCH, g.hit.p); txt += `shadow centre at ${fmtLL(g.hit.lat, g.hit.lon)}<br>Sun ${Math.round(L.alt / DEG)}° above the horizon there`; }
    else txt += Math.abs(g.gamma) < 1.6 ? 'the axis of the shadow misses Earth now' : '';
    $('globeHud').innerHTML = txt;
  }
  function drawLunar() {
    const { w, h, d } = fitCanvas(lunarCv); const ctx = lunarCv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = '#04060a'; ctx.fillRect(0, 0, w, h);
    const ev = E.ev;
    // positions of the Moon relative to the shadow centre (anti-Sun direction), in degrees on the sky
    const at = tt => { const g = ECL.geo(eph.at(tt)); const ax = g.sun.map(v => -v / Math.hypot(...g.sun)); const m = g.moon, dm = Math.hypot(...m); const e1 = [0, 0, 1], x = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]]; const xl = Math.hypot(...x); const xx = x.map(v => v / xl), yy = [ax[1] * xx[2] - ax[2] * xx[1], ax[2] * xx[0] - ax[0] * xx[2], ax[0] * xx[1] - ax[1] * xx[0]]; return [-(m[0] * xx[0] + m[1] * xx[1] + m[2] * xx[2]) / dm / DEG, (m[0] * yy[0] + m[1] * yy[1] + m[2] * yy[2]) / dm / DEG]; };
    const sc = Math.min(w, h) / 3.2, cx = w / 2, cy = h / 2;
    ctx.fillStyle = 'rgba(155,163,180,0.13)'; ctx.beginPath(); ctx.arc(cx, cy, ev.pen / DEG * sc, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(120,30,20,0.45)'; ctx.beginPath(); ctx.arc(cx, cy, ev.umb / DEG * sc, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(230,234,240,0.25)'; ctx.setLineDash([3, 4]); ctx.beginPath();
    for (let k = -30; k <= 30; k++) { const p = at(ev.t + k * 0.01); const x = cx + p[0] * sc, y = cy - p[1] * sc; k === -30 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = '#9ba3b4';
    for (let hr = -3; hr <= 3; hr++) { const p = at(ev.t + hr / 24); const x = cx + p[0] * sc, y = cy - p[1] * sc; ctx.fillRect(x - 1, y - 1, 2, 2); ctx.fillText((hr >= 0 ? '+' : '') + hr + 'h', x + 4, y - 4); }
    const p = at(E.t), mx = cx + p[0] * sc, my = cy - p[1] * sc, mr = ev.sM / DEG * sc;
    const sep = Math.hypot(p[0], p[1]) * DEG, deep = Math.max(0, Math.min(1, (ev.umb + ev.sM - sep) / (2 * ev.sM)));
    const pen = Math.max(0, Math.min(1, (ev.pen + ev.sM - sep) / (2 * ev.sM)));
    const lit = 1 - 0.35 * pen, r = Math.round(236 - 90 * deep), gch = Math.round(230 * lit - 190 * deep), b = Math.round(215 * lit - 190 * deep);
    const grd = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    grd.addColorStop(0, `rgb(${r},${Math.max(40, gch)},${Math.max(25, b)})`); grd.addColorStop(1, `rgb(${Math.round(r * 0.7)},${Math.max(25, Math.round(gch * 0.6))},${Math.max(15, Math.round(b * 0.5))})`);
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
    ctx.fillStyle = '#687084'; ctx.fillText('Earth’s penumbra', cx + ev.pen / DEG * sc * 0.72, cy - ev.pen / DEG * sc * 0.72);
    ctx.fillText('umbra', cx - 18, cy + ev.umb / DEG * sc - 8);
    $('globeHud').innerHTML = `<b>${CW.fmtClock(E.t)} UT</b> · ${dateStr(ev)}<br>${deep > 0.999 ? 'totally eclipsed: lit only by sunsets around the Earth' : deep > 0 ? Math.round(deep * 100) + '% of the Moon’s width inside the umbra' : pen > 0 ? 'in the penumbra: a faint dimming' : 'outside Earth’s shadow'}`;
  }
  // Upcoming eclipses from today
  async function upcoming() {
    const t0 = CW.nowT(); await ensure(t0 - 30, t0 + 1300);
    const list = []; let t = t0;
    for (let k = 0; k < 7; k++) { const ev = ECL.next(eph, t, 1); if (!ev) break; list.push(ev); t = ev.t; }
    $('eUpcoming').innerHTML = list.map((ev, i) => `<li><button data-i="${i}"><span class="d">${dateStr(ev).replace(/ (\d{4})$/, ' $1')}</span><span>${ev.type} ${ev.kind}${ev.lat !== undefined ? ' · ' + fmtLL(ev.lat, ev.lon) : ''}</span><span class="ty">${ev.kind === 'solar' ? (ev.duration ? CW.fmtDur(ev.duration) : '') : ev.type === 'penumbral' ? 'pen. mag ' + ev.penMag.toFixed(2) : 'mag ' + ev.mag.toFixed(2)}</span></button></li>`).join('');
    $('eUpcoming').querySelectorAll('button').forEach(b => b.addEventListener('click', () => show(list[+b.dataset.i], FAMOUS.find(f => Math.abs(P.calToJd(f.y, f.m, f.d) + 0.5 - P.tdbToUt(list[+b.dataset.i].jd)) < 1.5))));
  }

  /* ================================================================
     Mercury's perihelion: two complete runs, with and without Einstein
     ================================================================ */
  const init = P.initial(DATA.state0, DATA.moonDelta);
  let ephN = null; const PERI_SPAN = 365.25 * 1000;
  const peri = { gr: new Map(), nw: new Map() };     // bin (10-year) -> [sum, n]
  const done = { gr: { f: 0, b: 1 }, nw: { f: 0, b: 1 } };
  function varpi(f) { // heliocentric osculating longitude of perihelion from a packed checkpoint
    const N = P.N, mu = P.GM[0] + P.GM[1];
    const r = [f[3] - f[0], f[4] - f[1], f[5] - f[2]], v = [f[3 * N + 3] - f[3 * N], f[3 * N + 4] - f[3 * N + 1], f[3 * N + 5] - f[3 * N + 2]];
    const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], rn = Math.hypot(...r);
    const ex = (v[1] * h[2] - v[2] * h[1]) / mu - r[0] / rn, ey = (v[2] * h[0] - v[0] * h[2]) / mu - r[1] / rn;
    return Math.atan2(ey, ex);
  }
  let w0 = null;
  function absorb(key, e) {
    const d = done[key];
    if (w0 === null) w0 = varpi(eph.fwd[0]);
    const add = (f, t) => { if (Math.abs(t) > PERI_SPAN) return; let w = varpi(f) - w0; while (w > Math.PI) w -= 2 * Math.PI; while (w < -Math.PI) w += 2 * Math.PI; const bin = Math.round(t / 3652.5); const m = peri[key]; const c = m.get(bin) || [0, 0]; c[0] += w / DEG * 3600; c[1]++; m.set(bin, c); };
    while (d.f < e.fwd.length) { add(e.fwd[d.f], d.f * P.CK); d.f++; }
    while (d.b < e.bwd.length) { add(e.bwd[d.b], -d.b * P.CK); d.b++; }
  }
  function slope(m) {
    const pts = [...m.entries()].filter(([b, c]) => c[1] > 60).map(([b, c]) => [b * 10 / 100, c[0] / c[1]]);
    if (pts.length < 6) return null;
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    return { k: sxy / sxx, span: (pts[pts.length - 1][0] - pts[0][0]) };
  }
  let periVisible = false;
  new IntersectionObserver(es => { periVisible = es.some(e => e.isIntersecting); }, { rootMargin: '600px' }).observe($('einstein'));
  function periWork() {
    if (!periVisible && !ephN) return;
    if (!ephN) ephN = new P.Ephemeris(init, { gr: 0 });
    ephN.growTo(-PERI_SPAN, PERI_SPAN, 6);
    absorb('gr', eph); absorb('nw', ephN);
  }
  let periLast = 0;
  function drawPeri() {
    const now = performance.now(); if (now - periLast < 400) return; periLast = now;
    const cv = $('periChart'), { w, h, d } = fitCanvas(cv), ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const x0 = 2026 - 1000, x1 = 2026 + 1000;
    const avg = k => new Map([...peri[k].entries()].filter(([bn, c]) => c[1] > 60).map(([bn, c]) => [bn, c[0] / c[1]]));
    const g = avg('gr'), n = avg('nw');
    const diff = [...g.keys()].filter(k => n.has(k)).sort((a, b) => a - b).map(k => [2026 + k * 10, g.get(k) - n.get(k)]);
    const ymax = 480, ymin = -480;
    const L = 52, R = 8, T = 8, Bm = 26;
    const X = y => L + (y - x0) / (x1 - x0) * (w - L - R), Y = v => T + (ymax - v) / (ymax - ymin) * (h - T - Bm);
    ctx.font = '11px "IBM Plex Mono", monospace'; ctx.lineWidth = 1;
    for (let v = -400; v <= 400; v += 200) { ctx.strokeStyle = v === 0 ? 'rgba(230,234,240,0.3)' : 'rgba(230,234,240,0.1)'; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(w - R, Y(v)); ctx.stroke(); ctx.fillStyle = '#687084'; ctx.fillText((v > 0 ? '+' : '') + v + '\u2033', 6, Y(v) + 4); }
    for (let y = 1200; y <= 3000; y += 300) { ctx.fillStyle = '#687084'; ctx.fillText(String(y), X(y) - 14, h - 8); }
    // theory: 42.98" per century
    ctx.strokeStyle = 'rgba(230,234,240,0.7)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(x0), Y(-42.98 * 10)); ctx.lineTo(X(x1), Y(42.98 * 10)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#b99cff'; ctx.lineWidth = 2.5; ctx.beginPath(); diff.forEach(([x, y], i) => i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))); ctx.stroke();
    ctx.fillStyle = '#9ba3b4'; ctx.fillText('Newton alone would stay on this line', X(1080), Y(0) - 8);
    if (diff.length) { const a = diff[diff.length - 1]; if (a[0] > 2100) { ctx.fillStyle = '#e6eaf0'; ctx.fillText(`+${Math.round(a[1])}\u2033 by ${a[0]}`, Math.min(X(a[0]) + 8, w - 110), Y(a[1]) + 16); } }
    const sg = slope(peri.gr), sn = slope(peri.nw);
    if (sg) $('kGR').textContent = sg.k.toFixed(1) + '″'; if (sn) $('kNewton').textContent = sn.k.toFixed(1) + '″';
    if (sg && sn) { $('kDiff').textContent = (sg.k - sn.k).toFixed(2) + '″'; CW.periShare = sg.k - sn.k; }
    const cov = ephN ? Math.min(ephN.hi, -ephN.lo) / 365.25 : 0;
    $('periStatus').textContent = !ephN ? 'waiting to start' : cov < 999 ? `running both simulations · ±${Math.round(cov)} years so far` : 'both runs complete, 2,000 years';
  }

  /* ---------- the rosette ---------- */
  const ros = { f: 100, x: 0, y: 0, vx: 0, vy: 0, trail: [], peri: [], rPrev: [0, 0], t: 0 };
  const SLOW = [1, 30, 100, 300];
  function rosReset() {
    const a = 0.387098, e = 0.205630, mu = P.GM[0];
    ros.x = a * (1 + e); ros.y = 0; ros.vx = 0; ros.vy = Math.sqrt(mu / a * (1 - e) / (1 + e));
    ros.trail = []; ros.peri = []; ros.rPrev = [1e9, 1e9]; ros.t = 0;
  }
  function rosStep(h) {
    const mu = P.GM[0], c = P.C / ros.f, c2 = c * c;
    const acc = (x, y, vx, vy) => { const r2 = x * x + y * y, r = Math.sqrt(r2), v2 = vx * vx + vy * vy, rv = x * vx + y * vy; const nf = -mu / (r2 * r); const g = mu / (c2 * r2 * r); return [nf * x + g * ((4 * mu / r - v2) * x + 4 * rv * vx), nf * y + g * ((4 * mu / r - v2) * y + 4 * rv * vy)]; };
    // RK4
    const s0 = [ros.x, ros.y, ros.vx, ros.vy];
    const f = s => { const a = acc(s[0], s[1], s[2], s[3]); return [s[2], s[3], a[0], a[1]]; };
    const k1 = f(s0), k2 = f(s0.map((v, i) => v + h / 2 * k1[i])), k3 = f(s0.map((v, i) => v + h / 2 * k2[i])), k4 = f(s0.map((v, i) => v + h * k3[i]));
    const s1 = s0.map((v, i) => v + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    [ros.x, ros.y, ros.vx, ros.vy] = s1; ros.t += h;
    const r = Math.hypot(ros.x, ros.y);
    if (ros.rPrev[0] < ros.rPrev[1] && ros.rPrev[0] < r) ros.peri.push(Math.atan2(ros.py, ros.px));
    ros.rPrev = [r, ros.rPrev[0]]; ros.px = ros.x; ros.py = ros.y;
  }
  $('slowc').addEventListener('input', () => { ros.f = SLOW[+$('slowc').value]; rosReset(); rosLabel(); });
  function rosLabel() { const per = 0.1035 * ros.f * ros.f; $('slowcOut').textContent = ros.f === 1 ? 'real speed' : ros.f + '× slower'; $('rosNote').innerHTML = `perihelion turns <b>${per < 60 ? per.toFixed(per < 1 ? 2 : 0) + '″' : per < 3600 ? (per / 60).toFixed(1) + '′' : (per / 3600).toFixed(2) + '°'}</b> per orbit`; }
  ros.f = SLOW[+$('slowc').value]; rosReset(); rosLabel();
  function drawRosette(dt) {
    const orbitsPerSec = 3, days = dt * 88 * orbitsPerSec, h = 0.25;
    for (let k = 0; k < Math.min(4000, Math.ceil(days / h)); k++) { rosStep(h); if (k % 2 === 0) ros.trail.push(ros.x, ros.y); }
    const maxPts = 2 * 1400; if (ros.trail.length > maxPts) ros.trail.splice(0, ros.trail.length - maxPts);
    const cv = $('rosette'), { w, h: hh, d } = fitCanvas(cv), ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = '#090c13'; ctx.fillRect(0, 0, w, hh);
    const sc = Math.min(w, hh) / 2 / 0.5, cx = w / 2, cy = hh / 2;
    const n = ros.trail.length / 2;
    for (let i = 1; i < n; i++) { const a = i / n; ctx.strokeStyle = `rgba(185,156,255,${(0.05 + 0.9 * a * a).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx + ros.trail[2 * i - 2] * sc, cy - ros.trail[2 * i - 1] * sc); ctx.lineTo(cx + ros.trail[2 * i] * sc, cy - ros.trail[2 * i + 1] * sc); ctx.stroke(); }
    // perihelion directions
    const pl = ros.peri.slice(-40);
    pl.forEach((a, i) => { ctx.strokeStyle = `rgba(255,196,107,${(0.15 + 0.85 * (i + 1) / pl.length).toFixed(2)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 0.33 * sc, cy - Math.sin(a) * 0.33 * sc); ctx.stroke(); });
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14); grd.addColorStop(0, '#fff3d6'); grd.addColorStop(0.4, '#ffc46b'); grd.addColorStop(1, 'rgba(255,196,107,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 7); ctx.fill();
    ctx.fillStyle = '#c9c4bd'; ctx.beginPath(); ctx.arc(cx + ros.x * sc, cy - ros.y * sc, 4, 0, 7); ctx.fill();
    ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillStyle = '#687084';
    ctx.fillText(`${Math.floor(ros.t / 87.969)} orbits · ${(ros.t / 365.25).toFixed(1)} years`, 12, hh - 12);
  }

  /* ================================================================
     The asteroid belt: histogram of the real asteroids
     ================================================================ */
  const RES = [[4, 1], [3, 1], [5, 2], [7, 3], [2, 1], [3, 2], [4, 3], [1, 1]].map(([p, q]) => ({ lab: p + ':' + q, a: 5.2034 * Math.pow(q / p, 2 / 3) }));
  let histReal = null;
  function realHist(a0, a1, bw) {
    const nb = Math.round((a1 - a0) / bw), hgm = new Float64Array(nb);
    for (let k = 0; k < CW.A.a.length; k++) { const a = CW.A.a[k]; if (a >= a0 && a < a1) hgm[Math.floor((a - a0) / bw)]++; }
    return hgm;
  }
  function drawHist() {
    if (!CW.A.ready) return;
    if (!histReal) histReal = realHist(1.7, 5.6, 0.005);
    const cv = $('histChart'), { w, h, d } = fitCanvas(cv), ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const L = 44, Rr = 8, T = 20, Bm = 24, a0 = 1.7, a1 = 5.6, bw = 0.005;
    const X = a => L + (a - a0) / (a1 - a0) * (w - L - Rr);
    const max = Math.max(...histReal), Y = v => h - Bm - Math.sqrt(v / max) * (h - T - Bm);
    ctx.font = '11px "IBM Plex Mono", monospace';
    for (const v of [100, 1000, 3000]) { if (v > max) continue; ctx.strokeStyle = 'rgba(230,234,240,0.1)'; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(w - Rr, Y(v)); ctx.stroke(); ctx.fillStyle = '#687084'; ctx.fillText(v.toLocaleString('en-US'), 2, Y(v) + 4); }
    ctx.fillStyle = '#c7bdae';
    for (let i = 0; i < histReal.length; i++) { const a = a0 + i * bw; const y = Y(histReal[i]); ctx.fillRect(X(a), y, Math.max(1, X(a + bw) - X(a) - 0.2), h - Bm - y); }
    for (const r of RES) {
      const x = X(r.a); ctx.strokeStyle = 'rgba(255,196,107,0.55)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, T - 4); ctx.lineTo(x, h - Bm); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffc46b'; ctx.fillText(r.lab, x - 10 + (r.lab === '7:3' ? 8 : r.lab === '5:2' ? -6 : 0), T - 8 + 4);
    }
    for (let a = 2; a <= 5.5; a += 0.5) { ctx.fillStyle = '#687084'; ctx.fillText(a.toFixed(1) + ' AU', X(a) - 16, h - 6); }
    ctx.fillStyle = '#9ba3b4'; ctx.fillText('Hildas', X(3.97) + 6, Y(histReal[Math.round((3.97 - a0) / bw)]) - 6); ctx.fillText('Trojans', X(5.2) - 58, Y(histReal[Math.round((5.2 - a0) / bw)]) - 6);
  }

  /* ================================================================
     The resonance lab
     ================================================================ */
  const labCv = $('lab'), lgl = labCv.getContext('webgl2', { antialias: true });
  const LAB_N = 120000, LAB_DT = 20, LAB_K = 32;
  const lab = { sim: null, gl: lgl, run: false, years: 0, preset: 'belt', passes: 6, lost: 0, a0s: null, rot: [1, 0] };
  let labGL = null;
  if (lgl) { try { labGL = LabGL(lgl); } catch (e) { console.error(e); } }
  // giant planets: Sun (with the inner planets' mass) + Jupiter, Saturn, Uranus, Neptune, integrated on the CPU
  const G = { idx: [0, 6, 7, 8, 9], M: null, X: new Float64Array(15), V: new Float64Array(15), A: new Float64Array(15) };
  G.M = G.idx.map(i => i === 0 ? P.GM[0] + P.GM[1] + P.GM[2] + P.GM[3] + P.GM[4] + P.GM[5] : P.GM[i]);
  const Y6 = (() => { const w = [-1.17767998417887, 0.235573213359357, 0.784513610477560]; const w0 = 1 - 2 * (w[0] + w[1] + w[2]); return [w[2], w[1], w[0], w0, w[0], w[1], w[2]]; })();
  function gAcc() { G.A.fill(0); for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { const dx = G.X[3 * j] - G.X[3 * i], dy = G.X[3 * j + 1] - G.X[3 * i + 1], dz = G.X[3 * j + 2] - G.X[3 * i + 2], r2 = dx * dx + dy * dy + dz * dz, ir3 = 1 / (r2 * Math.sqrt(r2)); G.A[3 * i] += G.M[j] * ir3 * dx; G.A[3 * i + 1] += G.M[j] * ir3 * dy; G.A[3 * i + 2] += G.M[j] * ir3 * dz; G.A[3 * j] -= G.M[i] * ir3 * dx; G.A[3 * j + 1] -= G.M[i] * ir3 * dy; G.A[3 * j + 2] -= G.M[i] * ir3 * dz; } }
  function gStep(h) { for (const w of Y6) { const d = w * h; for (let i = 0; i < 15; i++) G.X[i] += G.V[i] * d / 2; gAcc(); for (let i = 0; i < 15; i++) G.V[i] += G.A[i] * d; for (let i = 0; i < 15; i++) G.X[i] += G.V[i] * d / 2; } }
  function labReset() {
    const s0 = P.initial(DATA.state0);
    G.idx.forEach((b, j) => { for (let k = 0; k < 3; k++) { G.X[3 * j + k] = s0.x[3 * b + k]; G.V[3 * j + k] = s0.v[3 * b + k]; } });
    let seed = 17; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const Pa = new Float32Array(4 * LAB_N), Va = new Float32Array(4 * LAB_N);
    const [lo, hi] = lab.preset === 'belt' ? [1.9, 4.25] : lab.preset === 'jupiter' ? [4.55, 5.95] : [1.9, 5.95];
    for (let k = 0; k < LAB_N; k++) {
      const a = lo + (hi - lo) * rnd(), e = 0.12 * rnd(), inc = 6 * rnd();
      const s = AST.elemToState(a, e, inc, 360 * rnd(), 360 * rnd(), 360 * rnd());
      Pa.set([s[0], s[1], s[2], 0], 4 * k); Va.set([s[3], s[4], s[5], a], 4 * k);
    }
    // heliocentric: the elements are relative to the Sun already
    if (labGL) { if (!lab.sim) lab.sim = AsteroidSim(lgl, LAB_N, Pa, Va); else lab.sim.load(Pa, Va); }
    lab.years = 0; lab.lost = 0; lab.hist = null; lab.readT = 0;
    $('labClock').textContent = '0 years';
  }
  const labPl = new Float32Array(LAB_K * 4 * 3), labGM = new Float32Array([P.GM[6], P.GM[7], P.GM[8], P.GM[9]]);
  // One GPU pass of K steps of dt days (dt up to LAB_DT; smaller steps keep slow playback smooth).
  function labPass(K = LAB_K, dt = LAB_DT) {
    for (let k = 0; k < K; k++) {
      gStep(dt / 2);
      for (let j = 1; j < 5; j++) for (let q = 0; q < 3; q++) labPl[12 * k + 3 * (j - 1) + q] = G.X[3 * j + q] - G.X[q];
      gStep(dt / 2);
    }
    lab.sim.step(dt, K, labPl, labGM, 4, P.GM[0], 1.666, 100);
    lab.years += K * dt / 365.25;
  }
  // Speed slider: 0.5 to 5,000 years per second on a log scale; the top of the range means as fast as the GPU allows.
  const labSpeed = $('labSpeed');
  const labRate = () => +labSpeed.value >= 990 ? Infinity : Math.pow(10, Math.log10(0.5) + (+labSpeed.value / 990) * 4);
  function labSpeedOut() {
    const r = labRate();
    $('labSpeedOut').textContent = r === Infinity ? 'as fast as possible' : (r < 10 ? r.toFixed(1) : Math.round(r).toLocaleString('en-US')) + ' years per second';
  }
  labSpeed.addEventListener('input', () => { lab.carry = 0; labSpeedOut(); });
  labSpeedOut();
  $('labRun').addEventListener('click', () => { lab.run = !lab.run; $('labRun').textContent = lab.run ? 'Pause' : 'Start'; });
  $('labReset').addEventListener('click', () => { labReset(); });
  $('labPresets').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { lab.preset = b.dataset.preset; $('labPresets').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b ? 'true' : 'false')); labReset(); }));
  let labVisible = false;
  new IntersectionObserver(es => { labVisible = es.some(e => e.isIntersecting); }, { rootMargin: '200px' }).observe(labCv);
  const labRead = { P: new Float32Array(4 * LAB_N), V: new Float32Array(4 * LAB_N) };
  function labFrame(dt) {
    if (!labGL || !lab.sim) return;
    if (lab.run) {
      const rate = labRate();
      if (rate === Infinity) {
        const t0 = performance.now();
        for (let k = 0; k < lab.passes; k++) labPass();
        const spent = performance.now() - t0;
        if (dt < 0.022 && spent < 10) lab.passes = Math.min(40, lab.passes + 1); else if (dt > 0.03) lab.passes = Math.max(1, lab.passes - 1);
      } else {
        // days to cover this frame, in steps no longer than 20 days and at least one step per frame
        const days = rate * 365.25 * dt + (lab.carry || 0);
        const step = Math.min(LAB_DT, Math.max(0.5, rate * 365.25 / 60));
        let n = Math.floor(days / step); lab.carry = days - n * step;
        n = Math.min(n, LAB_K * 40);
        while (n > 0) { const K = Math.min(LAB_K, n); labPass(K, step); n -= K; }
      }
      $('labClock').textContent = Math.round(lab.years).toLocaleString('en-US') + ' years' + (lab.lost ? ` · ${lab.lost.toLocaleString('en-US')} lost to Mars-crossing orbits` : '');
    }
    if (!labVisible) return;
    const { w, h, d } = fitCanvas(labCv);
    const W = labCv.width, H = labCv.height, narrow = w < 700;
    const jl = Math.atan2(G.X[4] - G.X[1], G.X[3] - G.X[0]), rot = [Math.cos(-jl + Math.PI / 2), Math.sin(-jl + Math.PI / 2)];
    const box = [1.8, 6.0, 0, 0.6];
    const left = narrow ? { x: 0, y: Math.round(H * 0.45), w: W, h: H - Math.round(H * 0.45) } : { x: 0, y: 0, w: Math.round(W * 0.45), h: H };
    const right = narrow ? { x: 0, y: 0, w: W, h: Math.round(H * 0.45) } : { x: Math.round(W * 0.45), y: 0, w: W - Math.round(W * 0.45), h: H };
    const pad = 36 * d;
    const dens = n => Math.min(1, 0.3 / (LAB_N / n));      // keep the additive glow from saturating on small or dense screens
    const aL = 0.5 * dens(left.w * left.h / (d * d)) / d, aR = 0.45 * dens(right.w * right.h / (d * d)) / d;
    labGL.render(lab.sim, { ...left, mode: 0, mu: P.GM[0], scale: 1 / 6.4, rot, box, pt: 1.2 * d, alpha: aL });
    lgl.enable(lgl.SCISSOR_TEST); lgl.scissor(right.x, right.y, right.w, right.h); lgl.clearColor(0.016, 0.02, 0.035, 1); lgl.clear(lgl.COLOR_BUFFER_BIT); lgl.disable(lgl.SCISSOR_TEST);
    labGL.render(lab.sim, { x: right.x + pad * 1.4, y: right.y + pad, w: right.w - pad * 1.8, h: right.h - pad * 1.6, mode: 1, mu: P.GM[0], scale: 1, rot, box, pt: 1.2 * d, alpha: aR });
    // overlay: axes, resonances, Jupiter and its Lagrange points
    const ax = $('labAxes'), ov = fitCanvas(ax), ctx = ax.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, ov.w, ov.h);
    ctx.font = '11px "IBM Plex Mono", monospace';
    const L = { x: left.x / d, y: (H - left.y - left.h) / d, w: left.w / d, h: left.h / d };
    const Rp = { x: (right.x + pad * 1.4) / d, y: (H - right.y - right.h + pad * 0.6) / d, w: (right.w - pad * 1.8) / d, h: (right.h - pad * 1.6) / d };
    // left: Sun, Jupiter at top, L4 and L5
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2, s = Math.min(L.w, L.h) / 2 / 6.4, s2 = L.h / 2 / 6.4;
    const sx = (1 / 6.4) * L.h / 2; // scale in px per AU (vertical)
    ctx.fillStyle = '#ffc46b'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.fill();
    const jr = Math.hypot(G.X[3] - G.X[0], G.X[4] - G.X[1]) * sx;
    ctx.fillStyle = '#e8d3b0'; ctx.beginPath(); ctx.arc(cx, cy - jr, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#9ba3b4'; ctx.fillText('Jupiter', cx + 8, cy - jr + 4);
    for (const [ang, lab_] of [[60, 'L4'], [-60, 'L5']]) { const a = (90 + ang) * DEG; ctx.strokeStyle = 'rgba(115,217,140,0.7)'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * jr, cy - Math.sin(a) * jr, 7, 0, 7); ctx.stroke(); ctx.fillStyle = '#73d98c'; ctx.fillText(lab_, cx + Math.cos(a) * jr + (ang > 0 ? -26 : 10), cy - Math.sin(a) * jr + 4); }
    ctx.fillStyle = '#687084'; ctx.fillText('seen turning with Jupiter', L.x + 10, L.y + 16);
    // right: a-e axes
    const X = a => Rp.x + (a - box[0]) / (box[1] - box[0]) * Rp.w, Y = e => Rp.y + Rp.h - (e - box[2]) / (box[3] - box[2]) * Rp.h;
    ctx.strokeStyle = 'rgba(230,234,240,0.2)'; ctx.strokeRect(Rp.x, Rp.y, Rp.w, Rp.h);
    ctx.fillStyle = '#687084';
    for (let a = 2; a <= 6; a += 0.5) ctx.fillText(a.toFixed(1), X(a) - 10, Rp.y + Rp.h + 14);
    for (let e = 0; e <= 0.6; e += 0.1) ctx.fillText(e.toFixed(1), Rp.x - 26, Y(e) + 4);
    ctx.fillText('distance from the Sun, AU', Rp.x + Rp.w / 2 - 80, Rp.y + Rp.h + 28);
    ctx.save(); ctx.translate(Rp.x - 30, Rp.y + Rp.h / 2 + 50); ctx.rotate(-Math.PI / 2); ctx.fillText('eccentricity (stretch)', 0, 0); ctx.restore();
    RES.forEach((r, i) => { const x = X(r.a); if (x < Rp.x || x > Rp.x + Rp.w) return; if (narrow && (r.lab === '7:3' || r.lab === '4:3' || r.lab === '4:1')) return; ctx.strokeStyle = 'rgba(255,196,107,0.35)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, Rp.y); ctx.lineTo(x, Rp.y + Rp.h); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#ffc46b'; ctx.fillText(r.lab, r.lab === '7:3' ? x + 3 : x - 10, r.lab === '7:3' ? Rp.y + 12 : Rp.y - 4); });
    ctx.strokeStyle = 'rgba(255,92,77,0.7)'; ctx.beginPath(); for (let a = 1.8; a <= 6; a += 0.02) { const e = 1 - 1.666 / a; if (e < 0) continue; const x = X(a), y = Y(Math.min(e, 0.6)); a < 1.8 + 1e-6 || e < 0.005 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
    ctx.fillStyle = '#ff5c4d'; ctx.fillText('orbits reach Mars above this line', X(3.3), Y(Math.min(0.58, 1 - 1.666 / 3.3)) - 6);
    // histogram readback (slow path)
    const now = performance.now();
    if (now - (lab.readT || 0) > 700) { lab.readT = now; labHistogram(); }
  }
  function labHistogram() {
    lab.sim.read(labRead.P, labRead.V);
    const a0 = 1.8, a1 = 6.0, bw = 0.02, nb = Math.round((a1 - a0) / bw), hh = new Float64Array(nb); let lost = 0;
    for (let k = 0; k < LAB_N; k++) {
      if (labRead.P[4 * k + 3] < 0) { lost++; continue; }
      const x = labRead.P[4 * k], y = labRead.P[4 * k + 1], z = labRead.P[4 * k + 2], vx = labRead.V[4 * k], vy = labRead.V[4 * k + 1], vz = labRead.V[4 * k + 2];
      const a = 1 / (2 / Math.hypot(x, y, z) - (vx * vx + vy * vy + vz * vz) / P.GM[0]);
      if (a >= a0 && a < a1) hh[Math.floor((a - a0) / bw)]++;
    }
    lab.lost = lost; lab.hist = hh;
    const cv = $('labHist'), { w, h, d } = fitCanvas(cv), ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const L = 44, Rr = 8, T = 16, Bm = 22, X = a => L + (a - a0) / (a1 - a0) * (w - L - Rr);
    // real asteroids in the same range, scaled to the same total over the preset's starting range
    const [lo, hi] = lab.preset === 'belt' ? [1.9, 4.25] : lab.preset === 'jupiter' ? [4.55, 5.95] : [1.9, 5.95];
    let real = null;
    if (CW.A.ready) { real = new Float64Array(nb); for (let k = 0; k < CW.A.a.length; k++) { const a = CW.A.a[k]; if (a >= lo && a < hi) real[Math.floor((a - a0) / bw)]++; } }
    const perBin = LAB_N * bw / (hi - lo), maxv = perBin * 2.2;
    const rmax = real ? Math.max(...real) : 1, scaleR = maxv * 0.92 / rmax;
    const Y = v => h - Bm - Math.min(1, v / maxv) * (h - T - Bm);
    ctx.font = '11px "IBM Plex Mono", monospace';
    if (real) { ctx.fillStyle = 'rgba(155,163,180,0.35)'; for (let i = 0; i < nb; i++) { const v = real[i] * scaleR; if (!v) continue; ctx.fillRect(X(a0 + i * bw), Y(v), X(a0 + bw) - X(a0) - 0.5, h - Bm - Y(v)); } }
    ctx.strokeStyle = '#ffc46b'; ctx.lineWidth = 1.6; ctx.beginPath(); for (let i = 0; i < nb; i++) { const x = X(a0 + (i + 0.5) * bw), y = Y(hh[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    for (const r of RES) { if (w < 600 && (r.lab === '7:3' || r.lab === '4:3' || r.lab === '4:1')) continue; const x = X(r.a); ctx.fillStyle = '#ffc46b'; ctx.fillText(r.lab, x - 10 + (r.lab === '7:3' ? 12 : r.lab === '5:2' ? -8 : 0), T - 3); }
    for (let a = 2; a <= 6; a += 0.5) { ctx.fillStyle = '#687084'; ctx.fillText(a.toFixed(1), X(a) - 10, h - 6); }
  }

  /* ================================================================
     Checks and catalogue
     ================================================================ */
  const CHECK_NAMES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
  const IDX = { Sun: 0, Mercury: 1, Venus: 2, Moon: 4, Mars: 5, Jupiter: 6, Saturn: 7, Uranus: 8, Neptune: 9 };
  const checkRes = {};
  function angErr(t, name, ref) {
    const s = eph.at(t), i = IDX[name];
    const g = [0, 1, 2].map(k => s.x[3 * i + k] - s.x[9 + k]);
    const d = Math.hypot(...ref), e = Math.hypot(g[0] - ref[0], g[1] - ref[1], g[2] - ref[2]);
    return e / d * 206264.806;
  }
  function runChecks() {
    for (const c of DATA.checks) {
      const t = c.jd - P.EPOCH; if (checkRes[c.jd] || !eph.covers(t)) continue;
      let worst = 0, who = ''; for (const n of CHECK_NAMES) { const e = angErr(t, n, c[n]); if (e > worst) { worst = e; who = n; } }
      checkRes[c.jd] = { worst, who, moon: angErr(t, 'Moon', c.Moon) };
    }
    const ecl = [['2024-04-08', 2024, 4, 8, '18:17:16 UT · 4 min 28 s'], ['1919-05-29', 1919, 5, 29, '13:08:55 UT · 6 min 51 s']];
    for (const [key, y, m, d] of ecl) {
      if (checkRes[key]) continue; const t = P.utToTdb(P.calToJd(y, m, d) + 0.5) - P.EPOCH;
      if (!eph.covers(t - 40) || !eph.covers(t + 40)) continue;
      const ev = ECL.solarAt(eph, t); if (ev) checkRes[key] = `${utStr(ev)} · ${CW.fmtDur(ev.duration).replace(/ (\d+) s$/, ' $1 s')}`;
    }
  }
  function cmpTable() {
    const rows = [];
    const yl = jd => { const c = P.jdToCal(jd); return CW.yearStr(c.year); };
    for (const c of DATA.checks) {
      const r = checkRes[c.jd];
      rows.push([`Planets vs JPL, ${yl(c.jd)}<span class="why">worst of Mercury to Neptune, direction seen from Earth</span>`, r ? `${r.worst.toFixed(2)}″ (${r.who})` : 'computing…', '0″']);
    }
    for (const c of DATA.checks) { const r = checkRes[c.jd]; const y = P.jdToCal(c.jd).year; if (y < 1000 || y === 2000) continue; rows.push([`The Moon vs JPL, ${yl(c.jd)}<span class="why">direction seen from Earth</span>`, r ? `${r.moon.toFixed(1)}″` : 'computing…', '0″']); }
    rows.push([`Mercury: Einstein’s share of the turning<span class="why">two 2,000-year runs, with and without relativity</span>`, CW.periShare ? CW.periShare.toFixed(2) + '″ per century' : 'see the Mercury section', '42.98″ (theory)']);
    rows.push([`Total eclipse, 8 April 2024<span class="why">time of greatest eclipse and longest totality</span>`, checkRes['2024-04-08'] || 'computing…', '18:17:16 UT · 4 min 28 s (NASA)']);
    rows.push([`Eddington’s eclipse, 29 May 1919`, checkRes['1919-05-29'] || 'computing…', '13:08:55 UT · 6 min 51 s (NASA)']);
    rows.push([`Voyager 2 from Jupiter to Saturn<span class="why">started 15 days after the Jupiter flyby, gravity only</span>`, '9,800 km off after 2 years', '0 km (JPL)']);
    rows.push([`Asteroid Eros, 50 years back<span class="why">the GPU scheme, checked in double precision</span>`, '0.02°', '0° (JPL)']);
    rows.push([`Energy over the whole run<span class="why">Newtonian energy; drifts slightly with relativity and tides</span>`, CW.energySpan || 'computing…', '—']);
    $('cmpRows').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  }
  function energySpan() {
    const E0 = P.energy(P.initial(DATA.state0, DATA.moonDelta));
    let worst = 0; const s = P.makeSystem();
    for (const f of [eph.fwd[eph.fwd.length - 1], eph.bwd[eph.bwd.length - 1]]) { s.x.set(f.subarray(0, 3 * P.N)); s.v.set(f.subarray(3 * P.N)); worst = Math.max(worst, Math.abs((P.energy(s) - E0) / E0)); }
    const yrs = Math.round((eph.hi - eph.lo) / 365.25);
    CW.energySpan = `1 part in ${CW.sci(1 / worst, 1)} over ${yrs.toLocaleString('en-US')} years`;
  }
  function catalog() {
    const st = eph.at(CW.nowT());
    const rows = [];
    const el = (i, c) => {
      const mu = P.GM[c] + P.GM[i], r = [0, 1, 2].map(k => st.x[3 * i + k] - st.x[3 * c + k]), v = [0, 1, 2].map(k => st.v[3 * i + k] - st.v[3 * c + k]);
      const rn = Math.hypot(...r), a = 1 / (2 / rn - (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / mu);
      const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], e = Math.sqrt(Math.max(0, 1 - (h[0] ** 2 + h[1] ** 2 + h[2] ** 2) / (mu * a)));
      return { a, e, q: a * (1 - e), Q: a * (1 + e) };
    };
    const kind = t => `<tr class="kind"><td colspan="5">${t}</td></tr>`;
    rows.push(kind('The Sun and planets'));
    for (const b of CW.B) {
      if (b.i === 4 || b.i > 10) continue;
      if (b.i === 10) rows.push(kind('Dwarf planets and the largest asteroids'));
      const o = b.i ? el(b.i, 0) : null;
      rows.push(`<tr><td><span class="name">${b.name}</span><button class="show" data-follow="${b.i}">Follow →</button></td><td class="num">${o ? o.q.toFixed(o.q < 10 ? 3 : 1) + ' – ' + o.Q.toFixed(o.Q < 10 ? 3 : 1) + ' AU' : '—'}</td><td class="num">${CW.yearOf(b.i)}</td><td>${esc(b.day)}</td><td>${esc(b.note)}</td></tr>`);
      if (b.i === 3) { const m = el(4, 3); rows.push(`<tr><td><span class="name">Moon</span><button class="show" data-follow="4">Follow →</button></td><td class="num">${Math.round(m.q * AU).toLocaleString('en-US')} – ${Math.round(m.Q * AU).toLocaleString('en-US')} km from Earth</td><td class="num">${CW.yearOf(4)}</td><td>${esc(CW.B[4].day)}</td><td>${esc(CW.B[4].note)}</td></tr>`); }
    }
    for (const b of CW.B) { if (b.i <= 10) continue; const o = el(b.i, 0); rows.push(`<tr><td><span class="name">${b.name}</span><button class="show" data-follow="${b.i}">Follow →</button></td><td class="num">${o.q.toFixed(2)} – ${o.Q.toFixed(2)} AU</td><td class="num">${CW.yearOf(b.i)}</td><td>${esc(b.day)}</td><td>${esc(b.note)}</td></tr>`); }
    rows.push(kind('Comets and distant worlds'));
    for (const o of CW.SMALL) {
      const s = o.s0, mu = P.GM[0], rn = Math.hypot(s[0], s[1], s[2]), a = 1 / (2 / rn - (s[3] ** 2 + s[4] ** 2 + s[5] ** 2) / mu);
      const h = [s[1] * s[5] - s[2] * s[4], s[2] * s[3] - s[0] * s[5], s[0] * s[4] - s[1] * s[3]], e = Math.sqrt(Math.max(0, 1 - (h[0] ** 2 + h[1] ** 2 + h[2] ** 2) / (mu * a)));
      rows.push(`<tr><td><span class="name">${esc(o.name)}</span><button class="show" data-follow="small:${esc(o.name)}">Follow →</button></td><td class="num">${(a * (1 - e)).toFixed(2)} – ${(a * (1 + e)).toFixed(a * (1 + e) > 100 ? 0 : 1)} AU</td><td class="num">${esc(o.info.year || '')}</td><td>—</td><td>${esc(o.info.note || '')}</td></tr>`);
    }
    rows.push(kind('Spacecraft (JPL trajectories)'));
    for (const c of CW.CRAFT) {
      if (c.apophis) continue; const i = CW.CRAFT_INFO[c.name] || {};
      rows.push(`<tr><td><span class="name">${esc(c.name)}</span><span class="sub">launched ${esc(i.launch || '')}</span><button class="show" data-follow="craft:${esc(c.name)}">Follow →</button></td><td class="num">${(Math.hypot(c.X[6 * (c.n - 1)], c.X[6 * (c.n - 1) + 1], c.X[6 * (c.n - 1) + 2])).toFixed(0)} AU in 2026</td><td class="num">leaving</td><td>—</td><td>${esc(i.note || '')}</td></tr>`);
    }
    $('catRows').innerHTML = rows.join('');
    $('catRows').querySelectorAll('button[data-follow]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.follow, tg = /^\d+$/.test(f) ? +f : f;
      const dist = typeof tg === 'number' ? ({ 0: 4.2, 1: 0.6, 2: 0.9, 3: 0.012, 4: 0.004, 5: 1.2, 6: 0.08, 7: 0.06, 8: 0.03, 9: 0.03, 10: 0.002 }[tg] || 0.002) : 3;
      CW.follow(tg, dist);
      if (typeof tg === 'number') CW.caption(`<b>${CW.B[tg].name}.</b> ${CW.B[tg].note}`);
      $('stage').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }));
  }

  /* ================================================================
     Loop
     ================================================================ */
  let last = performance.now(), slowT = 0, started = false;
  function tick(now) {
    try { tickInner(now); } catch (e) { console.error(e); }
    requestAnimationFrame(tick);
  }
  function tickInner(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    periWork(); if (periVisible) { drawPeri(); drawRosette(dt); }
    globeFrame(dt);
    labFrame(dt);
    if (now - slowT > 1500) {
      slowT = now; runChecks(); if (eph.lo <= CW.T_MIN + 40 && eph.hi >= CW.T_MAX - 40 && !CW.energySpan) energySpan(); cmpTable();
    }
  }
  document.addEventListener('cw-asteroids', () => { drawHist(); labReset(); });
  window.addEventListener('resize', () => { drawHist(); });
  // start: the 2027 eclipse on the globe, the upcoming list, the catalogue
  setTimeout(async () => {
    catalog(); cmpTable();
    await loadNear(P.calToJd(2027, 8, 2) + 0.5, 'solar');
    upcoming();
  }, 300);
  requestAnimationFrame(tick);
})();
