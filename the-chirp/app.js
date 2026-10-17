(() => {
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MLY_PER_MPC = 3.26156, KM_PER_M = Wave.RSUN_KM, PROTON_M = 1.68e-15, ARM_M = 4000;
  const H1_DELAY = 0.0069;   // GW150914: Hanford 6.9 ms after Livingston, trace flipped

  /* ================================================================
     Events
     ================================================================ */
  const EVENTS = {
    gw150914: { name: 'GW150914', m1: 36, m2: 29, D: 410,
      caption: '<b>14 September 2015.</b> The first gravitational waves ever detected. Two black holes of 36 and 29 suns, about 1.3 billion light-years away, merged into one of 62. The missing 3 suns left as gravitational waves in a fraction of a second.' },
    gw170817: { name: 'GW170817', m1: 1.46, m2: 1.27, D: 40,
      caption: '<b>17 August 2017.</b> Two neutron stars, each a ball of 1.3 to 1.5 suns only about 24 km across. LIGO followed their chirp for 100 seconds. A gamma-ray burst arrived 1.7 s after the merger, and telescopes then watched a kilonova glow in galaxy NGC 4993.' },
    gw190521: { name: 'GW190521', m1: 85, m2: 66, D: 5300,
      caption: '<b>21 May 2019.</b> The heaviest merger at the time: 85 and 66 suns made a black hole of about 142, the first "intermediate-mass" black hole caught forming. The waves left about 7 billion years ago and lasted only four cycles in the detectors.' },
  };

  const State = {
    ev: 'gw150914', m1: 36, m2: 29, D: 410, customName: null,
    playing: !reduceMotion, speed: 1, pitch: 4, sound: false, two: false, grid: true, spin: !reduceMotion,
    yaw: -0.9, el: 0.62, zoom: 1,
  };

  /* ================================================================
     Model and timeline
     ================================================================ */
  let ev = null;           // current event: waveform + timeline constants
  let t = 0;               // simulation time, seconds at Earth, 0 = peak strain
  let wallAfterPeak = 0, holdAtEnd = 0, realTake = null;
  const S = {};            // scratch state from Wave.at

  function displayStart(m1, m2, D){
    const bns = Math.max(m1, m2) <= Wave.NS_MAX;
    if (bns) return 24;
    const z = Wave.zOfD(D), Tm = (m1 + m2) * (1 + z) * Wave.TSUN;
    return Math.min(20, Math.pow(0.075, 1.5) / (Math.PI * Tm));
  }
  function buildEvent(m1, m2, D){
    const fDisp = displayStart(m1, m2, D);
    const W = Wave.build({ m1, m2, D, fStart: fDisp * 0.7 });
    let t0 = W.t[0]; for (let i = 0; i < W.n; i++) if (W.f[i] >= fDisp){ t0 = W.t[i]; break; }
    const e = { W, fDisp, t0, bns: W.bns, nsbh: !W.bns && W.m2 <= Wave.NS_MAX,
      C: W.bns ? 3 : 0.8, Th: 5,
      tEnd: W.bns ? 2.3 : W.tEnd, tCollapse: 0.9, tJet: 1.7,
      Msrc: W.Msrc, Mf: W.Msrc * W.Mf };
    e.hPeak = W.aPeak * W.hScale;
    e.lookback = Wave.lookbackGyr(W.z);
    // where the table crosses the merger of the bodies
    e.tMB = W.bns ? 0 : W.tMergeBodies;
    return e;
  }

  function sepAt(tt, s){
    // orbital separation in units of the total mass; 0 once merged
    const W = ev.W;
    if (ev.bns){
      if (tt < 0) return 1 / Math.pow(s.w / 2, 2 / 3);
      const sc = 1 / W.xMerge, ms = 1e-3 / (W.Msrc * Wave.TSUN) * W.Tm;   // one ms at Earth
      return Math.max(0, sc * (1 - tt / (0.6 * ms)));
    }
    if (tt < ev.tMB) return 1 / Math.pow(s.w / 2, 2 / 3);
    const sm = 1 / W.xMerge;
    return Math.max(0, sm * (1 - (tt - ev.tMB) / (5 * W.Tm)));
  }

  function rate(tt){
    if (realTake) return 1;
    Wave.at(ev.W, tt, S);
    const C = ev.C * State.speed;
    if (tt < 0) return Math.max(C / S.f, (-tt) / ev.Th * State.speed);
    return C / S.f * Math.pow(2, Math.max(0, wallAfterPeak - (ev.bns ? 2.2 : 2.5)) / 0.8);
  }

  /* ================================================================
     WebGL
     ================================================================ */
  const canvas = $('sky');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  let eng = null;
  function nogl(msg){ const d = document.createElement('div'); d.className = 'nogl'; d.textContent = msg; $('stage').appendChild(d); }
  if (!gl) nogl('This simulation needs WebGL 2, which this browser or device has turned off. The sound, charts and readouts below still work.');
  else {
    try { eng = ChirpEngine(gl); }
    catch (e){ console.error(e); eng = null; nogl('This simulation needs floating-point render targets, which this graphics card or browser does not offer. The sound, charts and readouts below still work.'); }
  }
  const NR = eng ? eng.NR : 640, rip = new Float32Array(NR * 4);
  const rhoIn = eng ? eng.RHO_IN : 0.004, rhoOut = eng ? eng.RHO_OUT : 5;
  const ringRho = new Float64Array(NR);
  for (let k = 0; k < NR; k++) ringRho[k] = Math.exp(Math.log(rhoIn) + (Math.log(rhoOut) - Math.log(rhoIn)) * k / (NR - 1));

  // small matrix kit (column-major)
  function perspective(fovy, asp, n, f){ const q = 1 / Math.tan(fovy / 2), nf = 1 / (n - f); return [q / asp,0,0,0, 0,q,0,0, 0,0,(f + n) * nf,-1, 0,0,2 * f * n * nf,0]; }
  function lookAt(e, c, up){
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return { m: [xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*e[0]+xy*e[1]+xz*e[2]), -(yx*e[0]+yy*e[1]+yz*e[2]), -(zx*e[0]+zy*e[1]+zz*e[2]), 1],
      right: [xx, xy, xz], up: [yx, yy, yz], fwd: [-zx, -zy, -zz] };
  }
  function mul(a, b){ const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++){ let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  function project(VP, x, y, z){ const cx = VP[0]*x + VP[4]*y + VP[8]*z + VP[12], cy = VP[1]*x + VP[5]*y + VP[9]*z + VP[13], cw = VP[3]*x + VP[7]*y + VP[11]*z + VP[15]; return [cx / cw, cy / cw, cw]; }

  let Rview = 100, RviewSnap = true;
  function viewTarget(tt){
    const W = ev.W; Wave.at(W, Math.min(tt, 0), S);
    const lam = 1 / (S.f * W.Tm), sep = 1 / Math.pow(S.w / 2, 2 / 3);
    const pre = Math.max(8 * sep, Math.min(2.1 * lam, 22 * sep));
    if (tt <= 0) return pre;
    const front = tt / W.Tm;                 // distance the merger burst has travelled, in M
    return Math.min(Math.max(pre, front * 1.05), pre * (ev.bns ? 30 : 6));
  }

  // well shape shared by GPU and CPU (for placing the bodies on the sheet)
  function wellsHeight(wells, x, y){
    let z = 0; for (let i = 0; i < 3; i++){ const D = wells[i * 4 + 2], w = wells[i * 4 + 3]; if (D > 0){ const dx = x - wells[i * 4], dy = y - wells[i * 4 + 1]; z -= D * w / Math.sqrt(w * w + dx * dx + dy * dy); } }
    return z;
  }

  const frame = {
    VP: null, cam: {}, Rview: 1, rip, ampRef: 1, wells: new Float32Array(12), grid: 1, gridFade: 0, showGrid: true,
    bodies: new Float32Array((eng ? eng.NSUB_MAX : 8) * 12), btypes: new Float32Array(12), nsub: 1,
    kn: new Float32Array(4), knCol: new Float32Array(3), jet: new Float32Array(4), jetI: 0, flash: 0, exposure: 1.25,
    halos: new Float32Array(12),
  };

  // positions of the bodies at time tt, in M units: [x1,y1,m1frac, x2,y2,m2frac, finalVisible]
  function bodiesAt(tt){
    const W = ev.W; Wave.at(W, tt, S);
    const sep = sepAt(tt, S), phi = S.ph / 2;
    const q1 = W.m2 / W.Msrc, q2 = W.m1 / W.Msrc;   // distance of each body from the centre of mass, per unit separation
    const c = Math.cos(phi), s = Math.sin(phi);
    let fin = 0;
    if (ev.bns) fin = tt >= 0 ? Math.min(1, tt / (0.6e-3 * W.Tm / (W.Msrc * Wave.TSUN))) : 0;
    else fin = Math.min(1, Math.max(0, (tt - ev.tMB) / (4 * W.Tm)));
    return { x1: q1 * sep * c, y1: q1 * sep * s, x2: -q2 * sep * c, y2: -q2 * sep * s, sep, fin };
  }

  function camera(w, h){
    const dist = Rview * 2.35 * State.zoom;
    const ce = Math.cos(State.el), se = Math.sin(State.el);
    const eye = [dist * ce * Math.cos(State.yaw), dist * ce * Math.sin(State.yaw), dist * se];
    const L = lookAt(eye, [0, 0, -0.04 * Rview], [0, 0, 1]);
    const fov = 0.72, asp = w / h;
    const P = perspective(fov, asp, dist * 0.02, dist * 30);
    frame.VP = new Float32Array(mul(P, L.m));
    frame.cam = { pos: eye, right: L.right, up: L.up, fwd: L.fwd, tanY: Math.tan(fov / 2), tanX: Math.tan(fov / 2) * asp };
  }

  let lastDt = 0.016;
  function renderGL(){
    if (!eng) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
    eng.resize(w, h);
    const W = ev.W, M = W.Msrc;
    camera(w, h);
    const VP = frame.VP;
    frame.Rview = Rview; frame.ampRef = Rview * 0.035;
    Wave.at(W, t, S);
    const b = bodiesAt(t);
    // wells: the two bodies, then the merged object
    const wl = frame.wells, depth = Rview * 0.11;
    const m1f = W.m1 / M, m2f = W.m2 / M, mff = ev.Mf / M;
    const wid = mf => Math.max(2.2 * mf + 0.8, 0.025 * Rview);
    wl[0] = b.x1; wl[1] = b.y1; wl[2] = depth * m1f * (1 - b.fin); wl[3] = wid(m1f);
    wl[4] = b.x2; wl[5] = b.y2; wl[6] = depth * m2f * (1 - b.fin); wl[7] = wid(m2f);
    wl[8] = 0; wl[9] = 0; wl[10] = depth * mff * b.fin; wl[11] = wid(mff);
    // ripples at each ring, read at the retarded time t − r/c
    const aPk = W.aPeak, sepNow = Math.max(b.sep, 1.5);
    const tmp = {};
    for (let k = 0; k < NR; k++){
      const r = Rview * ringRho[k];
      const tr = t - r * W.Tm;
      Wave.at(W, tr, tmp);
      let A = 0;
      if (tr >= W.t[0] && tmp.a > 0){
        const near = smooth(0.7, 2.6, r / sepNow);
        const radial = Math.pow(1 + r / (0.9 * Rview), -0.8);
        const lamM = 1 / (Math.max(tmp.f, 1e-3) * W.Tm);   // wavelength in M: fade what the mesh can't draw
        A = frame.ampRef * 1.7 * Math.pow(tmp.a / aPk, 0.45) * radial * smooth(0.025, 0.07, lamM / Rview) * smooth(0.6, 1.8, lamM / (r * 0.06 + 1e-9)) * near * smooth(0, 0.03, (tr - W.t[0]) / (W.t[W.n - 1] - W.t[0]) * 10);
      }
      rip[k * 4] = A; rip[k * 4 + 1] = tmp.ph % (2 * Math.PI); rip[k * 4 + 2] = 0; rip[k * 4 + 3] = 0;
    }
    // grid spacing in M, stepping by factors of two with a cross-fade
    const L2 = Math.log2(Rview / 9), s0 = Math.pow(2, Math.floor(L2));
    frame.grid = s0; frame.gridFade = L2 - Math.floor(L2); frame.showGrid = State.grid;
    gridKm = 2 * s0 * M * KM_PER_M;
    // bodies on screen, with sub-frame samples when the orbit is fast
    const dtSim = rate(t) * lastDt;
    const dphi = Math.PI * S.f * dtSim;
    const nsub = eng ? Math.max(1, Math.min(eng.NSUB_MAX, Math.ceil(Math.abs(dphi) / 0.3))) : 1;
    frame.nsub = State.playing ? nsub : 1;
    const shadow = mf => 3.9 * mf;          // apparent shadow radius, in M
    const nsR = ev.W.bns || ev.nsbh ? 12 / (M * KM_PER_M) : 0;
    const kind1 = W.m1 <= Wave.NS_MAX ? 2 : 1, kind2 = W.m2 <= Wave.NS_MAX ? 2 : 1;
    const bt = frame.btypes;
    const collapse = ev.bns ? smooth(ev.tCollapse, ev.tCollapse + 0.02, t) : 1;
    bt[0] = kind1; bt[1] = 1.0; bt[2] = 0; bt[4] = kind2; bt[5] = 1.0; bt[6] = 0;
    bt[8] = ev.bns && collapse < 0.5 ? 2 : 1; bt[9] = ev.bns ? 1.6 : 1;
    if (ev.bns){ const st = smooth(0.62, 1.0, (1 / W.xMerge) / Math.max(b.sep, 1e-3)) * 0.35; bt[2] = st; bt[6] = st; }
    const px = (x, y, z) => { const p = project(VP, x, y, z); return [(p[0] * 0.5 + 0.5) * w, (p[1] * 0.5 + 0.5) * h, p[2]]; };
    const radPx = (R, cw) => R * VP[5] === 0 ? 0 : R * (h / 2) * (1 / Math.tan(0.36)) / cw;
    const Bf = frame.bodies;
    let tagPos = [];
    for (let s = 0; s < frame.nsub; s++){
      const ts = t - dtSim * s / frame.nsub;
      const bb = s === 0 ? b : bodiesAt(ts);
      const list = [
        [bb.x1, bb.y1, kind1 === 2 ? nsR : shadow(m1f), 1 - bb.fin],
        [bb.x2, bb.y2, kind2 === 2 ? nsR : shadow(m2f), 1 - bb.fin],
        [0, 0, ev.bns ? (collapse < 0.5 ? nsR * 1.25 : shadow(mff)) : shadow(mff), bb.fin],
      ];
      if (ev.nsbh){ list[1][3] *= 1 - smooth(-6 * W.Tm, 0, ts - ev.tMB); }
      for (let i = 0; i < 3; i++){
        const [x, y, R, vis] = list[i];
        const z = wellsHeight(wl, x, y) + (bt[i * 4] === 2 ? R * 0.4 : 0);
        const p = px(x, y, z);
        const rp = radPx(R, p[2]);
        Bf[(s * 3 + i) * 4] = p[0]; Bf[(s * 3 + i) * 4 + 1] = p[1]; Bf[(s * 3 + i) * 4 + 2] = Math.max(rp, 0.5); Bf[(s * 3 + i) * 4 + 3] = vis;
        if (s === 0) tagPos.push([p[0] / dpr, (h - p[1]) / dpr, rp / dpr, vis]);
      }
    }
    // soft halos keep far-off tiny bodies findable
    for (let i = 0; i < 3; i++){
      const rp = Bf[i * 4 + 2], vis = Bf[i * 4 + 3];
      frame.halos[i * 4] = Bf[i * 4]; frame.halos[i * 4 + 1] = Bf[i * 4 + 1];
      frame.halos[i * 4 + 2] = 9 * dpr; frame.halos[i * 4 + 3] = vis * (1 - smooth(2, 7, rp)) * 0.5;
    }
    // neutron-star aftermath: flash at contact, kilonova cloud, jet
    frame.kn[3] = 0; frame.jetI = 0; frame.flash = 0;
    if (ev.bns && t > 0){
      const c = px(0, 0, wellsHeight(wl, 0, 0));
      const Rk = 0.2 * t / W.Tm;                       // ejecta at a fifth of light speed, in M
      frame.kn[0] = c[0]; frame.kn[1] = c[1]; frame.kn[2] = radPx(Math.min(Rk, 0.7 * Rview), c[2]);
      frame.kn[3] = Math.min(1, t / 0.003) * (0.22 + 0.45 * Math.exp(-t / 0.4));
      const red = smooth(0.02, 1.2, t);
      frame.knCol[0] = 0.35 + 0.65 * red; frame.knCol[1] = 0.55 - 0.2 * red; frame.knCol[2] = 1.0 - 0.75 * red;
      frame.flash = 0.55 * Math.exp(-t / 0.0012) * Math.min(1, t / 0.0002);
      if (t > ev.tJet){
        const top = px(0, 0, wellsHeight(wl, 0, 0) + Rview * 0.9);
        frame.jet[0] = c[0]; frame.jet[1] = c[1]; frame.jet[2] = top[0] - c[0]; frame.jet[3] = top[1] - c[1];
        frame.jetI = Math.exp(-(t - ev.tJet) / 0.35) * 1.4;
        frame.flash += 0.35 * Math.exp(-(t - ev.tJet) / 0.08);
      }
    }
    eng.render(frame);
    placeTags(tagPos, b);
  }
  let gridKm = 0;
  function smooth(a, b, x){ const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); }

  /* ---------- labels that follow the bodies ---------- */
  const tags = [$('tag0'), $('tag1'), $('tag2')];
  function placeTags(pos, b){
    const W = ev.W, show = pos.length === 3;
    const sepPx = show ? Math.hypot(pos[0][0] - pos[1][0], pos[0][1] - pos[1][1]) : 0;
    const txt = [kindName(W.m1) + ' <b>' + fmtM(W.m1) + '</b>', kindName(W.m2) + ' <b>' + fmtM(W.m2) + '</b>', finalName()];
    for (let i = 0; i < 3; i++){
      const el = tags[i];
      const vis = show && pos[i][3] > 0.5 && (i === 2 || (sepPx > 90 && b.sep > 0)) && pos[i][0] > 0 && pos[i][0] < canvas.clientWidth - 60;
      el.hidden = !vis;
      if (!vis) continue;
      if (el._t !== txt[i]){ el.innerHTML = txt[i]; el._t = txt[i]; }
      const off = Math.max(10, pos[i][2] + 8);
      el.style.transform = `translate(${(pos[i][0] + off).toFixed(1)}px, ${(pos[i][1] - off - 10).toFixed(1)}px)`;
    }
  }
  const kindName = m => m <= Wave.NS_MAX ? 'neutron star' : 'black hole';
  const fmtM = m => (m < 10 ? m.toFixed(2).replace(/0$/, '') : m.toFixed(0)) + ' suns';
  function finalName(){
    if (ev.bns) return t < ev.tCollapse ? 'merged star, <b>' + fmtM(ev.Mf) + '</b>' : 'new black hole, <b>' + fmtM(ev.Mf) + '</b>';
    return 'black hole <b>' + fmtM(ev.Mf) + '</b>, spin ' + ev.W.af.toFixed(2);
  }

  /* ================================================================
     Sound
     ================================================================ */
  const Snd = { ctx: null, master: null, osc: null, og: null, src: null };
  function ensureAudio(){
    if (Snd.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    Snd.ctx = new AC();
    Snd.master = Snd.ctx.createGain(); Snd.master.gain.value = 0.9;
    const comp = Snd.ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4;
    Snd.master.connect(comp); comp.connect(Snd.ctx.destination);
    Snd.osc = Snd.ctx.createOscillator(); Snd.osc.type = 'sine'; Snd.osc.frequency.value = 100;
    Snd.og = Snd.ctx.createGain(); Snd.og.gain.value = 0;
    Snd.osc.connect(Snd.og); Snd.og.connect(Snd.master); Snd.osc.start();
    return true;
  }
  const loud = a => 0.32 * Math.pow(Math.max(a, 0) / ev.W.aPeak, 0.6);
  // live tone that follows the simulation clock: pitch-preserving slow motion
  function updateTone(){
    if (!Snd.ctx) return;
    const now = Snd.ctx.currentTime;
    const on = State.sound && State.playing && !realTake && t >= ev.t0 - 0.001;
    Wave.at(ev.W, t, S);
    const f = Math.min(16000, Math.max(8, S.f * State.pitch));
    Snd.osc.frequency.setTargetAtTime(f, now, 0.012);
    Snd.og.gain.setTargetAtTime(on ? loud(S.a) : 0, now, 0.03);
  }
  // real-speed take: the waveform itself, sample by sample
  function synth(t0, t1){
    const ctx = Snd.ctx, sr = ctx.sampleRate, n = Math.ceil((t1 - t0) * sr);
    const two = State.two, buf = ctx.createBuffer(two ? 2 : 1, n, sr);
    const L = buf.getChannelData(0), R = two ? buf.getChannelData(1) : null;
    const W = ev.W, P = State.pitch, tmp = {};
    let peak = 0;
    for (let i = 0; i < n; i++){
      const tt = t0 + i / sr;
      Wave.at(W, tt, tmp);
      const v = loud(tmp.a) * Math.cos(P * tmp.ph);
      L[i] = v;
      if (two){ Wave.at(W, tt - H1_DELAY, tmp); R[i] = -loud(tmp.a) * Math.cos(P * tmp.ph); }
      peak = Math.max(peak, Math.abs(v));
    }
    const fade = Math.min(n, Math.round(0.02 * sr));
    for (let i = 0; i < fade; i++){ const g = i / fade; L[i] *= g; L[n - 1 - i] *= g; if (R){ R[i] *= g; R[n - 1 - i] *= g; } }
    Snd.lastPeak = peak; Snd.lastN = n;
    return buf;
  }
  function stopTake(){ if (Snd.src){ try { Snd.src.stop(); } catch (e){} Snd.src = null; } realTake = null; }
  function startTake(){
    if (!ensureAudio()) return;
    Snd.ctx.resume();
    if (!State.sound) setSound(true);
    stopTake();
    const t0 = ev.bns ? Math.max(ev.t0, -30) : ev.t0, t1 = ev.bns ? 0.05 : Math.min(ev.W.tEnd, 12 * ev.W.tauQNMs + 0.01);
    const buf = synth(t0, t1);
    const src = Snd.ctx.createBufferSource(); src.buffer = buf;
    if (State.two){ /* channel 0 Livingston (right), 1 Hanford (left) */
      const sp = Snd.ctx.createChannelSplitter(2), mg = Snd.ctx.createChannelMerger(2);
      src.connect(sp); sp.connect(mg, 0, 1); sp.connect(mg, 1, 0); mg.connect(Snd.master);
    } else src.connect(Snd.master);
    const at0 = Snd.ctx.currentTime + 0.08;
    src.start(at0);
    Snd.src = src;
    realTake = { t0, t1, at0 };
    t = t0; wallAfterPeak = 0; holdAtEnd = 0; RviewSnap = true;
    State.playing = true; syncPlay();
    src.onended = () => { if (Snd.src === src){ Snd.src = null; realTake = null; State.playing = false; syncPlay(); setPhaseNote(ev.bns ? 'That was the last 30 seconds at real speed' : 'That was the whole thing at real speed'); } };
  }
  function setSound(on){
    State.sound = on;
    if (on){ if (!ensureAudio()){ State.sound = false; $('soundLabel').textContent = 'No audio in this browser'; return; } Snd.ctx.resume(); }
    else stopTake();
    $('soundBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('soundLabel').textContent = on ? 'Sound on' : 'Turn sound on';
  }

  /* ================================================================
     Readouts
     ================================================================ */
  const sup = n => String(n).replace(/-/g, '⁻').replace(/[0-9]/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  function sci(x, d = 1){ if (!(x > 0)) return '0'; const e = Math.floor(Math.log10(x)); const m = x / Math.pow(10, e); return m.toFixed(d) + ' × 10' + sup(e); }
  function fmtTime(s){
    const a = Math.abs(s);
    if (a >= 1) return a.toFixed(a >= 10 ? 0 : 1) + ' s';
    if (a >= 0.001) return (a * 1e3).toFixed(a >= 0.01 ? 0 : 1) + ' ms';
    return (a * 1e6).toFixed(0) + ' µs';
  }
  function fmtKm(km){ return km >= 1000 ? Math.round(km).toLocaleString('en-US') + ' km' : km.toFixed(0) + ' km'; }
  function fmtRate(r){
    if (Math.abs(r - 1) < 0.02) return 'real speed';
    if (r < 1){ const k = 1 / r; return 'slowed ' + (k >= 100 ? Math.round(k / 10) * 10 : Math.round(k)).toLocaleString('en-US') + '×'; }
    return 'fast-forward ' + (r >= 10 ? Math.round(r) : r.toFixed(1)) + '×';
  }
  function fmtDist(Mpc){ const gly = Mpc * MLY_PER_MPC / 1000; return gly >= 1 ? gly.toFixed(gly >= 10 ? 0 : 1) + ' billion ly' : Math.round(gly * 1000) + ' million ly'; }
  function protonFrac(h){ const dL = h * ARM_M, f = dL / PROTON_M; if (f <= 0) return '—'; return f >= 1 ? f.toFixed(1) + ' protons' : '1/' + Math.round(1 / f).toLocaleString('en-US') + ' proton'; }

  let readTick = 0;
  function readouts(r){
    if (++readTick % 3 && State.playing) return;
    const W = ev.W; Wave.at(W, t, S);
    const b = bodiesAt(t);
    const merged = ev.bns ? t >= 0 : t >= ev.tMB;
    $('rFreq').textContent = S.a > 0 ? S.f.toFixed(S.f < 100 ? 1 : 0) + ' Hz' : '—';
    $('rTime').textContent = t < 0 ? fmtTime(-t) : fmtTime(t) + ' after';
    $('rSep').textContent = !merged ? fmtKm(b.sep * W.Msrc * KM_PER_M) : 'merged';
    const v = Math.pow(S.w / 2, 1 / 3);
    $('rSpeed').textContent = !merged ? (v).toFixed(2) + ' c · ' + Math.round(v * 299792).toLocaleString('en-US') + ' km/s' : '—';
    $('rEnergy').textContent = (S.E < 0.1 ? S.E.toFixed(3) : S.E.toFixed(2)) + ' suns';
    $('rPower').textContent = S.P > 0 ? sci(S.P) + ' W' : '—';
    const hA = S.a * W.hScale;
    $('rStrain').textContent = hA > 0 ? sci(hA) : '—';
    $('rArm').textContent = hA > 0 ? protonFrac(hA) : '—';
    $('rRate').textContent = fmtRate(r);
    phaseText(merged, v);
  }
  let phaseNote = null, phaseNoteUntil = 0;
  function setPhaseNote(s){ phaseNote = s; phaseNoteUntil = performance.now() + 5000; }
  function phaseText(merged, v){
    const W = ev.W; let big, small;
    if (t < ev.t0 - 1e-6){ big = 'Waiting'; small = ''; }
    else if (!merged){
      const orb = S.f / 2;
      big = ev.bns && t > -0.02 ? 'Tides stretch the stars' : (!ev.bns && t > ev.tMB - 60 * W.Tm ? 'The final orbits' : 'Inspiral');
      small = (orb < 10 ? orb.toFixed(1) : Math.round(orb)) + ' orbits a second';
    } else if (ev.bns){
      if (t < 0.02){ big = 'Collision'; small = 'the merged star rings at ~2.8 kHz'; }
      else if (t < ev.tCollapse){ big = 'Kilonova'; small = 'debris flies out at a fifth of light speed'; }
      else if (t < ev.tJet){ big = 'Collapse to a black hole'; small = 'probably within about a second'; }
      else { big = 'Gamma-ray burst'; small = 'Fermi saw it 1.7 s after the merger'; }
    } else if (t < ev.tMB + 8 * W.Tm){ big = 'Merger'; small = 'the horizons join'; }
    else if (S.a > W.aPeak * 0.01){ big = 'Ringdown'; small = 'ringing at ' + Math.round(W.fQNM) + ' Hz'; }
    else { big = 'A single black hole'; small = 'the last ripples head out at the speed of light'; }
    if (phaseNote && performance.now() < phaseNoteUntil){ small = phaseNote; }
    if ($('phaseText')._t !== big){ $('phaseText').textContent = big; $('phaseText')._t = big; }
    $('phaseSmall').textContent = small;
  }

  /* ================================================================
     Scope (live strain) and LIGO arm inset
     ================================================================ */
  const scope = $('scope'), sctx = scope.getContext('2d');
  const arm = $('arm'), actx = arm.getContext('2d');
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COL = { l1: css('--l1'), h1: css('--h1'), wave: css('--wave'), ink: css('--ink'), faint: css('--faint'), line: 'rgba(230,234,240,0.12)', hot: css('--hot') };
  function fitCanvas(c, ctx){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h){ c.width = w; c.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [c.clientWidth, c.clientHeight];
  }
  function drawScope(){
    const [w, h] = fitCanvas(scope, sctx);
    sctx.clearRect(0, 0, w, h);
    const W = ev.W; Wave.at(W, t, S);
    const f = Math.max(S.f, ev.fDisp * 0.7);
    const span = 10 / f;
    const hMax = ev.hPeak * 1.15;
    sctx.strokeStyle = COL.line; sctx.lineWidth = 1;
    sctx.beginPath(); sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); sctx.stroke();
    const N = Math.min(600, Math.round(w * 1.5)), tmp = {};
    const trace = (delay, sign, col) => {
      sctx.strokeStyle = col; sctx.lineWidth = 1.5; sctx.beginPath();
      for (let i = 0; i <= N; i++){
        const tt = t - span + span * i / N - delay;
        Wave.at(W, tt, tmp);
        const v = tt < W.t[0] ? 0 : sign * tmp.a * W.hScale * Math.cos(tmp.ph);
        const x = i / N * w, y = h / 2 - v / hMax * (h / 2 - 3);
        i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
      }
      sctx.stroke();
    };
    if (State.two) trace(H1_DELAY, -1, COL.h1);
    trace(0, 1, State.two ? COL.l1 : COL.wave);
    $('scopeSpan').textContent = 'last ' + fmtTime(span);
  }
  let armFlash = 0;
  function drawArm(){
    if ($('armHud').offsetParent === null) return;
    const [w, h] = fitCanvas(arm, actx);
    actx.clearRect(0, 0, w, h);
    const W = ev.W; Wave.at(W, t, S);
    const hNow = S.a * W.hScale * Math.cos(S.ph);
    const ex = 0.13 / ev.hPeak;                                // exaggeration factor
    const e = hNow * ex;
    const ox = 22, oy = h - 22, Lx = w - 44, Ly = h - 42;
    // arms
    actx.lineCap = 'round';
    actx.strokeStyle = 'rgba(143,211,232,0.25)'; actx.lineWidth = 6;
    actx.beginPath(); actx.moveTo(ox, oy); actx.lineTo(ox + Lx, oy); actx.moveTo(ox, oy); actx.lineTo(ox, oy - Ly); actx.stroke();
    actx.strokeStyle = COL.wave; actx.lineWidth = 2;
    const ax = Lx * (1 + e / 2), ay = Ly * (1 - e / 2);
    actx.beginPath(); actx.moveTo(ox, oy); actx.lineTo(ox + ax, oy); actx.moveTo(ox, oy); actx.lineTo(ox, oy - ay); actx.stroke();
    actx.fillStyle = COL.ink;
    for (const [x, y] of [[ox + ax, oy], [ox, oy - ay]]){ actx.beginPath(); actx.arc(x, y, 3.5, 0, 7); actx.fill(); }
    actx.fillStyle = COL.hot; actx.beginPath(); actx.arc(ox, oy, 3, 0, 7); actx.fill();
    // ring of free-floating test masses in the corner of the L
    const cx = ox + Lx * 0.58, cy = oy - Ly * 0.58, R = Math.min(Lx, Ly) * 0.24;
    actx.fillStyle = 'rgba(230,234,240,0.8)';
    for (let i = 0; i < 16; i++){
      const a = i / 16 * 2 * Math.PI, x = Math.cos(a), y = Math.sin(a);
      actx.beginPath(); actx.arc(cx + R * x * (1 + e / 2), cy - R * y * (1 - e / 2), 1.6, 0, 7); actx.fill();
    }
    $('armX').textContent = 'exaggerated ' + (ex > 0 ? '10' + sup(Math.round(Math.log10(ex))) : '') + '×';
    if (armFlash > 0){ armFlash--; if (!armFlash) $('armHud').classList.remove('flash'); }
  }

  /* ================================================================
     Overview chart: the whole signal
     ================================================================ */
  const ov = $('overview'), octx = ov.getContext('2d');
  let ovStatic = null, ovMap = null, ovHover = null;
  function ovAxes(w, h){
    const W = ev.W;
    const padL = 58, padR = 14, top = 8, gap = 26, bottom = 30;
    const ph = (h - top - gap - bottom) / 2;
    const A = { x0: padL, x1: w - padR, sTop: top, sBot: top + ph, fTop: top + ph + gap, fBot: top + 2 * ph + gap };
    if (!ev.bns){
      let ta = ev.t0; for (let i = 0; i < W.n; i++) if (W.f[i] >= Math.max(ev.fDisp, W.fPeak / 4.5)){ ta = W.t[i]; break; }
      const tb = Math.min(W.tEnd, 8 * W.tauQNMs + 0.004);
      A.tx = tt => A.x0 + (tt - ta) / (tb - ta) * (A.x1 - A.x0);
      A.xt = x => ta + (x - A.x0) / (A.x1 - A.x0) * (tb - ta);
      A.ta = ta; A.tb = tb;
      const narrow = w < 560; const step = niceStep((tb - ta) / (narrow ? 3 : 6));
      A.ticks = []; for (let v = Math.ceil(ta / step) * step; v <= tb + 1e-9; v += step) A.ticks.push([v, Math.abs(v) < 1e-9 ? 'merger' : narrow ? (v < 0 ? '−' : '+') + fmtTime(Math.abs(v)) : (v < 0 ? fmtTime(-v) + ' before' : fmtTime(v) + ' after')]);
    } else {
      // log of time before merger, with the last 7% of the width for the aftermath
      const tauMax = -ev.t0, tauMin = 1e-3, xm = A.x0 + (A.x1 - A.x0) * 0.93, postMax = 0.03;
      A.tx = tt => tt < -tauMin ? A.x0 + (Math.log(tauMax) - Math.log(-tt)) / (Math.log(tauMax) - Math.log(tauMin)) * (xm - A.x0)
        : tt <= 0 ? xm : xm + Math.min(tt, postMax) / postMax * (A.x1 - xm);
      A.xt = x => x < xm ? -Math.exp(Math.log(tauMax) - (x - A.x0) / (xm - A.x0) * (Math.log(tauMax) - Math.log(tauMin))) : (x - xm) / (A.x1 - xm) * postMax;
      A.ta = ev.t0; A.tb = postMax;
      A.ticks = [[-100, '100 s'], [-10, '10 s'], [-1, '1 s'], [-0.1, '0.1 s'], [-0.01, w < 560 ? '10 ms' : '10 ms before'], [0, 'merger']].filter(v => -v[0] <= tauMax && (w >= 560 || [-100, -1, -0.01, 0].includes(v[0])));
    }
    A.hMax = ev.hPeak * 1.15;
    A.fy = f => A.fBot - (Math.log(Math.max(f, 5)) - Math.log(5)) / (Math.log(4000) - Math.log(5)) * (A.fBot - A.fTop);
    A.hy = v => (A.sTop + A.sBot) / 2 - v / A.hMax * (A.sBot - A.sTop) / 2;
    return A;
  }
  function niceStep(x){ const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e; }
  function drawOverviewStatic(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = ov.clientWidth, h = ov.clientHeight;
    ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr);
    const c = document.createElement('canvas'); c.width = ov.width; c.height = ov.height;
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const A = ovAxes(w, h); ovMap = A;
    const W = ev.W, tmp = {};
    g.font = '11px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    // grid and axes
    g.strokeStyle = COL.line; g.fillStyle = COL.faint; g.lineWidth = 1;
    const hExp = Math.floor(Math.log10(A.hMax)), hUnit = Math.pow(10, hExp);
    const hStep = niceStep(A.hMax / hUnit / 2.2) * hUnit;
    for (let v = -Math.floor(A.hMax / hStep) * hStep; v <= A.hMax; v += hStep){
      const y = A.hy(v); g.beginPath(); g.moveTo(A.x0, y); g.lineTo(A.x1, y); g.stroke();
      const lab = Math.abs(v) < hStep / 10 ? '0' : (v < 0 ? '−' : '') + (+(Math.abs(v) / hUnit).toFixed(2));
      g.textAlign = 'right'; g.fillText(lab, A.x0 - 6, y);
    }
    for (const f of [10, 30, 100, 300, 1000, 3000]){
      const y = A.fy(f); g.beginPath(); g.moveTo(A.x0, y); g.lineTo(A.x1, y); g.stroke();
      g.textAlign = 'right'; g.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), A.x0 - 6, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const [v, lab] of A.ticks){ const x = A.tx(v); g.strokeStyle = COL.line; g.beginPath(); g.moveTo(x, A.sTop); g.lineTo(x, A.fBot); g.stroke(); g.fillText(lab, Math.min(Math.max(x, A.x0 + 30), A.x1 - 30), A.fBot + 8); }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = COL.faint;
    g.fillText('strain, × 10' + sup(hExp), A.x0 + 6, A.sTop + 12); g.fillText('hertz', A.x0 + 6, A.fTop + 12);
    // strain: a line where cycles are resolved, an envelope where they are not
    g.save(); g.beginPath(); g.rect(A.x0, A.sTop, A.x1 - A.x0, A.sBot - A.sTop); g.clip();
    const cols = Math.round(A.x1 - A.x0);
    g.fillStyle = 'rgba(143,211,232,0.55)'; g.strokeStyle = COL.wave; g.lineWidth = 1.5;
    let pathOpen = false;
    for (let i = 0; i < cols; i++){
      const xa = A.x0 + i, ta = A.xt(xa), tb = A.xt(xa + 1);
      Wave.at(W, ta, tmp); const pa = tmp.ph, aa = tmp.a; Wave.at(W, tb, tmp);
      const cyc = (tmp.ph - pa) / (2 * Math.PI);
      if (cyc > 0.2){
        if (pathOpen){ g.stroke(); pathOpen = false; }
        const a = Math.max(aa, tmp.a) * W.hScale, y0 = A.hy(a), y1 = A.hy(-a);
        g.fillRect(xa, y0, 1, y1 - y0);
      } else {
        for (let s = 0; s < 4; s++){
          const tt = ta + (tb - ta) * s / 4; Wave.at(W, tt, tmp);
          const y = A.hy(tt < W.t[0] ? 0 : tmp.a * W.hScale * Math.cos(tmp.ph));
          if (!pathOpen){ g.beginPath(); g.moveTo(xa + s / 4, y); pathOpen = true; } else g.lineTo(xa + s / 4, y);
        }
      }
    }
    if (pathOpen) g.stroke();
    g.restore();
    // frequency track, brighter where the wave is stronger
    for (let i = 0; i < cols; i += 1){
      const xa = A.x0 + i, tt = A.xt(xa + 0.5); Wave.at(W, tt, tmp);
      if (!(tmp.a > 0) || tt < W.t[0]) continue;
      const k = Math.pow(tmp.a / W.aPeak, 0.5);
      g.fillStyle = `rgba(255,179,92,${(0.35 + 0.65 * k).toFixed(3)})`;
      const y = A.fy(tmp.f); g.fillRect(xa, y - 1 - k * 1.5, 1.2, 2 + k * 3);
    }
    ovStatic = c;
    $('ovTitle').textContent = evName() + ' · ' + fmtM(ev.W.m1) + ' + ' + fmtM(ev.W.m2).replace(' suns', '') + ' suns';
    $('ovUnit').textContent = ev.bns ? 'strain at Earth (top) and wave frequency in hertz (bottom); time runs on a log scale so all 100 seconds fit' : 'strain at Earth (top) and wave frequency in hertz (bottom), against time before the merger';
    ovRows();
  }
  function drawOverview(){
    if (!ovStatic) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (ov.width !== Math.round(ov.clientWidth * dpr)){ drawOverviewStatic(); }
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height); octx.drawImage(ovStatic, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const A = ovMap;
    const x = A.tx(Math.max(A.ta, Math.min(A.tb, t)));
    octx.strokeStyle = COL.ink; octx.lineWidth = 1; octx.beginPath(); octx.moveTo(x, A.sTop); octx.lineTo(x, A.fBot); octx.stroke();
    Wave.at(ev.W, t, S);
    if (S.a > 0 && t >= A.ta && t <= A.tb){ octx.fillStyle = COL.hot; octx.beginPath(); octx.arc(x, A.fy(S.f), 4, 0, 7); octx.fill(); octx.strokeStyle = '#090c13'; octx.lineWidth = 2; octx.stroke(); }
    if (ovHover != null){
      octx.strokeStyle = 'rgba(230,234,240,0.45)'; octx.setLineDash([3, 3]); octx.beginPath(); octx.moveTo(ovHover, A.sTop); octx.lineTo(ovHover, A.fBot); octx.stroke(); octx.setLineDash([]);
    }
  }
  function ovRows(){
    const W = ev.W, tmp = {}, rows = [];
    const pts = ev.bns ? [-60, -10, -1, -0.1, -0.01, -0.001] : [-0.2, -0.1, -0.05, -0.02, -0.01, -0.005, 0, 0.005, 0.01].filter(v => v >= ev.t0);
    for (const tt of pts){
      Wave.at(W, tt, tmp);
      const b = (() => { const sv = t; const r = sepAt(tt, tmp); return r; })();
      const merged = ev.bns ? tt >= 0 : tt >= ev.tMB;
      rows.push(`<tr><td>${tt < 0 ? fmtTime(-tt) + ' before' : tt === 0 ? 'peak' : fmtTime(tt) + ' after'}</td><td>${tmp.f.toFixed(0)} Hz</td><td>${sci(tmp.a * W.hScale)}</td><td>${merged ? 'merged' : fmtKm(b * W.Msrc * KM_PER_M)}</td><td>${merged ? '—' : Math.pow(tmp.w / 2, 1 / 3).toFixed(2) + ' c'}</td></tr>`);
    }
    $('ovRows').innerHTML = rows.join('');
  }
  function ovPointer(e){
    if (!ovMap) return;
    const r = ov.getBoundingClientRect(), x = e.clientX - r.left, A = ovMap;
    if (x < A.x0 || x > A.x1){ ovLeave(); return; }
    ovHover = x;
    const tt = A.xt(x), tmp = {}; Wave.at(ev.W, tt, tmp);
    $('tipWhen').textContent = tt < 0 ? fmtTime(-tt) + ' before merger' : fmtTime(tt) + ' after the peak';
    $('tipF').textContent = tmp.a > 0 ? tmp.f.toFixed(0) + ' Hz' : '—';
    $('tipH').textContent = tmp.a > 0 ? sci(tmp.a * ev.W.hScale) : '—';
    const tip = $('ovTip'); tip.hidden = false;
    const tw = tip.offsetWidth, left = x + 14 + tw > r.width ? x - tw - 14 : x + 14;
    tip.style.left = (left + 14) + 'px'; tip.style.top = '52px';
    if (!State.playing) drawOverview();
  }
  function ovLeave(){ ovHover = null; $('ovTip').hidden = true; }
  ov.addEventListener('pointermove', ovPointer);
  ov.addEventListener('pointerleave', ovLeave);
  ov.addEventListener('click', e => {
    const r = ov.getBoundingClientRect(), x = e.clientX - r.left;
    if (!ovMap || x < ovMap.x0 || x > ovMap.x1) return;
    seek(Math.max(ev.t0, ovMap.xt(x)));
  });

  /* ================================================================
     Controls
     ================================================================ */
  const m1s = $('m1'), m2s = $('m2'), ds = $('dist');
  const MMIN = 1, MMAX = 150, DMIN = 10, DMAX = 10000;
  const toM = v => MMIN * Math.pow(MMAX / MMIN, v / 1000), fromM = m => Math.round(Math.log(m / MMIN) / Math.log(MMAX / MMIN) * 1000);
  const toD = v => DMIN * Math.pow(DMAX / DMIN, v / 1000), fromD = d => Math.round(Math.log(d / DMIN) / Math.log(DMAX / DMIN) * 1000);
  function evName(){ return State.ev === 'custom' ? (State.customName || 'Your merger') : EVENTS[State.ev].name; }

  function load(opts = {}){
    stopTake();
    ev = buildEvent(State.m1, State.m2, State.D);
    t = opts.t != null ? Math.max(ev.t0, opts.t) : ev.t0;
    wallAfterPeak = 0; holdAtEnd = 0; RviewSnap = true;
    m1s.value = fromM(State.m1); m2s.value = fromM(State.m2); ds.value = fromD(State.D);
    sliderOut();
    derived();
    document.querySelectorAll('#events .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.ev === State.ev ? 'true' : 'false'));
    if (State.ev !== 'custom') $('caption').innerHTML = EVENTS[State.ev].caption;
    else $('caption').innerHTML = customCaption();
    drawOverviewStatic();
  }
  function customCaption(){
    const W = ev.W, nm = State.customName;
    const kind = ev.bns ? 'Two neutron stars' : ev.nsbh ? 'A black hole and a neutron star' : 'Two black holes';
    return `<b>${nm ? nm + ' as measured.' : 'Your merger.'}</b> ${kind} of ${fmtM(W.m1).replace(' suns', '')} and ${fmtM(W.m2)}, ${fmtDist(W.D)} away (luminosity distance). The waves left them ${ev.lookback >= 1 ? ev.lookback.toFixed(1) + ' billion' : Math.round(ev.lookback * 1000) + ' million'} years ago. ${ev.bns ? 'The chirp lasts about ' + Math.round(-ev.t0) + ' s from 24 Hz.' : 'The final hole weighs ' + fmtM(ev.Mf) + ' and rings at ' + Math.round(W.fQNM) + ' Hz.'}`;
  }
  function sliderOut(){
    const kind = m => m <= Wave.NS_MAX ? ' · NS' : '';
    $('m1Out').textContent = fmtM(State.m1) + kind(State.m1);
    $('m2Out').textContent = fmtM(State.m2) + kind(State.m2);
    $('distOut').textContent = fmtDist(State.D);
  }
  function derived(){
    const W = ev.W;
    const mc = Math.pow(W.m1 * W.m2, 0.6) / Math.pow(W.m1 + W.m2, 0.2);
    $('dChirp').textContent = mc.toFixed(mc < 10 ? 2 : 1) + ' suns';
    $('dFinal').textContent = ev.bns ? 'neutron star, then black hole' : 'black hole, ' + fmtM(ev.Mf) + ', spin ' + W.af.toFixed(2);
    $('dErad').textContent = (W.E[W.n - 1] < 0.1 ? W.E[W.n - 1].toFixed(3) : W.E[W.n - 1].toFixed(2)) + ' suns';
    $('dRing').textContent = ev.bns ? '≈ 2.8 kHz, too faint to catch' : Math.round(W.fQNM) + ' Hz, fades in ' + (W.tauQNMs * 1e3).toFixed(1) + ' ms';
    $('dTravel').textContent = (ev.lookback >= 1 ? ev.lookback.toFixed(2) + ' billion' : Math.round(ev.lookback * 1000) + ' million') + ' years';
    $('dStrain').textContent = sci(ev.hPeak);
  }
  let buildTimer = 0;
  function onSlider(){
    State.m1 = +toM(+m1s.value).toPrecision(3); State.m2 = +toM(+m2s.value).toPrecision(3); State.D = +toD(+ds.value).toPrecision(3);
    if (State.m2 > State.m1){ const x = State.m1; State.m1 = State.m2; State.m2 = x; }
    State.ev = 'custom'; State.customName = null;
    sliderOut();
    clearTimeout(buildTimer); buildTimer = setTimeout(() => load(), 90);
  }
  [m1s, m2s, ds].forEach(s => s.addEventListener('input', onSlider));

  function loadEvent(key, opts){
    if (key === 'custom'){ State.ev = 'custom'; State.customName = null; load(opts); return; }
    const E = EVENTS[key]; State.ev = key; State.m1 = E.m1; State.m2 = E.m2; State.D = E.D; State.customName = null;
    load(opts);
  }
  $('events').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; loadEvent(b.dataset.ev); if (!State.playing){ State.playing = true; syncPlay(); } });

  document.querySelectorAll('#pitches .chip').forEach(b => b.addEventListener('click', () => {
    State.pitch = +b.dataset.p;
    document.querySelectorAll('#pitches .chip').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
  }));
  document.querySelectorAll('#toggles .chip[data-key]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.key; State[k] = !State[k]; b.setAttribute('aria-pressed', State[k] ? 'true' : 'false');
    if (k === 'two') $('scopeKeys').hidden = !State.two;
  }));
  function setToggle(k, v){ State[k] = v; const b = document.querySelector(`#toggles .chip[data-key="${k}"]`); if (b) b.setAttribute('aria-pressed', v ? 'true' : 'false'); if (k === 'two') $('scopeKeys').hidden = !v; }
  $('resetView').addEventListener('click', () => { State.yaw = -0.9; State.el = 0.62; State.zoom = 1; });

  function syncPlay(){ $('playBtn').textContent = State.playing ? 'Pause' : 'Play'; }
  $('playBtn').addEventListener('click', () => {
    if (realTake){ stopTake(); State.playing = false; }
    else { State.playing = !State.playing; if (State.playing && t >= ev.tEnd - 1e-9) seek(ev.t0); }
    syncPlay();
  });
  $('restartBtn').addEventListener('click', () => { stopTake(); seek(ev.t0); State.playing = true; syncPlay(); });
  $('soundBtn').addEventListener('click', () => setSound(!State.sound));
  $('realBtn').addEventListener('click', () => startTake());
  const speedS = $('speed');
  function speedFromSlider(){ const v = +speedS.value; State.speed = Math.pow(10, -v / 100); $('speedOut').textContent = Math.abs(v) < 4 ? 'normal' : v > 0 ? (1 / State.speed).toFixed(1) + '× slower' : State.speed.toFixed(1) + '× faster'; }
  speedS.addEventListener('input', speedFromSlider);

  function seek(tt){ stopTake(); t = Math.max(ev.t0, Math.min(ev.tEnd, tt)); wallAfterPeak = 0; holdAtEnd = 0; RviewSnap = true; if (!State.playing) drawAll(); }

  function scrollToStage(){ $('stage').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }
  function setSpeed(v){ speedS.value = v; speedFromSlider(); }
  const SHOW = {
    masses(){ loadEvent('gw150914', { t: -0.16 }); setSpeed(0); setPhaseNote('listen for the pitch climbing'); },
    twodet(){ setToggle('two', true); loadEvent('gw150914', { t: -0.045 }); setSpeed(40); setPhaseNote('Hanford (orange) trails Livingston by 6.9 ms'); },
    proton(){ loadEvent('gw150914', { t: -0.006 }); setSpeed(60); $('armHud').classList.add('flash'); armFlash = 400; setPhaseNote('watch the LIGO arm change in the readout'); },
    energy(){ loadEvent('gw150914', { t: -0.008 }); setSpeed(50); setPhaseNote('power peaks as the horizons join'); },
    fast(){ loadEvent('gw150914', { t: -0.03 }); setSpeed(70); setPhaseNote('orbital speed is in the readout'); },
    ring(){ loadEvent('gw150914', { t: 0 }); setSpeed(70); setPhaseNote('one pitch, fading away'); },
    hear(){ loadEvent('gw150914'); setSpeed(0); startTake(); },
    gold(){ loadEvent('gw170817', { t: -0.03 }); setSpeed(0); setPhaseNote('the last hundredth of a second'); },
    heavy(){ loadEvent('gw190521', { t: -0.25 }); setSpeed(0); },
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('button.show'); if (!b) return;
    if (b.dataset.show && SHOW[b.dataset.show]){ SHOW[b.dataset.show](); }
    else if (b.dataset.ev){ loadEvent(b.dataset.ev); setSpeed(0); }
    else if (b.dataset.load){
      const [a, c, d, nm] = b.dataset.load.split(','); State.ev = 'custom'; State.m1 = +a; State.m2 = +c; State.D = +d; State.customName = nm; load(); setSpeed(0);
    } else return;
    State.playing = true; syncPlay(); scrollToStage();
  });

  /* ---------- camera interaction ---------- */
  const pointers = new Map(); let pinch0 = 0, zoom0 = 1, userTouched = false;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); userTouched = true;
    if (pointers.size === 2){ const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = State.zoom; } });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1){ State.yaw -= (e.clientX - prev[0]) * 0.006; State.el = Math.max(0.08, Math.min(1.5, State.el + (e.clientY - prev[1]) * 0.005)); }
    else if (pointers.size === 2){ const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) State.zoom = Math.max(0.15, Math.min(6, zoom0 * pinch0 / d)); }
    if (!State.playing) drawAll();
  });
  const up = e => { pointers.delete(e.pointerId); pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); State.zoom = Math.max(0.15, Math.min(6, State.zoom * Math.exp(e.deltaY * 0.0012))); if (!State.playing) drawAll(); }, { passive: false });

  /* ================================================================
     Model check table: GW150914 from this model vs LIGO
     ================================================================ */
  function cmpTable(){
    const W = Wave.build({ m1: 36, m2: 29, D: 410, fStart: 20 });
    let t35 = 0; for (let i = 0; i < W.n; i++) if (W.f[i] >= 35){ t35 = W.t[i]; break; }
    const i35 = Wave.idx(W, t35), i0 = Wave.idx(W, 0);
    const cyc = (W.ph[i0] - W.ph[i35]) / (2 * Math.PI);
    const rows = [
      ['Final black hole', fmtM(W.Msrc * W.Mf), '62 ± 4 suns'],
      ['Mass radiated as waves', (W.Eradfit * W.Msrc).toFixed(1) + ' suns', '3.0 ± 0.5 suns'],
      ['Spin of the final hole', W.af.toFixed(2), '0.67 (+0.05 / −0.07)'],
      ['Peak power', sci(W.Ppeak) + ' W', '3.6 × 10⁴⁹ W'],
      ['Peak strain at Earth', sci(W.aPeak * W.hScale), '1.0 × 10⁻²¹', 'orientation factor set to match'],
      ['Frequency at the loudest point', Math.round(W.fPeak) + ' Hz', '≈ 150 Hz', 'read by eye from the published plot'],
      ['Ringdown pitch', Math.round(W.fQNM) + ' Hz', '≈ 250 Hz'],
      ['Ringdown fade time', (W.tauQNMs * 1e3).toFixed(1) + ' ms', '≈ 4 ms'],
      ['Speed just before merging', Math.pow(W.w[Wave.idx(W, 0)] / 2, 1 / 3).toFixed(2) + ' c', '≈ 0.5 c'],
      ['From 35 Hz to the peak', fmtTime(-t35) + ', ' + cyc.toFixed(0) + ' cycles', '≈ 0.2 s, ≈ 8 cycles', 'the paper\'s rough description; see the note'],
    ];
    $('cmpRows').innerHTML = rows.map(r => `<tr><td>${r[0]}${r[3] ? '<span class="why">' + r[3] + '</span>' : ''}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  }

  /* ================================================================
     Main loop
     ================================================================ */
  let last = performance.now(), visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (!visible && Snd.ctx){ stopTake(); Snd.og && Snd.og.gain.setTargetAtTime(0, Snd.ctx.currentTime, 0.02); } });
  function drawAll(){
    let r = rate(t);
    if (!Number.isFinite(Rview) || RviewSnap){ Rview = viewTarget(t); RviewSnap = false; }
    renderGL(); drawScope(); drawArm(); drawOverview(); readouts(r);
  }
  function tick(now){
    const dtw = Math.min(0.1, (now - last) / 1000); last = now; lastDt = dtw;
    if (State.playing && visible){
      if (realTake){
        t = Math.min(realTake.t1, realTake.t0 + Math.max(0, Snd.ctx.currentTime - realTake.at0));
        if (t > 0) wallAfterPeak += dtw;
      } else if (holdAtEnd > 0){
        holdAtEnd -= dtw; if (holdAtEnd <= 0){ t = ev.t0; wallAfterPeak = 0; RviewSnap = true; }
      } else {
        const r = rate(t);
        t += r * dtw;
        if (t > 0) wallAfterPeak += dtw;
        if (t >= ev.tEnd || wallAfterPeak > (ev.bns ? 14 : 9)){ t = Math.min(t, ev.tEnd); holdAtEnd = 2.5; }
      }
      if (State.spin && !pointers.size) State.yaw += dtw * 0.035;
    }
    const target = viewTarget(t);
    if (RviewSnap){ Rview = target; RviewSnap = false; }
    else Rview = Math.exp(Math.log(Rview) + (Math.log(target) - Math.log(Rview)) * (1 - Math.exp(-dtw / (realTake ? 0.08 : 0.4))));
    renderGL();
    drawScope(); drawArm(); drawOverview();
    readouts(realTake ? 1 : (holdAtEnd > 0 ? 0 : rate(t)));
    updateTone();
    requestAnimationFrame(tick);
  }

  loadEvent('gw150914');
  cmpTable();
  speedFromSlider();
  syncPlay();
  window.addEventListener('resize', () => drawOverviewStatic());
  window.__chirp = { State, get t(){ return t; }, set t(v){ seek(v); }, get ev(){ return ev; }, seek, loadEvent, SHOW, Snd, synth, ensureAudio, setSound, setToggle, rate: () => rate(t) };
  requestAnimationFrame(tick);
})();
