// GPU particle-mesh engine (WebGL 2) for dark matter + gas. The 3D grid lives in a 2D "atlas" texture:
// NG slices of NG×NG tiled TX across and NG/TX down. Particles live in transform-feedback buffers.
// Particles [0, NDM) are dark matter; [NDM, 2·NDM) are gas, each carrying (temperature, star fraction,
// young-star fraction, collapsed fraction already counted) in an aux vec4.
const PMEngine = (gl) => {
  const ext = {
    cbf: gl.getExtension('EXT_color_buffer_float'),
    fblend: gl.getExtension('EXT_float_blend'),
  };
  if (!ext.cbf) throw new Error('EXT_color_buffer_float unavailable');

  const QUAD_VS = `#version 300 es
  void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  const header = (NG, TX, NP) => `#version 300 es
  precision highp float; precision highp int; precision highp sampler2D;
  #define NG ${NG}
  #define TX ${TX}
  #define TY ${NG / TX}
  #define NP ${NP}
  #define NDM ${NP * NP * NP}
  ivec3 cellOf(ivec2 t){ return ivec3(t.x % NG, t.y % NG, t.x / NG + TX * (t.y / NG)); }
  ivec2 texOf(ivec3 c){ c = c & (NG - 1); return ivec2(c.x + NG * (c.z % TX), c.y + NG * (c.z / TX)); }
  ivec3 freqOf(ivec3 c){ return c - NG * ivec3(greaterThan(c, ivec3(NG / 2))); }
  // cloud-in-cell interpolation of a grid at a position in box units
  vec4 cic(sampler2D s, vec3 x){
    vec3 u = x * float(NG); ivec3 i0 = ivec3(floor(u)); vec3 f = u - vec3(i0);
    vec4 acc = vec4(0.0);
    for (int k = 0; k < 8; k++){
      ivec3 d = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
      vec3 w = mix(1.0 - f, f, vec3(d));
      acc += w.x * w.y * w.z * texelFetch(s, texOf(i0 + d), 0);
    }
    return acc;
  }
  `;

  const FS = {
    noise: `uniform uint uSeed; out vec4 o;
      uint pcg(uint v){ uint st = v * 747796405u + 2891336453u; uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u; return (w >> 22u) ^ w; }
      void main(){
        ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
        uint i = uint(c.x + NG * (c.y + NG * c.z)), sh = uSeed * 0x9E3779B9u;
        float u = (float(pcg((2u * i) ^ sh)) + 1.0) / 4294967296.0, v = float(pcg((2u * i + 1u) ^ sh)) / 4294967296.0;
        o = vec4(sqrt(-2.0 * log(u)) * cos(6.283185307 * v), 0.0, 0.0, 0.0);
      }`,
    pack: `uniform sampler2D uRho; uniform float uMfac; out vec4 o;
      void main(){ o = vec4(texelFetch(uRho, ivec2(gl_FragCoord.xy), 0).r * uMfac - 1.0, 0.0, 0.0, 0.0); }`,
    // one radix-2 Stockham pass along one axis; output lands in natural order after all passes
    fft: `uniform sampler2D uSrc; uniform int uAxis, uNs; uniform float uSign; out vec4 o;
      void main(){
        ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
        int oi = c[uAxis], blk = oi / (2 * uNs), r = oi - blk * 2 * uNs, jm = r % uNs, j = blk * uNs + jm;
        ivec3 c0 = c, c1 = c; c0[uAxis] = j; c1[uAxis] = j + NG / 2;
        vec2 a = texelFetch(uSrc, texOf(c0), 0).xy, b = texelFetch(uSrc, texOf(c1), 0).xy;
        float ang = uSign * 3.14159265358979 * float(jm) / float(uNs);
        vec2 w = vec2(cos(ang), sin(ang));
        vec2 bw = vec2(b.x * w.x - b.y * w.y, b.x * w.y + b.y * w.x);
        o = vec4(r < uNs ? a + bw : a - bw, 0.0, 0.0);
      }`,
    // Poisson: ψ_k = -δ_k / k²
    green: `uniform sampler2D uSrc; out vec4 o;
      void main(){
        ivec2 t = ivec2(gl_FragCoord.xy); vec3 n = vec3(freqOf(cellOf(t)));
        float k2 = dot(n, n) * 39.4784176;
        o = vec4(k2 > 0.0 ? -texelFetch(uSrc, t, 0).xy / k2 : vec2(0.0), 0.0, 0.0);
      }`,
    // Zel'dovich displacement component: Ψ_k = i n / (2π n²) · amp(|n|) · W_k
    disp: `uniform sampler2D uSrc, uLut; uniform int uComp; uniform float uLutScale; out vec4 o;
      void main(){
        ivec2 t = ivec2(gl_FragCoord.xy); ivec3 ni = freqOf(cellOf(t)); vec3 n = vec3(ni);
        float nm = length(n);
        if (nm == 0.0 || abs(ni[uComp]) == NG / 2){ o = vec4(0.0); return; }
        float x = nm * uLutScale; int i = int(x);
        float amp = mix(texelFetch(uLut, ivec2(i, 0), 0).r, texelFetch(uLut, ivec2(i + 1, 0), 0).r, x - float(i));
        vec2 d = texelFetch(uSrc, t, 0).xy * amp;
        float f = n[uComp] / (6.283185307 * nm * nm);
        o = vec4(-d.y * f, d.x * f, 0.0, 0.0);
      }`,
    copyReal: `uniform sampler2D uSrc; uniform float uScale; out vec4 o;
      void main(){ o = vec4(texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).x * uScale); }`,
    // g = -∇ψ with 4-point differences
    grad: `uniform sampler2D uSrc; uniform float uScale; out vec4 o;
      float P(ivec3 c){ return texelFetch(uSrc, texOf(c), 0).x; }
      void main(){
        ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
        ivec3 ex = ivec3(1, 0, 0), ey = ivec3(0, 1, 0), ez = ivec3(0, 0, 1);
        vec3 g = vec3(
          8.0 * (P(c + ex) - P(c - ex)) - (P(c + 2 * ex) - P(c - 2 * ex)),
          8.0 * (P(c + ey) - P(c - ey)) - (P(c + 2 * ey) - P(c - 2 * ey)),
          8.0 * (P(c + ez) - P(c - ez)) - (P(c + 2 * ez) - P(c - 2 * ez)));
        o = vec4(-g * uScale * float(NG) / 12.0, 0.0);
      }`,
    // [1,2,1]/4 along one axis: smoothing that removes the particle-lattice pattern
    blur: `uniform sampler2D uSrc; uniform int uAxis; out vec4 o;
      void main(){
        ivec3 c = cellOf(ivec2(gl_FragCoord.xy)), e = ivec3(0); e[uAxis] = 1;
        o = vec4(0.25 * texelFetch(uSrc, texOf(c - e), 0).r + 0.5 * texelFetch(uSrc, texOf(c), 0).r + 0.25 * texelFetch(uSrc, texOf(c + e), 0).r, 0.0, 0.0, 0.0);
      }`,
    // gas cell state: mean flow and thermal pressure
    gasCell: `uniform sampler2D uGA, uGB; uniform float uMfac, uKT; out vec4 o;
      void main(){
        ivec2 t = ivec2(gl_FragCoord.xy);
        vec4 a = texelFetch(uGA, t, 0), b = texelFetch(uGB, t, 0);
        float m = a.r;
        vec3 v = m > 0.0 ? a.gba / m : vec3(0.0);
        float T = m > 0.0 ? b.r / m : 0.0;
        o = vec4(v, m * uMfac * T * uKT);
      }`,
    // physical divergence of the gas flow (Hubble + peculiar) and von Neumann–Richtmyer viscosity q
    gasDiv: `uniform sampler2D uHA, uGA; uniform float uA, uH, uCq, uMfac; out vec4 o;
      void main(){
        ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
        ivec3 ex = ivec3(1, 0, 0), ey = ivec3(0, 1, 0), ez = ivec3(0, 0, 1);
        float dv = (texelFetch(uHA, texOf(c + ex), 0).x - texelFetch(uHA, texOf(c - ex), 0).x
                  + texelFetch(uHA, texOf(c + ey), 0).y - texelFetch(uHA, texOf(c - ey), 0).y
                  + texelFetch(uHA, texOf(c + ez), 0).z - texelFetch(uHA, texOf(c - ez), 0).z) * float(NG) * 0.5;
        float th = 3.0 * uH + dv / uA, dx = uA / float(NG);
        float rho = texelFetch(uGA, texOf(c), 0).r * uMfac;
        o = vec4(th, th < 0.0 ? rho * uCq * (dx * th) * (dx * th) : 0.0, 0.0, 0.0);
      }`,
    // pressure force -∇(P + q)/ρ, with the divergence carried along in w
    gasForce: `uniform sampler2D uHA, uDQ, uGA; uniform float uMfac, uFloor; out vec4 o;
      float PQ(ivec3 c){ ivec2 t = texOf(c); return texelFetch(uHA, t, 0).a + texelFetch(uDQ, t, 0).y; }
      void main(){
        ivec3 c = cellOf(ivec2(gl_FragCoord.xy));
        ivec3 ex = ivec3(1, 0, 0), ey = ivec3(0, 1, 0), ez = ivec3(0, 0, 1);
        float rho = max(texelFetch(uGA, texOf(c), 0).r * uMfac, uFloor);
        vec3 h = -vec3(PQ(c + ex) - PQ(c - ex), PQ(c + ey) - PQ(c - ey), PQ(c + ez) - PQ(c - ez)) * float(NG) * 0.5 / rho;
        o = vec4(h, texelFetch(uDQ, texOf(c), 0).x);
      }`,
    // coarse grid (NC³): total mass, stars, gas above 10⁵ K, gas above 10⁷ K
    reduce: `uniform sampler2D uRho, uGB; out vec4 o;
      #define NC 64
      #define TXC 8
      #define B (NG / NC)
      void main(){
        ivec2 t = ivec2(gl_FragCoord.xy);
        ivec3 cc = ivec3(t.x % NC, t.y % NC, t.x / NC + TXC * (t.y / NC));
        vec4 s = vec4(0.0);
        for (int k = 0; k < B; k++) for (int j = 0; j < B; j++) for (int i = 0; i < B; i++){
          ivec2 q = texOf(cc * B + ivec3(i, j, k));
          s += vec4(texelFetch(uRho, q, 0).r, texelFetch(uGB, q, 0).gba);
        }
        o = s;
      }`,
  };

  // thermal physics shared by the update shader
  const GAS_GLSL = `
  const float LT[12] = float[12](4.0, 4.2, 4.4, 5.0, 5.4, 5.8, 6.2, 6.6, 7.0, 7.5, 8.0, 8.5);
  const float LL[12] = float[12](-23.6, -22.2, -21.8, -21.6, -21.7, -22.0, -22.35, -22.6, -22.75, -22.8, -22.65, -22.4);
  // radiative cooling function Λ(T), erg cm³ s⁻¹ (hydrogen, helium and some metals)
  float lambda(float T){
    float l = log(max(T, 1.0)) / 2.302585;
    if (l < LT[0]) return 1e-30;
    if (l >= LT[11]) return pow(10.0, LL[11] + 0.5 * (l - LT[11]));
    for (int i = 0; i < 11; i++) if (l < LT[i + 1]){ float w = (l - LT[i]) / (LT[i + 1] - LT[i]); return pow(10.0, mix(LL[i], LL[i + 1], w)); }
    return 1e-30;
  }
  float erfc_(float x){ float z = abs(x), t = 1.0 / (1.0 + 0.3275911 * z);
    float y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * exp(-z * z);
    return x >= 0.0 ? y : 2.0 - y; }
  // Mo & White (1996): linear overdensity from nonlinear overdensity
  float linDelta(float d){ float x = 1.0 + max(d, -0.99); return 1.68647 - 1.35 * pow(x, -2.0 / 3.0) - 1.12431 * pow(x, -0.5) + 0.78785 * pow(x, -0.58661); }
  `;

  const VS = {
    deposit: `in vec3 aPos; in float aSpecies; uniform vec2 uMass; out float vW;
      void main(){
        vec3 u = aPos * float(NG); ivec3 i0 = ivec3(floor(u)); vec3 f = u - vec3(i0);
        int k = gl_InstanceID; ivec3 d = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
        vec3 w = mix(1.0 - f, f, vec3(d));
        vW = w.x * w.y * w.z * (aSpecies < 0.5 ? uMass.x : uMass.y);
        gl_Position = vec4((vec2(texOf(i0 + d)) + 0.5) / vec2(NG * TX, NG * TY) * 2.0 - 1.0, 0.0, 1.0);
        gl_PointSize = 1.0;
      }`,
    // gas only: mass-weighted velocity, temperature, stars and hot-gas tallies
    gasDeposit: `in vec3 aPos; in vec3 aMom; in vec4 aAux; uniform float uMassG, uA; out vec4 vA; out vec4 vB;
      void main(){
        vec3 u = aPos * float(NG); ivec3 i0 = ivec3(floor(u)); vec3 f = u - vec3(i0);
        int k = gl_InstanceID; ivec3 d = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
        vec3 w3 = mix(1.0 - f, f, vec3(d));
        float w = w3.x * w3.y * w3.z * uMassG, fg = 1.0 - aAux.y, T = aAux.x;
        vA = w * fg * vec4(1.0, aMom / uA);
        vB = w * vec4(fg * T, aAux.y, fg * step(1e5, T), fg * step(1e7, T));
        gl_Position = vec4((vec2(texOf(i0 + d)) + 0.5) / vec2(NG * TX, NG * TY) * 2.0 - 1.0, 0.0, 1.0);
        gl_PointSize = 1.0;
      }`,
    ic: `uniform sampler2D uPsi; uniform float uA, uVfac, uT0; out vec3 oPos; out vec3 oMom; out vec4 oAux;
      void main(){
        int id = gl_VertexID, s = id >= NDM ? 1 : 0, l = id - s * NDM;
        vec3 q = (vec3(ivec3(l % NP, (l / NP) % NP, l / (NP * NP))) + 0.5 * float(s)) / float(NP);
        vec3 d = cic(uPsi, q).xyz;
        oPos = fract(q + uA * d); oMom = uVfac * d; oAux = vec4(float(s) * uT0, 0.0, 0.0, 0.0);
        gl_Position = vec4(0.0);
      }`,
    update: `in vec3 aPos; in vec3 aMom; in vec4 aAux;
      uniform sampler2D uG, uHF, uHA, uGA, uRhoS;
      uniform float uKick, uDrift, uKickH, uDt, uA, uTf, uDtGyr, uD, uSdiff, uEps, uK, uCq, uKT, uMfac, uFb, uCool, uTsf;
      out vec3 oPos; out vec3 oMom; out vec4 oAux;
      void main(){
        vec3 p = aMom + uKick * cic(uG, aPos).xyz;
        vec4 aux = aAux;
        if (gl_VertexID >= NDM){
          float T = aux.x, fs = aux.y, fg = 1.0 - fs;
          vec4 hf = cic(uHF, aPos);
          p += uKickH * fg * hf.xyz;
          // energy equation: compression heats, expansion cools, shocks heat through the viscosity q
          float th = hf.w;
          T *= exp(-2.0 / 3.0 * th * uDt);
          if (th < 0.0){ float dx = uA / float(NG); T += 2.0 / 3.0 * uCq * dx * dx * th * th / uKT * (-th) * uDt; }
          // gas streams can't pass through each other: relax toward the local mean flow, the lost motion becomes heat
          vec3 vb = cic(uHA, aPos).xyz, ur = p / uA - vb;
          float u2 = dot(ur, ur);
          float r = exp(-uDt * uK * (sqrt(u2) + sqrt(1.667 * T * uKT)) * float(NG) / uA);
          p = uA * (vb + ur * r);
          T += u2 * (1.0 - r * r) / 3.0 / uKT;
          // radiative cooling toward the photoionization floor
          float rphys = max(cic(uGA, aPos).r * uMfac / uFb, 0.02) / (uA * uA * uA);
          if (T > uTf){ float tc = uCool * T / (rphys * lambda(T)); T = uTf + (T - uTf) * exp(-uDt / tc); }
          T = max(T, uTf);
          // star formation: gas newly gathered into unresolved galaxy halos (extended Press–Schechter), unless too hot to cool
          float dTot = cic(uRhoS, aPos).r * uMfac - 1.0;
          float fc = erfc_((1.686 - min(linDelta(dTot), 1.68)) / uD / sqrt(2.0 * uSdiff));
          float quench = 1.0 / (1.0 + (T / uTsf) * (T / uTsf));
          float df = min(fg, uEps * max(0.0, fc - aux.w) * quench * fg);
          aux = vec4(T, fs + df, (aux.z + df) * exp(-uDtGyr / 0.5), max(aux.w, fc));
        }
        oPos = fract(aPos + uDrift * p); oMom = p; oAux = aux;
        gl_Position = vec4(0.0);
      }`,
  };
  const DEPOSIT_FS = `out vec4 o; in float vW; void main(){ o = vec4(vW, 0.0, 0.0, 0.0); }`;
  const GAS_DEPOSIT_FS = `in vec4 vA; in vec4 vB; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
    void main(){ o0 = vA; o1 = vB; }`;
  const NULL_FS = `#version 300 es
  precision mediump float; out vec4 o; void main(){ o = vec4(0.0); }`;

  function compile(vs, fs, varyings){
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + s); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++){ const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u, a: name => gl.getAttribLocation(p, name) };
  }

  function tex2D(w, h, ifmt, fmt, type, data = null){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, f, w, h, ok };
  }
  const freeTex = x => { if (x){ gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); } };

  const E = {
    NG: 0, NP: 0, NDM: 0, N: 0, TX: 0, W: 0, H: 0,
    rho: null, rhoS: null, rhoT: null, cplx: [null, null], grad: null, coarse: null, lut: null,
    gA: null, gB: null, hA: null, gasFbo: null,
    pos: [null, null], mom: [null, null], aux: [null, null], species: null, cur: 0,
    prog: null, rhoHalf: false, busy: false,
  };
  const emptyVao = gl.createVertexArray();
  const tf = gl.createTransformFeedback();
  const NC = 64;

  function setupGrid(NG){
    if (E.NG === NG) return;
    [E.rho, E.rhoS, E.rhoT, E.cplx[0], E.cplx[1], E.grad, E.coarse, E.gA, E.gB, E.hA].forEach(freeTex);
    if (E.gasFbo) gl.deleteFramebuffer(E.gasFbo);
    const TX = 1 << Math.ceil(Math.log2(Math.sqrt(NG)));
    E.NG = NG; E.TX = TX; E.W = NG * TX; E.H = NG * (NG / TX);
    // deposits need additive blending: 32-bit float if the GPU can blend it, else 16-bit
    E.rhoHalf = !ext.fblend;
    const blendFmt = E.rhoHalf ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA32F, gl.FLOAT];
    E.rho = E.rhoHalf ? tex2D(E.W, E.H, gl.R16F, gl.RED, gl.HALF_FLOAT) : tex2D(E.W, E.H, gl.R32F, gl.RED, gl.FLOAT);
    E.rhoS = tex2D(E.W, E.H, gl.R32F, gl.RED, gl.FLOAT); E.rhoT = tex2D(E.W, E.H, gl.R32F, gl.RED, gl.FLOAT);
    E.cplx = [0, 1].map(() => tex2D(E.W, E.H, gl.RG32F, gl.RG, gl.FLOAT));
    E.grad = tex2D(E.W, E.H, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    E.gA = tex2D(E.W, E.H, blendFmt[0], gl.RGBA, blendFmt[1]);
    E.gB = tex2D(E.W, E.H, blendFmt[0], gl.RGBA, blendFmt[1]);
    E.hA = tex2D(E.W, E.H, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    E.coarse = tex2D(NC * 8, NC * 8, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    // both gas deposits in one draw
    E.gasFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, E.gasFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, E.gA.t, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, E.gB.t, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const mrtOK = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!mrtOK || ![E.rho, E.rhoS, E.rhoT, ...E.cplx, E.grad, E.gA, E.gB, E.hA, E.coarse].every(x => x.ok)) throw new Error('grid framebuffers incomplete');
    E.prog = null;
  }

  function setupParticles(NP){
    if (E.NP === NP) return;
    for (const b of [...E.pos, ...E.mom, ...E.aux, E.species]) if (b) gl.deleteBuffer(b);
    E.NP = NP; E.NDM = NP * NP * NP; E.N = 2 * E.NDM;
    for (let k = 0; k < 2; k++){
      E.pos[k] = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.pos[k]); gl.bufferData(gl.ARRAY_BUFFER, E.N * 12, gl.DYNAMIC_COPY);
      E.mom[k] = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.mom[k]); gl.bufferData(gl.ARRAY_BUFFER, E.N * 12, gl.DYNAMIC_COPY);
      E.aux[k] = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.aux[k]); gl.bufferData(gl.ARRAY_BUFFER, E.N * 16, gl.DYNAMIC_COPY);
    }
    const sp = new Float32Array(E.N); sp.fill(1, E.NDM);
    E.species = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.species); gl.bufferData(gl.ARRAY_BUFFER, sp, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    E.prog = null;
  }

  function programs(){
    if (E.prog) return E.prog;
    const h = header(E.NG, E.TX, E.NP), pr = {};
    for (const k of Object.keys(FS)) pr[k] = compile(QUAD_VS, h + FS[k]);
    pr.deposit = compile(h + VS.deposit, h + DEPOSIT_FS);
    pr.gasDeposit = compile(h + VS.gasDeposit, h + GAS_DEPOSIT_FS);
    pr.ic = compile(h + VS.ic, NULL_FS, ['oPos', 'oMom', 'oAux']);
    pr.update = compile(h + GAS_GLSL + VS.update, NULL_FS, ['oPos', 'oMom', 'oAux']);
    const attr = (buf, loc, size) => { if (loc < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
    const vao = (prog, k) => { const v = gl.createVertexArray(); gl.bindVertexArray(v);
      attr(E.pos[k], prog.a('aPos'), 3); attr(E.mom[k], prog.a('aMom'), 3); attr(E.aux[k], prog.a('aAux'), 4); attr(E.species, prog.a('aSpecies'), 1); return v; };
    pr.depVao = [0, 1].map(k => vao(pr.deposit, k));
    pr.gasVao = [0, 1].map(k => vao(pr.gasDeposit, k));
    pr.updVao = [0, 1].map(k => vao(pr.update, k));
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return (E.prog = pr);
  }

  // ---- passes ----
  function pass(prog, target, setup){
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.f); gl.viewport(0, 0, target.w, target.h);
    let unit = 0;
    const bind = (name, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.uniform1i(prog.u[name], unit); unit++; };
    setup && setup(bind, prog.u);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // complex data lives in cplx[E.c]
  E.c = 0;
  function fftPasses(q, sign){
    const pr = programs();
    for (let axis = 0; axis < 3; axis++) for (let Ns = 1; Ns < E.NG; Ns *= 2) q.push(() => {
      const src = E.cplx[E.c], dst = E.cplx[1 - E.c];
      pass(pr.fft, dst, (bind, u) => { bind('uSrc', src); gl.uniform1i(u.uAxis, axis); gl.uniform1i(u.uNs, Ns); gl.uniform1f(u.uSign, sign); });
      E.c = 1 - E.c;
    });
    return q;
  }
  const run = q => q.forEach(f => f());
  function cplxPass(prog, setup){
    const src = E.cplx[E.c], dst = E.cplx[1 - E.c];
    pass(prog, dst, (bind, u) => { bind('uSrc', src); setup && setup(bind, u); });
    E.c = 1 - E.c;
  }

  const fb = Cosmo.P.Ob / Cosmo.P.Om;
  E.massDM = 2 * (1 - fb); E.massGas = 2 * fb;   // mean particle mass = 1
  function deposit(){
    const pr = programs();
    gl.bindFramebuffer(gl.FRAMEBUFFER, E.rho.f); gl.viewport(0, 0, E.W, E.H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD);
    gl.useProgram(pr.deposit.p);
    gl.uniform2f(pr.deposit.u.uMass, E.massDM, E.massGas);
    gl.bindVertexArray(pr.depVao[E.cur]);
    gl.drawArraysInstanced(gl.POINTS, 0, E.N, 8);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
  function gasDeposit(a){
    const pr = programs();
    gl.bindFramebuffer(gl.FRAMEBUFFER, E.gasFbo); gl.viewport(0, 0, E.W, E.H);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD);
    gl.useProgram(pr.gasDeposit.p);
    gl.uniform1f(pr.gasDeposit.u.uMassG, E.massGas); gl.uniform1f(pr.gasDeposit.u.uA, a);
    gl.bindVertexArray(pr.gasVao[E.cur]);
    gl.drawArraysInstanced(gl.POINTS, E.NDM, E.NDM, 8);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // smoothed copy of the density (two rounds of [1,2,1] per axis), used for coloring and star formation
  function smoothPasses(){
    const pr = programs(), q = [];
    for (let r = 0; r < 2; r++) for (let axis = 0; axis < 3; axis++){
      const first = r === 0 && axis === 0, odd = (r * 3 + axis) % 2 === 0;
      q.push(() => pass(pr.blur, odd ? E.rhoT : E.rhoS, (bind, u) => { bind('uSrc', first ? E.rho : odd ? E.rhoS : E.rhoT); gl.uniform1i(u.uAxis, axis); }));
    }
    return q; // six passes, ending in rhoS
  }

  function transform(prog, vao, dstIdx, setup){
    // a buffer being written by transform feedback may not be bound anywhere else, and the
    // textures read here must not be attached to the current framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(prog.p);
    let unit = 0;
    const bind = (name, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.uniform1i(prog.u[name], unit); unit++; };
    setup(bind, prog.u);
    gl.bindVertexArray(vao);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, E.pos[dstIdx]);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, E.mom[dstIdx]);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, E.aux[dstIdx]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, E.N);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    for (let i = 0; i < 3; i++) gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
  }

  // amplitude lookup: sqrt(P(k) N³ / V), zero above the particle Nyquist frequency
  function ampLut(){
    const n = 4096, nmax = Math.sqrt(3) * E.NG / 2 + 2, L = Cosmo.P.boxMpc, N3 = E.NG ** 3, kCut = Math.min(E.NG, E.NP) / 2;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++){
      const nm = i / (n - 1) * nmax;
      d[i] = nm === 0 || nm > kCut ? 0 : Math.sqrt(Cosmo.power(2 * Math.PI * nm / L) * N3 / (L * L * L));
    }
    if (E.lut) freeTex(E.lut);
    E.lut = tex2D(n, 1, gl.R32F, gl.RED, gl.FLOAT, d);
    return (n - 1) / nmax;
  }

  // ---- coarse readback (async through a pixel-pack buffer) ----
  const coarseBuf = new Float32Array(NC * 8 * NC * 8 * 4), coarse = new Float32Array(NC ** 3);
  E.NC = NC;
  const pbo = gl.createBuffer(); let fence = null, fenceTag = null;
  function reduceAndRead(tag){
    const pr = programs();
    pass(pr.reduce, E.coarse, (bind) => { bind('uRho', E.rho); bind('uGB', E.gB); });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, coarseBuf.byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, NC * 8, NC * 8, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); fenceTag = tag;
    gl.flush();
  }
  // outside a step: redo the deposits for the current positions, then read
  E.requestCoarse = (a) => {
    if (fence || E.busy) return false;
    deposit(); run(smoothPasses()); gasDeposit(a);
    reduceAndRead(a);
    return true;
  };
  // returns { mass, stars, hot5, hot7, a } once ready, else null
  E.pollCoarse = () => {
    if (!fence) return null;
    if (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) return null;
    gl.deleteSync(fence); fence = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, coarseBuf); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let stars = 0, hot5 = 0, hot7 = 0;
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) for (let y = 0; y < NC; y++) for (let x = 0; x < NC; x++){
      const z = tx + 8 * ty, j = 4 * (x + NC * tx + NC * 8 * (y + NC * ty));
      coarse[x + NC * (y + NC * z)] = coarseBuf[j];
      stars += coarseBuf[j + 1]; hot5 += coarseBuf[j + 2]; hot7 += coarseBuf[j + 3];
    }
    const gasTotal = E.NDM * E.massGas; // all ordinary matter, in deposit units
    return { mass: coarse, stars: stars / gasTotal, hot5: hot5 / gasTotal, hot7: hot7 / gasTotal, a: fenceTag };
  };
  E.cancelCoarse = () => { if (fence){ gl.deleteSync(fence); fence = null; } };

  // ---- public ----
  // cfg: { NP, NG, seed, A (growth at start), vfac, T0 (starting gas temperature), gas: { eps, K, Cq, Tsf, Sdiff } }
  E.init = (cfg) => {
    setupGrid(cfg.NG); setupParticles(cfg.NP);
    E.cancelCoarse(); E.busy = false;
    const pr = programs();
    const lutScale = ampLut();
    for (let comp = 0; comp < 3; comp++){
      E.c = 0;
      pass(pr.noise, E.cplx[0], (bind, u) => gl.uniform1ui(u.uSeed, cfg.seed >>> 0));
      run(fftPasses([], -1));
      cplxPass(pr.disp, (bind, u) => { bind('uLut', E.lut); gl.uniform1i(u.uComp, comp); gl.uniform1f(u.uLutScale, lutScale); });
      run(fftPasses([], 1));
      gl.colorMask(comp === 0, comp === 1, comp === 2, false);
      pass(pr.copyReal, E.grad, (bind, u) => { bind('uSrc', E.cplx[E.c]); gl.uniform1f(u.uScale, 1 / E.NG ** 3); });
      gl.colorMask(true, true, true, true);
    }
    E.cur = 0;
    transform(pr.ic, emptyVao, 0, (bind, u) => { bind('uPsi', E.grad); gl.uniform1f(u.uA, cfg.A); gl.uniform1f(u.uVfac, cfg.vfac); gl.uniform1f(u.uT0, cfg.T0); });
    deposit(); run(smoothPasses());
    E.gas = cfg.gas;
  };

  // One step as a list of GPU passes; the caller may spread them over frames. Positions change only in the last one.
  // s: { kick, drift, kickH, dt, a, H, Tf, dtGyr, D }
  E.stepPasses = (s) => {
    const pr = programs(), q = [], G = E.gas, mfac = E.NG ** 3 / E.N;
    q.push(deposit);
    q.push(...smoothPasses());
    q.push(() => { E.c = 0; pass(pr.pack, E.cplx[0], (bind, u) => { bind('uRho', E.rho); gl.uniform1f(u.uMfac, mfac); }); });
    fftPasses(q, -1);
    q.push(() => cplxPass(pr.green));
    fftPasses(q, 1);
    q.push(() => pass(pr.grad, E.grad, (bind, u) => { bind('uSrc', E.cplx[E.c]); gl.uniform1f(u.uScale, 1 / E.NG ** 3); }));
    q.push(() => gasDeposit(s.a));
    q.push(() => { if (!fence) reduceAndRead(s.a); });
    q.push(() => pass(pr.gasCell, E.hA, (bind, u) => { bind('uGA', E.gA); bind('uGB', E.gB); gl.uniform1f(u.uMfac, mfac); gl.uniform1f(u.uKT, G.KT); }));
    // the gravity FFT is finished, so a complex texture can hold (divergence, viscosity)
    q.push(() => pass(pr.gasDiv, E.cplx[0], (bind, u) => { bind('uHA', E.hA); bind('uGA', E.gA); gl.uniform1f(u.uA, s.a); gl.uniform1f(u.uH, s.H); gl.uniform1f(u.uCq, G.Cq); gl.uniform1f(u.uMfac, mfac); }));
    q.push(() => { pass(pr.gasForce, E.gB, (bind, u) => { bind('uHA', E.hA); bind('uDQ', E.cplx[0]); bind('uGA', E.gA); gl.uniform1f(u.uMfac, mfac); gl.uniform1f(u.uFloor, 0.1 * fb); }); E.busy = true; });
    q.push(() => {
      transform(pr.update, pr.updVao[E.cur], 1 - E.cur, (bind, u) => {
        bind('uG', E.grad); bind('uHF', E.gB); bind('uHA', E.hA); bind('uGA', E.gA); bind('uRhoS', E.rhoS);
        const f1 = (n, v) => gl.uniform1f(u[n], v);
        f1('uKick', s.kick); f1('uDrift', s.drift); f1('uKickH', s.kickH); f1('uDt', s.dt); f1('uA', s.a); f1('uTf', s.Tf); f1('uDtGyr', s.dtGyr); f1('uD', s.D);
        f1('uSdiff', G.Sdiff); f1('uEps', G.eps); f1('uK', G.K); f1('uCq', G.Cq); f1('uKT', G.KT); f1('uMfac', mfac); f1('uFb', fb); f1('uCool', G.cool); f1('uTsf', G.Tsf);
      });
      E.cur = 1 - E.cur; E.busy = false;
    });
    return q;
  };
  E.step = (s) => run(E.stepPasses(s));

  E.header = () => header(E.NG, E.TX, E.NP);
  E.mfac = () => E.NG ** 3 / E.N;
  E.readParticles = () => {
    const p = new Float32Array(3 * E.N), m = new Float32Array(3 * E.N), x = new Float32Array(4 * E.N);
    gl.bindBuffer(gl.ARRAY_BUFFER, E.pos[E.cur]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, p);
    gl.bindBuffer(gl.ARRAY_BUFFER, E.mom[E.cur]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, m);
    gl.bindBuffer(gl.ARRAY_BUFFER, E.aux[E.cur]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, x);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return { p, m, x };
  };
  E.ext = ext;
  return E;
};
