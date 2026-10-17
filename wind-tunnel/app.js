// The Wind Tunnel: main stage. Builds a scene (body + grid + flow settings), runs the GPU solver as
// many steps per frame as the GPU allows, renders smoke / vortices / cut planes, and reports forces
// in coefficients and in real-world units.

const AIR = { rho: 1.204, nu: 1.51e-5 }, BLOOD = { rho: 1060, nu: 3.3e-6 };
const QUALITY = { low: 0.5, medium: 0.72, high: 1, ultra: 1.3 };

// Per-scene setup. grid is at "high" quality. real: length scale (m) of refLen, speed range.
const SCENE_DEF = {
  wing: {
    label: 'Wing', grid: a => a.tips ? [320, 192, 192] : [384, 48, 256], wallModel: true, nuWall: 0.0005, realL: 1.5, refName: 'chord',
    speed: { min: 5, max: 70, def: 30, unit: 'm/s' }, angle: 6, fluid: AIR, ctl: ['angle', 'tips'],
    alpha: 0.035, target: 0.42, cam: { yaw: -1.78, pitch: 0.16, dist: 0.55 }, camTips: { yaw: -2.3, pitch: 0.42, dist: 0.85 }, slice: { axis: 1 }, clip: true,
    rake: (N, sc) => sc.span < N[1] ? { lo: [1, N[1] / 2 - sc.span / 2 - 6, N[2] * 0.36], hi: [1, N[1] / 2 - sc.span / 2 + 22, N[2] * 0.64], ny: 6, nz: 24 }
      : { lo: [1, N[1] * 0.5 - 0.5, N[2] * 0.3], hi: [1, N[1] * 0.5 - 0.5, N[2] * 0.7], ny: 1, nz: 30 },
    caption: a => `A <b>NACA 2412</b> wing section, the one on a Cessna 172, ${a.tips ? 'with its <b>tips</b> exposed: watch the tip vortices roll up' : 'spanning the tunnel wall to wall, so the flow sees an endless wing'}. Air flowing over the top speeds up and its pressure drops; air underneath slows and its pressure rises. The wing turns the stream <b>downward</b>, and the air pushes the wing up. Push the angle past about 15° and the flow tears off the upper surface: <b>stall</b>.`,
  },
  cylinder: {
    label: 'Cylinder', grid: [320, 72, 160], realL: 0.1, refName: 'diameter',
    re: { min: 20, max: 200000, def: 150 }, fluid: AIR, ctl: ['re'],
    alpha: 0.05, cam: { yaw: -1.62, pitch: 0.35, dist: 1.0 }, slice: { axis: 1 },
    rake: N => ({ lo: [1, N[1] * 0.5, N[2] * 0.3], hi: [1, N[1] * 0.5, N[2] * 0.7], ny: 1, nz: 48 }),
    caption: () => `Flow past a cylinder is the classic experiment of fluid mechanics. Below a Reynolds number of about 47 the wake is two quiet eddies. Above it the eddies break away <b>alternately</b>, top, bottom, top, into a <b>Kármán vortex street</b>, at a rhythm set by the Strouhal number, about 0.2. Turn the Reynolds number up and the street turns three-dimensional, then turbulent.`,
  },
  sphere: {
    label: 'Ball', grid: [256, 128, 128], realL: 0.22, refName: 'diameter',
    re: { min: 50, max: 200000, def: 300 }, fluid: AIR, ctl: ['re'],
    cam: { yaw: -2.2, pitch: 0.3, dist: 1.0 }, slice: { axis: 1 },
    rake: N => ({ lo: [1, N[1] * 0.38, N[2] * 0.38], hi: [1, N[1] * 0.62, N[2] * 0.62], ny: 12, nz: 12 }),
    caption: () => `A sphere, the size of a football. At low Reynolds numbers a steady ring vortex sits behind it; around Re 210 it tilts, and by 300 it sheds a chain of <b>hairpin vortices</b> to one side. At the speed of a kicked ball the wake is fully turbulent and the drag coefficient settles near <b>0.4–0.5</b>.`,
  },
  car: {
    label: 'Car', grid: [288, 144, 96], realL: 4.5, refName: 'length', wallModel: true,
    speed: { min: 5, max: 60, def: 30, unit: 'm/s' }, fluid: AIR, ctl: ['speed'],
    cam: { yaw: -2.35, pitch: 0.32, dist: 0.95 }, slice: { axis: 1 },
    rake: (N, sc) => ({ lo: [1, N[1] * 0.5 - 14, 2], hi: [1, N[1] * 0.5 + 14, 40], ny: 3, nz: 30 }),
    caption: () => `A family car on a <b>rolling road</b>: the floor moves with the air, as the road does under a real car. The air parts at the nose, races over the roof and cannot follow the sudden end of the car. It breaks away into a broad, turbulent <b>wake</b> of low pressure that sucks backwards on the car. Most of a car's drag is this wake.`,
  },
  cyclist: {
    label: 'Cyclist', grid: [256, 112, 128], realL: 1.75, refName: 'height', wallModel: true,
    speed: { min: 3, max: 20, def: 11.1, unit: 'm/s' }, fluid: AIR, ctl: ['speed', 'posture'],
    cam: { yaw: -2.3, pitch: 0.2, dist: 0.95 }, slice: { axis: 1 },
    rake: N => ({ lo: [1, N[1] * 0.5 - 10, 4], hi: [1, N[1] * 0.5 + 10, N[2] * 0.62], ny: 3, nz: 40 }),
    caption: a => `A road cyclist at ${a.speedText}. Above about 25 km/h most of a rider's effort goes into pushing air aside. ${a.posture ? 'Tucked low, the rider hides more of the body behind the arms and presents less frontal area' : 'Sitting up, the rider is a blunt, upright obstacle with a big turbulent wake'}. Switch posture and watch the drag and the power.`,
  },
  tower: {
    label: 'Tower', grid: [256, 160, 112], realL: 30, refName: 'width', wallModel: true,
    speed: { min: 3, max: 30, def: 12, unit: 'm/s' }, fluid: AIR, ctl: ['speed'],
    cam: { yaw: -2.5, pitch: 0.45, dist: 1.0 }, slice: { axis: 2, pos: 0.12 },
    rake: N => ({ lo: [1, N[1] * 0.3, 3], hi: [1, N[1] * 0.7, N[2] * 0.6], ny: 14, nz: 10 }),
    caption: () => `A tower in the wind near the ground, where the wind <b>grows with height</b>. Wind hitting the face is pushed down the front of the building toward the street. It rolls up into a <b>horseshoe vortex</b> wrapped around the base, and squeezes round the corners. That is why it is so gusty at the foot of tall buildings.`,
  },
  artery: {
    label: 'Artery', grid: [448, 72, 72], realL: 0.006, refName: 'diameter',
    speed: { min: 0.1, max: 0.6, def: 0.35, unit: 'm/s' }, severity: 0.75, fluid: BLOOD, ctl: ['speed', 'severity'],
    target: 0.36, cam: { yaw: -1.85, pitch: 0.45, dist: 0.6 }, slice: { axis: 1 }, internal: true, clip: true,
    rake: (N, sc) => ({ lo: [1, N[1] * 0.5 - sc.R0 * 0.8, N[2] * 0.5 - sc.R0 * 0.8], hi: [1, N[1] * 0.5 + sc.R0 * 0.8, N[2] * 0.5 + sc.R0 * 0.8], ny: 9, nz: 9 }),
    caption: a => `Blood in a carotid artery, ${(100 * a.severity).toFixed(0)}% of its cross-section blocked by plaque. Squeezed through the narrowing, the blood speeds up into a <b>jet</b>. The jet cannot follow the widening wall, so it separates, swirls and, if fast enough, breaks into <b>turbulence</b>. Those pressure fluctuations shake the artery wall, and a stethoscope hears them as a <b>bruit</b>.`,
  },
};

