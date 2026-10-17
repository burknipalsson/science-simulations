// Powers of Ten: WebGL2 drawing. Every layer is drawn camera-relative: the CPU (in double precision) gives
// each layer a rotation+offset into camera axes already divided by the view width, so the GPU only ever
// sees numbers of order one, whatever the power of ten.
(function (root) {
  const FOV = 40 * Math.PI / 180, EYE = 0.5 / Math.tan(FOV / 2);   // eye distance in view widths

  function make(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) return null;
    const R = { gl, canvas, EYE, FOV };
    function sh(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
      return s;
    }
    R.program = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\nprecision highp float;\n' + COMMON + vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n' + fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    // a vertex array from named float attributes {name: [Float32Array, size]}
    R.vao = (prog, attrs) => {
      const v = gl.createVertexArray(); gl.bindVertexArray(v);
      let count = 0; const bufs = {};
      for (const [name, [data, size]] of Object.entries(attrs)) {
        const loc = gl.getAttribLocation(prog.p, name); if (loc < 0) continue;
        const b = gl.createBuffer(); bufs[name] = b; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        count = data.length / size;
      }
      gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      return { v, count, bufs };
    };
    R.update = (vao, name, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, vao.bufs[name]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); gl.bindBuffer(gl.ARRAY_BUFFER, null); };
    R.texture = (img, opts = {}) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      return t;
    };
    // projection: camera at (0,0,EYE) looking down -z, in view-width units
    R.proj = (near, far) => {
      const a = R.canvas.width / R.canvas.height, f = 1 / Math.tan(FOV / 2);
      return new Float32Array([f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
    };
    R.pxPerUnit = () => R.canvas.height / 2 / Math.tan(FOV / 2);   // pixels per (unit size at unit distance)

    // ---- the point program: stars, particles, galaxies ----
    R.points = R.program(`
      in vec3 aPos; in vec4 aCol; in float aSize;
      uniform float uMinPx, uMaxPx, uGain, uFocus, uMarker;
      out vec4 vCol; out float vSoft;
      void main() {
        vec3 c = toCam(aPos);
        // depth focus: fade what lies far from the point we are looking at (in view widths)
        vec3 v = c + vec3(0.0, 0.0, uEye);
        float fog = uFocus > 0.0 ? exp(-dot(v, v) / (uFocus * uFocus)) : 1.0;
        float d = -c.z;
        gl_Position = uProj * vec4(c, 1.0);
        if (d <= uNear) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float px = aSize * uScale * uPx / d;                 // true size in pixels
        float s = clamp(px, uMinPx, uMaxPx);
        // conserve light: a sprite drawn bigger than it really is gets dimmer
        float k = px < uMinPx && uMarker < 0.5 ? (px * px) / (uMinPx * uMinPx) : 1.0;   // markers keep a visible minimum
        k *= aCol.a * uGain;
        gl_PointSize = s;
        vCol = vec4(aCol.rgb, k * uAlpha * fog);
        vSoft = px > uMinPx ? 1.0 : 0.0;
      }`, `
      in vec4 vCol; in float vSoft; out vec4 o;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
        float g = exp(-r2 * 4.0) + 0.25 * exp(-r2 * 14.0) * (1.0 - vSoft);
        float a = vCol.a * g;
        // bright points saturate toward white like a photograph
        o = vec4(vCol.rgb * a, 1.0);
      }`);

    // ---- lines (orbits, rings, rulers) ----
    R.lines = R.program(`
      in vec3 aPos;
      void main() { vec3 c = toCam(aPos); gl_Position = uProj * vec4(c, 1.0); }`, `
      uniform vec4 uColor; out vec4 o;
      void main() { o = vec4(uColor.rgb * uColor.a, 1.0); }`);

    // ---- ray-cast spheres (planets, Sun): exact surfaces at any scale ----
    R.sphere = R.program(`
      uniform vec3 uC; uniform float uRad;
      out vec3 vDir;
      const vec2 Q[4] = vec2[4](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
      void main() {
        // a screen-space quad around the sphere (or the whole screen when it fills the view)
        vec3 c = uC - vec3(0.0, 0.0, uEye);
        float d = length(c);
        vec2 q = Q[gl_VertexID];
        if (d < uRad * 1.6 || -c.z < uRad * 1.05) { gl_Position = vec4(q, 0.0, 1.0); }
        else {
          vec4 p = uProj * vec4(c, 1.0); float r = uRad / sqrt(max(d * d - uRad * uRad, 1e-30)) * 1.15;
          vec2 sc = vec2(uProj[0][0], uProj[1][1]) * r * (d / -c.z);
          gl_Position = vec4(p.xy / p.w + q * sc, 0.0, 1.0);
        }
        // view ray through this vertex (camera space)
        vec2 ndc = gl_Position.xy / gl_Position.w;
        vDir = vec3(ndc.x / uProj[0][0], ndc.y / uProj[1][1], -1.0);
      }`, `
      uniform vec3 uC; uniform float uRad, uCc, uAlpha, uEye, uK; uniform mat3 uRotB; uniform vec3 uEyeB; uniform vec3 uSun;
      uniform sampler2D uTex, uDetail, uNight, uMercTexA, uMercTexB; uniform float uNightOn; uniform vec4 uMercA, uMercB; uniform vec2 uMercFade; uniform vec4 uDetailBox; uniform int uKind; uniform vec3 uTint; uniform float uDetailOn;
      in vec3 vDir; out vec4 o;
      const float PI = 3.14159265;
      void main() {
        // Ray-cast an ellipsoid (polar axis squashed by 1/uK) in a body frame stretched along z by uK, where it
        // is a sphere of radius uRad. uEyeB (eye - centre, stretched) and uCc = |uEyeB|^2 - uRad^2 come from the
        // CPU in double precision, and the near root is taken in the cancellation-free form.
        vec3 dir = normalize(vDir);
        vec3 D = uRotB * dir; D.z *= uK;
        float A = dot(D, D), B = dot(uEyeB, D);
        float disc = B * B - A * uCc;
        if (disc < 0.0 || B > 0.0) discard;
        float t = uCc / (-B + sqrt(disc));
        vec3 P = uEyeB + t * D;
        vec3 nb = normalize(vec3(P.xy, P.z * uK));          // surface normal (geodetic) in the body frame
        vec3 n = transpose(uRotB) * nb;                      // ... and in camera axes
        if (uKind == 2) {                                  // the Sun: limb darkening (Eddington, u = 0.6)
          float mu = max(dot(n, -dir), 0.0);
          o = vec4(vec3(1.0, 0.93, 0.82) * (0.4 + 0.6 * mu) * 1.6 * uAlpha, uAlpha); return;
        }
        float lat = asin(clamp(nb.z, -1.0, 1.0)), lon = atan(nb.y, nb.x);
        vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
        vec3 col = uKind == 0 ? texture(uTex, uv).rgb : uTint;
        if (uDetailOn > 0.5) {
          float lo = degrees(lon), la = degrees(lat);
          vec2 du = vec2((lo - uDetailBox.x) / (uDetailBox.y - uDetailBox.x), (uDetailBox.z - la) / (uDetailBox.z - uDetailBox.w));
          if (du.x > 0.0 && du.x < 1.0 && du.y > 0.0 && du.y < 1.0) {
            float e = min(min(du.x, 1.0 - du.x), min(du.y, 1.0 - du.y));
            col = mix(col, texture(uDetail, du).rgb, smoothstep(0.0, 0.03, e));
          }
        }
        if (uDetailOn > 0.5) {
          // Sentinel-2 mosaics around Reykjavík, in Web Mercator tile coordinates (exact projection)
          float my = (1.0 - log(tan(lat) + 1.0 / cos(lat)) / PI) * 0.5, mx = degrees(lon) / 360.0 + 0.5;
          for (int k = 0; k < 2; k++) {
            vec4 M = k == 0 ? uMercA : uMercB;
            vec2 q = (vec2(mx, my) * M.x - M.yz) / M.w;
            if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
              float e = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
              vec3 c2 = k == 0 ? texture(uMercTexA, q).rgb : texture(uMercTexB, q).rgb;
              col = mix(col, c2, smoothstep(0.0, 0.12, e) * (k == 0 ? uMercFade.x : uMercFade.y));
            }
          }
        }
        col = pow(col, vec3(2.2));
        float l = dot(n, uSun);
        float day = smoothstep(-0.05, 0.1, l);
        vec3 lit = col * (max(l, 0.0) * 1.15 + 0.035) ;
        if (uNightOn > 0.5) { vec3 nl = texture(uNight, uv).rgb; lit += pow(nl, vec3(2.2)) * vec3(1.0, 0.85, 0.6) * (1.0 - smoothstep(-0.12, 0.02, l)) * 1.4; }
        // thin blue limb for the Earth
        if (uKind == 0) { float rim = pow(1.0 - max(dot(n, -dir), 0.0), 3.0); lit += vec3(0.25, 0.45, 1.0) * rim * 0.5 * day; }
        o = vec4(pow(lit, vec3(1.0 / 2.2)) * uAlpha, uAlpha);
      }`);
    // ---- HDR: draw into a half-float buffer, then tone-map like an exposure (graceful highlights) ----
    R.hdrOK = !!gl.getExtension('EXT_color_buffer_float');
    R.tone = R.program(`
      out vec2 vUV;
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`, `
      uniform sampler2D uImg; uniform float uExposure; in vec2 vUV; out vec4 o;
      void main() {
        vec3 c = texture(uImg, vUV).rgb * uExposure;
        vec3 t = 1.0 - exp(-c);                                  // soft shoulder: bright cores stay coloured
        o = vec4(pow(t, vec3(0.9)), 1.0);
      }`);
    let fb = null, tex = null, depth = null, fw = 0, fh = 0;
    R.begin = () => {
      if (!R.hdrOK) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
      const w = canvas.width, h = canvas.height;
      if (w !== fw || h !== fh) {
        if (tex) { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); }
        tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        // depth for the opaque layers below 1 km (buildings, the person, molecules), written as log depth
        if (depth) gl.deleteRenderbuffer(depth);
        depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { R.hdrOK = false; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
        fw = w; fh = h;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    };
    R.end = exposure => {
      if (!R.hdrOK) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.BLEND);
      gl.useProgram(R.tone.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(R.tone.u.uImg, 0);
      gl.uniform1f(R.tone.u.uExposure, exposure); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    return R;
  }

  // shared vertex prelude: layer -> camera transform, all in view-width units
  const COMMON = `
    uniform mat3 uRot; uniform vec3 uOff; uniform mat4 uProj; uniform float uEye, uScale, uPx, uNear, uAlpha;
    vec3 toCam(vec3 p) { return uRot * p + uOff - vec3(0.0, 0.0, uEye); }
  `;
  // log depth, shared by every opaque layer so they occlude each other whatever their frame: distance d
  // (view widths) maps to log(d / 1e-6) / log(1e12), resolving 1 part in 10^6 of the distance anywhere.
  const LOGDEPTH = `
    float logDepth(float d) { return clamp(log2(max(d, 1e-6) * 1e6) / 39.863, 0.0, 1.0); }
  `;

  // set the per-layer transform uniforms. pl = place(): rot (layer units -> view widths) and off
  function setPlace(R, prog, pl, alpha, near) {
    const gl = R.gl, u = prog.u, m = pl.rot;
    // column-major for GLSL
    gl.uniformMatrix3fv(u.uRot, false, new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]));
    if (u.uOff) gl.uniform3f(u.uOff, pl.off[0], pl.off[1], pl.off[2]);
    if (u.uEye) gl.uniform1f(u.uEye, R.EYE);
    if (u.uScale) gl.uniform1f(u.uScale, Math.hypot(m[0], m[3], m[6]));
    if (u.uPx) gl.uniform1f(u.uPx, R.pxPerUnit());
    if (u.uNear) gl.uniform1f(u.uNear, near || 1e-4);
    if (u.uAlpha) gl.uniform1f(u.uAlpha, alpha);
  }

  const api = { make, setPlace, FOV, EYE, LOGDEPTH };
  root.PTEN_RENDER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
