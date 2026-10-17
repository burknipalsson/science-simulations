// Pack the recorded smoke tracers (wind_rec.json from wind_run.js) into ../../wind_data.js (PTEN_WIND).
// Each tracer is followed from its release upstream until it leaves the domain (or 2 s), in person-frame metres.
// Only paths that start inside one loop period are kept, so the page can replay them seamlessly in a loop:
// at loop time t a path that started at s is shown at age (t - s) mod T.
const fs = require('fs'), zlib = require('zlib');
const r = JSON.parse(fs.readFileSync(process.argv[2] || 'wind_rec.json'));
const M = r.meta, F = r.frames.length, n = M.PW * M.PH, CAP = 60;
const c = Math.cos(M.theta), s = Math.sin(M.theta);
const toPerson = (x, y, z) => { const q = [(x - M.xp) * M.dx, (y - M.yc) * M.dx, (z - M.zg) * M.dx]; return [c * q[0] - s * q[1], s * q[0] + c * q[1], q[2]]; };
const segs = [];
for (let i = 0; i < n; i++) {
  let cur = null, prevAge = -1;
  for (let f = 0; f < F; f++) {
    const a = r.frames[f], x = a[4 * i], y = a[4 * i + 1], z = a[4 * i + 2], w = a[4 * i + 3];
    const alive = w >= 0 && x > -1;
    if (!alive || w < prevAge) { if (cur) { cur.done = !alive || w < prevAge; segs.push(cur); } cur = null; }
    if (alive) { if (!cur) cur = { s: f, p: [], born: f > 0 }; if (cur.p.length < CAP) cur.p.push(toPerson(x, y, z)); }
    prevAge = alive ? w : -1;
  }
  if (cur) { cur.done = false; segs.push(cur); }
}
const T = F - CAP;
const keep = segs.filter(g => g.born && g.s >= 1 && g.s < 1 + T && (g.done || g.p.length >= CAP) && g.p.length >= 4);
console.log(`frames ${F}, slots ${n}, paths ${segs.length}, kept ${keep.length} in a ${T}-frame loop (${(T / M.fps).toFixed(2)} s); mean length ${(keep.reduce((a, g) => a + g.p.length, 0) / keep.length).toFixed(1)} samples`);
// encode: header (start uint16, count uint8), first point int16 mm, then int8 deltas in 2 mm (rounded on the reconstructed path)
const head = [], pts = [];
let clip = 0;
for (const g of keep) {
  head.push(g.s - 1, g.p.length);
  let q = g.p[0].map(v => Math.round(v * 1000));
  pts.push(...q.map(v => v & 0xffff));
  for (let k = 1; k < g.p.length; k++) {
    const t = g.p[k].map(v => v * 1000), d = t.map((v, j) => Math.max(-127, Math.min(127, Math.round((v - q[j]) / 2))));
    if (d.some((v, j) => Math.abs((t[j] - q[j]) / 2) > 127.5)) clip++;
    q = q.map((v, j) => v + 2 * d[j]); pts.push(...d.map(v => v & 0xff));
  }
}
// pack bytes: head as uint16 pairs, first points as int16, deltas as int8 (in path order)
const bytes = [];
for (let k = 0, pi = 0; k < keep.length; k++) {
  const cnt = keep[k].p.length;
  bytes.push(head[2 * k] & 255, head[2 * k] >> 8, cnt);
  for (let j = 0; j < 3; j++) { const v = pts[pi++]; bytes.push(v & 255, v >> 8); }
  for (let m = 1; m < cnt; m++) for (let j = 0; j < 3; j++) bytes.push(pts[pi++]);
}
const gz = zlib.gzipSync(Buffer.from(bytes), { level: 9 });
const meta = { n: keep.length, T, fps: M.fps, uReal: M.uReal, zr: M.zr, z0: M.z0, dx: M.dx, theta: M.theta, CAP };
// drag: subtract the floor's share (a run without the person) to get the body's drag area
const nb = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3])) : null;
const U = M.U, Fb = M.Fmean, Fn = nb ? nb.meta.Fmean : [0, 0];
const cda = (Fb[0] - Fn[0]) * M.dx * M.dx / (0.5 * U * U), lat = (Fb[1] - Fn[1]) * M.dx * M.dx / (0.5 * U * U);
meta.CdA = +cda.toFixed(3); meta.side = +lat.toFixed(3);
meta.F = +(0.5 * 1.25 * M.uReal ** 2 * Math.hypot(cda, lat)).toFixed(2);
console.log(`clipped deltas ${clip}; drag area ${cda.toFixed(3)} m² (along the wind), ${lat.toFixed(3)} m² across; force ${meta.F} N at ${M.uReal} m/s (1.5 m); ${(gz.length / 1024).toFixed(0)} KB gz`);
fs.writeFileSync(__dirname + '/../../wind_data.js', `globalThis.PTEN_WIND = ${JSON.stringify(Object.assign(meta, { b64: gz.toString('base64') }))};\n`);