const App = {
  scene: 'wing', view: 'smoke', quality: 'high', running: true,
  args: { angle: 6, tips: false, posture: 0, severity: 0.75 },
  cam: { yaw: -2.05, pitch: 0.22, dist: 1.0 },

  init() {
    const cv = this.cv = document.getElementById('sky');
    const gl = this.gl = cv.getContext('webgl2', { antialias: false, depth: true, powerPreference: 'high-performance' });
    if (!gl || !gl.getExtension('EXT_color_buffer_float') || gl.getParameter(gl.MAX_DRAW_BUFFERS) < 7) {
      document.getElementById('nogl').hidden = false; return false;
    }
    this.quality = this.guessQuality();
    this.hist = [];
    this.bindUI();
    this.load('wing');
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    new IntersectionObserver(e => { this.visible = e[0].isIntersecting; }).observe(cv);
    this.visible = true;
    return true;
  },

  guessQuality() {
    const q = new URLSearchParams(location.search).get('q');
    if (q && QUALITY[q]) return q;
    const gl = this.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/RTX (40|50)[6-9]0|RTX [3-5]090|RX 7[89]00|M[1-4] (Max|Ultra)/i.test(r)) return 'high';
    if (/RTX|RX [67]\d00|Radeon Pro|M[1-4] Pro|Arc A7/i.test(r)) return 'medium';
    return 'low';
  },

  // ---------------------------------------------------------------- scene setup
  load(name, keepCam) {
    const gl = this.gl, def = SCENE_DEF[name], q = QUALITY[this.quality];
    this.scene = name; this.def = def;
    const grid = typeof def.grid === 'function' ? def.grid(this.args) : def.grid;
    const N = this.N = grid.map(v => Math.max(16, Math.round(v * q / 2) * 2));
    if (!keepCam) { this.cam = Object.assign({}, def.cam); }
    if (def.speed && (this.args.speedFor !== name)) { this.args.speed = def.speed.def; this.args.speedFor = name; }
    if (def.re && (this.args.reFor !== name)) { this.args.re = def.re.def; this.args.reFor = name; }
    const sc = this.sc = this.buildScene();
    if (this.L) { this.L.dispose(); this.V.dispose(); }
    const flow = this.flowParams();
    const L = this.L = new LBMGPU(gl, {
      nx: N[0], ny: N[1], nz: N[2], nu: flow.nu, cs: 0.1, u: flow.U, bcY: sc.bcY, bcZ: sc.bcZ, wall: flow.wall,
      sponge: { len: Math.round(N[0] * 0.1), nu: 0.04 },
      absorb: { inLen: Math.round(N[0] * (def.internal ? 0.02 : 0.05)), outLen: Math.round(N[0] * 0.1), sigma: 0.2,
        side: def.internal ? [0, 0, 0, 0] : [sc.bcY === 1 ? 12 : 0, sc.bcY === 1 ? 12 : 0, sc.bcZ === 1 && !sc.ground ? 12 : 0, sc.bcZ === 1 ? 12 : 0].map(v => Math.round(v * q)) },
      nuWall: def.nuWall ?? 0,
      sdf: sc.sdf, inflow: sc.inflow, lib: GLSL_SDF_LIB + (sc.lib || ''), SP: sc.SP, wallModel: !!def.wallModel, solidVel: sc.solidVel,
    });
    const V = this.V = new Viz(gl, L);
    V.bakeBody(sc);
    this.nPart = { low: 1 << 18, medium: 1 << 19, high: 1 << 20, ultra: 1 << 21 }[this.quality];
    this.rake = Object.assign({ life: 2.6 * N[0] / flow.U, jitter: 0.25 }, def.rake(N, sc));
    V.initParticles(this.nPart, this.rake.life);
    this.target = flow; this.steps = this.steps || 4; this.t0 = L.t; this.changeT = L.t; this.hist = []; this.cdEma = null; this.clEma = null;
    this.updateUI();
  },

  buildScene() {
    const a = this.args, name = this.scene, N = this.N;
    if (name === 'wing') return SCENES.wing(N, { code: '2412', alpha: a.angle, span: a.tips ? 0.62 : 0, chord: a.tips ? 0.2 : 0.16 });
    if (name === 'cyclist') return SCENES.cyclist(N, { posture: a.posture });
    if (name === 'artery') return SCENES.artery(N, { severity: a.severity });
    if (name === 'car') return SCENES.car(N, { wheels: a.wheels !== false });
    return SCENES[name](N, {});
  },

  // lattice velocity and viscosity for the current scene and controls
  flowParams() {
    const def = this.def, sc = this.sc, a = this.args;
    let U = 0.05, Re;
    if (def.re) Re = a.re;
    else {
      Re = a.speed * def.realL / def.fluid.nu;
      // the air in the simulation moves faster when the wind is faster (compressed, to stay in the solver's stable range)
      const f = Math.pow(a.speed / def.speed.def, 0.7);
      if (this.scene === 'artery') U = Math.min(Math.min(0.05, 0.12 * (1 - a.severity)) * f, 0.14 * (1 - a.severity)); // jet below lattice Mach ~0.25
      else U = Math.min(0.05 * f, 0.09);
    }
    const nu = U * sc.refLen / Re;
    const wall = sc.floor === 'road' ? { zlo: [U, 0, 0] } : {};
    return { U, Re, nu, wall };
  },
  // move the running flow toward new settings gradually (an instant jump would send a pressure shock through the tunnel)
  rampFlow() {
    const L = this.L, f = this.target; if (!f || L.o.u === f.U) return;
    const k = Math.min(1, this.steps / 600), u = Math.abs(f.U - L.o.u) < 1e-5 ? f.U : L.o.u + k * (f.U - L.o.u);
    L.o.u = u; L.o.nu = u * this.sc.refLen / f.Re; L.o.wall = this.sc.floor === 'road' ? { zlo: [u, 0, 0] } : {};
    this.rake.life = 2.6 * this.N[0] / u;
  },
  // real seconds per lattice step, metres per cell
  units() {
    const def = this.def, sc = this.sc, f = this.flowParams(), U = this.L ? this.L.o.u : f.U;
    const Ureal = def.re ? f.Re * def.fluid.nu / def.realL : this.args.speed;
    const dx = def.realL / sc.refLen, dt = dx * U / Ureal;
    return { dx, dt, Ureal, Re: f.Re, U };
  },

  // change controls without a full reload when possible
  setArg(k, v) {
    this.args[k] = v; if (this.L) this.changeT = this.L.t;
    if (k === 'angle') {
      const r = v * Math.PI / 180; this.L.o.SP = [Math.cos(r), Math.sin(r), 0, 0];
      this.sc = this.buildScene(); this.L.revoxel(false); this.V.bakeBody(this.sc); this.hist = []; this.cdEma = this.clEma = null;
    } else if (k === 'speed' || k === 're') {
      this.target = this.flowParams(); this.L.o.nu = this.L.o.u * this.sc.refLen / this.target.Re;
    } else if (k === 'tips' || k === 'posture' || k === 'severity') {
      if (k === 'tips') this.cam = Object.assign({}, v ? this.def.camTips : this.def.cam);
      this.load(this.scene, true);
    }
    this.updateUI();
  },

  // ---------------------------------------------------------------- frame
  frame() {
    if (!this.L) return;
    const now = performance.now(), dtf = this.lastT ? now - this.lastT : 16; this.lastT = now;
    const L = this.L, V = this.V, onScreen = this.visible !== false;
    if (this.running) {
      // adapt the step count to keep ~50-60 fps (offscreen: a fixed modest budget, no rendering)
      if (onScreen) {
        if (dtf < 19 && this.steps < 64) this.steps++;
        else if (dtf > 26 && this.steps > 1) this.steps = Math.max(1, Math.floor(this.steps * 0.8));
      }
      this.rampFlow();
      L.step(this.steps, true);
      if (onScreen) {
        V.updateFields();
        this.rake.T = L.t - this.t0; this.rake.pulse = this.puffs;
        this.rake.pulseP = Math.round(0.5 * this.sc.refLen / L.o.u); this.rake.pulseL = Math.max(this.steps, Math.round(0.025 * this.sc.refLen / L.o.u));
        V.advect(this.steps, this.rake);
      }
      // forces: a one-pixel synchronous read a few times a second (cheap, and avoids readback-buffer churn)
      if (now - (this.forceT || 0) > 120) { this.forceT = now; const F = L.readForceSync(); this.onForce([F[0], F[1], F[2], L.t]); }
      this.rate = (this.rate || 0) * 0.95 + 0.05 * (this.steps * 1000 / Math.max(dtf, 1));
    }
    if (onScreen) this.render();
    if (now - (this.hudT || 0) > 250) { this.hudT = now; this.updateHud(); }
  },

  onForce(F) {
    const sc = this.sc, U = this.L.o.u, q = 0.5 * U * U * sc.refArea;
    const cd = F[0] / q, cl = F[2] / q;
    if (!isFinite(cd)) return;
    const k = 0.04;
    this.cdEma = this.cdEma == null ? cd : this.cdEma + k * (cd - this.cdEma);
    this.clEma = this.clEma == null ? cl : this.clEma + k * (cl - this.clEma);
    this.hist.push([F[3], cd, cl]); if (this.hist.length > 600) this.hist.shift();
  },

  viewOpts() {
    const v = this.view, U = this.L.o.u, sc = this.sc, def = this.def;
    const o = { uRef: U, rake: this.rake, floor: sc.ground ? 2 : 1, qThr: 0, mode: 0, smoke: false, cp: false,
      wRef: 2.5 * U / sc.refLen, alpha: (def.alpha ?? 0.08) * (this.quality === 'ultra' ? 0.6 : 1), psize: (window.devicePixelRatio || 1) > 1.5 ? 2 : 1.4 };
    if (def.internal) o.floor = 0;
    if (def.clip && !this.args.tips && (v !== 'vortices' || def.internal)) o.clipY = this.N[1] / 2 - 0.5;
    if (v === 'smoke') { o.smoke = true; }
    else if (v === 'surface') { o.smoke = true; o.cp = true; o.alpha *= 0.5; }
    else if (v === 'vortices') { o.mode = 1; o.qThr = 0.6 * (U / sc.refLen) ** 2 * (def.internal ? 4 : 1); o.colorIso = this.scene === 'wing' && this.args.tips ? 1 : 0; o.wRef = 3 * U / sc.refLen; }
    else { o.mode = 2; o.sliceField = { speed: 0, pressure: 1, swirl: 2 }[v]; o.sliceAxis = def.slice.axis; o.slicePos = this.N[def.slice.axis] * (def.slice.pos ?? 0.5) - (def.slice.axis === 1 ? 0.5 : 0); }
    if (def.internal) { const k = 1 / (1 - this.args.severity); o.uRef = U * k * 1.1 / 1.6; o.wRef *= k; }
    return o;
  },

  render() {
    const cv = this.cv, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const N = this.N, c = this.cam, D = Math.max(N[0], N[1], N[2]);
    const target = [N[0] * (this.def.target ?? 0.48), N[1] / 2, this.sc.ground ? N[2] * 0.3 : N[2] / 2];
    const view = M4.orbit(target, c.yaw, c.pitch, c.dist * D * 1.25, w / h);
    view.width = w; view.height = h;
    this.view_ = view;
    this.V.render(view, this.viewOpts());
  },

  // ---------------------------------------------------------------- UI
  bindUI() {
    const cv = this.cv; let drag = null, pinch = null;
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (!drag || pinch) return;
      this.cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
      this.cam.pitch = Math.max(-1.2, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.005));
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.dist = Math.max(0.25, Math.min(3, this.cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    cv.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), dist: this.cam.dist }; }, { passive: true });
    cv.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); this.cam.dist = Math.max(0.25, Math.min(3, pinch.dist * pinch.d / d)); } }, { passive: true });
    cv.addEventListener('touchend', () => { pinch = null; });

    document.querySelectorAll('[data-scene]').forEach(b => b.addEventListener('click', () => this.load(b.dataset.scene)));
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { this.view = b.dataset.view; this.updateUI(); }));
    document.querySelectorAll('[data-quality]').forEach(b => b.addEventListener('click', () => { this.quality = b.dataset.quality; this.load(this.scene, true); }));
    document.getElementById('play').addEventListener('click', () => { this.running = !this.running; this.updateUI(); });
    document.getElementById('restart').addEventListener('click', () => this.load(this.scene, true));
    const sp = document.getElementById('spd'), an = document.getElementById('ang'), sv = document.getElementById('sev');
    sp.addEventListener('input', () => {
      const def = this.def, t = +sp.value / 1000;
      if (def.re) this.setArg('re', Math.round(def.re.min * Math.pow(def.re.max / def.re.min, t)));
      else this.setArg('speed', def.speed.min + (def.speed.max - def.speed.min) * t);
    });
    an.addEventListener('input', () => this.setArg('angle', +an.value));
    sv.addEventListener('input', () => { this.args.severity = +sv.value / 100; this.updateUI(); });
    sv.addEventListener('change', () => this.setArg('severity', +sv.value / 100));
    document.getElementById('ctlTips').addEventListener('click', () => this.setArg('tips', !this.args.tips));
    document.getElementById('ctlPosture').addEventListener('click', () => this.setArg('posture', this.args.posture ? 0 : 1));
  },

  speedText() {
    const def = this.def, a = this.args;
    if (!def.speed) return '';
    if (this.scene === 'artery') return `${a.speed.toFixed(2)} m/s`;
    return `${a.speed.toFixed(def.speed.max < 25 ? 1 : 0)} m/s · ${(a.speed * 3.6).toFixed(0)} km/h`;
  },

  updateUI() {
    const def = this.def, a = this.args;
    document.querySelectorAll('[data-scene]').forEach(b => b.setAttribute('aria-pressed', b.dataset.scene === this.scene));
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === this.view));
    document.querySelectorAll('[data-quality]').forEach(b => b.setAttribute('aria-pressed', b.dataset.quality === this.quality));
    document.getElementById('play').textContent = this.running ? 'Pause' : 'Run';
    const show = (id, on) => { document.getElementById(id).hidden = !on; };
    show('ctlSpeed', true); show('ctlAngle', def.ctl.includes('angle')); show('ctlTips', def.ctl.includes('tips'));
    show('ctlPosture', def.ctl.includes('posture')); show('ctlSev', def.ctl.includes('severity'));
    const sp = document.getElementById('spd'), so = document.getElementById('spdOut'), sl = document.getElementById('spdLab');
    if (def.re) {
      sl.textContent = 'Reynolds number';
      sp.value = Math.round(1000 * Math.log(a.re / def.re.min) / Math.log(def.re.max / def.re.min));
      so.textContent = fmtRe(a.re);
    } else {
      sl.textContent = this.scene === 'artery' ? 'Blood speed' : 'Wind speed';
      sp.value = Math.round(1000 * (a.speed - def.speed.min) / (def.speed.max - def.speed.min));
      so.textContent = this.speedText();
    }
    document.getElementById('ang').value = a.angle; document.getElementById('angOut').textContent = `${a.angle}°`;
    document.getElementById('sev').value = Math.round(100 * a.severity); document.getElementById('sevOut').textContent = `${Math.round(100 * a.severity)}% blocked`;
    document.getElementById('ctlTips').setAttribute('aria-pressed', a.tips);
    document.getElementById('ctlTips').textContent = a.tips ? 'Wingtips: on' : 'Wingtips: off';
    document.getElementById('ctlPosture').textContent = a.posture ? 'Posture: tucked' : 'Posture: upright';
    document.getElementById('caption').innerHTML = def.caption(Object.assign({ speedText: this.speedText() }, a));
  },

  updateHud() {
    const u = this.units(), def = this.def, sc = this.sc, N = this.N, $ = id => document.getElementById(id);
    const cd = this.cdEma, cl = this.clEma, rho = def.fluid.rho;
    const Areal = sc.refArea * u.dx * u.dx, qd = 0.5 * rho * u.Ureal * u.Ureal * Areal;
    $('rObj').textContent = def.label + (this.scene === 'wing' ? ` · ${this.args.angle}°` : '');
    $('rRe').textContent = fmtRe(u.Re);
    $('rCd').textContent = cd == null ? '—' : cd.toFixed(3);
    $('rClRow').hidden = $('rCl').hidden = this.scene !== 'wing';
    $('rCl').textContent = cl == null ? '—' : cl.toFixed(3);
    let force = '—';
    if (cd != null) {
      const F = cd * qd;
      if (this.scene === 'artery') {
        force = '';
      } else force = F < 10 ? `${F.toFixed(2)} N` : F < 1e4 ? `${F.toFixed(0)} N` : `${(F / 1000).toFixed(1)} kN`;
      if (this.scene === 'cyclist' || this.scene === 'car') { const P = F * u.Ureal; force += ` · ${P < 1e4 ? P.toFixed(0) + ' W' : (P / 1000).toFixed(1) + ' kW'}`; }
      if (this.scene === 'wing' && cl != null) { const kgm2 = cl * 0.5 * rho * u.Ureal * u.Ureal / 9.81; force = `holds up ${kgm2.toFixed(0)} kg per m² · L/D ${(cl / cd).toFixed(1)}`; }
    }
    $('rForce').textContent = force;
    $('rRate').textContent = `${(N[0] * N[1] * N[2] / 1e6).toFixed(1)} M cells · ${Math.round(this.rate || 0)} steps/s`;
    this.st = this.strouhal();
    if (this.scene === 'cylinder' || this.scene === 'sphere') {
      $('rForce').textContent = this.st ? `sheds ${(this.st * u.Ureal / def.realL).toFixed(1)} vortices/s · St ${this.st.toFixed(3)}` : 'wake settling…';
    }
    this.drawChart(); this.drawKey(u);
    $('rTime').textContent = `${fmtTime((this.L.t - this.t0) * u.dt)} of real time`;
  },
};

