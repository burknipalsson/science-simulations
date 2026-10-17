// Powers of Ten, side trip: into the black hole at the Galaxy's centre. The S-stars on their fitted orbits
// (Gillessen et al. 2017) and Sgr A* itself, ray-traced with the exact Schwarzschild photon equation from the
// series' Event Horizon sim, at the mass GRAVITY measured.
(function (root) {
  const S = root.PTEN, Z = root.PTEN_ZOOM, RD = root.PTEN_RENDER, G = root.PTEN_SGR, band = (...a) => root.PTEN_LAYERS.band(...a), smooth = Z.smooth;
  const m3 = m => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  const YR = 365.25 * 86400;

  function build(R) {
    const gl = R.gl, layers = [];
    if (!G || !S.nodes.sgr) return layers;
    const N = G.STARS.length;

    // ---- the nuclear star cluster: random stars with its measured size (half-light radius 4.2 pc) and flattening
    // (axis ratio 0.71 toward the Galactic pole), Schödel et al. 2014; a cusp toward the centre ----
    {
      let sd = 99; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
      const NS = 40000, p = new Float32Array(3 * NS), c = new Float32Array(4 * NS), z = new Float32Array(NS);
      const gal = S.T(S.nodes.sgr.rot);                       // gc -> sgr
      for (let i = 0; i < NS; i++) {
        // r from a Dehnen-like profile (gamma 1.2): projected half-light radius ~4.2 pc for a = 3.5 pc
        const u = rnd(), a = 3.5, g = 1.2, r = a * Math.pow(u, 1 / (3 - g)) / (1 - Math.pow(u, 1 / (3 - g)));
        if (r > 30) { i--; continue; }
        const ct = 2 * rnd() - 1, ph = 6.283 * rnd(), st2 = Math.sqrt(1 - ct * ct);
        const q = [r * st2 * Math.cos(ph), r * st2 * Math.sin(ph), r * ct * 0.71].map(v => v * S.PC);   // gc axes: z = Galactic north
        p.set(S.app(gal, q).map(v => v / S.AU), 3 * i);
        const hot = rnd() < 0.08; c.set(hot ? [0.7, 0.82, 1, 0.9] : [1, 0.75, 0.5, 0.5 + 0.5 * rnd()], 4 * i); z[i] = 2e9 / S.AU;
      }
      const vao = R.vao(R.points, { aPos: [p, 3], aCol: [c, 4], aSize: [z, 1] });
      const Ln = { name: 'nsc', frame: 'sgr', trip: 'sgr' };
      Ln.alpha = Lv => band(Lv, 15.4, 18.6, 0.5, 0.9);
      Ln.draw = (cam, a) => {
        const pl = Z.place(cam, 'sgr', [0, 0, 0]), m = pl.rot.map(x => x * S.AU);
        const P = R.points; gl.useProgram(P.p); RD.setPlace(R, P, { rot: m, off: pl.off }, a);
        gl.uniformMatrix4fv(P.u.uProj, false, R.proj(1e-4, 1e6));
        gl.uniform1f(P.u.uMinPx, 1.6); gl.uniform1f(P.u.uMaxPx, 8); gl.uniform1f(P.u.uGain, 0.55); gl.uniform1f(P.u.uFocus, 0); gl.uniform1f(P.u.uMarker, 1);
        gl.bindVertexArray(vao.v); gl.drawArrays(gl.POINTS, 0, NS);
      };
      Ln.labels = cam => [];
      layers.push(Ln);
    }

    // ---- the S-stars: orbits and stars ----
    const ORB = 480, lines = [];
    const orbitVAOs = G.STARS.map((st, k) => {
      const T = st[7]; if (!(st[1] > 0) || !(st[2] < 1)) return null;
      const p = new Float32Array(3 * (ORB + 1));
      for (let i = 0; i <= ORB; i++) { const q = G.pos(k, st[6] + T * i / ORB); p.set(q.map(v => v / S.AU), 3 * i); }
      return R.vao(R.lines, { aPos: [p, 3] });
    });
    const starPos = new Float32Array(3 * N), starCol = new Float32Array(4 * N), starSize = new Float32Array(N);
    G.STARS.forEach((st, k) => {
      const early = st[8] === 'e', b = Math.pow(10, -0.4 * (st[9] - 14));
      starCol.set([...(early ? [0.7, 0.82, 1.0] : [1.0, 0.72, 0.45]), Math.min(2.5, 0.6 + 0.9 * b)], 4 * k); starSize[k] = 6e9 / S.AU;
    });
    const starVAO = R.vao(R.points, { aPos: [starPos, 3], aCol: [starCol, 4], aSize: [starSize, 1] });
    const Ls = { name: 'sstars', frame: 'sgr', trip: 'sgr' };
    Ls.alpha = Lv => band(Lv, 12.6, 17.2, 0.6, 0.8);
    Ls.draw = (cam, a, clocks) => {
      const yr = G.YEAR0 + (clocks.trip || 0) / YR;
      const pl = Z.place(cam, 'sgr', [0, 0, 0]), m = pl.rot.map(x => x * S.AU);
      gl.useProgram(R.lines.p); RD.setPlace(R, R.lines, { rot: m, off: pl.off }, a);
      gl.uniformMatrix4fv(R.lines.u.uProj, false, R.proj(1e-4, 1e6));
      orbitVAOs.forEach((v, k) => {
        if (!v) return; const s2 = G.STARS[k][0] === 'S2';
        gl.uniform4f(R.lines.u.uColor, s2 ? 1.0 : 0.55, s2 ? 0.7 : 0.62, s2 ? 0.45 : 0.85, (s2 ? 0.55 : 0.22) * a);
        gl.bindVertexArray(v.v); gl.drawArrays(gl.LINE_STRIP, 0, v.count);
      });
      for (let k = 0; k < N; k++) { const q = G.pos(k, yr); starPos.set(q ? q.map(v => v / S.AU) : [1e9, 0, 0], 3 * k); }
      R.update(starVAO, 'aPos', starPos);
      const P = R.points; gl.useProgram(P.p); RD.setPlace(R, P, { rot: m, off: pl.off }, a);
      gl.uniformMatrix4fv(P.u.uProj, false, R.proj(1e-4, 1e6));
      gl.uniform1f(P.u.uMinPx, 5); gl.uniform1f(P.u.uMaxPx, 64); gl.uniform1f(P.u.uGain, 1.4); gl.uniform1f(P.u.uFocus, 0); gl.uniform1f(P.u.uMarker, 1);
      gl.bindVertexArray(starVAO.v); gl.drawArrays(gl.POINTS, 0, N);
    };
    const NAMED = new Set(['S2', 'S1', 'S4', 'S8', 'S12', 'S13', 'S14', 'S29', 'S38', 'S55', 'S175', 'S62']);
    Ls.labels = cam => {
      const yr = G.YEAR0 + ((root.PTEN_CLOCKS && root.PTEN_CLOCKS.trip) || 0) / YR, out = [];
      G.STARS.forEach((st, k) => { if (!NAMED.has(st[0])) return; const q = G.pos(k, yr); if (q) out.push({ t: st[0], frame: 'sgr', p: q, cls: st[0] === 'S2' ? 'sun' : 'minor', a: band(cam.L, 13.2, 15.9, 0.3, 0.4) }); });
      out.push({ t: 'Sgr A*: 4.15 million suns', frame: 'sgr', p: [0, 0, 0], cls: 'ring', a: band(cam.L, 12.4, 16.8, 0.3, 0.4) });
      return out;
    };
    layers.push(Ls);

    // ---- Sgr A*: Schwarzschild ray tracing (units of the Schwarzschild radius) ----
    // the accretion flow's plane: tilted 30° from the line of sight (EHT finds Sgr A* seen fairly face-on)
    const tl = 30 * Math.PI / 180, ny = [Math.sin(tl) * 0.6, Math.sin(tl) * 0.8, -Math.cos(tl)];
    let nx = [ny[1], -ny[0], 0]; const l = Math.hypot(...nx); nx = nx.map(v => v / l);
    const nz = [nx[1] * ny[2] - nx[2] * ny[1], nx[2] * ny[0] - nx[0] * ny[2], nx[0] * ny[1] - nx[1] * ny[0]];
    S.node('bh', 'sgr', [0, 0, 0], [nx[0], ny[0], nz[0], nx[1], ny[1], nz[1], nx[2], ny[2], nz[2]], { size: G.RS });
    const bh = R.program(`
      out vec3 vDir;
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0);
        vDir = vec3(p.x / uProj[0][0], p.y / uProj[1][1], -1.0); }`, `
      uniform mat3 uInv; uniform vec3 uOrg; uniform float uA, uTime; in vec3 vDir; out vec4 o;
      const float RIN = 3.0, ROUT = 14.0;
      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
        return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
      float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
      void main() {
        vec3 rd = normalize(uInv * normalize(vDir)), pos = uOrg, vel = rd;
        // start far rays near the hole: march straight in until r ~ 60 (no bending to speak of beyond)
        float r0 = length(pos), b = dot(pos, rd);
        if (r0 > 60.0) { float c = dot(pos, pos) - 3600.0, disc = b * b - c; if (disc < 0.0 || b > 0.0) discard; pos += rd * (-b - sqrt(disc)); }
        float h2 = dot(cross(pos, vel), cross(pos, vel));
        vec3 acc = -1.5 * h2 * pos / pow(dot(pos, pos), 2.5);
        vec3 col = vec3(0.0); float alpha = 0.0; bool captured = false; int crossings = 0;
        for (int i = 0; i < 400; i++) {
          float r = length(pos);
          if (r < 1.0) { captured = true; break; }
          if (r > 70.0 && dot(pos, vel) > 0.0) break;
          float dt = clamp(0.045 * r * r, 0.02, 2.0);
          vec3 prev = pos;
          pos += vel * dt + 0.5 * acc * dt * dt;
          vec3 accN = -1.5 * h2 * pos / pow(dot(pos, pos), 2.5);
          vel += 0.5 * (acc + accN) * dt; acc = accN;
          if (prev.y * pos.y < 0.0) {
            float t = prev.y / (prev.y - pos.y); vec3 p = mix(prev, pos, t); float rr = length(p.xz);
            if (rr > RIN && rr < ROUT) {
              float beta = min(sqrt(0.5 / (rr - 1.0)), 0.99), gam = 1.0 / sqrt(1.0 - beta * beta);
              vec3 vdir = normalize(vec3(-p.z, 0.0, p.x)), toObs = -normalize(vel);
              float g = sqrt(1.0 - 1.0 / rr) / (gam * (1.0 - beta * dot(vdir, toObs)));
              float omega = 0.7071 / pow(rr, 1.5), phi = atan(p.z, p.x) - omega * uTime;
              float n = fbm(vec2(cos(phi), sin(phi)) * rr * 0.9 + 3.0);
              float dens = clamp(n * 1.25 * (0.55 + 0.45 * sin(rr * 5.0 + n * 6.0)) + 0.12, 0.0, 1.0);
              float edge = smoothstep(RIN, RIN + 0.35, rr) * (1.0 - smoothstep(ROUT - 5.0, ROUT, rr));
              float a = clamp(dens * edge * 1.2, 0.0, 0.95);
              float I = pow(RIN / rr, 2.2) * pow(g, 4.0);
              vec3 emit = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.85, 0.55), clamp(I * 0.6, 0.0, 1.0)) * I * (0.6 + 1.4 * dens) * 2.0;
              col += (1.0 - alpha) * a * emit; alpha += (1.0 - alpha) * a; crossings++;
              if (alpha > 0.985) break;
            }
          }
        }
        float cover = captured ? 1.0 : alpha;
        o = vec4(col * uA, cover * uA);
      }`);
    const Lb = { name: 'sgrA', frame: 'bh', trip: 'sgr', opaque: true };
    Lb.alpha = Lv => band(Lv, 10.5, 13.4, 0.5, 0.6);
    Lb.draw = (cam, a, clocks) => {
      const pl = Z.place(cam, 'bh', [0, 0, 0]), s = Math.hypot(pl.rot[0], pl.rot[3], pl.rot[6]);
      const Qt = S.T(pl.rot).map(x => x / s), org = S.app(Qt, [-pl.off[0], -pl.off[1], R.EYE - pl.off[2]]).map(x => x / s / G.RS);
      gl.useProgram(bh.p); gl.uniformMatrix4fv(bh.u.uProj, false, R.proj(1e-6, 1e7));
      gl.uniformMatrix3fv(bh.u.uInv, false, m3(Qt)); gl.uniform3f(bh.u.uOrg, ...org); gl.uniform1f(bh.u.uA, a);
      gl.uniform1f(bh.u.uTime, (clocks.trip || 0) / (G.RS / 299792458));
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    Lb.labels = cam => [];
    layers.push(Lb);

    // ---- time trip: the Milky Way and Andromeda, test particles stepped in a worker along the semi-analytic orbit ----
    const MM = root.PTEN_M31;
    if (MM) {
      const NP = 60000, GYR = 3.15576e16;
      let worker = null, busy = false, tSim = 0, vao = null, col = null, pos = null, orb = null;
      const Lm = { name: 'merger', frame: 'gc', trip: 'm31' };
      Lm.start = () => {
        if (worker) worker.terminate();
        orb = orb || MM.orbit();
        const q = MM.particles(NP, orb); col = q.C; pos = q.P.slice();
        if (!vao) vao = R.vao(R.points, { aPos: [pos, 3], aCol: [col, 4], aSize: [new Float32Array(NP).fill(0.25), 1] }); else R.update(vao, 'aPos', pos);
        worker = new Worker(URL.createObjectURL(new Blob([MM.WORKER], { type: 'text/javascript' })));
        worker.onmessage = e => { tSim = e.data.t; pos = e.data.P; R.update(vao, 'aPos', pos); busy = false; };
        busy = true; worker.postMessage({ init: true, P: q.P, V: q.V, orb, M1: MM.GAL.MW, M2: MM.GAL.M31, fM: MM.fM, bary: MM.BARY });
        tSim = 0;
      };
      Lm.stop = () => { if (worker) worker.terminate(); worker = null; busy = false; };
      Lm.alpha = Lv => band(Lv, 21.6, 24.0, 0.5, 0.6);
      Lm.draw = (cam, a, clocks) => {
        if (!vao) return;
        const want = Math.min(12.5, (clocks.trip || 0) / GYR);
        if (worker && !busy && want > tSim + 1e-4) { busy = true; worker.postMessage({ to: want }); }
        const pl = Z.place(cam, 'gc', [0, 0, 0]), m = pl.rot.map(x => x * S.KPC);
        const P = R.points; gl.useProgram(P.p); RD.setPlace(R, P, { rot: m, off: pl.off }, a);
        gl.uniformMatrix4fv(P.u.uProj, false, R.proj(1e-4, 1e6));
        gl.uniform1f(P.u.uMinPx, 1.3); gl.uniform1f(P.u.uMaxPx, 6); gl.uniform1f(P.u.uGain, 0.22 * Math.pow(10, 0.45 * Math.max(0, 22.6 - cam.L))); gl.uniform1f(P.u.uFocus, 0); gl.uniform1f(P.u.uMarker, 1);
        gl.bindVertexArray(vao.v); gl.drawArrays(gl.POINTS, 0, NP);
      };
      Lm.simTime = () => tSim;
      // separation of the two centres (kpc) at time t (Gyr), for the automatic zoom
      Lm.separation = t => { if (!orb) return 770; const k = Math.max(0, Math.min(orb.length - 1, Math.round(t / 0.005))); return Math.hypot(orb[k][1], orb[k][2], orb[k][3]); };
      Lm.labels = cam => {
        if (tSim > 10.4) return [{ t: 'one merged galaxy, an elliptical', frame: 'gc', p: MM.BARY.map(v => v * S.KPC), cls: 'ring', a: Math.min(1, (tSim - 10.4) * 2) }];
        if (tSim > 0.3) return [];
        return [{ t: 'the Milky Way', frame: 'gc', p: [0, 0, 0], cls: '', a: 0.9 }, { t: 'Andromeda (M31)', frame: 'gc', p: MM.m31.map(v => v * S.KPC), cls: '', a: 0.9 }];
      };
      layers.push(Lm);
      root.PTEN_MERGER = Lm;
    }
    return layers;
  }
  root.PTEN_LAYERS_TRIP = { build };
})(typeof globalThis !== 'undefined' ? globalThis : this);
