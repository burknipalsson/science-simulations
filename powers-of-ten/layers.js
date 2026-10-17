// Powers of Ten: the outer rungs (cosmic web -> Earth). Each layer knows its frame, when it is visible
// (as a function of L = log10 view width), how to draw itself, and which labels to show.
(function (root) {
  const S = root.PTEN, Z = root.PTEN_ZOOM, G = root.PTEN_GALAXY, RD = root.PTEN_RENDER;
  const smooth = Z.smooth;
  // fully visible between lo and hi, fading over `f` dex outside
  const band = (L, lo, hi, fIn = 0.6, fOut = 0.6) => smooth((hi + fOut - L) / fOut) * smooth((L - (lo - fIn)) / fIn);

  // star colour from B-V (Ballesteros 2012 temperature, then a blackbody-ish ramp)
  function bvColor(bv) {
    const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    const t = Math.max(0, Math.min(1, (T - 2500) / 9500));
    return [1.0, 0.62 + 0.36 * Math.min(1, t * 1.6), 0.35 + 0.75 * t].map(x => Math.min(1, x));
  }
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const gauss = rnd => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

  async function b64gz(s, Type) {
    const bin = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const buf = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return new Type(buf);
  }

  function build(R, assets) {
    const gl = R.gl, DATA = root.PTEN_DATA, layers = [];
    const drawPoints = (vao, pl, alpha, o) => {
      const P = R.points; gl.useProgram(P.p); RD.setPlace(R, P, pl, alpha);
      gl.uniformMatrix4fv(P.u.uProj, false, R.proj(1e-3, 1e6));
      gl.uniform1f(P.u.uMinPx, o.minPx || 1.5); gl.uniform1f(P.u.uMaxPx, o.maxPx || 64);
      gl.uniform1f(P.u.uGain, o.gain || 1); gl.uniform1f(P.u.uFocus, o.focus || 0); gl.uniform1f(P.u.uMarker, o.marker ? 1 : 0);
      gl.bindVertexArray(vao.v); gl.drawArrays(gl.POINTS, 0, vao.count);
    };
    const pointsVAO = (pos, col, size) => R.vao(R.points, { aPos: [pos, 3], aCol: [col, 4], aSize: [size, 1] });

    // ---------- 1. the cosmic web (recorded from The Cosmic Web's engine) ----------
    const WEB = root.PTEN_WEB;
    if (WEB) {
      const web = { name: 'web', frame: 'web', vaos: [] };
      (async () => {
        const far = await b64gz(WEB.far, Uint16Array), near = await b64gz(WEB.near, Int16Array);
        const nf = far.length / 3, pf = new Float32Array(3 * nf), cf = new Float32Array(4 * nf), sf = new Float32Array(nf);
        for (let i = 0; i < nf; i++) {
          for (let k = 0; k < 3; k++) pf[3 * i + k] = (far[3 * i + k] / 65536 - 0.5);
          cf.set([0.55, 0.62, 1.0, 1], 4 * i); sf[i] = WEB.farSize;
        }
        const nn = near.length / 3, pn = new Float32Array(3 * nn), cn = new Float32Array(4 * nn), sn = new Float32Array(nn);
        for (let i = 0; i < nn; i++) {
          for (let k = 0; k < 3; k++) pn[3 * i + k] = WEB.lg[k] + near[3 * i + k] / 32767 * WEB.nearR;
          cn.set([0.55, 0.62, 1.0, 1], 4 * i); sn[i] = WEB.nearSize;
        }
        web.far = pointsVAO(pf, cf, sf); web.near = pointsVAO(pn, cn, sn);
      })();
      web.alpha = L => band(L, 23.6, 30, 0.8);
      web.draw = (cam, a) => {
        if (!web.far) return;
        const pl = Z.place(cam, 'web', [0, 0, 0]); pl.rot = pl.rot.map(x => x * S.nodes.web.size);
        // the far sample is sparse: dim it as the view closes in, where the full-resolution sphere takes over
        const zoomIn = smooth((cam.L - 23.6) / 1.2);
        // below ~10^25 m the view looks through 100+ Mpc of particles: focus on a slab around the centre
        const focus = window.PTEN_NOFOCUS ? 0 : cam.L > 24.9 ? 0 : 0.9 + 3 * Math.max(0, cam.L - 24.2);
        drawPoints(web.far, pl, a * zoomIn, { gain: WEB.farGain, minPx: 1.5, focus });
        drawPoints(web.near, pl, a, { gain: WEB.nearGain * (1 - 0.6 * zoomIn) * (cam.L < 24.5 ? 0.6 : 1), minPx: 1.5, focus });
      };
      web.labels = cam => [
        { t: 'the Local Group', frame: 'gc', p: [0, 0, 0], cls: 'ring', a: band(cam.L, 23.3, 25.4, 0.3, 0.4), far: 9 },
        { t: 'a Virgo-like cluster, 16.5 Mpc away', frame: 'web', p: S.bodies.virgo.pos, cls: 'minor', a: band(cam.L, 23.4, 24.6, 0.3, 0.4), far: 9 }];
      layers.push(web);
    }

    // ---------- 2. galaxies of the Local Group and Local Volume (real positions) ----------
    {
      const gal = DATA.galaxies.filter(g => g.n !== 'LMC' && g.n !== 'SMC' || true);
      const n = gal.length, pos = new Float32Array(3 * n), col = new Float32Array(4 * n), size = new Float32Array(n);
      gal.forEach((g, i) => {
        pos.set(g.p, 3 * i);
        const mv = g.mv == null ? -8 : g.mv, lum = Math.pow(10, -0.4 * (mv + 16));
        const r = g.R ? g.R * 0.5 : Math.min(Math.max((g.rh || 300) * 1.5e-3, 0.12), 1.5);
        col.set(g.big ? [1.0, 0.9, 0.78, Math.min(3, 1.2 + lum * 0.02)] : [0.85, 0.88, 1.0, Math.min(0.9, 0.35 + lum * 0.3)], 4 * i);
        size[i] = r;
      });
      const vao = pointsVAO(pos, col, size);
      // M31 and M33 as particle discs, oriented on the sky by their measured position angle and inclination
      const discs = [];
      function disc(name, ra, dec, dKpc, pa, inc, Rd, nP, ringR) {
        const D = S.D, s = S.fromEq(ra, dec, 1), north = S.app(S.EQ2GAL, [-Math.sin(dec * D) * Math.cos(ra * D), -Math.sin(dec * D) * Math.sin(ra * D), Math.cos(dec * D)]);
        const east = [s[1] * north[2] - s[2] * north[1], s[2] * north[0] - s[0] * north[2], s[0] * north[1] - s[1] * north[0]].map(x => -x);
        const maj = north.map((x, i) => Math.cos(pa * D) * x + Math.sin(pa * D) * east[i]);
        const m2 = north.map((x, i) => -Math.sin(pa * D) * x + Math.cos(pa * D) * east[i]);
        const u = m2.map((x, i) => -Math.cos(inc * D) * x - Math.sin(inc * D) * s[i]);  // in-plane minor axis, near side NW
        const nrm = [maj[1] * u[2] - maj[2] * u[1], maj[2] * u[0] - maj[0] * u[2], maj[0] * u[1] - maj[1] * u[0]];
        const c = S.fromEq(ra, dec, dKpc).map((x, i) => x + (i === 0 ? S.SUN_GC[0] / S.KPC : i === 2 ? S.SUN_GC[2] / S.KPC : 0));
        const rnd = mulberry(name.length * 7919), p = new Float32Array(3 * nP), cl = new Float32Array(4 * nP), sz = new Float32Array(nP);
        for (let i = 0; i < nP; i++) {
          let a, b, h, colr;
          const kind = rnd();
          if (kind < 0.25) { a = gauss(rnd) * Rd * 0.25; b = gauss(rnd) * Rd * 0.2; h = gauss(rnd) * Rd * 0.16; colr = [1, 0.8, 0.55, 1.2]; }
          else if (ringR && kind < 0.4) { const r = ringR + gauss(rnd) * 0.8, t = rnd() * 6.283; a = r * Math.cos(t); b = r * Math.sin(t); h = gauss(rnd) * 0.1; colr = [0.65, 0.78, 1, 1]; }
          else { const r = -Rd * Math.log(rnd() * rnd() + 1e-9), t = rnd() * 6.283; a = r * Math.cos(t); b = r * Math.sin(t); h = gauss(rnd) * 0.3; colr = [1, 0.88, 0.72, 0.8]; }
          for (let k = 0; k < 3; k++) p[3 * i + k] = c[k] + a * maj[k] + b * u[k] + h * nrm[k];
          cl.set(colr, 4 * i); sz[i] = 0.35;
        }
        discs.push({ name, vao: pointsVAO(p, cl, sz), n: nrm, c });
      }
      disc('Andromeda (M31)', 10.68471, 41.26875, 765, 38, 77, 5.3, 60000, 10);   // PA, i: de Vaucouleurs 1958; Rd: Courteau 2011
      disc('Triangulum (M33)', 23.46208, 30.66017, 859, 22, 56, 1.4, 15000, 0);   // Corbelli 2014
      const L = { name: 'galaxies', frame: 'gc' };
      L.alpha = Lv => band(Lv, 20.9, 23.5, 0.5, 0.5);
      L.draw = (cam, a) => {
        const pl = Z.place(cam, 'gc', [0, 0, 0]); pl.rot = pl.rot.map(x => x * S.KPC);
        for (const d of discs) drawPoints(d.vao, pl, a, { gain: 2.5, minPx: 1.3 });
        drawPoints(vao, pl, a, { gain: 1.2, minPx: 3, maxPx: 90, marker: true });
      };
      const named = new Set(['Andromeda (M31)', 'Triangulum (M33)', 'LMC', 'SMC', 'M81', 'Centaurus A', 'NGC 253 (Sculptor)', 'IC 342', 'NGC 6822', 'IC 1613', 'Leo I', 'Sagittarius', 'Fornax', 'Maffei 1', 'NGC 300', 'M83', 'M32']);
      L.labels = cam => gal.filter(g => named.has(g.n)).map(g => ({ t: g.n === 'LMC' ? 'Large Magellanic Cloud' : g.n === 'SMC' ? 'Small Magellanic Cloud' : g.n, frame: 'gc', p: g.p.map(x => x * S.KPC), cls: g.big ? '' : 'minor', a: g.big || g.n === 'LMC' || g.n === 'SMC' ? band(cam.L, 20.9, 23.3, 0.5, 0.3) : band(cam.L, 20.9, 22.4, 0.5, 0.3) }));
      layers.push(L);
    }

    // ---------- 3. the Milky Way (model from measured structure; turns on its own clock) ----------
    {
      const P = G.build(DATA.arms, 420000);
      const prog = R.program(`
        in float aR, aPhi, aZ, aKind, aPhase, aLum, aSize; in vec3 aCol;
        uniform float uT, uOmBar, uOmArm, uLife, uMinPx, uGain, uCoarse, uFine;
        out vec4 vCol;
        float omega(float R) { return 236.0 * (1.0 - exp(-R / 0.6)) / max(R, 0.05) * 1.0227e-3; }
        void main() {
          float phi, lum = aLum;
          if (aKind < 0.5) phi = aPhi - omega(aR) * uT;
          else if (aKind < 1.5) phi = aPhi - uOmBar * uT;
          else {
            float age = fract(uT / uLife + aPhase) * uLife;
            phi = aPhi - uOmArm * (uT - age) - omega(aR) * age;
            lum *= exp(-age / 25.0) * 3.0 * smoothstep(0.0, 2.0, age);   // OB stars burn out in tens of Myr
          }
          vec3 p = vec3(aR * cos(phi), aR * sin(phi), aZ);
          vec3 c = toCam(p);
          gl_Position = uProj * vec4(c, 1.0);
          float d = -c.z; float px = aSize * uScale * uPx / d;
          float s = max(px, uMinPx);
          gl_PointSize = s;
          // a sprite carries a fixed amount of light: spread over a bigger disc it is dimmer per pixel
          // coarse sprites (the whole disc) hand over to fine ones (the Sun's 2.5 kpc patch) as the view closes in
          lum *= aSize > 0.03 ? uCoarse : uFine;
          vCol = vec4(aCol, lum * uGain * uAlpha * (px * px) / (s * s));
        }`, `
        in vec4 vCol; out vec4 o;
        void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = vCol.a * exp(-r2 * 3.5); o = vec4(vCol.rgb * a, 1.0); }`);
      const vao = R.vao(prog, { aR: [P.R, 1], aPhi: [P.phi, 1], aZ: [P.z, 1], aKind: [P.kind, 1], aPhase: [P.phase, 1], aLum: [P.lum, 1], aSize: [P.size, 1], aCol: [P.col, 3] });
      // globular clusters: real positions
      const gcs = DATA.globulars, gp = new Float32Array(3 * gcs.length), gc = new Float32Array(4 * gcs.length), gs = new Float32Array(gcs.length);
      gcs.forEach((g, i) => { gp.set(g.p, 3 * i); gc.set([1, 0.85, 0.6, 1.2], 4 * i); gs[i] = 0.02; });
      const gvao = pointsVAO(gp, gc, gs);
      const L = { name: 'milkyway', frame: 'gc', clock: 'galaxy' };
      L.alpha = Lv => band(Lv, 19.7, 23.3, 0.6, 0.6);
      L.tripAlpha = Lv => band(Lv, 19.9, 23.3, 0.5, 0.6);     // on the trip to the centre the model stays in view longer
      L.draw = (cam, a, clocks) => {
        const pl = Z.place(cam, 'gc', [0, 0, 0]);
        gl.useProgram(prog.p); RD.setPlace(R, prog, pl, a);
        gl.uniformMatrix4fv(prog.u.uProj, false, R.proj(1e-3, 1e6));
        gl.uniform1f(prog.u.uScale, Math.hypot(pl.rot[0], pl.rot[3], pl.rot[6]) * S.KPC);
        // uRot is per metre; the model is in kpc
        const m = pl.rot.map(x => x * S.KPC);
        gl.uniformMatrix3fv(prog.u.uRot, false, new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]));
        gl.uniform1f(prog.u.uT, clocks.galaxy); gl.uniform1f(prog.u.uOmBar, G.OMEGA_BAR); gl.uniform1f(prog.u.uOmArm, G.OMEGA_ARM); gl.uniform1f(prog.u.uLife, G.YOUNG_LIFE);
        gl.uniform1f(prog.u.uMinPx, 1.2); gl.uniform1f(prog.u.uGain, 0.35);
        const toCentre = Math.hypot(...S.rel([0, 0, 0], 'gc', cam.pos, cam.frame, 'gc')) < 2 * S.KPC;
        gl.uniform1f(prog.u.uCoarse, toCentre ? 0.03 + 0.97 * smooth((cam.L - 19.1) / 1.6) : 0.25 + 0.75 * smooth((cam.L - 19.7) / 0.8)); gl.uniform1f(prog.u.uFine, toCentre ? 0 : smooth((20.9 - cam.L) / 0.7));
        gl.bindVertexArray(vao.v); gl.drawArrays(gl.POINTS, 0, vao.count);
        drawPoints(gvao, { rot: m, off: pl.off }, a * band(cam.L, 20.0, 22.0, 0.4, 0.5), { gain: 0.7, minPx: 2.2, marker: true });
      };
      L.labels = cam => {
        const a = band(cam.L, 20.0, 21.6, 0.3, 0.4);
        const out = [{ t: 'Sgr A*, the central black hole', frame: 'gc', p: [0, 0, 0], cls: 'minor', a }, { t: 'the Sun', frame: 'sol', p: [0, 0, 0], cls: 'sun ring', a: band(cam.L, 19.4, 22.4, 0.3, 0.4) }];
        // arm names at a point within each arm's measured range
        for (const arm of DATA.arms) {
          if (arm.n === '3-kpc') continue;
          const beta = arm.n === 'Local' ? arm.b1 : arm.n === 'Outer' ? arm.b1 - 10 : arm.n === 'Perseus' ? 60 : arm.b1 - 8, Rr = G.armR(arm, beta), phi = G.phiOf(beta);
          out.push({ t: arm.n + ' arm', frame: 'gc', p: [Rr * Math.cos(phi) * S.KPC, Rr * Math.sin(phi) * S.KPC, 0], cls: 'arm', a: band(cam.L, 20.1, 20.9, 0.3, 0.3) });
        }
        return out;
      };
      layers.push(L);
    }

    // ---------- 4. the Sun's neighbourhood: real stars (HYG: Hipparcos, Yale, Gliese) ----------
    {
      const st = DATA.stars.filter(s => s.n !== 'Sol').concat([{ n: '', p: [0, 0, 0], v: [0, 0, 0], m: 4.83, c: 0.65 }]), n = st.length;
      const pos = new Float32Array(3 * n), vel = new Float32Array(3 * n), col = new Float32Array(4 * n), size = new Float32Array(n);
      st.forEach((s, i) => { pos.set(s.p, 3 * i); vel.set(s.v || [0, 0, 0], 3 * i); col.set([...bvColor(s.c), Math.pow(10, -0.4 * (s.m - 4.83))], 4 * i); size[i] = 0; });
      const prog = R.program(`
        in vec3 aPos, aVel; in vec4 aCol;
        uniform float uT, uGain, uPxS;
        out vec4 vCol;
        void main() {
          vec3 c = toCam(aPos + aVel * uT);
          float d = -c.z; gl_Position = uProj * vec4(c, 1.0);
          if (d <= 0.0) { gl_Position = vec4(2.0); return; }
          float f = aCol.a / (d * d) * uGain;                 // inverse-square: apparent brightness
          float m = log(f) / log(10.0);                       // like a magnitude scale: 4 decades of brightness shown
          float b = clamp((m + 3.2) / 3.0, 0.0, 1.6);
          gl_PointSize = uPxS * (1.0 + 0.9 * clamp(m + 0.5, 0.0, 2.5));
          // the luminous-star sample stops at 600 pc: let it thin out instead of ending at a hard sphere
          vCol = vec4(aCol.rgb, b * b * uAlpha * smoothstep(600.0, 350.0, length(aPos)));
        }`, `
        in vec4 vCol; out vec4 o;
        void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
          float a = vCol.a * (exp(-r2 * 6.0) + 0.15 * exp(-r2 * 1.5)); o = vec4(vCol.rgb * a + max(a - 1.0, 0.0) * 0.5, 1.0); }`);
      const vao = R.vao(prog, { aPos: [pos, 3], aVel: [vel, 3], aCol: [col, 4] });
      const L = { name: 'stars', frame: 'gc', clock: 'stars' };
      L.alpha = Lv => band(Lv, 15.0, 19.15, 0.7, 0.5);
      L.draw = (cam, a, clocks) => {
        const pl = Z.place(cam, 'gc', S.SUN_GC);
        gl.useProgram(prog.p); RD.setPlace(R, prog, pl, a);
        const m = pl.rot.map(x => x * S.PC);
        gl.uniformMatrix3fv(prog.u.uRot, false, new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]));
        gl.uniformMatrix4fv(prog.u.uProj, false, R.proj(1e-4, 1e6));
        gl.uniform1f(prog.u.uT, clocks.stars); gl.uniform1f(prog.u.uGain, Math.pow(10, -0.5 * Math.max(0, cam.L - 17)));
        gl.uniform1f(prog.u.uPxS, 2.2 * (R.canvas.height / 900 + 0.3));
        gl.bindVertexArray(vao.v); gl.drawArrays(gl.POINTS, 0, vao.count);
      };
      // label the brightest-looking named stars
      L.labels = cam => {
        const a = L.alpha(cam.L); if (a < 0.05) return [];
        const out = [];
        for (const s of st) if (s.n) {
          const p = s.p.map((x, k) => (x + (s.v ? s.v[k] : 0) * (root.PTEN_CLOCKS ? root.PTEN_CLOCKS.stars : 0)) * S.PC + S.SUN_GC[k]);
          out.push({ t: s.n, frame: 'gc', p, cls: 'minor', a, lum: Math.pow(10, -0.4 * (s.m - 4.83)) });
        }
        return out;
      };
      L.maxLabels = 18;
      layers.push(L);
    }

    // ---------- 5. the solar system (Kepler orbits from JPL Horizons states) ----------
    const PLANETS = [['mercury', 'Mercury', 2.4397e6, [0.7, 0.68, 0.65]], ['venus', 'Venus', 6.0518e6, [1, 0.9, 0.7]], ['earth', 'Earth', 6.371e6, [0.5, 0.7, 1]],
      ['mars', 'Mars', 3.3895e6, [1, 0.6, 0.4]], ['jupiter', 'Jupiter', 6.9911e7, [1, 0.85, 0.65]], ['saturn', 'Saturn', 5.8232e7, [1, 0.9, 0.7]],
      ['uranus', 'Uranus', 2.5362e7, [0.7, 0.9, 1]], ['neptune', 'Neptune', 2.4622e7, [0.5, 0.65, 1]]];
    {
      // orbit rings: sample one period of each two-body orbit
      const orbits = PLANETS.map(([k]) => {
        const b = S.bodies[k === 'earth' ? 'emb' : k], r = Math.hypot(...b.pos), v2 = b.vel.reduce((s, x) => s + x * x, 0);
        const a = 1 / (2 / r - v2 / 1.32712440018e20), per = 2 * Math.PI * Math.sqrt(a ** 3 / 1.32712440018e20);
        const N = 720, p = new Float32Array(3 * (N + 1));
        for (let i = 0; i <= N; i++) { const q = S.kepler(b.pos, b.vel, 1.32712440018e20, per * i / N); for (let j = 0; j < 3; j++) p[3 * i + j] = q[j] / S.AU; }
        return R.vao(R.lines, { aPos: [p, 3] });
      });
      const L = { name: 'solar', frame: 'sol', clock: 'solar' };
      L.alpha = Lv => band(Lv, 8.8, 15.8, 0.4, 0.8);
      let pv = null;
      L.draw = (cam, a) => {
        const pl = Z.place(cam, 'sol', [0, 0, 0]); const m = pl.rot.map(x => x * S.AU);
        gl.useProgram(R.lines.p); RD.setPlace(R, R.lines, { rot: m, off: pl.off }, a);
        gl.uniformMatrix4fv(R.lines.u.uProj, false, R.proj(1e-4, 1e6));
        orbits.forEach((o, i) => {
          const isE = PLANETS[i][0] === 'earth';
          gl.uniform4f(R.lines.u.uColor, isE ? 0.45 : 0.55, isE ? 0.65 : 0.6, isE ? 1 : 0.75, (isE ? 0.55 : 0.28) * a * band(cam.L, 10.4, 15.5, 0.5, 0.5));
          gl.bindVertexArray(o.v); gl.drawArrays(gl.LINE_STRIP, 0, o.count);
        });
        // planets as points (their discs are far below a pixel here)
        const list = PLANETS.concat([['moon', 'Moon', 1.7374e6, [0.8, 0.8, 0.78]]]);
        const n = list.length, pos = new Float32Array(3 * n), col = new Float32Array(4 * n), size = new Float32Array(n);
        list.forEach(([k, , r, c], i) => { pos.set(S.bodies[k].pos.map(x => x / S.AU), 3 * i); col.set([...c, k === 'moon' ? 0.8 * band(cam.L, 8.6, 10.2, 0.3, 0.4) : 1.6], 4 * i); size[i] = r / S.AU; });
        if (!pv) pv = pointsVAO(pos, col, size); else R.update(pv, 'aPos', pos);
        drawPoints(pv, { rot: m, off: pl.off }, a * band(cam.L, 9.25, 15.6, 0.35, 0.6), { gain: 1, minPx: 4.5, marker: true });
      };
      L.labels = cam => {
        const a = band(cam.L, 10.6, 14.6, 0.5, 0.5), out = [];
        PLANETS.forEach(([k, name]) => { if (k !== 'earth' || cam.L > 11.4) out.push({ t: name, frame: 'sol', p: S.bodies[k].pos, cls: k === 'earth' ? 'ring' : '', a: k === 'earth' ? band(cam.L, 11.0, 14.6, 0.4, 0.5) : a }); });
        out.push({ t: 'the Sun', frame: 'sol', p: [0, 0, 0], cls: 'sun', a: band(cam.L, 10.6, 16.6, 0.4, 0.5) });
        return out;
      };
      layers.push(L);
    }

    // ---------- 6. Sun, Earth and Moon as real spheres ----------
    {
      const earthTex = R.texture(assets.earth, { wrap: true }), nightTex = R.texture(assets.night, { wrap: true }), rvkA = R.texture(assets.rvk11), rvkB = R.texture(assets.rvk13), detail = R.texture(assets.iceland), moonTex = assets.moon ? R.texture(assets.moon, { wrap: true }) : null;
      const sp = R.sphere;
      function sphere(cam, frame, centre, radius, bodyRot, kind, a, opts = {}) {
        const pl = Z.place(cam, frame, centre);
        const r = radius / cam.w, C = pl.off, k = opts.k || 1;
        // eye relative to the centre in the (z-stretched) body frame, in double precision (the eye sits at z = EYE)
        const E = S.app(S.T(bodyRot), [-C[0], -C[1], R.EYE - C[2]]); E[2] *= k;
        const dist = Math.hypot(...E), cc = (dist - r) * (dist + r);
        if (cc <= 0) return;
        gl.useProgram(sp.p);
        gl.uniformMatrix4fv(sp.u.uProj, false, R.proj(1e-4, 1e6));
        gl.uniform1f(sp.u.uEye, R.EYE); gl.uniform3f(sp.u.uC, C[0], C[1], C[2]); gl.uniform1f(sp.u.uRad, r); gl.uniform1f(sp.u.uCc, cc);
        gl.uniform1f(sp.u.uK, k); gl.uniform3f(sp.u.uEyeB, E[0], E[1], E[2]);
        const m = S.T(bodyRot);   // camera axes -> body axes
        gl.uniformMatrix3fv(sp.u.uRotB, false, new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]));
        const sun = S.app(S.T(cam.R), S.rel(centre, frame, [0, 0, 0], 'sol', cam.frame)), sl = Math.hypot(...sun);
        gl.uniform3f(sp.u.uSun, sun[0] / sl, sun[1] / sl, sun[2] / sl);
        gl.uniform1i(sp.u.uKind, kind); gl.uniform1f(sp.u.uAlpha, a);
        gl.uniform3f(sp.u.uTint, ...(opts.tint || [0.6, 0.6, 0.6]));
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, opts.tex || earthTex); gl.uniform1i(sp.u.uTex, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, detail); gl.uniform1i(sp.u.uDetail, 1);
        gl.uniform4f(sp.u.uDetailBox, -25.5, -12.5, 67.0, 62.8); gl.uniform1f(sp.u.uDetailOn, opts.detail ? 1 : 0);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, nightTex); gl.uniform1i(sp.u.uNight, 2); gl.uniform1f(sp.u.uNightOn, opts.detail ? 1 : 0);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, rvkA); gl.uniform1i(sp.u.uMercTexA, 3);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, rvkB); gl.uniform1i(sp.u.uMercTexB, 4);
        gl.uniform4f(sp.u.uMercA, 2048, 895, 540, 8); gl.uniform4f(sp.u.uMercB, 8192, 3594, 2174, 6);   // zoom 11 and 13 tiles
        gl.uniform2f(sp.u.uMercFade, smooth((5.0 - cam.L) / 0.5), smooth((4.3 - cam.L) / 0.4));          // fine imagery only when it helps
        gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      const L = { name: 'bodies', frame: 'sol' };
      L.alpha = Lv => band(Lv, 0.0, 16, 0.6, 1.0);
      L.draw = (cam, a) => {
        const camT = S.T(cam.R);
        const toCam = F => S.mul(camT, Z.rotBetween(F, cam.frame));
        // the Sun (a glow sprite keeps it visible when it is under a pixel)
        sphere(cam, 'sol', [0, 0, 0], 6.957e8, S.I3, 2, a);
        const sunPl = Z.place(cam, 'sol', [0, 0, 0]);
        gl.blendFunc(gl.ONE, gl.ONE);
        drawPoints(sunGlow, { rot: sunPl.rot.map(x => x * 6.957e8), off: sunPl.off }, a * band(cam.L, 8, 17, 0.5, 1.0), { gain: 1, minPx: 9, marker: true });
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // Moon: tidally locked, its prime meridian facing the Earth
        const me = S.bodies.earth.pos.map((x, i) => x - S.bodies.moon.pos[i]), ml = Math.hypot(...me), x = me.map(v => v / ml);
        const zz = [0, 0, 1], y = [zz[1] * x[2] - zz[2] * x[1], zz[2] * x[0] - zz[0] * x[2], zz[0] * x[1] - zz[1] * x[0]], yl = Math.hypot(...y);
        const yy = y.map(v => v / yl), z = [x[1] * yy[2] - x[2] * yy[1], x[2] * yy[0] - x[0] * yy[2], x[0] * yy[1] - x[1] * yy[0]];
        const moonRot = S.mul(toCam('sol'), [x[0], yy[0], z[0], x[1], yy[1], z[1], x[2], yy[2], z[2]]);
        sphere(cam, 'sol', S.bodies.moon.pos, 1.7374e6, moonRot, moonTex ? 0 : 1, a, { tex: moonTex, tint: [0.62, 0.6, 0.57] });
        // the Earth is the WGS84 ellipsoid (a = 6378.137 km, 1/f = 298.257): Reykjavík lies 6360.9 km from the centre
        // drawn at mean sea level here (the geoid is 66 m above the ellipsoid at Reykjavík), so the street-level terrain meets it
        sphere(cam, 'earth', [0, 0, 0], 6378137 + 66, toCam('earth'), 0, a, { detail: true, k: 1 / (1 - 1 / 298.257223563) });
      };
      const sunGlow = pointsVAO(new Float32Array([0, 0, 0]), new Float32Array([1, 0.9, 0.75, 2.5]), new Float32Array([1]));
      L.labels = cam => [
        { t: 'Earth', frame: 'earth', p: [0, 0, 0], cls: '', a: band(cam.L, 8.3, 10.6, 0.3, 0.6), off: 1 },
        { t: 'the Moon', frame: 'sol', p: S.bodies.moon.pos, cls: '', a: band(cam.L, 8.2, 9.8, 0.3, 0.5) },
        { t: 'Iceland', frame: 'site', p: [60e3, 60e3, 0], cls: '', a: band(cam.L, 5.9, 6.8, 0.3, 0.4) },
        { t: 'Reykjavík', frame: 'site', p: [0, 0, 0], cls: 'ring', a: band(cam.L, 4.4, 5.8, 0.3, 0.4) },
      ];
      layers.push(L);
    }
    return layers;
  }
  root.PTEN_LAYERS = { build, band };
})(typeof globalThis !== 'undefined' ? globalThis : this);
