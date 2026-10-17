// Web-worker side of the simulation. One coordinator owns the spectral state and performs the
// semi-implicit update; N compute workers each own a band of latitude pairs: they build grids,
// run the column physics, and return partial spectral tendencies. Compute workers also send
// display fields for their rows straight to the page.
const DISP_FIELDS = ['cldL', 'cldM', 'cldH', 'cldConv', 'prec', 'Ts', 'slp', 'snow', 'hice', 'W', 'pw', 'olr', 'u10', 'v10', 'u850', 'v850', 'u250', 'v250', 't850', 'precConv', 'rh700', 'cape', 'ctt', 't2'];
self.DISP_FIELDS = DISP_FIELDS;
let role = null, P = null, port = null, cfgG = null;

function packState(md, f32) {
  const L = md.L, ns = md.S.ns, n = (4 * L + 1) * ns;
  if (!f32 || f32.length !== 2 * n) f32 = new Float32Array(2 * n);
  let o = 0;
  for (const v of ['Z', 'D', 'T', 'Q']) { const a = md[v][1]; f32.set(a.re, o); o += L * ns; f32.set(a.im, o); o += L * ns; }
  f32.set(md.LP[1].re, o); o += ns; f32.set(md.LP[1].im, o);
  return f32;
}
function unpackState(md, f32) {
  const L = md.L, ns = md.S.ns; let o = 0;
  for (const v of ['Z', 'D', 'T', 'Q']) { const a = md[v][1]; for (let i = 0; i < L * ns; i++) a.re[i] = f32[o + i]; o += L * ns; for (let i = 0; i < L * ns; i++) a.im[i] = f32[o + i]; o += L * ns; }
  for (let i = 0; i < ns; i++) md.LP[1].re[i] = f32[o + i]; o += ns; for (let i = 0; i < ns; i++) md.LP[1].im[i] = f32[o + i];
}
function packTend(md, f32) {
  const t = md.tend, L = md.L, ns = md.S.ns, n = (4 * L + 1) * ns;
  if (!f32 || f32.length !== 2 * n) f32 = new Float32Array(2 * n);
  let o = 0;
  for (const v of ['Z', 'D', 'T', 'Q']) { f32.set(t[v].re, o); o += L * ns; f32.set(t[v].im, o); o += L * ns; }
  f32.set(t.L.re, o); o += ns; f32.set(t.L.im, o);
  return f32;
}
function addTend(md, f32) {
  const t = md.tend, L = md.L, ns = md.S.ns; let o = 0;
  for (const v of ['Z', 'D', 'T', 'Q']) { const a = t[v]; for (let i = 0; i < L * ns; i++) a.re[i] += f32[o + i]; o += L * ns; for (let i = 0; i < L * ns; i++) a.im[i] += f32[o + i]; o += L * ns; }
  for (let i = 0; i < ns; i++) t.L.re[i] += f32[o + i]; o += ns; for (let i = 0; i < ns; i++) t.L.im[i] += f32[o + i];
}
// full spectral state (both time levels) in float64 for resets/saves
function setFullState(md, st) {
  for (const v of ['Z', 'D', 'T', 'Q']) for (const c of [0, 1]) { md[v][c].re.set(st[v].re); md[v][c].im.set(st[v].im); }
  for (const c of [0, 1]) { md.LP[c].re.set(st.LP.re); md.LP[c].im.set(st.LP.im); }
  md.time = st.time; md.first = true;
}
const SURF_FIELDS = ['Ts', 'Tml', 'hice', 'W', 'snow'];
function setSurfState(ph, st) { for (const f of SURF_FIELDS) if (st[f]) ph[f].set(st[f]); }
function applyParams(Pl, prm, t) {
  const { md, ph } = Pl;
  for (const k in prm) {
    if (k === 'rot') ph.rotTarget = prm.rot;
    else if (k === 'rotT') continue;
    else if (k === 'sidereal') { ph.sidereal = prm.sidereal; md.Om = prm.sidereal; ph.rotTarget = 0; }
    else if (k in ph) ph[k] = prm[k];
  }
}
// when continents disappear, give the new ocean the local zonal-mean sea temperature
function oceanise(Pl) {
  const { md, ph } = Pl, nlon = md.nlon;
  for (const j of md.rows) {
    let s = 0, n = 0;
    for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (!ph.land[p]) { s += ph.Tml[p] > 0 ? ph.Tml[p] : ph.Ts[p]; n++; } }
    const m = n ? s / n : 271.35;
    for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (ph.land[p]) { ph.Tml[p] = ph.Ts[p] = Math.max(m, 271.35); ph.hice[p] = m <= 271.4 ? 1 : 0; ph.snow[p] = 0; ph.W[p] = 0; } }
  }
}
// ---------------- compute worker ----------------
let tendBuf = null, rowsZonal = null;
function computeInit(msg) {
  cfgG = msg.cfg;
  P = buildPlanet(cfgG);
  P.md.setPairs(msg.p0, msg.p1);
  setSurfState(P.ph, msg.surfState);
  if (msg.params) applyParams(P, msg.params, msg.time || 0);
  port = msg.port;
  port.onmessage = (e) => computeMsg(e.data);
}
function computeMsg(m) {
  const { md, ph } = P;
  if (m.type === 'step') {
    unpackState(md, m.state);
    md.time = m.time; md.first = m.first;
    if (m.params) applyParams(P, m.params, m.time);
    md.gridStage();
    const buf = packTend(md, m.state);
    port.postMessage({ type: 'tend', buf, wi: m.wi }, [buf.buffer]);
    if (m.disp) sendDisplay(m.stamp);
  } else if (m.type === 'reset') {
    if (m.surfState) setSurfState(ph, m.surfState);
    if (m.world) { if (m.world === 'aqua' && !m.surfState) oceanise(P); applySurface(P, cfgG.surf, cfgG.qflux, m.world); }
    if (m.params) applyParams(P, m.params, m.time);
    ph._qday = -1;
  } else if (m.type === 'getSurf') {
    const o = {}; for (const f of SURF_FIELDS) o[f] = ph[f].slice();
    port.postMessage({ type: 'surf', rows: md.rows, data: o });
  }
}
function levelNear(md, s) { let b = 0; for (let k = 0; k < md.L; k++) if (Math.abs(md.sf[k] - s) < Math.abs(md.sf[b] - s)) b = k; return b; }
function sendDisplay(stamp) {
  const { md, ph, S } = P, rows = md.rows, nlon = md.nlon, nG = md.nG, nr = rows.length, L = md.L;
  const nf = DISP_FIELDS.length, out = new Float32Array(nf * nr * nlon);
  const k850 = levelNear(md, 0.85), k250 = levelNear(md, 0.25), k700 = levelNear(md, 0.7), k500 = levelNear(md, 0.5);
  for (let r = 0; r < nr; r++) {
    const j = rows[r], ic = 1 / S.coslat[j];
    for (let i = 0; i < nlon; i++) {
      const p = j * nlon + i, o = r * nlon + i;
      let f = 0;
      const put = (v) => { out[(f++) * nr * nlon + o] = v; };
      put(ph.cldL[p]); put(ph.cldM[p]); put(ph.cldH[p]); put(ph.cldConv[p]);
      put(ph.prec[p] * 3600); put(ph.Ts[p] - 273.15); put(ph.slp[p] / 100 - 1000); put(ph.snow[p]);
      put(ph.hice[p]); put(ph.W[p] / ph.Wcap); put(ph.pw[p]); put(ph.olr[p]);
      put(ph.u10[p]); put(ph.v10[p]);
      put(md.U[k850 * nG + p] * ic); put(md.V[k850 * nG + p] * ic);
      put(md.U[k250 * nG + p] * ic); put(md.V[k250 * nG + p] * ic);
      put(md.TG[k850 * nG + p] + md.T0 - 273.15); put(ph.precConv[p] * 3600);
      put(ph.RH[k700 * nG + p]); put(ph.cape[p]);
      put(ph.ctt[p] - 273.15);
      put(ph.t2[p] - 273.15);
    }
  }
  // zonal means per row for the cross-sections: u, v, T, RH, latent heating
  const zm = new Float32Array(5 * L * nr);
  for (let r = 0; r < nr; r++) {
    const j = rows[r], ic = 1 / S.coslat[j];
    for (let k = 0; k < L; k++) {
      let su = 0, sv = 0, st = 0, sr = 0, sh = 0; const o = k * nG + j * nlon;
      for (let i = 0; i < nlon; i++) { su += md.U[o + i]; sv += md.V[o + i]; st += md.TG[o + i]; sr += ph.RH[o + i]; sh += ph.HEAT[o + i]; }
      const b = (r * L + k) * 5;
      zm[b] = su * ic / nlon; zm[b + 1] = sv * ic / nlon; zm[b + 2] = st / nlon + md.T0; zm[b + 3] = sr / nlon; zm[b + 4] = sh / nlon;
    }
  }
  self.postMessage({ type: 'disp', stamp, rows, data: out, zm, time: md.time, orb: [ph.sidereal, ph.rot0, ph.obl, ph.epoch, ph.rotTarget || ph.sidereal] }, [out.buffer, zm.buffer]);
}

