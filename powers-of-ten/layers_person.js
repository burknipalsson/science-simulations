// Powers of Ten: the person on Hallgrímstorg (10 m -> 1 mm). The body is person.js's signed-distance shape,
// ray-marched in the person's own frame; the fingertip is ray-marched again in the nail-fold frame so it stays
// sharp at millimetre scale. Around the body, smoke tracers replay the air's paths recorded by The Wind Tunnel's
// lattice-Boltzmann solver in today's wind.
(function (root) {
  const S = root.PTEN, Z = root.PTEN_ZOOM, RD = root.PTEN_RENDER, P = root.PTEN_PERSON, band = (...a) => root.PTEN_LAYERS.band(...a), smooth = Z.smooth;

  async function inflate(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const m3 = m => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);

  // ray-march program for a scene SDF given in some frame (metres). uInv: camera axes -> frame (per view width),
  // uOrg: the eye in that frame (metres), uScale: view widths per metre.
  function marchProgram(R, scene, opts) {
    return R.program(`
      out vec3 vDir;
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0);
        vDir = vec3(p.x / uProj[0][0], p.y / uProj[1][1], -1.0); }`, RD.LOGDEPTH + `
      uniform mat3 uInv, uToSite; uniform vec3 uOrg, uSun, uBoxLo, uBoxHi; uniform float uScale, uA, uSunUp, uPixel, uDetail;
      uniform highp sampler2DShadow uShadow; uniform mat4 uLight; uniform mat4 uFrameToSite; uniform float uShadowOn;
      in vec3 vDir; out vec4 o;
      ${scene}
      float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      float vnoise(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      vec3 nrm(vec3 p, float e) {
        vec2 k = vec2(1.0, -1.0);
        return normalize(k.xyy * sc(p + k.xyy * e).x + k.yyx * sc(p + k.yyx * e).x + k.yxy * sc(p + k.yxy * e).x + k.xxx * sc(p + k.xxx * e).x);
      }
      vec2 box(vec3 ro, vec3 rd) { vec3 ir = 1.0 / rd, a = (uBoxLo - ro) * ir, b = (uBoxHi - ro) * ir; vec3 lo = min(a, b), hi = max(a, b);
        return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z)); }
      void main() {
        vec3 dc = normalize(vDir);
        vec3 rd = normalize(uInv * dc), ro = uOrg;
        vec2 bb = box(ro, rd); if (bb.y < max(bb.x, 0.0)) discard;
        float t = max(bb.x, 0.0), eps = uPixel;
        vec2 h = vec2(1e9); bool hit = false;
        for (int i = 0; i < 220; i++) {
          vec3 p = ro + rd * t; h = sc(p);
          float tol = eps * max(t, 1e-6);
          if (h.x < tol) { hit = true; break; }
          t += h.x * 0.9; if (t > bb.y) break;
        }
        if (!hit) discard;
        vec3 p = ro + rd * t, n = nrm(p, max(eps * t, 1e-7) * 1.5);
        float m = h.y;
        // materials: skin, jacket, trousers, shoes, hair, nail
        vec3 alb = m < 0.5 ? vec3(0.74, 0.54, 0.46) : m < 1.5 ? vec3(0.09, 0.12, 0.2) : m < 2.5 ? vec3(0.16, 0.16, 0.17) : m < 3.5 ? vec3(0.05, 0.045, 0.04) : m < 4.5 ? vec3(0.28, 0.2, 0.13) : vec3(0.93, 0.74, 0.72);
        if (m > 4.5) {
          // the nail: pink over its bed, a pale lunula near the root, a white free edge past the fingertip
          float u = fract(m);
          alb = mix(vec3(0.86, 0.6, 0.58), vec3(0.95, 0.88, 0.84), smoothstep(0.24, 0.14, u));
          alb = mix(alb, vec3(0.97, 0.95, 0.9), smoothstep(0.86, 0.9, u));
        }
        // fine relief: skin texture and fabric weave, scaled to stay sub-pixel until it can be seen
        if (uDetail > 0.0) {
          float sc0 = m < 0.5 || m > 4.5 ? 9000.0 : 2500.0;
          float nz = vnoise(p * sc0) * 0.6 + vnoise(p * sc0 * 2.7) * 0.4;
          alb *= 0.92 + 0.16 * nz;
        }
        vec3 sunF = uSun;
        float sh = 1.0;
        if (uShadowOn > 0.5) {
          // the site's shadow map (buildings, the church) and a soft self-shadow march toward the Sun
          vec4 lp = uLight * (uFrameToSite * vec4(p, 1.0)); vec3 q = lp.xyz * 0.5 + 0.5;
          if (all(greaterThan(q, vec3(0.0))) && all(lessThan(q, vec3(1.0)))) sh = texture(uShadow, vec3(q.xy, q.z - 0.0015));
          float ts = 0.004, res = 1.0;
          for (int i = 0; i < 40; i++) { float d = sc(p + n * 0.002 + sunF * ts).x; res = min(res, 10.0 * d / ts); ts += clamp(d, 0.003, 0.08); if (res < 0.02 || ts > 1.5) break; }
          sh *= clamp(res, 0.0, 1.0);
        }
        float l = dot(n, sunF);
        vec3 col;
        vec3 sky = vec3(0.55, 0.66, 0.82) * (0.6 + 0.4 * (uToSite * n).z);
        if (m < 0.5 || m > 4.5) {
          // skin: wrapped diffuse with a warm subsurface term where the light grazes
          float wrap = max((l + 0.35) / 1.35, 0.0), sss = max(0.0, 1.0 - abs(l)) * 0.35;
          col = alb * (wrap * sh * vec3(1.0, 0.93, 0.82) * 2.1 * uSunUp + sky * 1.25) + alb * vec3(0.9, 0.25, 0.15) * sss * sh * uSunUp;
          if (m > 4.5) { vec3 hv = normalize(sunF - rd); col += vec3(0.9) * pow(max(dot(n, hv), 0.0), 60.0) * sh * uSunUp * 0.5; }
        } else col = alb * (max(l, 0.0) * sh * vec3(1.0, 0.93, 0.82) * 2.2 * uSunUp + sky * 1.35);
        o = vec4(col * uA, uA);
        gl_FragDepth = logDepth(t * uScale * (-dc.z));
      }`);
  }

  function build(R, siteLayer) {
    const gl = R.gl, layers = [];
    const sceneSrc = P.glslScene();
    const prog = marchProgram(R, sceneSrc + `\n vec2 sc(vec3 p) { return pp_scene(p); }`);
    // the fingertip in the nail-fold frame (origin at the nail fold, so millimetres stay exact in float)
    const N = S.nodes.nail, toNail = p => S.app(S.T(N.rot), p.map((x, i) => x - N.pos[i]));   // person -> nail frame
    const tipSrc = P.glslFingertip(toNail, m => S.app(S.T(N.rot), m));
    const progTip = marchProgram(R, tipSrc + `\n vec2 sc(vec3 p) { return pp_tip(p); }`);

    const L = { name: 'person', frame: 'person', opaque: true };
    L.alpha = Lv => band(Lv, -2.7, 1.6, 0.45, 0.5);
    function setup(pr, cam, frame, a, box, pixel, detail) {
      const pl = Z.place(cam, frame, [0, 0, 0]), s = Math.hypot(pl.rot[0], pl.rot[3], pl.rot[6]);   // view widths per metre
      // camera axes -> frame: rot^T / s^2 (rot = s Q); the eye (0,0,EYE) in the frame: Q^T (eye - off) / s
      const Qt = S.T(pl.rot).map(x => x / s);
      const org = S.app(Qt, [-pl.off[0], -pl.off[1], R.EYE - pl.off[2]]).map(x => x / s);
      gl.useProgram(pr.p);
      gl.uniformMatrix4fv(pr.u.uProj, false, R.proj(1e-6, 1e7));
      gl.uniformMatrix3fv(pr.u.uInv, false, m3(Qt));
      gl.uniform3f(pr.u.uOrg, ...org); gl.uniform1f(pr.u.uScale, s); gl.uniform1f(pr.u.uA, a);
      gl.uniform3f(pr.u.uBoxLo, ...box[0]); gl.uniform3f(pr.u.uBoxHi, ...box[1]);
      gl.uniform1f(pr.u.uPixel, pixel); gl.uniform1f(pr.u.uDetail, detail);
      const toSite = Z.rotBetween(frame, 'site'), fi = siteLayer.lastFi || siteLayer.frameInfo(cam);
      const sunF = S.app(S.T(toSite), fi.sun);
      gl.uniform3f(pr.u.uSun, ...sunF); gl.uniform1f(pr.u.uSunUp, siteLayer.lastSunUp ?? 1);
      gl.uniformMatrix3fv(pr.u.uToSite, false, m3(toSite));
      // frame -> site (metres), for the shadow map lookup
      const o = S.rel([0, 0, 0], 'site', [0, 0, 0], frame, 'site');
      gl.uniformMatrix4fv(pr.u.uFrameToSite, false, new Float32Array([toSite[0], toSite[3], toSite[6], 0, toSite[1], toSite[4], toSite[7], 0, toSite[2], toSite[5], toSite[8], 0, o[0], o[1], o[2], 1]));
      if (siteLayer.lastLM) { gl.uniformMatrix4fv(pr.u.uLight, false, siteLayer.lastLM); gl.uniform1f(pr.u.uShadowOn, 1); } else gl.uniform1f(pr.u.uShadowOn, 0);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, siteLayer.smTex); gl.uniform1i(pr.u.uShadow, 5);
    }
    L.draw = (cam, a) => {
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const px = R.FOV / R.canvas.height;           // radians per pixel
      const aBody = a * smooth((cam.L + 1.3) / 0.35), aTip = a * smooth((-0.95 - cam.L) / 0.35) * (1 - 0.5 * smooth((-2.25 - cam.L) / 0.35));   // thin nail-fold skin: the capillaries show through, as under a capillaroscope
      if (aBody > 0.003) {
        setup(prog, cam, 'person', aBody, [[-0.45, -0.45, -0.01], [0.45, 0.45, 1.9]], px * 0.6, cam.L < 0.2 ? 1 : 0);
        gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (aTip > 0.003) {
        setup(progTip, cam, 'nail', aTip, [[-0.06, -0.025, -0.03], [0.035, 0.025, 0.008]], px * 0.6, 1);
        gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.DEPTH_TEST);
    };
    L.labels = cam => [];
    layers.push(L);

    // ---- the wind: recorded smoke paths, replayed in a seamless loop ----
    const WD = root.PTEN_WIND;
    if (WD) {
      const W = { name: 'wind', frame: 'person' };
      const smoke = R.program(`
        uniform highp sampler2D uPath; uniform highp isampler2D uHead; uniform float uT, uLoop, uTail, uK; uniform int uN, uCap;
        out vec4 vC; out float vW;
        vec3 at(int row, float a) { int i = int(floor(a)); float f = a - float(i);
          return mix(texelFetch(uPath, ivec2(i, row), 0).xyz, texelFetch(uPath, ivec2(min(i + 1, uCap - 1), row), 0).xyz, f); }
        void main() {
          int inst = gl_InstanceID, row = inst % uN, ph = inst / uN;
          ivec2 hd = texelFetch(uHead, ivec2(row % 1024, row / 1024), 0).xy;
          float age = mod(uT - float(hd.x), uLoop) + float(ph) * uLoop;     // frames since release (this loop or the last)
          int seg = gl_VertexID / 2, end = gl_VertexID % 2;
          float a = age - (float(seg + end)) * uTail / uK;
          float cnt = float(hd.y);
          if (a < 0.0 || a > cnt - 1.0 || age > cnt - 1.0 + uTail) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec4(0.0); return; }
          vec3 p = at(row, min(a, cnt - 1.001));
          vec3 v = (at(row, min(a + 0.5, cnt - 1.001)) - at(row, max(a - 0.5, 0.0)));        // metres per frame
          float sp = length(v) * uLoop / uLoop;
          vec3 c = toCam(p); gl_Position = uProj * vec4(c, 1.0); vW = -c.z;
          float fade = (1.0 - float(seg + end) / uK) * smoothstep(0.0, 6.0, a) * smoothstep(cnt - 1.0, cnt - 8.0, a);
          float t = clamp(sp / 0.16, 0.0, 1.4);
          vec3 col = mix(mix(vec3(0.35, 0.55, 1.0), vec3(0.85, 0.92, 1.0), smoothstep(0.1, 0.6, t)), vec3(1.0, 0.62, 0.28), smoothstep(0.75, 1.3, t));
          vC = vec4(col * fade, fade);
        }`, RD.LOGDEPTH + `
        uniform float uAlpha; in vec4 vC; in float vW; out vec4 o;
        void main() { o = vec4(vC.rgb * uAlpha, 1.0); gl_FragDepth = logDepth(vW); }`);
      let pathTex = null, headTex = null, nPath = 0;
      (async () => {
        const buf = new Uint8Array(await inflate(WD.b64)), dv = new DataView(buf.buffer);
        const CAP = WD.CAP, N = WD.n, pos = new Float32Array(4 * CAP * N), head = new Int32Array(2 * 1024 * Math.ceil(N / 1024));
        let o = 0;
        for (let k = 0; k < N; k++) {
          const st = dv.getUint16(o, true), cnt = buf[o + 2]; o += 3;
          let q = [dv.getInt16(o, true), dv.getInt16(o + 2, true), dv.getInt16(o + 4, true)]; o += 6;
          head[2 * k] = st; head[2 * k + 1] = cnt;
          for (let m = 0; m < cnt; m++) {
            if (m > 0) { for (let j = 0; j < 3; j++) q[j] += 2 * dv.getInt8(o + j); o += 3; }
            pos.set([q[0] / 1000, q[1] / 1000, q[2] / 1000, 1], 4 * (k * CAP + m));
          }
        }
        pathTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, pathTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, CAP, N, 0, gl.RGBA, gl.FLOAT, pos);
        for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
        headTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, headTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32I, 1024, Math.ceil(N / 1024), 0, gl.RG_INTEGER, gl.INT, head);
        for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
        nPath = N;
      })();
      W.alpha = Lv => band(Lv, -0.2, 1.25, 0.35, 0.35);
      W.draw = (cam, a, clocks) => {
        if (!nPath) return;
        const pl = Z.place(cam, 'person', [0, 0, 0]);
        gl.useProgram(smoke.p); RD.setPlace(R, smoke, pl, a);
        gl.uniformMatrix4fv(smoke.u.uProj, false, R.proj(1e-6, 1e7));
        const secs = clocks.solar * 86400;                    // the real clock drives the replay (recorded at 30 frames/s)
        gl.uniform1f(smoke.u.uT, ((secs * WD.fps) % WD.T + WD.T) % WD.T); gl.uniform1f(smoke.u.uLoop, WD.T);
        gl.uniform1f(smoke.u.uTail, 7.0); gl.uniform1f(smoke.u.uK, 7.0); gl.uniform1i(smoke.u.uN, nPath); gl.uniform1i(smoke.u.uCap, WD.CAP);
        gl.uniform1f(smoke.u.uAlpha, a * 0.85);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pathTex); gl.uniform1i(smoke.u.uPath, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, headTex); gl.uniform1i(smoke.u.uHead, 1);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(false);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(null); gl.drawArraysInstanced(gl.LINES, 0, 2 * 7, 2 * nPath);
        gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
      };
      W.labels = cam => [];
      layers.push(W);
    }
    return layers;
  }
  root.PTEN_LAYERS_PERSON = { build };
})(typeof globalThis !== 'undefined' ? globalThis : this);
