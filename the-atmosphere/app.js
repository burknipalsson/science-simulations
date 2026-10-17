// The Atmosphere: page logic (simulation client, rendering loop, interaction, HUD, station).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DAY = 86400, DEG = Math.PI / 180;
  const canvas = $('sky');
  const A = window.ATM = {}; // shared with sections.js

  // ---------------- data ----------------
  async function decodePack(b64) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ds = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    const buf = await new Response(ds).arrayBuffer();
    const dv = new DataView(buf), n = dv.getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
    const base = 4 + n + ((4 - ((4 + n) % 4)) % 4), out = {};
    for (const [k, [type, off, len]] of Object.entries(meta.index)) {
      const C = { Float32Array, Uint8Array, Float64Array, Int32Array }[type];
      out[k] = new C(buf.slice(base + off, base + off + len * C.BYTES_PER_ELEMENT));
    }
    return { meta, arr: out };
  }
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

  // ---------------- sun (mirrors physics.js) ----------------
  const OMEGA_E = 360.98564736629 * DEG / DAY;
  const prm = { S0: 1361, green: 1, obl: 23.44, ecc: 0.0167, sidereal: OMEGA_E, rot0: 0, epoch: 9496.5 };
  A.OMEGA_E = OMEGA_E;
  A.prm = prm;
  function sunInfo(t) {
    const d = prm.epoch + t / DAY;
    const gM = (357.529 + 0.98560028 * d) * DEG, qL = (280.459 + 0.98564736 * d) * DEG;
    const eF = prm.ecc / 0.0167;
    const lam = qL + eF * (1.915 * Math.sin(gM) + 0.020 * Math.sin(2 * gM)) * DEG;
    const ob = prm.obl * DEG;
    const dec = Math.asin(Math.sin(ob) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(ob) * Math.sin(lam), Math.cos(lam));
    const T = prm.epoch * DAY + t, rot = 280.46061837 * DEG + prm.rot0 + OMEGA_E * T + (prm.sidereal - OMEGA_E) * T;
    const slon = ra - rot;
    return { dec, slon, vec: [Math.cos(dec) * Math.cos(slon), Math.cos(dec) * Math.sin(slon), Math.sin(dec)] };
  }
  A.sunInfo = sunInfo;
  function dateOf(t) { return new Date(Date.UTC(2000, 0, 1, 12) + (prm.epoch + t / DAY) * DAY * 1000); }
  A.dateOf = dateOf;

  // ---------------- boot ----------------
  let E, pack, S, nlat, nlon, nG;
  const fields = []; // assembled display fields (Float32Array nG each)
  let asm = null;
  async function boot() {
    pack = await decodePack(PACK_B64);
    const m = pack.meta; nlat = m.nlat; nlon = 2 * nlat; nG = nlat * nlon;
    A.meta = m; A.nlat = nlat; A.nlon = nlon;
    S = new Spectral(m.M, nlat, nlon, 6.371e6);
    A.S = S;
    const [day, night, land, elev] = await Promise.all([IMG.day, IMG.night, IMG.land, IMG.elev].map(loadImg));
    try {
      E = new Engine(canvas, { nlat, nlon, lats: S.lat, preserve: /[?&]shot/.test(location.search) });
    } catch (e) { console.error('engine: ' + e.message); showNoGL(); return; }
    A.E = E;
    E.setImages({ day, night, land, elev });
    for (let f = 0; f < 24; f++) fields.push(new Float32Array(nG));
    // start in the season nearest today's date
    const now = new Date(), doyNow = (now - Date.UTC(now.getUTCFullYear(), 0, 1)) / 864e5;
    let best = 0, bd = 1e9;
    pack.meta.states.forEach((s, i) => { const sd = ((s.epoch + s.time / DAY - 9496.5) % 365.2422 + 365.2422) % 365.2422; let dd = Math.abs(sd - doyNow); dd = Math.min(dd, 365.2422 - dd); if (dd < bd) { bd = dd; best = i; } });
    A.season = best;
    startSim(best);
    setupUI();
    requestAnimationFrame(frame);
  }
  function showNoGL() { $('status').hidden = true; const d = document.createElement('div'); d.className = 'nogl'; d.textContent = 'This page needs WebGL 2 with floating-point render targets. Try a recent Chrome, Edge, Firefox or Safari on a computer.'; $('stage').appendChild(d); }

  // ---------------- simulation client (workers) ----------------
  const sim = { coord: null, comps: [], W: 0, time: 0, rate: 0, running: true, stampParts: new Map(), snaps: [], zm: null };
  A.sim = sim;
  function stateFromPack(i) {
    const a = pack.arr, m = pack.meta, ns = S.ns, L = m.L, f = a['st' + i];
    const st = { time: m.states[i].time }; let o = 0;
    for (const v of ['Z', 'D', 'T', 'Q']) { st[v] = { re: Float64Array.from(f.subarray(o, o + L * ns)), im: Float64Array.from(f.subarray(o + L * ns, o + 2 * L * ns)) }; o += 2 * L * ns; }
    st.LP = { re: Float64Array.from(f.subarray(o, o + ns)), im: Float64Array.from(f.subarray(o + ns, o + 2 * ns)) };
    const surf = {}; for (const k of ['Ts', 'Tml', 'hice', 'W', 'snow']) surf[k] = Float64Array.from(a['st' + i + k]);
    return { st, surf };
  }
  function cfgFor() {
    const a = pack.arr, m = pack.meta;
    const q = m.qflux ? Array.from({ length: 12 }, (_, k) => a.qflux.subarray(k * nG, (k + 1) * nG)) : null;
    return { M: m.M, nlat, L: m.L, dt: m.dt, epoch: prm.epoch, surf: { land: a.land, zs: a.zs, alb: a.alb, sheet: a.sheet, z0: a.z0 }, qflux: q, world: 'earth' };
  }
  // A stand-in for Web Workers when the page cannot start them: the same code runs on the main thread
  function FakeWorker() {
    const w = this; w.onmessage = null;
    const scope = { onmessage: null, postMessage(m) { setTimeout(() => w.onmessage && w.onmessage({ data: m }), 0); } };
    scope.self = scope;
    WorkerScope(scope);
    w.postMessage = (m) => setTimeout(() => scope.onmessage && scope.onmessage({ data: m }), 0);
    w.terminate = () => {};
  }
  function startSim(si, fallback) {
    if (/[?&]noworker/.test(location.search)) fallback = true;
    let url = null;
    if (!fallback) {
      try { const src = $('wsrc').textContent; url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); } catch (e) { fallback = true; }
    }
    const mk = () => fallback ? new FakeWorker() : new Worker(url);
    const hc = navigator.hardwareConcurrency || 4;
    const W = fallback ? 1 : Math.max(1, Math.min(16, hc - 2, nlat >> 2));
    sim.W = W; sim.fallback = !!fallback; sim.ready = false;
    const init = stateFromPack(si);
    prm.epoch = pack.meta.states[si].epoch || prm.epoch;
    sim.time = init.st.time; sim.t0 = init.st.time;
    const cfg = cfgFor();
    try {
      sim.coord = mk();
      sim.comps = [];
      const ports = [];
      const nh = nlat >> 1;
      for (let w = 0; w < W; w++) {
        const ch = new MessageChannel();
        const cw = mk();
        cw.onmessage = (e) => onCompute(e.data);
        cw.onerror = () => failover(si);
        cw.postMessage({ type: 'initCompute', cfg, p0: Math.floor(w * nh / W), p1: Math.floor((w + 1) * nh / W), surfState: init.surf, port: ch.port2, time: init.st.time }, [ch.port2]);
        sim.comps.push(cw); ports.push(ch.port1);
      }
      sim.coord.onmessage = (e) => onCoord(e.data);
      sim.coord.onerror = () => failover(si);
      sim.coord.postMessage({ type: 'initCoord', cfg, state: init.st, ports }, ports);
      sim.coord.postMessage({ type: 'speed', target: speedTargets[+$('speed').value], dispEvery: fallback ? 1 : 2 });
      sim.coord.postMessage({ type: 'run', on: sim.running });
    } catch (e) { if (!fallback) return failover(si); throw e; }
    if (!fallback) setTimeout(() => { if (!sim.ready) failover(si); }, 6000);
  }
  function failover(si) {
    if (sim.fallback) return;
    console.warn('web workers unavailable; running the model on the main thread');
    try { sim.coord && sim.coord.terminate(); sim.comps.forEach((c) => c.terminate()); } catch (e) { }
    sim.stampParts.clear();
    startSim(si, true);
  }
  function send(m) { sim.coord.postMessage(m); }
  // restart from packed state i with Earth's settings
  A.restart = function (i) {
    const init = stateFromPack(i);
    prm.epoch = pack.meta.states[i].epoch || prm.epoch; prm.rot0 = 0; prm.sidereal = OMEGA_E; prm.obl = 23.44;
    const params = { epoch: prm.epoch, rot0: 0, sidereal: OMEGA_E, S0: 1361, green: 1, obl: 23.44, mld: 50 };
    send({ type: 'reset', state: init.st, surfState: init.surf, world: 'earth', params, run: sim.running });
    sim.t0 = init.st.time;
    station.rec = [];
    clock.has = 0; lastT = null;
    if (A.onRestart) A.onRestart();
  };
  A.send = send;
  function onCoord(m) {
    if (m.type === 'status') { sim.rate = m.rate; sim.prof = m.prof; if (m.bad) { $('statusText').textContent = 'the model became unstable — press Earth to restart'; $('status').hidden = false; } }
    else if (m.type === 'ready') { sim.ready = true; }
    else if (m.type === 'snapshot' && A.onSnapshot) A.onSnapshot(m);
  }
  function onCompute(m) {
    if (m.type !== 'disp') return;
    if (m.orb) { prm.sidereal = m.orb[0]; prm.rot0 = m.orb[1]; prm.obl = m.orb[2]; prm.epoch = m.orb[3]; sim.rotTarget = m.orb[4]; }
    let part = sim.stampParts.get(m.stamp);
    if (!part) { part = { n: 0, time: m.time, zm: new Float32Array(5 * pack.meta.L * nlat) }; sim.stampParts.set(m.stamp, part); }
    const rows = m.rows, nr = rows.length, d = m.data;
    for (let f = 0; f < 24; f++) { const dst = fields[f], o = f * nr * nlon; for (let r = 0; r < nr; r++) dst.set(d.subarray(o + r * nlon, o + (r + 1) * nlon), rows[r] * nlon); }
    const L = pack.meta.L;
    for (let r = 0; r < nr; r++) part.zm.set(m.zm.subarray(r * L * 5, (r + 1) * L * 5), rows[r] * L * 5);
    if (++part.n === sim.W) {
      sim.stampParts.delete(m.stamp);
      for (const k of sim.stampParts.keys()) if (k < m.stamp) sim.stampParts.delete(k);
      newSnapshot(part.time, part.zm);
    }
  }
  // display field order in the engine: A cloud(L,M,H,conv) B (prec,Ts,slp,snow) C (ice,W,pw,olr) D (u10,v10,u250,v250) E (u850,v850,t850,precConv) F (rh700,cape,omega500,t2)
  const ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 14, 15, 18, 19, 20, 21, 22, 23];
  const ordered = ORDER.map((i) => null);
  const clock = { t0: 0, t1: 0, arr: 0, iv: 400, shown: 0, has: 0 };
  function newSnapshot(t, zm) {
    for (let i = 0; i < 24; i++) ordered[i] = fields[ORDER[i]];
    E.upload(ordered);
    const now = performance.now();
    if (clock.has) clock.iv = clock.iv * 0.8 + Math.min(1500, now - clock.arr) * 0.2;
    clock.t0 = clock.has ? clock.t1 : t; clock.t1 = t; clock.arr = now; clock.has++;
    if (clock.has === 1) E.upload(ordered); // fill both snapshots
    sim.time = t;
    stats(t);
    if (A.onStats) A.onStats(t, fields);
    stationSample(t);
    if (A.onZonal) A.onZonal(zm, t);
    $('status').hidden = true;
  }

  // ---------------- global statistics & pressure centres ----------------
  const hud = { t2: 0, rain: 0, pw: 0, low: null, wind: 0, ice: 0 };
  A.hud = hud;
  let centres = [];
  function stats(t) {
    const w = S.w; let sw = 0, st = 0, sr = 0, sp = 0, si = 0, mw = 0;
    const t2 = fields[23], pr = fields[4], pw = fields[10], ice = fields[8], u = fields[12], v = fields[13], slp = fields[6];
    let lowV = 1e9, lowP = -1;
    for (let j = 0; j < nlat; j++) for (let i = 0; i < nlon; i++) {
      const p = j * nlon + i, ww = w[j];
      sw += ww; st += ww * t2[p]; sr += ww * (pr[p] > 0.1 ? 1 : 0); sp += ww * pw[p];
      if (ice[p] > 0.05) si += ww;
      const ws = Math.hypot(u[p], v[p]); if (ws > mw) mw = ws;
      if (slp[p] < lowV) { lowV = slp[p]; lowP = p; }
    }
    hud.t2 = st / sw; hud.rain = sr / sw; hud.pw = sp / sw; hud.wind = mw; hud.ice = si / sw * 510.1 * 0.7; // rough: fraction of Earth area (km2 e6), ocean share
    hud.ice = si / sw * 510.1;
    hud.low = { v: lowV + 1000, lat: S.lat[Math.floor(lowP / nlon)], lon: S.lon[lowP % nlon] };
    // local extrema of sea-level pressure for H / L labels
    centres = [];
    const R = 4;
    for (let j = 2; j < nlat - 2; j++) for (let i = 0; i < nlon; i++) {
      const p = j * nlon + i, x = slp[p];
      const isLow = x < -2, isHigh = x > 22;
      if (!isLow && !isHigh) continue;
      let ext = true;
      for (let dj = -R; dj <= R && ext; dj++) { const jj = j + dj; if (jj < 0 || jj >= nlat) continue; const ri = Math.round(R / Math.max(0.2, S.coslat[jj])); for (let di = -Math.min(ri, nlon / 2); di <= Math.min(ri, nlon / 2 - 1); di++) { if (!dj && !di) continue; const q = jj * nlon + ((i + di + nlon) % nlon); if (isLow ? slp[q] < x : slp[q] > x) { ext = false; break; } } }
      if (ext) centres.push({ kind: isLow ? 'L' : 'H', v: x + 1000, lat: S.lat[j], lon: S.lon[i] });
    }
  }

  // ---------------- weather station ----------------
  const station = { on: true, lat: 64.13 * DEG, lon: -21.9 * DEG, name: 'Reykjavík', rec: [] };
  A.station = station;
  function sampleAt(f, lat, lon) {
    // bilinear on the Gaussian grid
    let j = 0; while (j < nlat - 2 && S.lat[j + 1] > lat) j++;
    const fy = Math.max(0, Math.min(1, (S.lat[j] - lat) / (S.lat[j] - S.lat[j + 1])));
    const x = (((lon % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * nlon, i0 = Math.floor(x) % nlon, i1 = (i0 + 1) % nlon, fx = x - Math.floor(x);
    const a = f[j * nlon + i0] * (1 - fx) + f[j * nlon + i1] * fx, b = f[(j + 1) * nlon + i0] * (1 - fx) + f[(j + 1) * nlon + i1] * fx;
    return a * (1 - fy) + b * fy;
  }
  A.sampleAt = (fi, lat, lon) => sampleAt(fields[fi], lat, lon);
  function stationSample(t) {
    if (!station.on) return;
    const g = (fi) => sampleAt(fields[fi], station.lat, station.lon);
    const u = g(12), v = g(13);
    const cl = 1 - (1 - Math.min(1, g(0))) * (1 - Math.min(1, g(1)) * 0.8) * (1 - Math.min(1, g(2)) * 0.5);
    const last = station.rec[station.rec.length - 1];
    if (last && t < last.t) station.rec = [];
    if (last && t - last.t < 1800) return;
    station.rec.push({ t, p: g(6) + 1000, T: g(23), w: Math.hypot(u, v), dir: (Math.atan2(-u, -v) / DEG + 360) % 360, r: Math.max(0, g(4)), c: cl, snow: g(23) < 0 });
    while (station.rec.length && station.rec[0].t < t - 10 * DAY) station.rec.shift();
    station.dirty = true;
  }
  function setStation(lon, lat, name) {
    station.lat = lat; station.lon = lon; station.rec = []; station.on = true;
    station.name = name || `${Math.abs(lat / DEG).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon / DEG).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
    $('stationHud').hidden = false;
    E.station = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    station.dirty = true;
  }
  A.setStation = setStation;
  function drawStation() {
    const cv = $('stChart'), dpr = Math.min(2, devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const rec = station.rec; if (rec.length < 2) return;
    const t1 = rec[rec.length - 1].t, t0 = t1 - 10 * DAY;
    const X = (t) => 30 + (t - t0) / (t1 - t0) * (W - 60);
    // day ticks
    c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = 'rgba(230,234,240,0.35)'; c.strokeStyle = 'rgba(230,234,240,0.08)';
    for (let d = Math.ceil(t0 / DAY) * DAY; d <= t1; d += DAY) { const x = X(d); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H - 12); c.stroke(); c.fillText(String(dateOf(d).getUTCDate()), x + 2, H - 2); }
    // rain bars (bottom 30%)
    const rb = H - 14, rh = H * 0.28;
    for (const r of rec) if (r.r > 0.02) { const hgt = Math.min(rh, Math.sqrt(r.r / 4) * rh); c.fillStyle = r.snow ? 'rgba(220,235,255,0.85)' : 'rgba(95,208,138,0.8)'; c.fillRect(X(r.t) - 1, rb - hgt, 2.2, hgt); }
    // pressure
    let pmin = 1e9, pmax = -1e9, Tmin = 1e9, Tmax = -1e9;
    for (const r of rec) { pmin = Math.min(pmin, r.p); pmax = Math.max(pmax, r.p); Tmin = Math.min(Tmin, r.T); Tmax = Math.max(Tmax, r.T); }
    const pc = (pmin + pmax) / 2, ps = Math.max(12, pmax - pmin + 4), tc = (Tmin + Tmax) / 2, ts = Math.max(6, Tmax - Tmin + 2);
    const top = 6, bot = H - 14 - rh - 4;
    const YP = (p) => top + (0.5 - (p - pc) / ps) * (bot - top), YT = (T) => top + (0.5 - (T - tc) / ts) * (bot - top);
    const line = (key, Y, col) => { c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); rec.forEach((r, i) => { const x = X(r.t), y = Y(r[key]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); };
    line('p', YP, '#8fc3ec'); line('T', YT, '#ff9d5c');
    c.fillStyle = '#8fc3ec'; c.textAlign = 'left'; c.fillText(Math.round(pc + ps / 2) + '', 0, top + 8); c.fillText(Math.round(pc - ps / 2) + '', 0, bot);
    c.fillStyle = '#ff9d5c'; c.textAlign = 'right'; c.fillText(Math.round(tc + ts / 2) + '°', W, top + 8); c.fillText(Math.round(tc - ts / 2) + '°', W, bot);
    c.textAlign = 'left';
    const r = rec[rec.length - 1];
    const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(r.dir / 45) % 8];
    $('stNow').innerHTML = `<span style="color:#8fc3ec">pressure<b>${r.p.toFixed(0)} hPa</b></span><span style="color:#ff9d5c">air<b>${r.T.toFixed(1)} °C</b></span><span>wind<b>${(r.w).toFixed(0)} m/s ${card}</b></span><span style="color:#5fd08a">${r.snow ? 'snow' : 'rain'}<b>${r.r < 0.05 ? '—' : r.r.toFixed(1) + ' mm/h'}</b></span>`;
    $('stName').textContent = station.name;
    $('stWhere').textContent = 'last 10 days · local ' + localTime(sim.time, station.lon);
  }
  function localTime(t, lon) { const si = sunInfo(t); let h = ((lon - si.slon) / (2 * Math.PI) * 24 + 12); h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} sun time`; }

  // ---------------- speed ----------------
  const speedTargets = [3600, 6 * 3600, DAY, 3 * DAY, 0];
  const speedNames = ['1 hour a second', '6 hours a second', '1 day a second', '3 days a second', 'as fast as possible'];

  // ---------------- UI ----------------
  function setupSeasons() {
    const host = $('seasons'); if (!host || pack.meta.states.length < 2) return;
    host.innerHTML = pack.meta.states.map((s, i) => `<button class="chip" data-s="${i}" aria-pressed="${i === A.season}">${s.name}</button>`).join('');
    host.querySelectorAll('.chip').forEach((b) => b.onclick = () => { A.season = +b.dataset.s; host.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === b)); if (A.preset) A.preset('earth'); else A.restart(A.season); });
  }
  function setupUI() {
    setupSeasons();
    $('playBtn').onclick = () => { sim.running = !sim.running; send({ type: 'run', on: sim.running }); $('playBtn').textContent = sim.running ? 'Pause' : 'Play'; };
    const sp = $('speed');
    const setSpeed = () => { const v = +sp.value; $('speedOut').textContent = speedNames[v]; A.dayNightUser = undefined; $('dayNight').setAttribute('aria-pressed', v < 2); send({ type: 'speed', target: speedTargets[v], dispEvery: v <= 1 ? 1 : 2 }); };
    sp.oninput = setSpeed; $('speedOut').textContent = speedNames[+sp.value];
    $('mapBtn').onclick = () => { E.view.map = !E.view.map; $('mapBtn').setAttribute('aria-pressed', E.view.map); if (E.view.map) { E.view.mapLon = E.cam.lon; E.view.mapLat = 0; E.view.mapZoom = 1; } };
    $('icelandBtn').onclick = () => { flyTo(-19 * DEG, 62 * DEG, 1.9); setStation(-21.9 * DEG, 64.13 * DEG, 'Reykjavík'); };
    $('stationX').onclick = () => { station.on = false; $('stationHud').hidden = true; E.station = null; };
    document.querySelectorAll('#layers .chip').forEach((b) => b.onclick = () => {
      document.querySelectorAll('#layers .chip').forEach((x) => x.setAttribute('aria-pressed', x === b)); E.layer = +b.dataset.layer; colorKey();
    });
    const dn = $('dayNight');
    dn.onclick = () => { A.dayNightUser = dn.getAttribute('aria-pressed') !== 'true'; dn.setAttribute('aria-pressed', A.dayNightUser); };
    document.querySelectorAll('#overlays .chip[data-key], #overlays .chip[data-wind]').forEach((b) => b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      if (b.dataset.wind) { document.querySelectorAll('#overlays [data-wind]').forEach((x) => x.setAttribute('aria-pressed', 'false')); E.wind = on ? +b.dataset.wind : 0; }
      else E[b.dataset.key] = on;
      b.setAttribute('aria-pressed', on);
    });
    setupInteraction();
    setStation(station.lon, station.lat, station.name);
    // save power: skip drawing when the globe is off screen, pause the model while the tab is hidden
    A.stageVisible = true;
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { A.stageVisible = es[0].isIntersecting; }).observe($('stage'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (sim.running) { A.hiddenPause = true; send({ type: 'run', on: false }); } }
      else if (A.hiddenPause) { A.hiddenPause = false; send({ type: 'run', on: true }); }
    });
    if (A.setupPlanet) A.setupPlanet();
  }
  function colorKey() {
    const k = $('colorKey'), L = E.layer;
    const defs = {
      1: ['Air temperature near the ground', 'linear-gradient(90deg,#3b1a73,#2659d9,#59bff2,#f2f2d9,#fab340,#d9332a,#730d26)', ['−40', '−20', '0', '20', '40 °C']],
      6: ['Ground and sea-surface temperature', 'linear-gradient(90deg,#3b1a73,#2659d9,#59bff2,#f2f2d9,#fab340,#d9332a,#730d26)', ['−40', '−20', '0', '20', '40 °C']],
      2: ['Rain (colours) and snow (white to violet)', 'linear-gradient(90deg,#59a6ff,#1ad973,#ffe633,#ff5926,#e633e6)', ['0.1', '0.5', '2', '10 mm/h']],
      5: ['Infrared: cloud-top temperature (works day and night)', 'linear-gradient(90deg,#000,#fff 70%,#4dbfff 76%,#2659f2 84%,#f23333 92%,#fff24d)', ['+30', '−20', '−50', '−80 °C']],
      3: ['Water vapour in the column', 'linear-gradient(90deg,#0d1233,#1a5999,#33b3b3,#d9f299)', ['0', '20', '40', '60 mm']],
    };
    if (!defs[L]) { k.hidden = true; return; }
    const d = defs[L]; k.hidden = false;
    k.innerHTML = `${d[0]}<div class="bar" style="background:${d[1]}"></div><div class="ticks">${d[2].map((x) => `<span>${x}</span>`).join('')}</div>`;
  }
  // ---------------- camera interaction ----------------
  let fly = null;
  function flyTo(lon, lat, dist, ms = 1600) {
    if (E.view.map) { E.view.mapLon = lon; E.view.mapLat = lat; E.view.mapZoom = 3; return; }
    const c = E.cam; let dl = lon - c.lon; dl = ((dl + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    fly = { t0: performance.now(), ms, from: [c.lon, c.lat, c.dist], to: [c.lon + dl, lat, dist] };
  }
  A.flyTo = flyTo;
  function setupInteraction() {
    let drag = null, moved = 0;
    const pts = new Map();
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); drag = [e.clientX, e.clientY]; moved = 0; fly = null; });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        const [c2, d2] = [...pts.values()]; const d1 = Math.hypot(c2[0] - d2[0], c2[1] - d2[1]);
        zoomBy(d0 / Math.max(1, d1)); moved += 10; return;
      }
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy);
      const h = canvas.clientHeight;
      if (E.view.map) { E.view.mapLon -= dx / canvas.clientWidth * 2 * Math.PI / E.view.mapZoom; E.view.mapLat += dy / h * Math.PI / E.view.mapZoom * (canvas.clientHeight / canvas.clientWidth) * 2; E.view.mapLat = Math.max(-1.3, Math.min(1.3, E.view.mapLat)); }
      else { const k = 2 * Math.tan(E.fovY() / 2) * (E.cam.dist - 1) / h * 1.2; E.cam.lon -= dx * k / Math.max(0.3, Math.cos(E.cam.lat)); E.cam.lat = Math.max(-1.5, Math.min(1.5, E.cam.lat + dy * k)); }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (drag && moved < 5 && e.type === 'pointerup') { const r = canvas.getBoundingClientRect(); const ll = E.pick(e.clientX - r.left, e.clientY - r.top); if (ll) setStation(ll[0], ll[1]); }
      drag = null;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  }
  function zoomBy(f) {
    if (E.view.map) { E.view.mapZoom = Math.max(1, Math.min(14, E.view.mapZoom / f)); return; }
    E.cam.dist = 1 + Math.max(0.12, Math.min(7, (E.cam.dist - 1) * f));
  }

  // ---------------- frame ----------------
  let lastT = null, lastHud = 0, cloudInit = true, lastFrame = performance.now();
  const perf = { sum: 0, n: 0, scale: 1 }; A.perf = perf;
  function frame(now) {
    requestAnimationFrame(frame);
    // adaptive resolution: keep the frame time reasonable on slower graphics chips
    const fdt = now - lastFrame;
    if (fdt > 0 && fdt < 200) { perf.sum += fdt; perf.n++; }
    if (perf.n >= 45) { const avg = perf.sum / perf.n; perf.sum = 0; perf.n = 0;
      if (avg > 24 && perf.scale > 0.45) perf.scale *= 0.85; else if (avg < 14 && perf.scale < 1) perf.scale = Math.min(1, perf.scale * 1.08); }
    const dpr = Math.min(2, window.devicePixelRatio || 1) * perf.scale;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (fly) { const f = Math.min(1, (now - fly.t0) / fly.ms), s = f * f * (3 - 2 * f); E.cam.lon = fly.from[0] + (fly.to[0] - fly.from[0]) * s; E.cam.lat = fly.from[1] + (fly.to[1] - fly.from[1]) * s; E.cam.dist = fly.from[2] + (fly.to[2] - fly.from[2]) * s; if (f >= 1) fly = null; }
    if (!clock.has) return;
    // interpolate between the two latest snapshots
    const mix = Math.max(0, Math.min(1, (now - clock.arr) / clock.iv));
    E.mix = mix;
    const t = clock.t0 + (clock.t1 - clock.t0) * mix;
    const si = sunInfo(t); E.sun = si.vec;
    const wantDN = A.dayNightUser !== undefined ? A.dayNightUser : +$('speed').value < 2;
    E.allDay += ((wantDN ? 0 : 1) - E.allDay) * 0.08;
    const dtSim = lastT === null ? 0 : Math.max(0, Math.min(6 * 3600, t - lastT));
    if (lastT !== null && t < lastT - 3600) cloudInit = true;
    lastT = t;
    if (!A.stageVisible) { lastFrame = now; if (now - lastHud > 250) { lastHud = now; updateHud(t); } if (A.onFrame) A.onFrame(now, t); return; }
    E.advectClouds(dtSim, t, cloudInit); cloudInit = false;
    if (E.wind) { const z = E.view.map ? 1 / E.view.mapZoom : (E.cam.dist - 1) / 2.1; E.stepParticles(E.wind === 2 ? 2 : 0, 700 * Math.max(0.15, Math.min(1.5, z)) * (E.wind === 2 ? 0.6 : 1.4)); }
    E.draw((now / 1000));
    lastFrame = now;
    tags();
    if (now - lastHud > 250) { lastHud = now; updateHud(t); if (station.on && station.dirty) { drawStation(); station.dirty = false; } }
    if (A.onFrame) A.onFrame(now, t);
  }
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function updateHud(t) {
    const d = dateOf(t);
    $('dateText').textContent = `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
    $('dateSmall').textContent = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC · day ${Math.max(1, Math.floor((t - sim.t0) / DAY) + 1)} of this run`;
    $('rTemp').textContent = hud.t2.toFixed(1) + ' °C';
    $('rRain').textContent = (hud.rain * 100).toFixed(0) + '% of Earth';
    $('rPW').textContent = hud.pw.toFixed(1) + ' mm';
    if (hud.low) $('rLow').textContent = `${hud.low.v.toFixed(0)} hPa, ${Math.abs(hud.low.lat / DEG).toFixed(0)}°${hud.low.lat > 0 ? 'N' : 'S'}`;
    $('rWind').textContent = hud.wind.toFixed(0) + ' m/s near ground';
    $('rIce').textContent = (hud.ice).toFixed(1) + ' million km²';
    const r = sim.rate * pack.meta.dt / DAY;
    $('rRate').textContent = sim.running ? (r >= 1 ? r.toFixed(1) + ' days/s' : (r * 24).toFixed(1) + ' hours/s') : 'paused';
  }
  // H / L pressure-centre labels
  const tagPool = [];
  function tags() {
    const host = $('tags');
    const show = E.isobars;
    let n = 0;
    if (show) for (const c of centres) {
      const [x, y, vis] = E.project(c.lon, c.lat);
      if (!vis) continue;
      let el = tagPool[n]; if (!el) { el = document.createElement('div'); host.appendChild(el); tagPool.push(el); }
      el.className = 'hl ' + c.kind; el.style.display = '';
      el.innerHTML = `${c.kind}<small>${c.v.toFixed(0)}</small>`;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      n++;
    }
    for (let i = n; i < tagPool.length; i++) tagPool[i].style.display = 'none';
  }
  A.fields = fields;
  boot().catch((e) => { console.error(e); $('statusText').textContent = 'could not start: ' + e.message; });
})();
