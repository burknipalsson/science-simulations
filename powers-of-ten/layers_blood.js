// Powers of Ten: under the nail fold (3 mm -> 1 µm). The row of capillary loops a capillaroscope sees, blood moving
// through them at the measured resting speed, and inside one arterial limb the red cells themselves: shapes
// recorded from the blood sim's fine-grid engine (Inside a Drop of Blood), replayed in the vessel.
(function (root) {
  const S = root.PTEN, Z = root.PTEN_ZOOM, RD = root.PTEN_RENDER, I = root.PTEN_INNER, band = (...a) => root.PTEN_LAYERS.band(...a), smooth = Z.smooth;
  const m3 = m => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  const VCELL = 0.65e-3;                 // m/s, resting red-cell speed in nail-fold capillaries (Fagrell 1977)

  // icosphere as in the blood sim's mesh.js (same vertex order: level-3 vertices are the first 642 of level 4)
  function icosphere(level) {
    const t = (1 + Math.sqrt(5)) / 2;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
    V = V.map(norm);
    for (let l = 0; l < level; l++) {
      const mid = new Map(), F2 = [];
      const m = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a; if (!mid.has(k)) { mid.set(k, V.length); V.push(norm([0, 1, 2].map(i => (V[a][i] + V[b][i]) / 2))); } return mid.get(k); };
      for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      F = F2;
    }
    return { V, F };
  }

  function build(R) {
    const gl = R.gl, layers = [];
    const BR = root.PTEN_BLOODREC;       // recorded cells (optional until packed)
    // cell spacing pattern along a vessel: the recorded train's centres at frame 0 (µm, periodic in the box)
    const box = BR ? BR.L * 1e-6 : 48e-6;
    const pattern = BR ? BR.c0.map(x => x * 1e-6) : [6e-6, 18e-6, 30e-6, 42e-6];

    // ---- tissue backdrop: the dermis seen through the skin, a soft pink haze ----
    const tissue = R.program(`
      out vec2 vQ; void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; vQ = p; gl_Position = vec4(p, 0.0, 1.0); }`, `
      uniform float uA, uIn; in vec2 vQ; out vec4 o;
      void main() { float r = length(vQ);
        vec3 c = mix(vec3(0.62, 0.36, 0.32), vec3(0.38, 0.17, 0.16), smoothstep(0.2, 1.5, r));
        // inside the red cell: the dark, crowded cytoplasm (haemoglobin solution) between the molecules
        vec3 ci = mix(vec3(0.16, 0.05, 0.06), vec3(0.07, 0.02, 0.03), smoothstep(0.2, 1.5, r));
        o = vec4(mix(c, ci, uIn) * uA, uA); }`);
    const T = { name: 'tissue', frame: 'cap', opaque: true };
    T.alpha = Lv => band(Lv, -9.5, -2.75, 0.4, 0.25);
    T.draw = (cam, a) => { gl.useProgram(tissue.p); gl.uniform1f(tissue.u.uA, a); gl.uniform1f(tissue.u.uIn, smooth((-6.3 - cam.L) / 0.5)); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    layers.push(T);

    // ---- the loops: tubes along each centreline ----
    const SEG = 220, SIDES = 10, pos = [], nor = [], arc = [], rad = [], idx = [];
    let base = 0;
    I.loops.forEach((Lp, li) => {
      const pts = []; for (let k = 0; k <= SEG; k++) pts.push(I.loopPoint(Lp, k / SEG));
      const total = pts[0].total;
      for (let k = 0; k <= SEG; k++) {
        const p = pts[k].p, q = pts[Math.min(SEG, k + 1)].p, o = pts[Math.max(0, k - 1)].p;
        let t = [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; const tl = Math.hypot(...t); t = t.map(v => v / tl);
        let n1 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        const d = n1[0] * t[0] + n1[1] * t[1] + n1[2] * t[2]; n1 = n1.map((v, i) => v - d * t[i]); const nl = Math.hypot(...n1); n1 = n1.map(v => v / nl);
        const n2 = [t[1] * n1[2] - t[2] * n1[1], t[2] * n1[0] - t[0] * n1[2], t[0] * n1[1] - t[1] * n1[0]];
        for (let j = 0; j < SIDES; j++) {
          const a = j / SIDES * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a), nn = [0, 1, 2].map(i => c * n1[i] + s * n2[i]);
          pos.push(...p.map((v, i) => v + pts[k].r * nn[i])); nor.push(...nn); arc.push(k / SEG * total, li); rad.push(pts[k].r);
        }
      }
      for (let k = 0; k < SEG; k++) for (let j = 0; j < SIDES; j++) {
        const a = base + k * SIDES + j, b = base + k * SIDES + (j + 1) % SIDES;
        idx.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
      }
      base += (SEG + 1) * SIDES;
    });
    const loopProg = R.program(`
      in vec3 aPos, aNor; in vec2 aArc; in float aRad; out vec3 vN, vP; out vec2 vArc; out float vW;
      void main() { vec3 c = toCam(aPos); gl_Position = uProj * vec4(c, 1.0); vW = -c.z; vN = aNor; vP = aPos; vArc = aArc; }`, RD.LOGDEPTH + `
      uniform float uA, uT, uBox, uV; uniform vec4 uPat; uniform mat3 uToCam; uniform float uWall, uGlass; uniform int uMode; uniform vec2 uArt;
      in vec3 vN, vP; in vec2 vArc; in float vW; out vec4 o;
      float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
      void main() {
        // mode 1: everything but the arterial stretch (drawn opaque); mode 2: only that stretch (drawn as glass)
        bool art = vArc.x > uArt.x && vArc.x < uArt.y;
        if ((uMode == 1 && art) || (uMode == 2 && !art)) discard;
        // red cells travel the loop at the measured speed, spaced as in the recorded train (granular flow)
        float s = vArc.x - uV * uT - hash(vArc.y) * uBox;
        float u = mod(s, uBox), cell = 0.0;
        for (int i = 0; i < 4; i++) { float d = abs(u - uPat[i]); d = min(d, uBox - d); cell = max(cell, smoothstep(4.2e-6, 2.8e-6, d)); }
        vec3 n = normalize(uToCam * vN);
        float l = 0.55 + 0.45 * max(n.z, 0.0);
        vec3 blood = mix(vec3(0.66, 0.36, 0.32), vec3(0.42, 0.03, 0.04), cell);
        vec3 c = blood * l;
        if (uGlass > 0.0) {
          // endothelium as a thin glassy wall: faint, brighter where seen edge-on
          float rim = pow(1.0 - abs(n.z), 2.0);
          float al = uGlass * (0.06 + 0.4 * rim) * uA;
          o = vec4(vec3(0.95, 0.75, 0.72) * al, al);
        } else o = vec4(c * uA * uWall, uA * uWall);
        gl_FragDepth = logDepth(vW);
      }`);
    const perLoop = SEG * SIDES * 6, CEN = (I.NL - 1) / 2;
    const lv = R.vao(loopProg, { aPos: [new Float32Array(pos), 3], aNor: [new Float32Array(nor), 3], aArc: [new Float32Array(arc), 2], aRad: [new Float32Array(rad), 1] });
    gl.bindVertexArray(lv.v); const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW); gl.bindVertexArray(null);
    const nIdx = idx.length;
    const Lo = { name: 'loops', frame: 'cap', opaque: true };
    Lo.alpha = Lv => band(Lv, -4.6, -2.6, 0.4, 0.35);
    Lo.draw = (cam, a, clocks) => {
      const pl = Z.place(cam, 'cap', [0, 0, 0]), s = Math.hypot(pl.rot[0], pl.rot[3], pl.rot[6]);
      gl.useProgram(loopProg.p); RD.setPlace(R, loopProg, pl, a);
      gl.uniformMatrix4fv(loopProg.u.uProj, false, R.proj(1e-6, 1e7));
      gl.uniformMatrix3fv(loopProg.u.uToCam, false, m3(pl.rot.map(x => x / s)));
      gl.uniform1f(loopProg.u.uA, a); gl.uniform1f(loopProg.u.uWall, 1); gl.uniform1f(loopProg.u.uGlass, 0);
      gl.uniform1f(loopProg.u.uT, clocks.inner || 0); gl.uniform1f(loopProg.u.uBox, box); gl.uniform1f(loopProg.u.uV, VCELL);
      gl.uniform4f(loopProg.u.uPat, ...pattern);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(lv.v);
      // the central loop turns to glass as the camera closes in on it, to show the recorded cells inside
      const glass = smooth((-3.65 - cam.L) / 0.35);
      gl.uniform2f(loopProg.u.uArt, 62e-6, 358e-6); gl.uniform1i(loopProg.u.uMode, 0);
      if (glass < 1) gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0);
      else {
        gl.drawElements(gl.TRIANGLES, CEN * perLoop, gl.UNSIGNED_INT, 0); gl.drawElements(gl.TRIANGLES, (I.NL - CEN - 1) * perLoop, gl.UNSIGNED_INT, 4 * (CEN + 1) * perLoop);
        gl.uniform1i(loopProg.u.uMode, 1); gl.drawElements(gl.TRIANGLES, perLoop, gl.UNSIGNED_INT, 4 * CEN * perLoop);
      }
      Lo.glass = glass;
      gl.disable(gl.DEPTH_TEST);
    };
    Lo.drawGlass = (cam, a) => {
      if (!(Lo.glass > 0)) return;
      const pl = Z.place(cam, 'cap', [0, 0, 0]), s = Math.hypot(pl.rot[0], pl.rot[3], pl.rot[6]);
      gl.useProgram(loopProg.p); RD.setPlace(R, loopProg, pl, a);
      gl.uniformMatrix4fv(loopProg.u.uProj, false, R.proj(1e-6, 1e7));
      gl.uniformMatrix3fv(loopProg.u.uToCam, false, m3(pl.rot.map(x => x / s)));
      gl.uniform1f(loopProg.u.uA, a); gl.uniform1f(loopProg.u.uWall, 1); gl.uniform1f(loopProg.u.uGlass, Lo.glass);
      gl.uniform1i(loopProg.u.uMode, 2); gl.uniform2f(loopProg.u.uArt, 62e-6, 358e-6);
      gl.uniform1f(loopProg.u.uT, root.PTEN_CLOCKS ? root.PTEN_CLOCKS.inner || 0 : 0); gl.uniform1f(loopProg.u.uBox, box); gl.uniform1f(loopProg.u.uV, VCELL); gl.uniform4f(loopProg.u.uPat, ...pattern);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(lv.v); gl.drawElements(gl.TRIANGLES, perLoop, gl.UNSIGNED_INT, 4 * CEN * perLoop);
      gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
    };
    Lo.labels = cam => [
      { t: 'arterial limb, 7.4 µm', frame: 'cap', p: [0.02e-3, -11e-6 - 6e-6, 0], cls: 'minor', a: band(cam.L, -3.9, -3.2, 0.2, 0.25) },
      { t: 'venous limb, 8.8 µm', frame: 'cap', p: [-0.06e-3, 11e-6 + 6e-6, 0], cls: 'minor', a: band(cam.L, -3.9, -3.2, 0.2, 0.25) },
      { t: 'toward the cuticle', frame: 'cap', p: [0.45e-3, 0, 0], cls: 'minor', a: band(cam.L, -3.5, -2.9, 0.2, 0.25) },
    ];
    layers.push(Lo);

    // ---- the recorded red cells, in the central loop's arterial limb ----
    if (BR) {
      const ico = icosphere(3), F3 = ico.F, NV = BR.nv, NC = BR.ncell, NF = BR.nf, EV = BR.every_ms * 1e-3, U = BR.unit;
      const Wrec = (NF - 1) * EV;                                   // seconds of recording
      let off = null, cen = null;
      (async () => {
        const inf = async b64 => new Response(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        const raw = new Uint8Array(await inf(BR.off)); cen = new Float32Array(await inf(BR.cen));
        // rebuild absolute offsets (µm) for every frame
        off = new Float32Array(NF * NC * NV * 3);
        const first = new Int16Array(raw.buffer, 0, NC * NV * 3), acc = Int32Array.from(first);
        for (let i = 0; i < acc.length; i++) off[i] = acc[i] * U;
        let o = first.byteLength;
        for (let f = 1; f < NF; f++) {
          const d = new Int8Array(raw.buffer, o, NC * NV * 3); o += d.length;
          for (let i = 0; i < acc.length; i++) { acc[i] += d[i]; off[f * acc.length + i] = acc[i] * U; }
        }
      })();
      // mean displacement of the train over the recording (µm), so the loop of frames moves on seamlessly
      const DISP = () => { let d = 0; for (let c = 0; c < NC; c++) d += cen[3 * ((NF - 1) * NC + c)] - cen[3 * c]; return d / NC; };
      const X0 = BR.c0 ? 0 : 0, AX = BR.axis;
      const cellProg = R.program(`
        in vec3 aPos, aNor; uniform vec3 uShift; out vec3 vN; out float vW;
        void main() { vec3 c = toCam(aPos + uShift); gl_Position = uProj * vec4(c, 1.0); vW = -c.z; vN = aNor; }`, RD.LOGDEPTH + `
        uniform mat3 uToCam; uniform float uA; in vec3 vN; in float vW; out vec4 o;
        void main() {
          vec3 n = normalize(uToCam * vN); if (!gl_FrontFacing) n = -n;
          float l = max(dot(n, normalize(vec3(0.3, 0.5, 1.0))), 0.0), rim = pow(1.0 - max(n.z, 0.0), 2.5);
          vec3 c = vec3(0.62, 0.06, 0.06) * (0.35 + 0.75 * l) + vec3(0.9, 0.35, 0.3) * rim * 0.35;
          o = vec4(c * uA, uA); gl_FragDepth = logDepth(vW);
        }`);
      const nTot = NC * NV, posB = new Float32Array(3 * nTot), norB = new Float32Array(3 * nTot);
      const idx = new Uint32Array(NC * F3.length * 3);
      for (let c = 0; c < NC; c++) F3.forEach((f, i) => idx.set([c * NV + f[0], c * NV + f[1], c * NV + f[2]], 3 * (c * F3.length + i)));
      const cv = R.vao(cellProg, { aPos: [posB, 3], aNor: [norB, 3] });
      gl.bindVertexArray(cv.v); const cib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); gl.bindVertexArray(null);
      // state at time t (s): positions in the tube frame (m), with the train's copies every BR.L µm
      const state = (t, xs = 0) => {
        const k = Math.floor(t / Wrec), tl = t - k * Wrec, fr = Math.min(NF - 1.000001, tl / EV), f0 = Math.floor(fr), w = fr - f0, sh = k * DISP();
        const C = [];
        for (let c = 0; c < NC; c++) {
          const a = 3 * (f0 * NC + c), b = 3 * ((f0 + 1) * NC + c);
          C.push([cen[a] * (1 - w) + cen[b] * w + sh, cen[a + 1] * (1 - w) + cen[b + 1] * w, cen[a + 2] * (1 - w) + cen[b + 2] * w]);
          for (let v = 0; v < NV; v++) for (let d = 0; d < 3; d++) {
            const i = (c * NV + v) * 3 + d, A = off[f0 * nTot * 3 + i], B2 = off[(f0 + 1) * nTot * 3 + i];
            posB[i] = (A * (1 - w) + B2 * w + C[c][d] - (d === 0 ? xs : AX[d])) * 1e-6;
          }
        }
        return C;
      };
      const normals = () => {
        norB.fill(0);
        for (let c = 0; c < NC; c++) for (const f of F3) {
          const a = 3 * (c * NV + f[0]), b = 3 * (c * NV + f[1]), d = 3 * (c * NV + f[2]);
          const e1 = [posB[b] - posB[a], posB[b + 1] - posB[a + 1], posB[b + 2] - posB[a + 2]], e2 = [posB[d] - posB[a], posB[d + 1] - posB[a + 1], posB[d + 2] - posB[a + 2]];
          const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          for (const q of [a, b, d]) { norB[q] += n[0]; norB[q + 1] += n[1]; norB[q + 2] += n[2]; }
        }
      };
      const Ce = { name: 'cells', frame: 'tube', opaque: true };
      Ce.alpha = Lv => band(Lv, -6.4, -4.0, 0.4, 0.3);
      // the followed cell: copy 0 of cell 0 is kept within half a box of the tube origin (the copies are identical)
      // the membrane patch the camera lands on: the vertex at the front of the followed cell's parachute at t = 0;
      // it moves with the membrane as the cell tank-treads
      let memV = -1, ring = null;
      Ce.follow = t => {
        if (!off) return null;
        if (memV < 0) {
          let best = -1e9; for (let v = 0; v < NV; v++) { const x = off[3 * v]; if (x > best) { best = x; memV = v; } }
          ring = F3.filter(f => f.includes(memV));
        }
        const k = Math.floor(t / Wrec), tl = t - k * Wrec, fr = Math.min(NF - 1.000001, tl / EV), f0 = Math.floor(fr), w = fr - f0, sh = k * DISP();
        const cc = [0, 1, 2].map(d => cen[3 * f0 * NC + d] * (1 - w) + cen[3 * (f0 + 1) * NC + d] * w);
        const P = v => [0, 1, 2].map(d => off[(f0 * nTot + v) * 3 + d] * (1 - w) + off[((f0 + 1) * nTot + v) * 3 + d] * w);
        const Lb = BR.L, x = cc[0] + sh, n = Math.round((x - BR.c0[0]) / Lb);
        const p = P(memV), nrm = [0, 0, 0];
        for (const f of ring) { const a = P(f[0]), b = P(f[1]), c = P(f[2]); const e1 = a.map((v, i) => b[i] - v), e2 = a.map((v, i) => c[i] - v);
          const q = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; for (let i = 0; i < 3; i++) nrm[i] += q[i]; }
        const nl = Math.hypot(...nrm);
        return { x: (x - n * Lb - BR.c0[0]) * 1e-6, y: (cc[1] - AX[1]) * 1e-6, z: (cc[2] - AX[2]) * 1e-6, n, mem: p.map(v => v * 1e-6), normal: nrm.map(v => v / nl) };
      };
      Ce.draw = (cam, a, clocks) => {
        if (!off) return;
        const t = clocks.inner || 0, f = Ce.follow(t);
        state(t, f.n * BR.L + BR.c0[0]); normals(); R.update(cv, 'aPos', posB); R.update(cv, 'aNor', norB);
        const pl = Z.place(cam, 'tube', [0, 0, 0]), s = Math.hypot(pl.rot[0], pl.rot[3], pl.rot[6]);
        gl.useProgram(cellProg.p); RD.setPlace(R, cellProg, pl, a);
        gl.uniformMatrix4fv(cellProg.u.uProj, false, R.proj(1e-6, 1e7));
        gl.uniformMatrix3fv(cellProg.u.uToCam, false, m3(pl.rot.map(x => x / s)));
        gl.uniform1f(cellProg.u.uA, a);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(cv.v);
        // copies of the periodic train along the straight stretch of the limb (±120 µm), shifted to keep the followed cell near 0
        const Lb = BR.L * 1e-6;
        for (let k = -3; k <= 3; k++) {
          gl.uniform3f(cellProg.u.uShift, k * Lb, 0, 0);
          gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
        }
        gl.disable(gl.DEPTH_TEST);
        Lo.drawGlass(cam, a);
      };
      Ce.labels = cam => [];
      layers.push(Ce);
      root.PTEN_FOLLOW = Ce.follow;
    }
    return layers;
  }
  root.PTEN_LAYERS_BLOOD = { build, VCELL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
