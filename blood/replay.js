// Recorded frames for the fine-grid replay: simulation state, not pixels.
// A frame stores each cell's centre (float32, lattice units, unwrapped along the periodic x so it can be interpolated
// across the box edge) and every vertex as an int16 offset from that centre (1/800 lattice unit, ±40 lu), plus the
// plasma tracers (int16 position ×100 and age). Playback interpolates linearly between frames.
const RP_OFF = 800, RP_TR = 100;

// pos: vertex offsets from the anchors (nv × nc RGBA float), anc: anchors (nc RGBA); prev: the previous frame (for unwrapping)
function rpEncode(pos, anc, nv, nc, nx, prev) {
  const cen = new Float32Array(nc * 3), off = new Int16Array(nc * nv * 3);
  for (let c = 0; c < nc; c++) {
    const m = [0, 0, 0];
    for (let v = 0; v < nv; v++) for (let d = 0; d < 3; d++) m[d] += pos[4 * (c * nv + v) + d];
    for (let d = 0; d < 3; d++) m[d] /= nv;
    for (let v = 0; v < nv; v++) for (let d = 0; d < 3; d++) {
      const q = Math.round((pos[4 * (c * nv + v) + d] - m[d]) * RP_OFF);
      off[3 * (c * nv + v) + d] = Math.max(-32767, Math.min(32767, q));
    }
    for (let d = 0; d < 3; d++) cen[3 * c + d] = anc[4 * c + d] + m[d];
    if (prev) { const px = prev.cen[3 * c]; cen[3 * c] -= nx * Math.round((cen[3 * c] - px) / nx); }
  }
  return { cen, off };
}

// interpolate frames A and B at fraction f into the engine's layout: pos (nv × nc RGBA, offsets from the anchor), anc (nc RGBA).
// The centre is wrapped back into [0, nx) along x.
function rpDecode(A, B, f, nv, nc, nx, pos, anc) {
  const g = 1 - f;
  for (let c = 0; c < nc; c++) {
    const cc = [0, 1, 2].map(d => g * A.cen[3 * c + d] + f * B.cen[3 * c + d]);
    cc[0] -= nx * Math.floor(cc[0] / nx);
    const an = cc.map(Math.floor), fr = [cc[0] - an[0], cc[1] - an[1], cc[2] - an[2]];
    anc[4 * c] = an[0]; anc[4 * c + 1] = an[1]; anc[4 * c + 2] = an[2]; anc[4 * c + 3] = 0;
    for (let v = 0, i = 3 * c * nv, o = 4 * c * nv; v < nv; v++, i += 3, o += 4) {
      pos[o] = fr[0] + (g * A.off[i] + f * B.off[i]) / RP_OFF;
      pos[o + 1] = fr[1] + (g * A.off[i + 1] + f * B.off[i + 1]) / RP_OFF;
      pos[o + 2] = fr[2] + (g * A.off[i + 2] + f * B.off[i + 2]) / RP_OFF;
      pos[o + 3] = 0;
    }
  }
}

// tracers: (x, y, z, age) RGBA float -> int16 quads
function rpEncodeTracers(st) {
  const n = st.length / 4, out = new Int16Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 3; d++) out[4 * i + d] = Math.round(st[4 * i + d] * RP_TR);
    out[4 * i + 3] = Math.round(Math.max(-1, Math.min(30000, st[4 * i + 3])));
  }
  return out;
}
// interpolated tracers; a tracer that respawned between the frames (its age went up) or crossed the box edge jumps to B
function rpDecodeTracers(A, B, f, nx, out) {
  const n = A.length / 4, L = nx * RP_TR;
  for (let i = 0; i < n; i++) {
    const j = 4 * i, jump = B[j + 3] > A[j + 3] || Math.abs(B[j] - A[j]) > L / 2, w = jump ? 1 : f;
    for (let d = 0; d < 3; d++) out[j + d] = ((1 - w) * A[j + d] + w * B[j + d]) / RP_TR;
    out[j + 3] = (1 - w) * A[j + 3] + w * B[j + 3];
  }
}

// averages of the recorded measurements over a window of 2h+1 frames around each frame (shifted, not shrunk, at the ends
// of the recording); the HUD shows these during the replay. stats per frame: { Q (flux through the vessel, lattice),
// flux (cell volume flux, null for the first frame), HT, cfl (µm) }
function rpWindow(stats, h) {
  const n = stats.length, P = [{ Q: 0, F: 0, nF: 0, H: 0, C: 0, nC: 0 }];
  stats.forEach((s, i) => { const p = P[i]; P.push({ Q: p.Q + s.Q, H: p.H + s.HT, F: p.F + (s.flux ?? 0), nF: p.nF + (s.flux !== null), C: p.C + (s.cfl || 0), nC: p.nC + (s.cfl > 0) }); });
  return stats.map((_, i) => {
    const w = Math.min(n, 2 * h + 1), a = Math.max(0, Math.min(n - w, i - h)), A = P[a], B = P[a + w], k = w;
    return { Q: (B.Q - A.Q) / k, HT: (B.H - A.H) / k, HDflux: B.nF > A.nF ? (B.F - A.F) / (B.nF - A.nF) : 0, cfl: B.nC > A.nC ? (B.C - A.C) / (B.nC - A.nC) : 0 };
  });
}

if (typeof module !== 'undefined') module.exports = { rpEncode, rpDecode, rpEncodeTracers, rpDecodeTracers, rpWindow, RP_OFF };