// Strouhal number from the lift (cross-stream force) history: mean period between upward zero crossings
App.strouhal = function () {
  const h = this.hist; if (h.length < 60) return null;
  const tail = h.slice(-Math.min(h.length, 400)), m = tail.reduce((a, v) => a + v[2], 0) / tail.length, ups = [];
  for (let i = 1; i < tail.length; i++) { const a = tail[i - 1][2] - m, b = tail[i][2] - m; if (a < 0 && b >= 0) ups.push(tail[i - 1][0] + (tail[i][0] - tail[i - 1][0]) * a / (a - b)); }
  if (ups.length < 3) return null;
  const per = (ups[ups.length - 1] - ups[0]) / (ups.length - 1), amp = Math.sqrt(tail.reduce((a, v) => a + (v[2] - m) ** 2, 0) / tail.length);
  if (amp < 0.02) return null;
  return this.sc.refLen / (per * this.L.o.u);
};
App.drawChart = function () {
  const cv = document.getElementById('chart'); if (!cv || !cv.offsetWidth) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.width = cv.offsetWidth * dpr, h = cv.height = cv.offsetHeight * dpr, c = cv.getContext('2d');
  const hs = this.hist.slice(-300), wing = this.scene === 'wing';
  if (hs.length < 2) return;
  const keys = wing ? [1, 2] : [1], all = hs.flatMap(v => keys.map(k => v[k])).filter(isFinite);
  let lo = Math.min(0, ...all), hi = Math.max(...all); if (hi - lo < 0.1) hi = lo + 0.1; const pad = 0.08 * (hi - lo); lo -= pad; hi += pad;
  const X = i => (i / (hs.length - 1)) * w, Y = v => h - (v - lo) / (hi - lo) * h;
  c.strokeStyle = 'rgba(230,234,240,0.12)'; c.lineWidth = dpr; c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(w, Y(0)); c.stroke();
  const col = { 1: '#ffc46b', 2: '#8fc3ec' };
  for (const k of keys) { c.strokeStyle = col[k]; c.lineWidth = 1.5 * dpr; c.beginPath(); hs.forEach((v, i) => i ? c.lineTo(X(i), Y(v[k])) : c.moveTo(X(i), Y(v[k]))); c.stroke(); }
  document.getElementById('chartLab').innerHTML = wing ? '<span style="color:#8fc3ec">lift</span> and <span style="color:#ffc46b">drag</span> coefficients' : this.scene === 'cylinder' || this.scene === 'sphere' ? 'drag coefficient (wiggles = vortex shedding)' : 'drag coefficient, live';
  const last = hs[hs.length - 1]; document.getElementById('chartVal').textContent = wing ? `${last[2].toFixed(2)} / ${last[1].toFixed(3)}` : last[1].toFixed(3);
};
App.drawKey = function (u) {
  const el = document.getElementById('colorkey'), v = this.view;
  const sl = { speed: 1, pressure: 1, swirl: 1, surface: 1 }[v];
  el.hidden = !sl; if (!sl) return;
  const U = u.Ureal, def = this.def, art = this.scene === 'artery';
  let grad, t, title;
  if (v === 'speed') { const k = art ? 1 / (1 - this.args.severity) * 1.1 : 1.6; grad = 'linear-gradient(90deg,#05070f,#1a4090,#40a6d9,#f2d98c,#ff7333)'; title = 'flow speed'; t = [0, k / 2, k].map(f => `${(f * U).toPrecision(2)} m/s`); }
  else if (v === 'pressure' || v === 'surface') { grad = 'linear-gradient(90deg,#2673f2,#d9dde6,#f25a2e)'; title = v === 'surface' ? 'pressure on the surface' : 'pressure'; t = ['suction', 'ambient', 'push']; }
  else { grad = 'linear-gradient(90deg,#2673f2,#d9dde6,#f25a2e)'; title = 'swirl (vorticity)'; t = ['clockwise', 'none', 'anticlockwise']; }
  el.innerHTML = `${title}<div class="bar" style="background:${grad}"></div><div class="ticks">${t.map(x => `<span>${x}</span>`).join('')}</div>`;
};

function fmtRe(re) {
  if (re < 1e4) return Math.round(re).toLocaleString('en-US');
  const e = Math.floor(Math.log10(re)), m = re / 10 ** e;
  return `${m.toFixed(1)} × 10${'⁰¹²³⁴⁵⁶⁷⁸⁹'[e] || e}`.replace(/(\d)\.0 ×/, '$1 ×');
}
function fmtTime(s) {
  if (s < 1e-3) return `${(s * 1e6).toFixed(0)} µs`;
  if (s < 1) return `${(s * 1e3).toFixed(s < 0.01 ? 2 : 1)} ms`;
  return `${s.toFixed(2)} s`;
}

window.addEventListener('DOMContentLoaded', () => App.init());