// ---------------- coordinator ----------------
const C = { ports: [], W: 0, pending: 0, running: false, stateBuf: null, stamp: 0, dispEvery: 3, stepCount: 0, target: 0, params: null, t0: 0, rate: 0, lastRateT: 0, lastRateSteps: 0, busy: false, queue: [] };
function coordInit(msg) {
  cfgG = msg.cfg;
  P = buildPlanet(Object.assign({}, cfgG, { noPhysics: true }));
  P.md.physics = null;
  setFullState(P.md, msg.state);
  C.ports = msg.ports; C.W = C.ports.length;
  if (msg.params) applyParams(P, msg.params, P.md.time);
  for (const pt of C.ports) pt.onmessage = (e) => coordFromCompute(e.data);
  self.postMessage({ type: 'ready', time: P.md.time });
}
function coordStep() {
  const md = P.md;
  if (C.busy) return;
  C.busy = true;
  const tend = md.tend; for (const k in tend) { tend[k].re.fill(0); tend[k].im.fill(0); }
  C.stateBuf = packState(md, C.stateBuf);
  if (!C.bufs) C.bufs = C.ports.map(() => new Float32Array(C.stateBuf.length));
  C.stepCount++;
  const disp = C.forceDisp || (C.stepCount % C.dispEvery === 0);
  C.forceDisp = false;
  if (disp) C.stamp++;
  C.pending = C.W; C.tSend = performance.now();
  C.ports.forEach((pt, i) => { const b = C.bufs[i]; b.set(C.stateBuf); C.bufs[i] = null; pt.postMessage({ type: 'step', state: b, wi: i, time: md.time, first: md.first, disp, stamp: C.stamp, params: C.params }, [b.buffer]); });
  C.params = null;
}
function coordFromCompute(m) {
  if (m.type === 'tend') {
    const ta = performance.now();
    if (C.pending === C.W) C.tFirst = ta;
    addTend(P.md, m.buf); C.bufs[m.wi] = m.buf;
    C.tAdd = (C.tAdd || 0) + performance.now() - ta;
    if (--C.pending === 0) {
      const tb = performance.now();
      P.md.advance();
      const tc = performance.now();
      C.prof = C.prof || { wait: 0, first: 0, add: 0, adv: 0, n: 0 };
      C.prof.wait += tb - C.tSend; C.prof.first += C.tFirst - C.tSend; C.prof.add += C.tAdd; C.prof.adv += tc - tb; C.prof.n++; C.tAdd = 0;
      C.busy = false;
      const now = performance.now();
      if (now - C.lastRateT > 500) {
        C.rate = (C.stepCount - C.lastRateSteps) / ((now - C.lastRateT) / 1000);
        C.lastRateT = now; C.lastRateSteps = C.stepCount;
        let bad = false; const z = P.md.Z[1].re; for (let i = 0; i < z.length; i += 97) if (!isFinite(z[i])) { bad = true; break; }
        const pr = C.prof; self.postMessage({ type: 'status', time: P.md.time, rate: C.rate, bad, prof: pr && pr.n ? { wait: pr.wait / pr.n, first: pr.first / pr.n, add: pr.add / pr.n, adv: pr.adv / pr.n } : null }); C.prof = null;
        if (bad) { C.running = false; return; }
      }
      coordNext();
    }
  } else if (m.type === 'surf') {
    C.surfParts.push(m);
    if (C.surfParts.length === C.W) finishSnapshot();
  }
}
function coordNext() {
  // drain queued control messages between steps
  while (C.queue.length) coordControl(C.queue.shift());
  if (!C.running) return;
  if (C.target > 0) {
    // throttle to a target number of simulated seconds per real second
    const now = performance.now();
    const want = C.tStart + (P.md.time - C.simStart) / C.target * 1000;
    if (want > now + 1) { setTimeout(coordStep, Math.min(250, want - now)); return; }
  }
  coordStep();
}
function coordControl(m) {
  const md = P.md;
  if (m.type === 'run') {
    const was = C.running; C.running = m.on;
    C.tStart = performance.now(); C.simStart = md.time;
    if (m.on && !was && !C.busy) coordStep();
  } else if (m.type === 'speed') {
    C.target = m.target; C.tStart = performance.now(); C.simStart = md.time; C.dispEvery = m.dispEvery || C.dispEvery;
  } else if (m.type === 'params') {
    applyParams(P, m.params, md.time);
    C.params = Object.assign(C.params || {}, m.params);
  } else if (m.type === 'reset') {
    if (m.state) setFullState(md, m.state);
    if (m.world) {
      // hydrostatic surface-pressure adjustment for the change of surface height
      const S = md.S, nG = md.nG, old = md.phisG.slice();
      applySurface(P, cfgG.surf, cfgG.qflux, m.world);
      if (!m.state) {
        const lp = new Float64Array(nG);
        for (const c of [0, 1]) {
          S.toGrid(md.LP[c].re, md.LP[c].im, lp);
          for (let p = 0; p < nG; p++) lp[p] += (old[p] - md.phisG[p]) / (md.R * 275);
          S.toSpec(lp, md.LP[c].re, md.LP[c].im);
        }
      }
    }
    if (m.params) applyParams(P, m.params, md.time);
    for (const pt of C.ports) pt.postMessage({ type: 'reset', surfState: m.surfState, world: m.world, params: m.params, time: md.time });
    C.forceDisp = true; C.tStart = performance.now(); C.simStart = md.time;
    if (!C.running) { C.running = true; coordStep(); C.running = m.run !== false; if (!C.running) C.after = true; }
  } else if (m.type === 'snapshot') {
    C.surfParts = []; C.snapId = m.id;
    for (const pt of C.ports) pt.postMessage({ type: 'getSurf' });
  } else if (m.type === 'disp') {
    C.forceDisp = true; if (!C.running && !C.busy) { C.running = true; coordStep(); C.running = false; }
  }
}
function finishSnapshot() {
  const md = P.md, st = { time: md.time };
  for (const v of ['Z', 'D', 'T', 'Q', 'LP']) st[v] = { re: md[v][1].re.slice(), im: md[v][1].im.slice() };
  const surf = {}; for (const f of SURF_FIELDS) surf[f] = new Float64Array(md.nG);
  for (const part of C.surfParts) for (const j of part.rows) for (const f of SURF_FIELDS) { const o = j * md.nlon; surf[f].set(part.data[f].subarray(o, o + md.nlon), o); }
  self.postMessage({ type: 'snapshot', id: C.snapId, state: st, surf });
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'initCompute') { role = 'compute'; computeInit(m); return; }
  if (m.type === 'initCoord') { role = 'coord'; coordInit(m); return; }
  if (role === 'coord') {
    if (C.busy) C.queue.push(m); else coordControl(m);
  }
};
