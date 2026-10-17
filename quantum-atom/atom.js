// The hydrogen atom in 3D: exact orbitals evaluated on the GPU into 3D textures, ray-marched as a glowing
// cloud whose colour is the wave's phase (gold crests, blue troughs, as on the main stage).
const AtomView = (canvas) => {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: !!window.__DEV });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  const SIZE = 112; // voxels per side
  const VS = `#version 300 es
  out vec2 vUv;
  void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p * 2.0 - 1.0; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  // ψ_nlm (real orbital) at voxel centres of one z-slice
  const FIELD = `#version 300 es
  precision highp float;
  uniform int uN, uL, uM; uniform float uRN, uYN, uB, uZ;
  out vec4 o;
  void main(){
    vec3 idx = vec3(gl_FragCoord.xy, uZ + 0.5);
    vec3 p = (idx / ${SIZE}.0 - 0.5) * 2.0 * uB;
    float r = length(p), rho = 2.0 * r / float(uN);
    int k = uN - uL - 1; float a = float(2 * uL + 1);
    float L0 = 1.0, L1 = 1.0 + a - rho;
    for (int i = 1; i < 12; i++){ if (i >= k) break; float L2 = ((2.0 * float(i) + 1.0 + a - rho) * L1 - (float(i) + a) * L0) / float(i + 1); L0 = L1; L1 = L2; }
    float Lk = k == 0 ? 1.0 : L1;
    float rl = 1.0; for (int i = 0; i < 12; i++){ if (i >= uL) break; rl *= rho; }
    float R = uRN * exp(-0.5 * rho) * rl * Lk;
    float ct = r > 0.0 ? clamp(p.z / r, -1.0, 1.0) : 1.0, phi = atan(p.y, p.x);
    int am = abs(uM);
    float pmm = 1.0, s = sqrt(max(0.0, (1.0 - ct) * (1.0 + ct))), f = 1.0;
    for (int i = 1; i < 12; i++){ if (i > am) break; pmm *= -f * s; f += 2.0; }
    float P = pmm;
    if (uL > am){
      float pm1 = ct * float(2 * am + 1) * pmm;
      P = pm1;
      for (int ll = am + 2; ll < 14; ll++){ if (ll > uL) break; float pl = (ct * float(2 * ll - 1) * pm1 - float(ll + am - 1) * pmm) / float(ll - am); pmm = pm1; pm1 = pl; P = pl; }
    }
    float trig = uM == 0 ? 1.0 : uM > 0 ? cos(float(am) * phi) : sin(float(am) * phi);
    o = vec4(R * uYN * P * trig, 0.0, 0.0, 0.0);
  }`;
  // ray-march Σ c_i ψ_i (up to two states)
  const MARCH = `#version 300 es
  precision highp float; precision highp sampler3D;
  in vec2 vUv; out vec4 o;
  uniform sampler3D uA, uBt;
  uniform vec2 uCA, uCB;        // complex coefficients
  uniform float uBox, uGain, uAspect, uTan, uDist, uDot, uDotZ;
  uniform vec3 uNuc0, uNuc1; uniform int uNucN;
  uniform mat3 uCam;            // columns: right, up, forward
  vec3 tint(float ph){
    float cr = 0.5 + 0.5 * cos(ph);
    return mix(vec3(0.30, 0.55, 1.00), vec3(1.00, 0.78, 0.42), smoothstep(0.0, 1.0, cr)) * (0.6 + 0.4 * abs(cos(ph)));
  }
  void main(){
    vec3 rd = normalize(uCam[2] + uCam[0] * vUv.x * uAspect * uTan + uCam[1] * vUv.y * uTan);
    vec3 ro = -uCam[2] * uDist;
    vec3 inv = 1.0 / rd, t0 = (-vec3(uBox) - ro) * inv, t1 = (vec3(uBox) - ro) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    float ta = max(max(tmin.x, tmin.y), tmin.z), tb = min(min(tmax.x, tmax.y), tmax.z);
    vec3 col = vec3(0.0); float tr = 1.0;
    if (tb > max(ta, 0.0)){
      ta = max(ta, 0.0);
      const int STEPS = 220;
      float ds = (tb - ta) / float(STEPS);
      float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      for (int i = 0; i < STEPS; i++){
        vec3 p = ro + rd * (ta + (float(i) + jit) * ds);
        vec3 uvw = p / (2.0 * uBox) + 0.5;
        float a = texture(uA, uvw).r, b = texture(uBt, uvw).r;
        vec2 psi = uCA * a + uCB * b;
        float q = dot(psi, psi) * uGain;
        float d = q * ds;
        col += tr * tint(atan(psi.y, psi.x)) * d * 3.2;
        tr *= exp(-d * 0.55);
        if (tr < 0.01) break;
      }
    }
    // the nuclei: protons, 100 000 times smaller than the cloud; drawn as points of light
    for (int k = 0; k < 2; k++){
      if (k >= uNucN) break;
      vec3 cp = (k == 0 ? uNuc0 : uNuc1) - ro; float along = dot(cp, rd); float dperp = length(cp - rd * along);
      col += vec3(1.0, 0.92, 0.85) * uDot * exp(-dperp * dperp / (uBox * uBox * 0.00008)) * 0.9 * max(tr, 0.35);
    }
    // the charge centre ⟨z⟩ when the cloud sloshes
    if (uDotZ != 0.0){
      vec3 cz = vec3(0.0, 0.0, uDotZ) - ro; float al = dot(cz, rd); float dz = length(cz - rd * al);
      col += vec3(0.75, 0.95, 1.0) * exp(-dz * dz / (uBox * uBox * 0.00012)) * 0.8;
    }
    col = 1.0 - exp(-col * 1.25);
    o = vec4(col + vec3(0.012, 0.016, 0.026) * tr, 1.0);
  }`;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const vs = sh(gl.VERTEX_SHADER, VS);
  const mk = (fs, names) => { const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); const u = {}; names.forEach(n => u[n] = gl.getUniformLocation(p, n)); return { p, u }; };
  const pField = mk(FIELD, ['uN', 'uL', 'uM', 'uRN', 'uYN', 'uB', 'uZ']);
  const pMarch = mk(MARCH, ['uA', 'uBt', 'uCA', 'uCB', 'uBox', 'uGain', 'uAspect', 'uTan', 'uDist', 'uCam', 'uDot', 'uDotZ', 'uNuc0', 'uNuc1', 'uNucN']);
  // H₂⁺: ψ = X(ξ) Y(η) from tabulated factors, protons at z = ±R/2
  const H2FIELD = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uX, uY; uniform float uR, uXiMax, uB, uZ; uniform int uNX, uNY;
  out vec4 o;
  float tab(sampler2D t, int n, float f){ f = clamp(f, 0.0, 1.0) * float(n - 1); int i = min(int(f), n - 2); float a = f - float(i); return mix(texelFetch(t, ivec2(i, 0), 0).r, texelFetch(t, ivec2(i + 1, 0), 0).r, a); }
  void main(){
    vec3 p = (vec3(gl_FragCoord.xy, uZ + 0.5) / ${SIZE}.0 - 0.5) * 2.0 * uB;
    float ra = length(p - vec3(0.0, 0.0, 0.5 * uR)), rb = length(p + vec3(0.0, 0.0, 0.5 * uR));
    float xi = (ra + rb) / uR, eta = (rb - ra) / uR;
    float v = xi >= uXiMax ? 0.0 : tab(uX, uNX, (xi - 1.0) / (uXiMax - 1.0)) * tab(uY, uNY, 0.5 * (eta + 1.0));
    o = vec4(v, 0.0, 0.0, 0.0);
  }`;
  const pH2 = mk(H2FIELD, ['uX', 'uY', 'uR', 'uXiMax', 'uB', 'uZ', 'uNX', 'uNY']);
  const tab1 = (arr) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, arr.length, 1, 0, gl.RED, gl.FLOAT, Float32Array.from(arr)); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  function newTex3(){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, SIZE, SIZE, SIZE, 0, gl.RED, gl.FLOAT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    return t;
  }
  // fill (or refill) a 3D texture with the H₂⁺ wavefunction wf = H2p.wavefunction(R, parity)
  function fieldH2(wf, B, tex){
    const t = tex || newTex3(), tx = tab1(wf.X), ty = tab1(wf.Y);
    gl.useProgram(pH2.p); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, SIZE, SIZE); gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(pH2.u.uX, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ty); gl.uniform1i(pH2.u.uY, 1);
    gl.uniform1f(pH2.u.uR, wf.R); gl.uniform1f(pH2.u.uXiMax, wf.xiMax); gl.uniform1f(pH2.u.uB, B);
    gl.uniform1i(pH2.u.uNX, wf.X.length); gl.uniform1i(pH2.u.uNY, wf.Y.length);
    for (let z = 0; z < SIZE; z++){ gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z); gl.uniform1f(pH2.u.uZ, z); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    gl.deleteTexture(tx); gl.deleteTexture(ty);
    return t;
  }
  const vao = gl.createVertexArray(), fb = gl.createFramebuffer();
  const fact = k => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
  // 3D texture of ψ_nlm over [−B, B]³, cached
  const cache = new Map();
  const zero = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t); gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, 1, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array(1)); return t; })();
  function field(n, l, m, B){
    const key = `${n},${l},${m},${B}`;
    if (cache.has(key)) return cache.get(key);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, SIZE, SIZE, SIZE, 0, gl.RED, gl.FLOAT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    gl.useProgram(pField.p); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, SIZE, SIZE); gl.bindVertexArray(vao);
    const am = Math.abs(m);
    const RN = Math.sqrt((2 / n) ** 3 * fact(n - l - 1) / (2 * n * fact(n + l)));
    const YN = Math.sqrt((2 * l + 1) / (4 * Math.PI) * fact(l - am) / fact(l + am)) * (m === 0 ? 1 : Math.SQRT2 * (am % 2 ? -1 : 1));
    gl.uniform1i(pField.u.uN, n); gl.uniform1i(pField.u.uL, l); gl.uniform1i(pField.u.uM, m);
    gl.uniform1f(pField.u.uRN, RN); gl.uniform1f(pField.u.uYN, YN); gl.uniform1f(pField.u.uB, B);
    for (let z = 0; z < SIZE; z++){
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z);
      gl.uniform1f(pField.u.uZ, z); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (cache.size > 10){ const [k0, t0] = cache.entries().next().value; gl.deleteTexture(t0); cache.delete(k0); }
    cache.set(key, t);
    return t;
  }
  // box half-size that holds an orbital's cloud
  const boxFor = n => Math.ceil(2.6 * n * n + 7);
  // peak |ψ|² of one orbital, by sampling (sets the exposure)
  const peakCache = new Map();
  function peak(n, l, m){
    const key = `${n},${l},${m}`; if (peakCache.has(key)) return peakCache.get(key);
    const B = boxFor(n); let mx = 0;
    for (let i = 0; i < 26; i++) for (let j = 0; j < 26; j++) for (let k = 0; k < 26; k++){
      const x = (i / 25 - 0.5) * 2 * B * 0.9, y = (j / 25 - 0.5) * 2 * B * 0.9, z = (k / 25 - 0.5) * 2 * B * 0.9;
      mx = Math.max(mx, H.psiReal(n, l, m, x + 0.01, y + 0.013, z + 0.017) ** 2);
    }
    peakCache.set(key, mx); return mx;
  }
  const V = { gl, field, fieldH2: (wf, B, tex) => fieldH2(wf, B, tex), boxFor, peak, yaw: 0.6, pitch: 0.28, dist: 2.35 };
  // states: [{ n, l, m, c: [re, im] }] or [{ tex, pk, c }], box B; dotZ: ⟨z⟩ marker (bohr) or 0
  V.draw = (states, B, gainScale = 1, dotZ = 0, nuclei = [[0, 0, 0]]) => {
    const w = canvas.width, h = canvas.height;
    const A = states[0], Bs = states[1];
    const tA = A.tex || field(A.n, A.l, A.m, B), tB = Bs ? (Bs.tex || field(Bs.n, Bs.l, Bs.m, B)) : zero; // (may switch programs)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.useProgram(pMarch.p); gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tA); gl.uniform1i(pMarch.u.uA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, tB); gl.uniform1i(pMarch.u.uBt, 1);
    gl.uniform2f(pMarch.u.uCA, A.c[0], A.c[1]); gl.uniform2f(pMarch.u.uCB, Bs ? Bs.c[0] : 0, Bs ? Bs.c[1] : 0);
    // exposure: scale the densest state so its peak sits at a fixed brightness per unit box size
    let pk = 0; for (const s of states) pk = Math.max(pk, (s.pk ?? peak(s.n, s.l, s.m)) * (s.c[0] ** 2 + s.c[1] ** 2));
    gl.uniform1f(pMarch.u.uBox, B); gl.uniform1f(pMarch.u.uGain, gainScale * 2.2 / (pk * B));
    const cy = Math.cos(V.yaw), sy = Math.sin(V.yaw), cp = Math.cos(V.pitch), sp = Math.sin(V.pitch);
    const fwd = [-cp * cy, -cp * sy, -sp], right = [-sy, cy, 0], up = [-sp * cy, -sp * sy, cp];
    // camera looks at the origin from (cp cy, cp sy, sp)·dist; z (the quantisation axis) points up
    gl.uniformMatrix3fv(pMarch.u.uCam, false, [...right, ...up, ...fwd]);
    gl.uniform1f(pMarch.u.uAspect, w / h); gl.uniform1f(pMarch.u.uTan, Math.tan(0.36));
    gl.uniform1f(pMarch.u.uDist, B * V.dist); gl.uniform1f(pMarch.u.uDot, 1); gl.uniform1f(pMarch.u.uDotZ, dotZ);
    gl.uniform3f(pMarch.u.uNuc0, ...nuclei[0]); gl.uniform3f(pMarch.u.uNuc1, ...(nuclei[1] || nuclei[0])); gl.uniform1i(pMarch.u.uNucN, nuclei.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // project a world point to canvas pixels (for overlays)
  V.project = (p, B) => {
    const cy = Math.cos(V.yaw), sy = Math.sin(V.yaw), cp = Math.cos(V.pitch), sp = Math.sin(V.pitch);
    const fwd = [-cp * cy, -cp * sy, -sp], right = [-sy, cy, 0], up = [-sp * cy, -sp * sy, cp], D = B * V.dist;
    const q = [p[0] + fwd[0] * D, p[1] + fwd[1] * D, p[2] + fwd[2] * D];
    const z = q[0] * fwd[0] + q[1] * fwd[1] + q[2] * fwd[2], x = q[0] * right[0] + q[1] * right[1] + q[2] * right[2], y = q[0] * up[0] + q[1] * up[1] + q[2] * up[2];
    const t = Math.tan(0.36), w = canvas.width, h = canvas.height;
    return [w / 2 + x / (z * t * w / h) * w / 2, h / 2 - y / (z * t) * h / 2];
  };
  return V;
};
if (typeof module !== 'undefined') module.exports = AtomView;
