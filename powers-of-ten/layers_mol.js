// Powers of Ten: molecules (1 µm -> 10 fm). The red cell's membrane (bilayer, band 3, spectrin skeleton at the
// measured densities), the haemoglobin crowd inside the cell (PDB 2DN1 packed at 33 g/dL), water at body
// temperature (TIP4P/2005 molecular dynamics), one water molecule's electron cloud (CCSD quantum chemistry), and
// the proton at the heart of one of its hydrogen atoms.
(function (root) {
  const S = root.PTEN, Z = root.PTEN_ZOOM, RD = root.PTEN_RENDER, band = (...a) => root.PTEN_LAYERS.band(...a), smooth = Z.smooth;
  const m3 = m => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  async function inflate(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // ---- sphere impostors: camera-facing quads, exact ray-sphere hit, log depth ----
  // Sphere data comes from a 'fetch' snippet that fills c (frame metres), r (metres), col for instance id.
  function sphereProgram(R, fetch, extraVS = '') {
    return R.program(`
      ${extraVS}
      uniform float uCut;
      out vec3 vC, vQ, vCol; out float vR;
      const vec2 Q[4] = vec2[4](vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(1, 1));
      void main() {
        vec3 c; float r; vec3 col; bool ok = true;
        ${fetch}
        if (!ok) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 sc_c = toCam(c); float rc = r * uScale;
        vec3 sc_q = sc_c + vec3(Q[gl_VertexID] * rc * 1.3, 0.0);
        gl_Position = uProj * vec4(sc_q, 1.0);
        // cutaway: nothing between the eye and the near side of what we look at
        if (-sc_c.z < rc * 0.5 || length(sc_c) < uCut) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vC = sc_c; vQ = sc_q; vR = rc; vCol = col * (uCut > 0.0 ? smoothstep(uCut, uCut * 1.25, length(sc_c)) * 0.6 + 0.4 : 1.0);
      }`, RD.LOGDEPTH + `
      uniform float uA, uFog; uniform vec3 uLight; in vec3 vC, vQ, vCol; in float vR; out vec4 o;
      void main() {
        vec3 d = normalize(vQ); float b = dot(d, vC), cc = dot(vC, vC) - vR * vR, disc = b * b - cc;
        if (disc < 0.0) discard;
        float t = b - sqrt(disc); vec3 h = d * t, n = (h - vC) / vR;
        float l = max(dot(n, uLight), 0.0), rim = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
        vec3 col = vCol * (0.28 + 0.85 * l) + vec3(0.5) * pow(max(dot(reflect(-uLight, n), -d), 0.0), 24.0) * 0.35 + vCol * rim * 0.25;
        float fog = uFog > 0.0 ? exp(-max(-h.z - 1.0, 0.0) * uFog) : 1.0;
        o = vec4(col * uA * fog, uA);
        gl_FragDepth = logDepth(-h.z);
      }`);
  }
  function drawSpheres(R, prog, cam, frame, a, n, setU, fog = 0, cut = 0) {
    const gl = R.gl, pl = Z.place(cam, frame, [0, 0, 0]);
    gl.useProgram(prog.p); RD.setPlace(R, prog, pl, a);
    gl.uniformMatrix4fv(prog.u.uProj, false, R.proj(1e-6, 1e7));
    gl.uniform1f(prog.u.uA, a); gl.uniform1f(prog.u.uFog, fog); gl.uniform1f(prog.u.uCut, cut);
    const L = [0.35, 0.55, 0.76]; gl.uniform3f(prog.u.uLight, ...L);
    if (setU) setU(prog, pl);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.DEPTH_TEST);
  }
  // float texture from an array of vec4s
  function tex4(gl, data, w) {
    const h = Math.ceil(data.length / 4 / w), buf = new Float32Array(4 * w * h); buf.set(data);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, buf);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    return t;
  }

  function build(R) {
    const gl = R.gl, layers = [];

    // ================= the membrane (frame 'mem': z out of the cell, the outer surface at z = 0) =================
    {
      const RAD = 1.6e-6;                                     // patch radius
      // band 3: 8,600 per µm² (1.2 million per cell), dimers ~8 nm across the 4.5 nm bilayer, cytoplasmic domain inside
      const nB = Math.round(8600e12 * Math.PI * RAD * RAD), b3 = new Float32Array(4 * nB * 2);
      for (let i = 0; i < nB; i++) {
        const rr = RAD * Math.sqrt(rnd()), th = 6.2832 * rnd(), x = rr * Math.cos(th), y = rr * Math.sin(th);
        b3.set([x, y, -2.2e-9, 3.6e-9], 8 * i); b3.set([x + 1.5e-9 * (rnd() - 0.5), y + 1.5e-9 * (rnd() - 0.5), -8.0e-9, 3.0e-9], 8 * i + 4);
      }
      // spectrin skeleton: junctions on a jittered triangular lattice (64 nm), each joined to its neighbours by a
      // tetramer folded to the junction spacing (native contour ~46-80 nm between junctions), 12-18 nm under the bilayer
      const SP = 64e-9, junc = [], idxOf = new Map();
      const NJ = Math.ceil(RAD / SP) + 1;
      for (let j = -NJ; j <= NJ; j++) for (let i = -NJ; i <= NJ; i++) {
        const x = (i + 0.5 * (j & 1)) * SP + (rnd() - 0.5) * 0.35 * SP, y = j * SP * 0.866 + (rnd() - 0.5) * 0.35 * SP;
        if (x * x + y * y < (RAD + SP) ** 2) { idxOf.set(i + ',' + j, junc.length); junc.push([x, y, -14e-9 - 4e-9 * rnd()]); }
      }
      const beads = [];
      for (let j = -NJ; j <= NJ; j++) for (let i = -NJ; i <= NJ; i++) {
        const a = idxOf.get(i + ',' + j); if (a === undefined) continue;
        const nb = [[i + 1, j], [i + (j & 1), j + 1], [i - 1 + (j & 1), j + 1]];
        for (const [ii, jj] of nb) {
          const b = idxOf.get(ii + ',' + jj); if (b === undefined || rnd() < 0.05) continue;   // a few missing links (pentagons, heptagons)
          const A = junc[a], B = junc[b], len = Math.hypot(B[0] - A[0], B[1] - A[1]), nseg = Math.ceil(len / 4.5e-9);
          const ph = 6.28 * rnd(), amp = 6e-9 + 4e-9 * rnd(), per = 1 + Math.floor(3 * rnd());
          const nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len;
          for (let k = 1; k < nseg; k++) {
            const t = k / nseg, wv = Math.sin(t * Math.PI * per + ph) * Math.sin(t * Math.PI) * amp;
            beads.push(A[0] + (B[0] - A[0]) * t + nx * wv, A[1] + (B[1] - A[1]) * t + ny * wv, A[2] + (B[2] - A[2]) * t + 3e-9 * Math.sin(t * 9 + ph), 2.6e-9);
          }
        }
        beads.push(...junc[a], 0);                // junction marker (radius 0 = drawn as an actin knob below)
      }
      const spec = new Float32Array(beads); for (let i = 3; i < spec.length; i += 4) if (spec[i] === 0) spec[i] = -1;
      const W = 1024, b3Tex = tex4(gl, b3, W), spTex = tex4(gl, spec, W);
      const nSpec = spec.length / 4;
      const memProg = sphereProgram(R, `
        int id = gl_InstanceID; vec4 s = texelFetch(uData, ivec2(id % 1024, id / 1024), 0);
        c = s.xyz; r = abs(s.w);
        col = uKind == 0 ? (id % 2 == 0 ? vec3(0.55, 0.62, 0.85) : vec3(0.45, 0.52, 0.8)) : s.w < 0.0 ? vec3(0.95, 0.55, 0.3) : vec3(0.45, 0.78, 0.55);
        if (s.w < 0.0) r = 5.5e-9;
        ok = length(c.xy - uFocus.xy) < uFocus.z;`, `uniform highp sampler2D uData; uniform int uKind; uniform vec3 uFocus;`);
      // the bilayer: a translucent sheet with a fine headgroup grain
      const sheet = R.program(`
        in vec2 aQ; uniform float uZ, uRad; out vec2 vP; out float vW;
        void main() { vec3 p = vec3(aQ * uRad, uZ); vec3 c = toCam(p); gl_Position = uProj * vec4(c, 1.0); vW = -c.z; vP = p.xy; }`, RD.LOGDEPTH + `
        uniform float uA, uOp, uRad; in vec2 vP; in float vW; out vec4 o;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          if (length(vP) > uRad) discard;
          vec2 g = vP / 0.8e-9; float grain = hash(floor(g));
          float edge = smoothstep(uRad, uRad * 0.8, length(vP));
          float al = uOp * uA * edge * (0.85 + 0.3 * grain);
          o = vec4(vec3(0.93, 0.83, 0.62) * al, al); gl_FragDepth = logDepth(vW);
        }`);
      const quad = R.vao(sheet, { aQ: [new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2] });
      const M = { name: 'membrane', frame: 'mem', opaque: true };
      M.alpha = Lv => band(Lv, -7.0, -5.75, 0.35, 0.3);
      M.draw = (cam, a) => {
        const w = cam.w, focus = [0, 0, Math.min(RAD, 3.2 * w)];
        const kB = Math.min(nB, Math.ceil(nB * (focus[2] / RAD) ** 2 * 1.3));
        const setU = (kind, tex) => (prog) => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u.uData, 0); gl.uniform1i(prog.u.uKind, kind); gl.uniform3f(prog.u.uFocus, ...focus); };
        drawSpheres(R, memProg, cam, 'mem', a, nB * 2, setU(0, b3Tex));
        drawSpheres(R, memProg, cam, 'mem', a * smooth((-6.0 - cam.L) / 0.3), nSpec, setU(1, spTex));
        // bilayer sheets (outer and inner leaflets) on top, translucent
        const pl = Z.place(cam, 'mem', [0, 0, 0]);
        gl.useProgram(sheet.p); RD.setPlace(R, sheet, pl, a);
        gl.uniformMatrix4fv(sheet.u.uProj, false, R.proj(1e-6, 1e7)); gl.uniform1f(sheet.u.uRad, RAD); gl.uniform1f(sheet.u.uA, a);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(quad.v);
        for (const z of [0, -4.5e-9]) { gl.uniform1f(sheet.u.uZ, z); gl.uniform1f(sheet.u.uOp, 0.32 * smooth((cam.L + 7.0) / 0.5)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
        gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
      };
      M.labels = cam => [
        { t: 'band 3 proteins: ~8,600 per µm²', frame: 'mem', p: [120e-9, -60e-9, 0], cls: 'minor', a: band(cam.L, -6.9, -6.2, 0.2, 0.2) },
        { t: 'spectrin skeleton (64 nm mesh)', frame: 'mem', p: [-100e-9, 90e-9, -16e-9], cls: 'minor', a: band(cam.L, -6.9, -6.3, 0.2, 0.2) },
      ];
      layers.push(M);
    }

    // ================= haemoglobin (frame 'hb': the water pocket at the origin) =================
    const HB = root.PTEN_HB;
    if (HB) {
      const H = { name: 'hb', frame: 'hb', opaque: true }; let ready = false, tplTex, molTex, nAt = HB.nAtoms, nMol = HB.n;
      const Lb = HB.box * 1e-10, tgt = HB.target.map(v => v * 1e-10);
      (async () => {
        const tpl = new Int16Array(await inflate(HB.tpl)), el = new Uint8Array(await inflate(HB.el)), mols = new Float32Array(await inflate(HB.mols));
        const t = new Float32Array(4 * nAt); for (let i = 0; i < nAt; i++) t.set([tpl[3 * i] * 1e-11, tpl[3 * i + 1] * 1e-11, tpl[3 * i + 2] * 1e-11, el[i]], 4 * i);
        tplTex = tex4(gl, t, 1024);
        // molecules: centre relative to the pocket (m, wrapped into the box around it) + quaternion
        const mm = new Float32Array(8 * nMol);
        for (let i = 0; i < nMol; i++) {
          const c = [0, 1, 2].map(k => { let v = mols[7 * i + k] * 1e-10 - tgt[k]; return v - Lb * Math.round(v / Lb); });
          mm.set([...c, 0, ...mols.slice(7 * i + 3, 7 * i + 7)], 8 * i);
        }
        molTex = tex4(gl, mm, 1024);
        H.mols = mm; ready = true;
      })();
      // whole molecules as single soft spheres (seen from afar), tiled periodically, only inside the cell (z < -12 nm in 'mem')
      const blobProg = sphereProgram(R, `
        int inst = gl_InstanceID, m = inst % uN, tile = inst / uN;
        vec4 a = texelFetch(uMol, ivec2((2 * m) % 1024, (2 * m) / 1024), 0);
        ivec3 tc = ivec3(tile % uT, (tile / uT) % uT, tile / (uT * uT)) - ivec3(uT / 2);
        c = a.xyz + vec3(tc) * uBox + uTileOff;
        r = 3.0e-9; col = vec3(0.78, 0.2, 0.22);
        vec3 inMem = uHbToMem * c + uHbOrg;
        ok = inMem.z < -12e-9 && length(c - uCenter) < uRadius;`, `uniform highp sampler2D uMol; uniform int uN, uT; uniform float uBox, uRadius; uniform vec3 uTileOff, uCenter, uHbOrg; uniform mat3 uHbToMem;`);
      // atoms: instance = (molecule, atom); CPK-ish colours (C grey, N blue, O red, S yellow, Fe orange)
      const atomProg = sphereProgram(R, `
        int inst = gl_InstanceID, m = uMolList[inst / uNA], at = inst % uNA;
        vec4 ta = texelFetch(uTpl, ivec2(at % 1024, at / 1024), 0);
        vec4 a = texelFetch(uMol, ivec2((2 * m) % 1024, (2 * m) / 1024), 0), q = texelFetch(uMol, ivec2((2 * m + 1) % 1024, (2 * m + 1) / 1024), 0);
        vec3 p = ta.xyz, u = q.xyz; float w = q.w;
        vec3 rp = p + 2.0 * cross(u, cross(u, p) + w * p);
        c = a.xyz + rp + uMolShift[inst / uNA];
        int e = int(ta.w + 0.5);
        r = e == 0 ? 1.7e-10 : e == 1 ? 1.55e-10 : e == 2 ? 1.52e-10 : e == 3 ? 1.8e-10 : 1.94e-10;
        col = e == 0 ? vec3(0.62, 0.62, 0.6) : e == 1 ? vec3(0.35, 0.45, 0.95) : e == 2 ? vec3(0.92, 0.25, 0.22) : e == 3 ? vec3(0.95, 0.85, 0.3) : vec3(1.0, 0.55, 0.15);
        vec3 inMem = uHbToMem * c + uHbOrg;
        ok = inMem.z < -12e-9;`, `uniform highp sampler2D uTpl, uMol; uniform int uNA; uniform int uMolList[64]; uniform vec3 uMolShift[64]; uniform vec3 uHbOrg; uniform mat3 uHbToMem;`);
      H.alpha = Lv => band(Lv, -9.0, -6.15, 0.45, 0.35);
      H.draw = (cam, a) => {
        if (!ready) return;
        // hb frame -> mem frame (to keep molecules inside the cell)
        const hbN = S.nodes.hb, toMem = hbN.rot, org = hbN.pos;
        const look = S.rel([0, 0, 0], 'hb', cam.pos, cam.frame, 'hb');
        const w = cam.w, radius = Math.min(2.5 * w, 0.3e-6);
        const blobA = a * smooth((cam.L + 7.65) / 0.35) * smooth((-6.25 - cam.L) / 0.3);
        if (blobA > 0.003) {
          const T = Math.min(33, 2 * Math.ceil(radius / Lb) + 1), off = [0, 1, 2].map(k => Math.round(look[k] / Lb) * Lb);
          drawSpheres(R, blobProg, cam, 'hb', blobA, nMol * T * T * T, (prog) => {
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, molTex); gl.uniform1i(prog.u.uMol, 0);
            gl.uniform1i(prog.u.uN, nMol); gl.uniform1i(prog.u.uT, T); gl.uniform1f(prog.u.uBox, Lb); gl.uniform1f(prog.u.uRadius, radius);
            gl.uniform3f(prog.u.uTileOff, ...off); gl.uniform3f(prog.u.uCenter, ...look);
            gl.uniformMatrix3fv(prog.u.uHbToMem, false, m3(toMem)); gl.uniform3f(prog.u.uHbOrg, ...org);
          }, 0, R.EYE * 0.62);
        }
        const atomA = a * smooth((-7.35 - cam.L) / 0.35);
        if (atomA > 0.003) {
          // molecules whose centre lies within reach of the view (nearest periodic image), at most 64
          const R2 = Math.min(3.2 * w + 4e-9, 30e-9), list = [];
          for (let i = 0; i < nMol; i++) {
            const c = [0, 1, 2].map(k => H.mols[8 * i + k]);
            const sh = [0, 1, 2].map(k => -Lb * Math.round((c[k] - look[k]) / Lb));
            const d = Math.hypot(...c.map((v, k) => v + sh[k] - look[k]));
            if (d < R2 + 3.5e-9) list.push([d, i, sh]);
          }
          list.sort((x, y) => x[0] - y[0]); const L2 = list.slice(0, 64);
          drawSpheres(R, atomProg, cam, 'hb', atomA, L2.length * nAt, (prog) => {
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tplTex); gl.uniform1i(prog.u.uTpl, 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, molTex); gl.uniform1i(prog.u.uMol, 1);
            gl.uniform1i(prog.u.uNA, nAt);
            gl.uniform1iv(prog.u.uMolList, new Int32Array(64).map((_, k) => L2[k] ? L2[k][1] : 0));
            const shf = new Float32Array(192); L2.forEach((e, k) => shf.set(e[2], 3 * k)); gl.uniform3fv(prog.u.uMolShift, shf);
            gl.uniformMatrix3fv(prog.u.uHbToMem, false, m3(toMem)); gl.uniform3f(prog.u.uHbOrg, ...org);
          }, 0, R.EYE * 0.62);
        }
      };
      H.labels = cam => [];
      layers.push(H);
    }
    // ================= water at 310 K (TIP4P/2005), tiled around the pocket, kept out of the protein =================
    const WD = root.PTEN_WATER, Inner = root.PTEN_INNER;
    if (WD && HB) {
      const N = WD.N, F = WD.F, LB = WD.box[0] * 1e-10, every = WD.every_fs * 1e-15;
      let com = null, quat = null, list = null, nList = 0, listTex = null, stTex = null, follow = -1;
      const st = new Float32Array(8 * N);
      // body-frame sites (m): O, H1, H2 (TIP4P/2005 geometry, origin at the centre of mass)
      const hx = 0.9572 * Math.sin(104.52 / 2 * Math.PI / 180), hz = 0.9572 * Math.cos(104.52 / 2 * Math.PI / 180), zc = 2 * 1.008 * hz / 18.0154;
      const SITE = [[0, 0, -zc], [hx, 0, hz - zc], [-hx, 0, hz - zc]].map(p => p.map(v => v * 1e-10));
      (async () => {
        const raw = new Uint8Array(await inflate(WD.b64));
        com = new Float32Array(F * N * 3); quat = new Float32Array(F * N * 4);
        const f0 = new Int16Array(raw.buffer, 0, 7 * N); let o = f0.byteLength;
        const c = new Float64Array(3 * N), q = new Float64Array(4 * N);
        for (let i = 0; i < N; i++) { for (let k = 0; k < 3; k++) c[3 * i + k] = f0[7 * i + k] / 1000; for (let k = 0; k < 4; k++) q[4 * i + k] = f0[7 * i + 3 + k] / 32767; }
        for (let f = 0; f < F; f++) {
          if (f > 0) { const d = new Int8Array(raw.buffer, o, 7 * N); o += 7 * N; for (let i = 0; i < N; i++) { for (let k = 0; k < 3; k++) c[3 * i + k] += 0.002 * d[7 * i + k]; for (let k = 0; k < 4; k++) q[4 * i + k] += 0.0025 * d[7 * i + 3 + k]; } }
          for (let i = 0; i < N; i++) { const l = Math.hypot(q[4 * i], q[4 * i + 1], q[4 * i + 2], q[4 * i + 3]); for (let k = 0; k < 3; k++) com[(f * N + i) * 3 + k] = c[3 * i + k]; for (let k = 0; k < 4; k++) quat[(f * N + i) * 4 + k] = q[4 * i + k] / l; }
        }
        // which (tile, molecule) copies to show: within 3.2 nm of the pocket and not inside a protein (O farther than
        // 2.9 Å from every protein atom, checked at the first frame)
        const hb = HB, Lh = hb.box * 1e-10, tgt = hb.target.map(v => v * 1e-10);
        const tpl = new Int16Array(await inflate(hb.tpl)), mols = new Float32Array(await inflate(hb.mols)), atomsNear = [];
        for (let m = 0; m < hb.n; m++) {
          const cm = [0, 1, 2].map(k => { let v = mols[7 * m + k] * 1e-10 - tgt[k]; return v - Lh * Math.round(v / Lh); });
          if (Math.hypot(...cm) > 7.5e-9) continue;
          const [x, y, z, w] = mols.slice(7 * m + 3, 7 * m + 7);
          for (let a = 0; a < hb.nAtoms; a++) {
            const p = [tpl[3 * a] * 1e-11, tpl[3 * a + 1] * 1e-11, tpl[3 * a + 2] * 1e-11];
            const t = [2 * (y * p[2] - z * p[1]), 2 * (z * p[0] - x * p[2]), 2 * (x * p[1] - y * p[0])];
            atomsNear.push(cm[0] + p[0] + w * t[0] + (y * t[2] - z * t[1]), cm[1] + p[1] + w * t[1] + (z * t[0] - x * t[2]), cm[2] + p[2] + w * t[2] + (x * t[1] - y * t[0]));
          }
        }
        const HS = 3e-10, grid = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
        for (let a = 0; a < atomsNear.length; a += 3) { const kk = key(Math.floor(atomsNear[a] / HS), Math.floor(atomsNear[a + 1] / HS), Math.floor(atomsNear[a + 2] / HS)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(a); }
        const clear = p => { const i0 = Math.floor(p[0] / HS), j0 = Math.floor(p[1] / HS), k0 = Math.floor(p[2] / HS);
          for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) { const g = grid.get(key(i, j, k)); if (g) for (const a of g) if (Math.hypot(atomsNear[a] - p[0], atomsNear[a + 1] - p[1], atomsNear[a + 2] - p[2]) < 2.9e-10) return false; }
          return true; };
        const L = [], RW = 3.2e-9, T = Math.ceil(RW / LB) + 1;
        let best = 1e9;
        for (let tx = -T; tx <= T; tx++) for (let ty = -T; ty <= T; ty++) for (let tz = -T; tz <= T; tz++) for (let i = 0; i < N; i++) {
          const p = [0, 1, 2].map(k => com[3 * i + k] * 1e-10 - LB / 2 + [tx, ty, tz][k] * LB);
          const d = Math.hypot(...p); if (d > RW) continue;
          const O = [p[0], p[1], p[2] - 0];   // centre of mass is within 0.07 Å of the O
          if (!clear(O)) continue;
          if (d < best) { best = d; follow = L.length / 4; }
          L.push(i, tx * LB, ty * LB, tz * LB);
        }
        list = new Float32Array(L); nList = L.length / 4; listTex = tex4(gl, list, 1024);
        stTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, stTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, 1, 0, gl.RGBA, gl.FLOAT, null);
        for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
        console.log(`water: ${nList} molecules shown around the pocket, followed molecule ${follow} at ${(best * 1e9).toFixed(2)} nm`);
      })();
      // molecular-dynamics time (s) from the inner clock: the 2 ps trajectory plays forward then back (time-reversible)
      const mdFrame = t => { const P = (F - 1) * every, u = ((t % (2 * P)) + 2 * P) % (2 * P), v = u < P ? u : 2 * P - u; return v / every; };
      const interp = t => {
        const fr = Math.min(F - 1.0001, mdFrame(t)), f0 = Math.floor(fr), w = fr - f0;
        for (let i = 0; i < N; i++) {
          for (let k = 0; k < 3; k++) st[8 * i + k] = (com[(f0 * N + i) * 3 + k] * (1 - w) + com[((f0 + 1) * N + i) * 3 + k] * w) * 1e-10 - LB / 2;
          let q = [0, 1, 2, 3].map(k => quat[(f0 * N + i) * 4 + k] * (1 - w) + quat[((f0 + 1) * N + i) * 4 + k] * w); const l = Math.hypot(...q);
          for (let k = 0; k < 4; k++) st[8 * i + 4 + k] = q[k] / l;
        }
      };
      const waterProg = sphereProgram(R, `
        int inst = gl_InstanceID / 3, site = gl_InstanceID % 3;
        vec4 e = texelFetch(uList, ivec2(inst % 1024, inst / 1024), 0); int m = int(e.x + 0.5);
        vec4 a = texelFetch(uSt, ivec2(2 * m, 0), 0), q = texelFetch(uSt, ivec2(2 * m + 1, 0), 0);
        vec3 b = site == 0 ? uO : site == 1 ? uH1 : uH2;
        // quaternion (q0 scalar, as the engine stores it): R(q) b
        float q0 = q.x; vec3 u = q.yzw;
        vec3 rb = b + 2.0 * cross(u, cross(u, b) + q0 * b);
        c = a.xyz + e.yzw + rb;
        r = site == 0 ? 0.95e-10 : 0.6e-10;
        col = site == 0 ? vec3(0.92, 0.22, 0.2) : vec3(0.95, 0.95, 0.97);
        ok = !(uHide == inst);`, `uniform highp sampler2D uList, uSt; uniform vec3 uO, uH1, uH2; uniform int uHide;`);
      const Wl = { name: 'water', frame: 'hb', opaque: true };
      Wl.alpha = Lv => band(Lv, -9.15, -8.45, 0.25, 0.3);
      Wl.update = t => {                     // called each frame before the camera: the followed molecule's frame
        if (!list) return;
        interp(t);
        const m = list[4 * follow], c = [0, 1, 2].map(k => st[8 * m + k] + list[4 * follow + 1 + k]);
        const [q0, x, y, z] = [st[8 * m + 4], st[8 * m + 5], st[8 * m + 6], st[8 * m + 7]];
        S.nodes.mol.pos = c;
        S.nodes.mol.rot = [q0 * q0 + x * x - y * y - z * z, 2 * (x * y - q0 * z), 2 * (x * z + q0 * y), 2 * (x * y + q0 * z), q0 * q0 - x * x + y * y - z * z, 2 * (y * z - q0 * x), 2 * (x * z - q0 * y), 2 * (y * z + q0 * x), q0 * q0 - x * x - y * y + z * z];
      };
      Wl.draw = (cam, a, clocks) => {
        if (!list) return;
        const buf = new Float32Array(4 * 1024); buf.set(st.subarray(0, Math.min(st.length, 4096)));
        gl.bindTexture(gl.TEXTURE_2D, stTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, 1, gl.RGBA, gl.FLOAT, buf);
        // the followed molecule fades into its electron cloud below 1 Å
        const hide = -1;
        drawSpheres(R, waterProg, cam, 'hb', a, nList * 3, prog => {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, listTex); gl.uniform1i(prog.u.uList, 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, stTex); gl.uniform1i(prog.u.uSt, 1);
          gl.uniform3f(prog.u.uO, ...SITE[0]); gl.uniform3f(prog.u.uH1, ...SITE[1]); gl.uniform3f(prog.u.uH2, ...SITE[2]); gl.uniform1i(prog.u.uHide, hide);
        }, 0, R.EYE * 0.55);
      };
      Wl.labels = cam => [];
      layers.push(Wl);
      root.PTEN_WATER_UPDATE = Wl.update;
    }

    // ================= one water molecule's electron cloud (CCSD natural orbitals), and the proton =================
    const QC = root.PTEN_QC;
    if (QC && root.PTEN_DENSITY) {
      const D = root.PTEN_DENSITY.make(QC), BOHR = 0.529177210903e-10, zc = Inner.H_BODY.zc;
      const cloud = R.program(`
        out vec3 vDir;
        void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0);
          vDir = vec3(p.x / uProj[0][0], p.y / uProj[1][1], -1.0); }`, `
        uniform mat3 uInv; uniform vec3 uOrg; uniform float uA, uStep, uRmax, uGain; in vec3 vDir; out vec4 o;
        ${D.glsl()}
        void main() {
          // ray in bohr, molecule frame with the O nucleus at the origin
          vec3 rd = normalize(uInv * normalize(vDir)), ro = uOrg;
          float b = dot(ro, rd), cc = dot(ro, ro) - uRmax * uRmax, disc = b * b - cc;
          if (disc < 0.0) discard;
          float t0 = max(-b - sqrt(disc), 0.0), t1 = -b + sqrt(disc);
          if (t1 <= 0.0) discard;
          // integrate a glow proportional to log density, with a faint shell where the density falls to 0.002 e/bohr^3
          vec3 acc = vec3(0.0); float n = 56.0, dt = (t1 - t0) / n;
          float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          for (int i = 0; i < 56; i++) {
            vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
            float rho = rhoAt(p);
            float lg = clamp((log(rho) / 2.302585 + 3.0) / 4.0, 0.0, 1.3);
            vec3 c = mix(vec3(0.12, 0.25, 1.0), vec3(0.85, 0.95, 1.0), smoothstep(0.45, 1.0, lg)) * lg * lg * lg;
            float shell = exp(-pow((log(rho) - log(0.002)) / 0.2, 2.0)), inner = exp(-pow((log(rho) - log(0.12)) / 0.18, 2.0));
            acc += (c + vec3(0.35, 0.6, 1.0) * shell * 0.6 + vec3(0.9, 0.95, 1.0) * inner * 0.5) * dt;
          }
          acc *= uGain;
          o = vec4(acc * uA, 0.0);
        }`);
      const protonProg = R.program(`
        out vec3 vDir;
        void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0);
          vDir = vec3(p.x / uProj[0][0], p.y / uProj[1][1], -1.0); }`, `
        uniform mat3 uInv; uniform vec3 uOrg; uniform float uA; in vec3 vDir; out vec4 o;
        void main() {
          // charge density of the proton, rho ~ exp(-r/a): the dipole form factor, a = r_p / sqrt(12) (r_p = 0.8408 fm)
          vec3 rd = normalize(uInv * normalize(vDir)), ro = uOrg;      // fm
          float b = dot(ro, rd), t0 = max(-b - 4.0, 0.0), t1 = -b + 4.0;
          vec3 acc = vec3(0.0); float n = 64.0, dt = (t1 - t0) / n;
          for (int i = 0; i < 64; i++) { vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt); float r = length(p); float rho = exp(-r / 0.2427);
            acc += mix(vec3(1.0, 0.35, 0.15), vec3(1.0, 0.85, 0.6), rho) * rho * dt; }
          o = vec4(acc * 1.6 * uA, 0.0);
        }`);
      const setRay = (prog, cam, frame, unit, a) => {
        const pl = Z.place(cam, frame, [0, 0, 0]), s = Math.hypot(pl.rot[0], pl.rot[3], pl.rot[6]);
        const Qt = S.T(pl.rot).map(x => x / s), org = S.app(Qt, [-pl.off[0], -pl.off[1], R.EYE - pl.off[2]]).map(x => x / s / unit);
        gl.useProgram(prog.p); gl.uniformMatrix4fv(prog.u.uProj, false, R.proj(1e-6, 1e7));
        gl.uniformMatrix3fv(prog.u.uInv, false, m3(Qt)); gl.uniform1f(prog.u.uA, a);
        return org;
      };
      const C = { name: 'cloud', frame: 'mol' };
      C.alpha = Lv => band(Lv, -16, -9.35, 0.6, 0.3);
      C.draw = (cam, a) => {
        const org = setRay(cloud, cam, 'mol', BOHR, a);
        org[2] += zc / BOHR;                                        // the quantum-chemistry frame has the O at its origin
        gl.uniform3f(cloud.u.uOrg, ...org); gl.uniform1f(cloud.u.uRmax, 7.0);
        // brightness: path-integrated glow, normalised so the molecule reads at every scale
        gl.uniform1f(cloud.u.uGain, 0.3);
        gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      C.labels = cam => [
        { t: 'O', frame: 'mol', p: Inner.H_BODY.O, cls: 'minor', a: band(cam.L, -10.3, -9.6, 0.2, 0.2) },
        { t: 'H', frame: 'proton', p: [0, 0, 0], cls: 'minor', a: band(cam.L, -10.3, -9.6, 0.2, 0.2) },
      ];
      layers.push(C);
      const Pr = { name: 'proton', frame: 'proton' };
      Pr.alpha = Lv => band(Lv, -15, -14.0, 0.5, 0.5);
      Pr.draw = (cam, a) => {
        const org = setRay(protonProg, cam, 'proton', 1e-15, a);
        gl.uniform3f(protonProg.u.uOrg, ...org);
        gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      Pr.labels = cam => [{ t: 'proton: charge radius 0.8408 fm', frame: 'proton', p: [0.9e-15, 0.0, 0.9e-15], cls: 'minor', a: band(cam.L, -14.8, -14.2, 0.2, 0.3) }];
      layers.push(Pr);
    }
    return layers;
  }
  root.PTEN_LAYERS_MOL = { build, sphereProgram, drawSpheres, tex4, inflate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
