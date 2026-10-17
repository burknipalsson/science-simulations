// Pack model data (grid, surface, Q-flux, initial states) into a gzipped binary, base64 encoded.
const fs = require('fs'), zlib = require('zlib');
function pack(meta, arrays) {
  // arrays: {name: TypedArray}; meta gets an index of offsets
  const idx = {}; let off = 0; const bufs = [];
  for (const [k, a] of Object.entries(arrays)) {
    const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
    const pad = (4 - (off % 4)) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; }
    idx[k] = [a.constructor.name, off, a.length]; bufs.push(b); off += b.length;
  }
  meta.index = idx;
  const mj = Buffer.from(JSON.stringify(meta));
  const head = Buffer.alloc(4); head.writeUInt32LE(mj.length);
  let body = Buffer.concat([head, mj, Buffer.alloc((4 - ((4 + mj.length) % 4)) % 4), ...bufs]);
  return zlib.gzipSync(body, { level: 9 }).toString('base64');
}
module.exports = { pack };
if (require.main === module) {
  const nlat = 64, surf = require('./data/surf_64.json');
  const nG = nlat * 2 * nlat;
  const states = process.argv.slice(2);
  const meta = { M: 42, nlat, L: 15, dt: 1200, states: [] };
  const arrays = {
    land: Uint8Array.from(surf.land), sheet: Uint8Array.from(surf.sheet),
    zs: Float32Array.from(surf.zs), alb: Float32Array.from(surf.alb), z0: Float32Array.from(surf.z0),
  };
  if (fs.existsSync('data/qflux_n1.json')) { const q = JSON.parse(fs.readFileSync('data/qflux_n1.json')); arrays.qflux = Float32Array.from(q.flat()); meta.qflux = true; }
  for (const f of states) {
    const [fn, name, ep] = f.split(':');
    const s = JSON.parse(fs.readFileSync(fn));
    const i = meta.states.length;
    meta.states.push({ name: name || fn, time: s.time, epoch: ep !== undefined ? +ep : (s.epoch || 9496.5) });
    const cat = [];
    s.LP[1][0][0] += Math.log(1013.25 / 1000) * Math.SQRT2; // Earth's mean sea-level pressure is 1013 hPa, not 1000
    for (const v of ['Z', 'D', 'T', 'Q', 'LP']) { cat.push(...s[v][1][0]); cat.push(...s[v][1][1]); }
    arrays['st' + i] = Float32Array.from(cat);
    for (const fld of ['Ts', 'Tml', 'hice', 'W', 'snow']) arrays['st' + i + fld] = Float32Array.from(s[fld]);
  }
  const b64 = pack(meta, arrays);
  fs.writeFileSync('data/pack.b64', b64);
  console.log('pack', (b64.length / 1024).toFixed(0), 'KB base64');
}
