// Powers of Ten: the street-level rung (1 km -> 1 m). Bare-earth terrain from ArcticDEM, every building from
// OpenStreetMap (heights tagged or measured from the surface model), the ground drawn from OSM's roads, paths,
// lawns and trees, the sky, and shadows cast by the Sun from its true direction at this moment.
// All geometry is in the 'site' frame (ENU metres about the landing point).
(function (root) {
  const S = root.PTEN, Z = root.PTEN_ZOOM, RD = root.PTEN_RENDER, band = (...a) => root.PTEN_LAYERS.band(...a), smooth = Z.smooth;

  async function inflate(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  // ---- triangulation of a simple polygon (ear clipping), ring CCW ----
  function earcut(ring) {
    const n = ring.length, idx = [...Array(n).keys()], out = [];
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    let guard = 0;
    while (idx.length > 3 && guard++ < 5000) {
      let found = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const a = ring[ia], b = ring[ib], c = ring[ic];
        if (cross(a, b, c) <= 1e-9) continue;
        let ok = true;
        for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inside(ring[j], a, b, c)) { ok = false; break; } }
        if (!ok) continue;
        out.push(ia, ib, ic); idx.splice(i, 1); found = true; break;
      }
      if (!found) { // degenerate: fan the rest
        for (let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1]);
        return out;
      }
    }
    if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
    return out;
  }

  // ---- the ground, rasterised from OSM vectors into a canvas ----
  const GROUND = { base: '#6c7350', grass: '#6f8048', trees: '#3f5533', paved: '#8f8b84', play: '#a8996f', pitch: '#4f7a3c', pool: '#5b8fae', water: '#3b5a73' };
  const ROAD = { footway: '#9a958c', path: '#8f8a7f', steps: '#a29d93', cycleway: '#8b8379', pedestrian: '#a09a91', treerow: '#3d5232' };
  function drawGround(V, ext, cx, cy, N, s2, aff) {
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), k = N / (2 * ext);
    const X = x => (x - cx + ext) * k, Y = y => (ext - (y - cy)) * k;
    g.fillStyle = GROUND.base; g.fillRect(0, 0, N, N);
    if (s2 && aff) {
      // the Sentinel-2 true-colour mosaic underneath (10 m pixels): site = Minv (px - p0), canvas = (k (x - cx + ext), k (ext - y + cy))
      const [p0x, p0y, ax, ay, bx, by] = aff, det = ax * by - bx * ay;
      const i11 = by / det, i12 = -bx / det, i21 = -ay / det, i22 = ax / det;     // site = I (px - p0)
      g.save(); g.setTransform(k * i11, -k * i21, k * i12, -k * i22, k * (-(i11 * p0x + i12 * p0y) - cx + ext), k * (ext + cy + (i21 * p0x + i22 * p0y)));
      g.imageSmoothingQuality = 'high'; g.drawImage(s2, 0, 0); g.restore();
      g.globalAlpha = 0.6;
    }
    const poly = p => { g.beginPath(); p.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); };
    for (const pass of ['grass', 'play', 'pitch', 'paved', 'trees', 'water', 'pool'])
      for (const a of V.areas) if (a.k === pass) { poly(a.p); g.fillStyle = GROUND[pass]; g.fill(); }
    g.globalAlpha = s2 ? 0.85 : 1; g.lineCap = 'round'; g.lineJoin = 'round';
    const order = ['treerow', 'path', 'footway', 'cycleway', 'steps', 'pedestrian', 'service', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary_link', 'secondary', 'primary_link', 'primary', 'trunk_link', 'trunk'];
    for (const kind of order) for (const r of V.roads) if (r.k === kind) {
      g.beginPath(); r.p.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)));
      const paving = r.s === 'paving_stones' || r.s === 'sett';
      g.strokeStyle = ROAD[kind] || (paving ? '#8e8981' : '#4a4c4f'); g.lineWidth = Math.max(1, r.w * k); g.stroke();
    }
    // footprints darker (the walls stand on them)
    g.fillStyle = '#3c3a37';
    for (const b of V.bld) { poly(b.r); g.fill(); }
    return cv;
  }

  function build(R, assets) {
    const gl = R.gl, SITE = root.PTEN_SITE, layers = [];
    if (!SITE) return layers;
    const L = { name: 'site', frame: 'site', ready: false, opaque: true };
    // ---- programs ----
    const VS_COMMON = `
      in vec3 aPos; in vec3 aNor; in vec3 aCol;
      uniform mat4 uLight; out vec3 vP, vN, vC; out vec4 vL; out float vW;
      void main() {
        vec3 c = toCam(aPos); gl_Position = uProj * vec4(c, 1.0);
        vW = -c.z; vP = aPos; vN = aNor; vC = aCol; vL = uLight * vec4(aPos, 1.0);
      }`;
    const FS_LIGHT = RD.LOGDEPTH + `
      uniform vec3 uSun, uSkyCol, uFogCol; uniform float uAlpha, uFog, uShadowOn, uSunUp; uniform highp sampler2DShadow uShadow; uniform vec3 uCamSite;
      float shadow(vec4 lp, vec3 n) {
        if (uShadowOn < 0.5) return 1.0;
        vec3 q = lp.xyz * 0.5 + 0.5; if (any(lessThan(q, vec3(0.0))) || any(greaterThan(q, vec3(1.0)))) return 1.0;
        float s = 0.0; vec2 px = vec2(1.0 / 4096.0);
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(uShadow, vec3(q.xy + vec2(i, j) * px, q.z - 0.0008));
        return s / 9.0;
      }
      vec3 light(vec3 albedo, vec3 n, vec4 lp, vec3 P) {
        float sh = shadow(lp, n);
        float l = max(dot(n, uSun), 0.0) * uSunUp;
        vec3 sky = uSkyCol * (0.55 + 0.45 * n.z);
        vec3 c = albedo * (l * sh * vec3(1.0, 0.93, 0.82) * 2.2 + sky * 1.35);
        float d = length(P - uCamSite), f = 1.0 - exp(-d * uFog);
        return mix(c, uFogCol, f);
      }`;
    const terrainProg = R.program(VS_COMMON, FS_LIGHT + `
      uniform sampler2D uGround, uNearTex; uniform vec4 uGBox, uNBox; uniform float uNearOn;
      in vec3 vP, vN, vC; in vec4 vL; in float vW; out vec4 o;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 uv = (vP.xy - uGBox.xy) / uGBox.zw + 0.5; uv.y = 1.0 - uv.y;
        vec3 col = pow(texture(uGround, uv).rgb, vec3(2.2));
        vec2 nv = (vP.xy - uNBox.xy) / uNBox.zw + 0.5; nv.y = 1.0 - nv.y;
        if (uNearOn > 0.5 && all(greaterThan(nv, vec2(0.0))) && all(lessThan(nv, vec2(1.0)))) {
          vec3 nc = pow(texture(uNearTex, nv).rgb, vec3(2.2));
          float e = min(min(nv.x, 1.0 - nv.x), min(nv.y, 1.0 - nv.y));
          // paving stones (Hallgrímstorg is paved): 30 x 20 cm stones, joints a little darker
          vec2 st = vP.xy / vec2(0.3, 0.2); vec2 fs = fract(st + vec2(floor(st.y) * 0.5, 0.0));
          float joint = smoothstep(0.0, 0.04, min(min(fs.x, 1.0 - fs.x), min(fs.y, 1.0 - fs.y)));
          float paved = smoothstep(0.08, 0.12, nc.r) * step(abs(nc.r - nc.g), 0.02) * step(abs(nc.g - nc.b), 0.03);
          nc *= mix(1.0, (0.82 + 0.18 * joint) * (0.93 + 0.14 * hash(floor(st + vec2(floor(st.y) * 0.5, 0.0)))), paved);
          col = mix(col, nc, smoothstep(0.0, 0.05, e));
        }
        vec3 n = normalize(vN);
        o = vec4(light(col, n, vL, vP) * uAlpha, uAlpha);
        gl_FragDepth = logDepth(vW);
      }`);
    const bldProg = R.program(VS_COMMON, FS_LIGHT + `
      in vec3 vP, vN, vC; in vec4 vL; in float vW; out vec4 o;
      void main() {
        vec3 n = normalize(vN);
        vec3 col = pow(vC, vec3(2.2));
        o = vec4(light(col, n, vL, vP) * uAlpha, uAlpha);
        gl_FragDepth = logDepth(vW);
      }`);
    const depthProg = R.program(`
      in vec3 aPos; uniform mat4 uLight;
      void main() { gl_Position = uLight * vec4(aPos, 1.0); }`, `out vec4 o; void main() { o = vec4(1.0); }`);
    const skyProg = R.program(`
      out vec2 vQ;
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; vQ = p; gl_Position = vec4(p, 0.0, 1.0); }`, `
      uniform mat3 uCamToSite; uniform vec2 uTan; uniform vec3 uSun; uniform float uAlpha; in vec2 vQ; out vec4 o;
      void main() {
        vec3 d = normalize(uCamToSite * vec3(vQ * uTan, -1.0));
        float h = d.z, mu = max(dot(d, uSun), 0.0);
        vec3 zen = vec3(0.13, 0.25, 0.52), hor = vec3(0.62, 0.70, 0.80), gnd = vec3(0.32, 0.33, 0.33);
        vec3 c = h > 0.0 ? mix(hor, zen, pow(min(h, 1.0), 0.55)) : mix(hor, gnd, smoothstep(0.0, 0.08, -h));
        c += vec3(1.0, 0.85, 0.6) * (0.35 * pow(mu, 12.0) + 3.0 * pow(mu, 900.0)) * step(-0.02, h);
        o = vec4(c * uAlpha, uAlpha);
      }`);

    // ---- geometry (built once the gzipped vectors are inflated) ----
    let terr = null, bld = null, groundTex = null, nearTex = null, V = null, bldDepth = null, terrDepth = null;
    const TER = SITE.terrain, N = TER.n, step = TER.step, ext = TER.ext;
    (async () => {
      const dz = new Int16Array(await inflate(TER.dz)), sea = new Uint8Array(await inflate(TER.sea));
      V = JSON.parse(new TextDecoder().decode(await inflate(SITE.vec)));
      // terrain heights (delta-coded rows of cm)
      const Hh = new Float32Array(N * N);
      for (let j = 0; j < N; j++) { let acc = 0; for (let i = 0; i < N; i++) { acc += dz[j * N + i]; Hh[j * N + i] = acc / 100; } }
      // the edge of the modelled square drops smoothly to sea level, so no cliff shows against the globe beyond
      const seaZ = -(SITE.origin.h - SITE.origin.geoid);
      const pos = new Float32Array(3 * N * N), nor = new Float32Array(3 * N * N), col = new Float32Array(3 * N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = -ext + i * step, y = -ext + j * step, k = j * N + i;
        const edge = Math.min(i, j, N - 1 - i, N - 1 - j) * step, t = Math.min(1, edge / 120);
        Hh[k] = seaZ + (Hh[k] - seaZ) * t * t * (3 - 2 * t);
        pos[3 * k] = x; pos[3 * k + 1] = y;
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i; pos[3 * k + 2] = Hh[k];
        const hx = (Hh[j * N + Math.min(N - 1, i + 1)] - Hh[j * N + Math.max(0, i - 1)]) / (2 * step), hy = (Hh[Math.min(N - 1, j + 1) * N + i] - Hh[Math.max(0, j - 1) * N + i]) / (2 * step);
        const l = Math.hypot(hx, hy, 1); nor.set([-hx / l, -hy / l, 1 / l], 3 * k);
      }
      const idx = new Uint32Array(6 * (N - 1) * (N - 1)); let q = 0;
      for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; idx.set([a, a + 1, a + N + 1, a, a + N + 1, a + N], q); q += 6; }
      terr = R.vao(terrainProg, { aPos: [pos, 3], aNor: [nor, 3], aCol: [col, 3] });
      terrDepth = R.vao(depthProg, { aPos: [pos, 3] });
      for (const v of [terr, terrDepth]) { gl.bindVertexArray(v.v); const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); v.n = idx.length; gl.bindVertexArray(null); }
      L.groundZ = (x, y) => { const fi = (x + ext) / step, fj = (y + ext) / step, i = Math.max(0, Math.min(N - 2, Math.floor(fi))), j = Math.max(0, Math.min(N - 2, Math.floor(fj))), u = fi - i, v = fj - j; return (Hh[j * N + i] * (1 - u) + Hh[j * N + i + 1] * u) * (1 - v) + (Hh[(j + 1) * N + i] * (1 - u) + Hh[(j + 1) * N + i + 1] * u) * v; };
      // buildings: walls + roofs as triangles (non-indexed)
      const P = [], Nn = [], C = [];
      const tri = (a, b, c, n, col) => { P.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) { Nn.push(...n); C.push(...col); } };
      for (const b of V.bld) {
        const r = b.r, z0 = b.z0, z1 = b.z1, w = b.w.map(x => x / 255), rc = b.rc.map(x => x / 255), n = r.length;
        if (z1 - z0 < 0.3 || n < 3) continue;
        for (let i = 0; i < n; i++) {
          const a = r[i], c = r[(i + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-3) continue;
          const nn = [dy / l, -dx / l, 0];
          tri([a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], nn, w); tri([a[0], a[1], z0], [c[0], c[1], z1], [a[0], a[1], z1], nn, w);
        }
        if (b.rh > 0 && b.rs !== 'flat') {
          // pitched roofs (gabled, hipped, pyramidal, dome): a hip toward the centroid, as tall as tagged
          const cx = r.reduce((s, p) => s + p[0], 0) / n, cy = r.reduce((s, p) => s + p[1], 0) / n, top = [cx, cy, z1 + b.rh];
          for (let i = 0; i < n; i++) {
            const a = [...r[i], z1], c = [...r[(i + 1) % n], z1];
            const e1 = [c[0] - a[0], c[1] - a[1], 0], e2 = [top[0] - a[0], top[1] - a[1], top[2] - a[2]];
            const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...nn) || 1;
            tri(a, c, top, nn.map(x => x / l), rc);
          }
        } else {
          const t = earcut(r);
          for (let i = 0; i < t.length; i += 3) tri([...r[t[i]], z1], [...r[t[i + 1]], z1], [...r[t[i + 2]], z1], [0, 0, 1], rc);
        }
      }
      const fp = new Float32Array(P);
      bld = R.vao(bldProg, { aPos: [fp, 3], aNor: [new Float32Array(Nn), 3], aCol: [new Float32Array(C), 3] }); bld.n = P.length / 3;
      bldDepth = R.vao(depthProg, { aPos: [fp, 3] }); bldDepth.n = bld.n;
      // ground textures
      const tex = cv => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const ex = gl.getExtension('EXT_texture_filter_anisotropic'); if (ex) gl.texParameterf(gl.TEXTURE_2D, ex.TEXTURE_MAX_ANISOTROPY_EXT, 8); return t; };
      groundTex = tex(drawGround(V, ext, 0, 0, 4096, assets.rvk13, SITE.s2aff));
      nearTex = tex(drawGround(V, 64, SITE.person.e, SITE.person.n, 4096, assets.rvk13, SITE.s2aff));
      L.ready = true;
    })();

    // ---- shadow map (orthographic, along the Sun's direction) ----
    const SM = 4096, smTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, smTex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SM, SM);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const smFb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, smFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, smTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // light matrix (column-major) for centre c (site metres), half-width H, depth half-range Dd
    function lightMatrix(sun, c, H, Dd) {
      const z = sun, x0 = [-z[1], z[0], 0], xl = Math.hypot(...x0) || 1, x = x0.map(v => v / xl), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      const row = (a, s) => [a[0] / s, a[1] / s, a[2] / s, -(a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / s];
      const rx = row(x, H), ry = row(y, H), rz = row(z.map(v => -v), Dd);
      return new Float32Array([rx[0], ry[0], rz[0], 0, rx[1], ry[1], rz[1], 0, rx[2], ry[2], rz[2], 0, rx[3], ry[3], rz[3], 1]);
    }
    L.lightMatrix = lightMatrix; L.smTex = smTex;

    L.alpha = Lv => band(Lv, -1.6, 3.15, 0.6, 0.35);
    // sun direction in the site frame, and where the camera looks (site metres)
    L.frameInfo = cam => {
      const sun = S.rel([0, 0, 0], 'site', [0, 0, 0], 'sol', 'site'), sl = Math.hypot(...sun);
      const look = S.rel([0, 0, 0], 'site', cam.pos, cam.frame, 'site');
      const eyeOff = S.app(Z.rotBetween(cam.frame, 'site'), S.app(cam.R, [0, 0, R.EYE * cam.w]));
      return { sun: sun.map(v => v / sl), look, eye: look.map((v, i) => v + eyeOff[i]) };
    };
    L.drawSky = (cam, a) => {
      if (a < 0.003) return;
      const fi = L.frameInfo(cam), M = S.mul(Z.rotBetween(cam.frame, 'site'), cam.R);   // camera axes -> site
      gl.useProgram(skyProg.p);
      gl.uniformMatrix3fv(skyProg.u.uCamToSite, false, new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]));
      const t = Math.tan(R.FOV / 2); gl.uniform2f(skyProg.u.uTan, t * R.canvas.width / R.canvas.height, t);
      gl.uniform3f(skyProg.u.uSun, ...fi.sun); gl.uniform1f(skyProg.u.uAlpha, a);
      gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    L.extraShadowCasters = [];          // the person adds itself here
    L.draw = (cam, a) => {
      if (!L.ready) return;
      const fi = L.frameInfo(cam), sunUp = smooth(fi.sun[2] / 0.05);
      // shadow pass: centre on the ground below the view, size with the view
      const H = Math.max(6, Math.min(1400, 2.2 * cam.w * (1 + Math.max(0, 2.3 - cam.L)))), Dd = 600;
      const c = [fi.look[0], fi.look[1], L.groundZ(fi.look[0], fi.look[1])];
      const LM = lightMatrix(fi.sun, c, H, Dd);
      gl.bindFramebuffer(gl.FRAMEBUFFER, smFb); gl.viewport(0, 0, SM, SM);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); gl.disable(gl.BLEND);
      gl.colorMask(false, false, false, false);
      gl.useProgram(depthProg.p); gl.uniformMatrix4fv(depthProg.u.uLight, false, LM);
      gl.bindVertexArray(terrDepth.v); gl.drawElements(gl.TRIANGLES, terrDepth.n, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(bldDepth.v); gl.drawArrays(gl.TRIANGLES, 0, bldDepth.n);
      for (const f of L.extraShadowCasters) f(LM);
      gl.colorMask(true, true, true, true);
      R.begin(); gl.viewport(0, 0, R.canvas.width, R.canvas.height);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      const pl = Z.place(cam, 'site', [0, 0, 0]);
      const fog = 1 / 9000, skyCol = [0.55, 0.66, 0.82], fogCol = [0.6, 0.67, 0.76];
      for (const [prog, vao, indexed] of [[terrainProg, terr, true], [bldProg, bld, false]]) {
        gl.useProgram(prog.p); RD.setPlace(R, prog, pl, a);
        gl.uniformMatrix4fv(prog.u.uProj, false, R.proj(1e-6, 1e7));
        gl.uniformMatrix4fv(prog.u.uLight, false, LM);
        gl.uniform3f(prog.u.uSun, ...fi.sun); gl.uniform1f(prog.u.uSunUp, sunUp);
        gl.uniform3f(prog.u.uSkyCol, ...skyCol); gl.uniform3f(prog.u.uFogCol, ...fogCol); gl.uniform1f(prog.u.uFog, fog);
        gl.uniform3f(prog.u.uCamSite, ...fi.eye); gl.uniform1f(prog.u.uShadowOn, 1);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, smTex); gl.uniform1i(prog.u.uShadow, 5);
        if (indexed) {
          gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, groundTex); gl.uniform1i(prog.u.uGround, 6);
          gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, nearTex); gl.uniform1i(prog.u.uNearTex, 7);
          gl.uniform4f(prog.u.uGBox, 0, 0, 2 * ext, 2 * ext); gl.uniform4f(prog.u.uNBox, SITE.person.e, SITE.person.n, 128, 128); gl.uniform1f(prog.u.uNearOn, cam.L < 2.6 ? 1 : 0);
          gl.bindVertexArray(vao.v); gl.drawElements(gl.TRIANGLES, vao.n, gl.UNSIGNED_INT, 0);
        } else { gl.bindVertexArray(vao.v); gl.drawArrays(gl.TRIANGLES, 0, vao.n); }
      }
      gl.disable(gl.DEPTH_TEST);
      L.lastLM = LM; L.lastFi = fi; L.lastSunUp = sunUp;
    };
    L.labels = cam => [
      { t: 'Hallgrímskirkja, 73 m', frame: 'site', p: [-12, 30, 72], cls: '', a: band(cam.L, 1.9, 3.2, 0.3, 0.3) },
      { t: 'Leifur Eiríksson (A. Stirling Calder, 1932)', frame: 'site', p: [-37, 95, 8], cls: 'minor', a: 0 },
    ];
    layers.push(L);
    return layers;
  }
  root.PTEN_LAYERS_SITE = { build, earcut };
})(typeof globalThis !== 'undefined' ? globalThis : this);
