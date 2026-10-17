// Draws the live wavefunction: brightness from |ψ|² on a log scale, hue from the phase (shown in a
// frame rotating with the electron's mean energy, so wavefronts hold still instead of strobing),
// walls as dark metal and lower barriers as translucent amber.
const WaveView = (gl) => {
  const VS = `#version 300 es
  out vec2 vUv;
  void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const FS = `#version 300 es
  precision highp float; precision highp sampler2D;
  in vec2 vUv; out vec4 o;
  uniform sampler2D uPsi, uPot;
  uniform vec4 uCrop;        // visible box region in grid uv: x0, y0, x1, y1
  uniform float uN, uRot, uLo, uSpan, uWallV;
  uniform vec2 uRes;
  uniform vec4 uSlits;       // y of the two slits and the wall x (uv), and the box size L (bohr)
  uniform float uFlash;
  vec2 fetchPsi(vec2 uv){
    // manual bilinear filtering (RG32F is not filterable everywhere)
    vec2 g = uv * uN - 0.5; vec2 f = fract(g); ivec2 i = ivec2(floor(g));
    vec2 a = texelFetch(uPsi, clamp(i, ivec2(0), ivec2(int(uN) - 1)), 0).xy;
    vec2 b = texelFetch(uPsi, clamp(i + ivec2(1, 0), ivec2(0), ivec2(int(uN) - 1)), 0).xy;
    vec2 c = texelFetch(uPsi, clamp(i + ivec2(0, 1), ivec2(0), ivec2(int(uN) - 1)), 0).xy;
    vec2 d = texelFetch(uPsi, clamp(i + ivec2(1, 1), ivec2(0), ivec2(int(uN) - 1)), 0).xy;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  vec3 hue(float t){
    // smooth cyclic palette: gold → rose → violet → sky → teal → gold
    vec3 c0 = vec3(1.00, 0.76, 0.42), c1 = vec3(1.00, 0.45, 0.55), c2 = vec3(0.62, 0.50, 1.00), c3 = vec3(0.45, 0.78, 1.00), c4 = vec3(0.40, 0.95, 0.78);
    t = fract(t) * 5.0; int k = int(t); float f = smoothstep(0.0, 1.0, fract(t));
    vec3 a = k == 0 ? c0 : k == 1 ? c1 : k == 2 ? c2 : k == 3 ? c3 : c4;
    vec3 b = k == 0 ? c1 : k == 1 ? c2 : k == 2 ? c3 : k == 3 ? c4 : c0;
    return mix(a, b, f);
  }
  void main(){
    vec2 uv = mix(uCrop.xy, uCrop.zw, vUv);
    vec2 p = fetchPsi(uv);
    float q = dot(p, p);
    float b = clamp((log(q + 1e-30) * 0.4342945 - uLo) / uSpan, 0.0, 1.0);
    float ph = atan(p.y, p.x) + uRot;
    // crests gold, troughs blue, the zero-crossings a dimmer violet between them
    float cr = 0.5 + 0.5 * cos(ph);
    vec3 tint = mix(vec3(0.30, 0.55, 1.00), vec3(1.00, 0.78, 0.42), smoothstep(0.0, 1.0, cr)) * (0.55 + 0.45 * abs(cos(ph)));
    vec3 col = tint * pow(b, 1.5) * 1.25;
    // potential
    vec4 pv = texelFetch(uPot, ivec2(uv * uN), 0);
    if (pv.w > 0.0){
      float v = pv.x / uWallV;
      vec3 metal = vec3(0.30, 0.31, 0.34) + 0.05 * sin(uv.y * 900.0);
      vec3 amber = vec3(1.0, 0.62, 0.25);
      col = pv.w > 0.75 ? metal : mix(col, amber, 0.35 + 0.25 * clamp(v, 0.0, 1.0));
    }
    // a faint grid every nanometre (18.897 bohr) over the vacuum
    vec2 per = vec2(18.897 / uSlits.w), dpx = (uCrop.zw - uCrop.xy) / uRes;
    vec2 dl = abs(fract(uv / per + 0.5) - 0.5) * per / dpx;
    col += vec3(0.022, 0.026, 0.034) * (1.0 - smoothstep(0.0, 1.0, min(dl.x, dl.y)));
    // which-path detectors: a glow at the slit mouths when a measurement fires
    if (uFlash > 0.0){
      for (int s = 0; s < 2; s++){
        vec2 c = vec2(uSlits.z, s == 0 ? uSlits.x : uSlits.y);
        vec2 dd = (uv - c) * vec2(1.0, 1.0) * 60.0;
        col += vec3(0.6, 0.9, 1.0) * uFlash * exp(-dot(dd, dd) * 2.0);
      }
    }
    o = vec4(col, 1.0);
  }`;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
  const u = {}; for (const n of ['uPsi', 'uPot', 'uCrop', 'uN', 'uRot', 'uLo', 'uSpan', 'uWallV', 'uRes', 'uSlits', 'uFlash']) u[n] = gl.getUniformLocation(p, n);
  const vao = gl.createVertexArray();
  return {
    // o: { engine, crop:[x0,y0,x1,y1] uv, rot, lo, span, wallV, slits:[y0,y1,xw], flash, vp:[x,y,w,h] }
    draw(o){
      const E = o.engine;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(...o.vp);
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, E.psiTex()); gl.uniform1i(u.uPsi, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, E.pot.t); gl.uniform1i(u.uPot, 1);
      gl.uniform4f(u.uCrop, ...o.crop); gl.uniform1f(u.uN, E.N); gl.uniform1f(u.uRot, o.rot);
      gl.uniform1f(u.uLo, o.lo); gl.uniform1f(u.uSpan, o.span); gl.uniform1f(u.uWallV, o.wallV);
      gl.uniform2f(u.uRes, o.vp[2], o.vp[3]);
      gl.uniform4f(u.uSlits, ...(o.slits || [0, 0, 0]), o.L);
      gl.uniform1f(u.uFlash, o.flash || 0);
      gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
};
if (typeof module !== 'undefined') module.exports = WaveView;
