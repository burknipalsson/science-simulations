// Pack the recorded capillary train (cap_rec.json from cap_run.js) into ../../blood_data.js (PTEN_BLOODREC).
// Each frame: cell centres (float32 µm, unwrapped along the vessel) and, per cell, the first 642 vertices of the
// 2,562-vertex membrane (the icosphere's level-3 vertices, so the page rebuilds the level-3 mesh) as offsets from
// the centre: int16 in 5 nm on the first frame, then int8 deltas (5 nm), rounded on the reconstructed path.
const fs = require('fs'), zlib = require('zlib');
const r = JSON.parse(fs.readFileSync(process.argv[2] || 'cap_rec.json')), M = r.meta, F = r.frames.length, NC = M.ncell, NV = 642, U = 0.005;
// vertices are stored wrapped into the periodic box: unwrap each cell around its first vertex, recompute the
// centre, then unwrap the centres over time
let prevC = null;
for (const f of r.frames) {
  for (let c = 0; c < NC; c++) {
    const X = f.off[c].map(o => o.map((v, k) => v + f.cen[c][k]));
    const x0 = X[0][0]; X.forEach(p => { p[0] -= M.L * Math.round((p[0] - x0) / M.L); });
    const m = [0, 1, 2].map(k => X.reduce((a, p) => a + p[k], 0) / X.length);
    f.off[c] = X.map(p => p.map((v, k) => v - m[k]));
    if (prevC) m[0] -= M.L * Math.round((m[0] - prevC[c][0]) / M.L);
    f.cen[c] = m;
  }
  prevC = f.cen.map(c => c.slice());
}
const cen = new Float32Array(3 * NC * F), parts = [];
let rec = null, clip = 0;
r.frames.forEach((f, fi) => {
  for (let c = 0; c < NC; c++) cen.set(f.cen[c], 3 * (fi * NC + c));
  if (fi === 0) {
    const a = new Int16Array(3 * NV * NC); rec = [];
    for (let c = 0; c < NC; c++) for (let v = 0; v < NV; v++) for (let k = 0; k < 3; k++) { const q = Math.round(f.off[c][v][k] / U); a[3 * (c * NV + v) + k] = q; rec.push(q); }
    parts.push(Buffer.from(a.buffer)); return;
  }
  const d = new Int8Array(3 * NV * NC);
  for (let c = 0; c < NC; c++) for (let v = 0; v < NV; v++) for (let k = 0; k < 3; k++) {
    const i = 3 * (c * NV + v) + k; let s = Math.round(f.off[c][v][k] / U - rec[i]);
    if (Math.abs(s) > 127) { clip++; s = Math.sign(s) * 127; } d[i] = s; rec[i] += s;
  }
  parts.push(Buffer.from(d.buffer));
});
const gz = zlib.gzipSync(Buffer.concat(parts), { level: 9 }), gc = zlib.gzipSync(Buffer.from(cen.buffer), { level: 9 });
// the train's spacing at frame 0, as positions within the periodic box (for the loops' moving pattern)
const c0 = r.frames[0].cen.map(c => ((c[0] % M.L) + M.L) % M.L).sort((a, b) => a - b);
const meta = { L: M.L, D: M.D, ncell: NC, nv: NV, nf: F, every_ms: M.every, vcell: +M.vcell.toFixed(4), vmean: +M.vmean.toFixed(4), G: M.G, axis: M.axis, c0: c0.map(x => +x.toFixed(3)), unit: U };
fs.writeFileSync('../../blood_data.js', `globalThis.PTEN_BLOODREC = ${JSON.stringify(Object.assign(meta, { off: gz.toString('base64'), cen: gc.toString('base64') }))};\n`);
console.log(`${F} frames x ${NC} cells, clipped ${clip}; ${((gz.length + gc.length) / 1024).toFixed(0)} KB gz`, JSON.stringify(Object.assign({}, meta)));
// how far the train moves over the recording (for a seamless loop)
const d = [0, 1, 2, 3].slice(0, NC).map(c => r.frames[F - 1].cen[c][0] - r.frames[0].cen[c][0]);
console.log('displacement over the record (µm):', d.map(x => x.toFixed(2)).join(' '), ' axis at', M.axis);
