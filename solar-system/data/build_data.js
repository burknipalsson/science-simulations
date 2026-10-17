// Pack everything the page needs into data.js: initial state, asteroid elements (quantized, gzipped),
// notable bodies, spacecraft tracks, JPL check values and textures.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const D = p => path.join(__dirname, p);
const EPOCH_A = 2461200.5, MU = 0.00029591220828411956, DEG = Math.PI / 180;

// ---------- asteroids ----------
function rows(file) { return JSON.parse(fs.readFileSync(D(file))).data; }
const num = rows('sbdb_full.json'), un = rows('sbdb_un.json');
let rng = 12345; const rand = () => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = [];
function add(r) {
  let [a, e, i, om, w, ma, ep, H, cls] = r;
  a = +a; e = +e; i = +i; om = +om; w = +w; ma = +ma; ep = +ep; H = H === null || H === '' ? 18 : +H;
  if (!(a > 0) || !(e < 0.99) || !(a < 1500)) return;
  if (ep !== EPOCH_A) { if (Math.abs(ep - EPOCH_A) > 400) return; ma += Math.sqrt(MU / a ** 3) * (EPOCH_A - ep) / DEG; }
  ma = ((ma % 360) + 360) % 360;
  pick.push([a, e, i, om, w, ma, H, cls]);
}
const keepAll = new Set(['APO', 'ATE', 'AMO', 'IEO', 'TJN', 'TNO', 'CEN', 'OMB', 'IMB', 'MCA', 'AST']);
const MBA_FRAC = +(process.env.MBA_FRAC || 0.22);
for (const r of num) if (keepAll.has(r[8]) || rand() < MBA_FRAC) add(r);
for (const r of un) add(r);
// sort by a so neighbouring values compress
pick.sort((x, y) => x[0] - y[0]);
const n = pick.length;
const cols = { a: new Uint8Array(3 * n), e: new Uint8Array(2 * n), i: new Uint8Array(2 * n), om: new Uint8Array(2 * n), w: new Uint8Array(2 * n), ma: new Uint8Array(2 * n), H: new Uint8Array(n) };
const LA0 = Math.log(0.4), LA1 = Math.log(1500);
const put16 = (arr, k, v) => { arr[2 * k] = v & 255; arr[2 * k + 1] = v >> 8; };
pick.forEach(([a, e, i, om, w, ma, H], k) => {
  const qa = Math.round((Math.log(a) - LA0) / (LA1 - LA0) * 16777215);
  cols.a[3 * k] = qa & 255; cols.a[3 * k + 1] = (qa >> 8) & 255; cols.a[3 * k + 2] = qa >> 16;
  put16(cols.e, k, Math.round(e * 65535)); put16(cols.i, k, Math.round(i / 180 * 65535));
  put16(cols.om, k, Math.round(om / 360 * 65536) & 65535); put16(cols.w, k, Math.round(w / 360 * 65536) & 65535); put16(cols.ma, k, Math.round(ma / 360 * 65536) & 65535);
  cols.H[k] = Math.max(0, Math.min(255, Math.round((H + 2) * 8)));
});
// byte-plane shuffle within each column (low bytes together, high bytes together) helps gzip
function planes(arr, w) { const out = new Uint8Array(arr.length), m = arr.length / w; for (let k = 0; k < m; k++) for (let b = 0; b < w; b++) out[b * m + k] = arr[w * k + b]; return out; }
const raw = Buffer.concat([planes(cols.a, 3), planes(cols.e, 2), planes(cols.i, 2), planes(cols.om, 2), planes(cols.w, 2), planes(cols.ma, 2), cols.H]);
const gz = zlib.gzipSync(raw, { level: 9 });
const classes = {}; pick.forEach(p => classes[p[7]] = (classes[p[7]] || 0) + 1);
console.error('asteroids', n, 'raw', raw.length, 'gz', gz.length, classes);

// ---------- bodies & checks ----------
const state0 = JSON.parse(fs.readFileSync(D('state0.json')));
const moonDelta = JSON.parse(fs.readFileSync(D('moon_delta.json')));
const refs = JSON.parse(fs.readFileSync(D('refs.json')));
// JPL geocentric check vectors (AU) for the in-page self test
const checkJD = [1721423.5, 2268923.5, 2415020.5, 2451545.0, 2488069.5, 2816787.5];
const checks = checkJD.map(jd => {
  const e = refs.Earth.rows.find(r => r.jd === jd).s, o = { jd };
  for (const b of ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) { const s = refs[b].rows.find(r => r.jd === jd).s; o[b] = [0, 1, 2].map(k => +(s[k] - e[k]).toPrecision(12)); }
  return o;
});
const notable = JSON.parse(fs.readFileSync(D('notable.json')));
const small = {}; for (const [k, v] of Object.entries(notable.small)) small[k] = v.slice(1);
// spacecraft: float32 [t (days from 2461041.5), x, y, z, vx, vy, vz] heliocentric; thin the coarse track to 16 days
const craft = {};
for (const [k, tr] of Object.entries(notable.craft)) {
  const keep = k.startsWith('Apophis') ? tr : tr.filter((r, i) => i === 0 || i === tr.length - 1 || (r[0] - Math.floor(r[0])) !== 0.5 || Math.round(r[0] - tr[0][0]) % 16 === 0 || tr.some(q => Math.abs(q[0] - r[0]) < 0.2 && (q[0] % 1) !== 0.5));
  const f = new Float32Array(keep.length * 7);
  keep.forEach((r, j) => { f[7 * j] = r[0] - 2461041.5; for (let q = 1; q < 7; q++) f[7 * j + q] = r[q]; });
  craft[k] = Buffer.from(f.buffer).toString('base64');
  console.error(k, tr.length, '->', keep.length);
}
const tex = f => 'data:image/jpeg;base64,' + fs.readFileSync(D(f)).toString('base64');
const out = `const DATA = ${JSON.stringify({ state0, moonDelta, checks, small, astCount: n, astEpoch: EPOCH_A, astLogA: [LA0, LA1] })};
DATA.ast = "${gz.toString('base64')}";
DATA.craft = ${JSON.stringify(craft)};
DATA.texDay = "${tex('earth_day.jpg')}";
DATA.texNight = "${tex('earth_night.jpg')}";
DATA.texMoon = "${tex('moon.jpg')}";
`;
fs.writeFileSync(D('../data.js'), out);
console.error('data.js', out.length);
