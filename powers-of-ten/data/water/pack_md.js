// Pack the 310 K water trajectory (md310.json) into ../../water_data.js (PTEN_WATER): 512 rigid TIP4P/2005
// molecules, a frame every 10 fs for 2 ps. First frame int16 (COM 0.001 Å, quaternion /32767), then int8 deltas
// (COM 0.002 Å, quaternion 0.0025), rounded against the reconstructed path so no error accumulates.
const fs = require('fs'), zlib = require('zlib');
const r = JSON.parse(fs.readFileSync('md310.json')), N = r.N, F = r.frames.length, box = r.box;
const out = [];
let rc = null, rq = null, clip = 0, clipQ = 0;
for (let f = 0; f < F; f++) {
  const com = r.frames[f].com.slice(), q = r.frames[f].q.slice();
  if (f === 0) {
    const a = new Int16Array(7 * N);
    rc = com.map(x => Math.round(x * 1000)); rq = [];
    for (let i = 0; i < N; i++) { let qq = q.slice(4 * i, 4 * i + 4); if (qq[0] < 0) qq = qq.map(v => -v); rq.push(...qq.map(v => Math.round(v * 32767))); }
    for (let i = 0; i < N; i++) { a.set(rc.slice(3 * i, 3 * i + 3), 7 * i); a.set(rq.slice(4 * i, 4 * i + 4), 7 * i + 3); }
    out.push(Buffer.from(a.buffer));
    rq = rq.map(v => v / 32767 * 400);         // track quaternions in units of 0.0025
    continue;
  }
  const d = new Int8Array(7 * N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) {
      // unwrap across the periodic box relative to the reconstructed previous position
      let t = com[3 * i + k] * 1000; const L = box[k] * 1000; t -= L * Math.round((t - rc[3 * i + k]) / L);
      let s = Math.round((t - rc[3 * i + k]) / 2); if (Math.abs(s) > 127) { clip++; s = Math.sign(s) * 127; }
      d[7 * i + k] = s; rc[3 * i + k] += 2 * s;
    }
    let qq = q.slice(4 * i, 4 * i + 4).map(v => v * 400);
    const dot = qq.reduce((a, v, k) => a + v * rq[4 * i + k], 0); if (dot < 0) qq = qq.map(v => -v);
    for (let k = 0; k < 4; k++) { let s = Math.round(qq[k] - rq[4 * i + k]); if (Math.abs(s) > 127) { clipQ++; s = Math.sign(s) * 127; } d[7 * i + 3 + k] = s; rq[4 * i + k] += s; }
  }
  out.push(Buffer.from(d.buffer));
}
const gz = zlib.gzipSync(Buffer.concat(out), { level: 9 });
const meta = { N, F, box, every_fs: r.every_fs, T: r.T, rho: +r.rho.toFixed(4), gpeak: r.gpeak, hb: +r.hb.toFixed(2), D: r.D };
fs.writeFileSync('../../water_data.js', `globalThis.PTEN_WATER = ${JSON.stringify(Object.assign(meta, { b64: gz.toString('base64') }))};\n`);
console.log(`${F} frames, clipped COM ${clip}, quaternion ${clipQ}, ${(gz.length / 1024).toFixed(0)} KB gz`);
