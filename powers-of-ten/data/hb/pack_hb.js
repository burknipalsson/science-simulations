// Haemoglobin inside a red cell: the oxy-Hb crystal structure (PDB 2DN1, Park et al. 2006, 1.25 Å; tetramer from
// BIOMT), packed at random positions and orientations at the measured concentration (MCHC 33 g/dL = 5.1 mM,
// 3.08e-3 molecules per nm^3, i.e. 7 nm apart), with no atomic overlaps. Periodic box. Writes ../../hb_data.js.
const fs = require('fs'), zlib = require('zlib');
const L = fs.readFileSync('2DN1.pdb', 'utf8').split('\n');
// BIOMT for biomolecule 1
const bio = {}; for (const l of L) { const m = l.match(/^REMARK 350\s+BIOMT(\d)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/); if (m) { (bio[m[2]] = bio[m[2]] || [])[+m[1] - 1] = [+m[3], +m[4], +m[5], +m[6]]; } if (/BIOMOLECULE: 2/.test(l)) break; }
const ops = Object.values(bio);
const EL = { C: 0, N: 1, O: 2, S: 3, FE: 4 };
const base = [];
for (const l of L) {
  if (!/^(ATOM  |HETATM)/.test(l)) continue;
  const res = l.slice(17, 20).trim(), alt = l[16];
  if (res === 'HOH' || res === 'MBN') continue;
  if (alt !== ' ' && alt !== 'A') continue;
  const el = (l.slice(76, 78).trim() || l.slice(12, 14).trim()).toUpperCase();
  if (el === 'H' || !(el in EL)) continue;
  base.push({ p: [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)], e: EL[el], ca: l.slice(12, 16).trim() === 'CA' || el === 'FE', chain: l[21], res });
}
const atoms = [];
for (const op of ops) for (const a of base) atoms.push({ ...a, p: [0, 1, 2].map(r => op[r][0] * a.p[0] + op[r][1] * a.p[1] + op[r][2] * a.p[2] + op[r][3]) });
const c = [0, 1, 2].map(k => atoms.reduce((s, a) => s + a.p[k], 0) / atoms.length);
atoms.forEach(a => { a.p = a.p.map((x, k) => x - c[k]); });
// principal extents (Å)
const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const a of atoms) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += a.p[i] * a.p[j];
function jacobi(A) { const n = 3, V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], a = A.map(r => r.slice()); for (let s = 0; s < 50; s++) { let p = 0, q = 1; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; } if (Math.abs(a[p][q]) < 1e-9) break; const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), cs = Math.cos(th), sn = Math.sin(th); for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = cs * x - sn * y; a[k][q] = sn * x + cs * y; } for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = cs * x - sn * y; a[q][k] = sn * x + cs * y; } for (let k = 0; k < n; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = cs * x - sn * y; V[k][q] = sn * x + cs * y; } } return V; }
const V = jacobi(I), ext = [0, 1, 2].map(k => { const ax = [V[0][k], V[1][k], V[2][k]]; const pr = atoms.map(a => a.p[0] * ax[0] + a.p[1] * ax[1] + a.p[2] * ax[2]); return Math.max(...pr) - Math.min(...pr) + 3.4; });
const rmax = Math.max(...atoms.map(a => Math.hypot(...a.p)));
console.log(`tetramer: ${atoms.length} heavy atoms (${atoms.filter(a => a.e === 4).length} Fe), extents incl. vdW ${ext.map(x => (x / 10).toFixed(2)).sort().reverse().join(' x ')} nm, max radius ${(rmax / 10).toFixed(2)} nm`);
// mass check (heavy atoms + implicit H ~ 64.5 kDa)
// packing
const NM = +(process.argv[2] || 400), n = 330 / 64500 * 6.02214076e23 / 1e24;      // per nm^3 at 330 g/L
const Lb = Math.cbrt(NM / n) * 10;                                                    // Å
console.log(`number density ${n.toExponential(3)} nm^-3, spacing ${(1 / Math.cbrt(n)).toFixed(2)} nm; box ${(Lb / 10).toFixed(2)} nm for ${NM} molecules`);
const coarse = atoms.filter(a => a.ca).map(a => a.p);   // C-alpha + Fe
let seed = 20261016; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rq = () => { const u1 = rnd(), u2 = rnd(), u3 = rnd(); return [Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2), Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2), Math.sqrt(u1) * Math.sin(2 * Math.PI * u3), Math.sqrt(u1) * Math.cos(2 * Math.PI * u3)]; };
const qm = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
const ap = (M, p, t) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + t[0], M[3] * p[0] + M[4] * p[1] + M[5] * p[2] + t[1], M[6] * p[0] + M[7] * p[1] + M[8] * p[2] + t[2]];
const CS = 8, nc = Math.floor(Lb / CS), grid = new Map(), mols = [];
const key = (i, j, k) => ((i + nc) % nc) * nc * nc + ((j + nc) % nc) * nc + ((k + nc) % nc);
const DMIN = 5.0;   // Å between C-alphas of different molecules (side chains then just touch)
let tries = 0;
while (mols.length < NM && tries < 2e6) {
  tries++;
  const t = [rnd() * Lb, rnd() * Lb, rnd() * Lb], q = rq(), M = qm(q);
  // quick reject on centres
  let bad = false;
  for (const m of mols) { const d = t.map((x, k) => { let v = x - m.t[k]; return v - Lb * Math.round(v / Lb); }); if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 40 * 40) { bad = true; break; } }
  if (bad) continue;
  const pts = coarse.map(p => ap(M, p, t).map(x => ((x % Lb) + Lb) % Lb));
  for (const p of pts) {
    const i = Math.floor(p[0] / CS), j = Math.floor(p[1] / CS), k = Math.floor(p[2] / CS);
    for (let a = -1; a <= 1 && !bad; a++) for (let b = -1; b <= 1 && !bad; b++) for (let cc = -1; cc <= 1 && !bad; cc++) {
      const cell = grid.get(key(i + a, j + b, k + cc)); if (!cell) continue;
      for (const r of cell) { const d = [0, 1, 2].map(m => { let v = p[m] - r[m]; return v - Lb * Math.round(v / Lb); }); if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < DMIN * DMIN) { bad = true; break; } }
    }
    if (bad) break;
  }
  if (bad) continue;
  for (const p of pts) { const kk = key(Math.floor(p[0] / CS), Math.floor(p[1] / CS), Math.floor(p[2] / CS)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(p); }
  mols.push({ t, q });
}
const volFrac = mols.length * 64500 / 6.022e23 / 1.35 / (Lb * 1e-8) ** 3;   // protein partial volume 0.74 cm3/g
console.log(`placed ${mols.length} in ${tries} tries; protein volume fraction ${volFrac.toFixed(3)} (crowding in a red cell ~0.25)`);
// a pocket of water to dive into: the point farthest from any atom, near the box centre
const nh0 = Math.round(Lb / (Lb / Math.floor(Lb / 6))); const allPts = []; for (const m of mols) { const M = qm(m.q); for (const a of atoms) allPts.push(ap(M, a.p, m.t)); }
const HS = Lb / Math.floor(Lb / 6), hash = new Map(); for (const p of allPts) { const k = [0, 1, 2].map(i => Math.floor((((p[i] % Lb) + Lb) % Lb) / HS) % nh0); const kk = k.join(','); if (!hash.has(kk)) hash.set(kk, []); hash.get(kk).push(p); }
const nh = nh0;
function clearance(x) {
  let best = 1e9; const k = x.map(v => Math.floor((((v % Lb) + Lb) % Lb) / HS));
  for (let a = -5; a <= 5; a++) for (let b = -5; b <= 5; b++) for (let cc = -5; cc <= 5; cc++) {
    const cell = hash.get([((k[0] + a) % nh + nh) % nh, ((k[1] + b) % nh + nh) % nh, ((k[2] + cc) % nh + nh) % nh].join(',')); if (!cell) continue;
    for (const p of cell) { const d = [0, 1, 2].map(i => { let v = p[i] - x[i]; return v - Lb * Math.round(v / Lb); }); best = Math.min(best, Math.hypot(...d)); }
  }
  return best;
}
// a water-filled gap about 1.2 nm from the nearest protein atom: room for a few layers of water, protein in view
let target = null, tb = 0;
for (let s = 0; s < 3000; s++) { const x = [0, 1, 2].map(() => Lb * (0.35 + 0.3 * rnd())); const c2 = clearance(x); if (!target || Math.abs(c2 - 12) < Math.abs(tb - 12)) { tb = c2; target = x; } }
console.log(`water pocket at ${target.map(v => (v / 10).toFixed(2))} nm: nearest protein atom ${(tb / 10).toFixed(2)} nm away`);
// encode: template atoms (0.1 Å int16 + element byte), molecules (centre Å float, quaternion)
const tpl = new Int16Array(3 * atoms.length), el = new Uint8Array(atoms.length);
atoms.forEach((a, i) => { tpl.set(a.p.map(x => Math.round(x * 10)), 3 * i); el[i] = a.e; });
const molArr = new Float32Array(7 * mols.length); mols.forEach((m, i) => molArr.set([...m.t, ...m.q], 7 * i));
const b64 = a => zlib.gzipSync(Buffer.from(a.buffer), { level: 9 }).toString('base64');
const out = { box: Lb, n: mols.length, nAtoms: atoms.length, tpl: b64(tpl), el: b64(el), mols: b64(molArr), target, clear: tb, ext, conc: 330 };
fs.writeFileSync('../../hb_data.js', `globalThis.PTEN_HB = ${JSON.stringify(out)};\n`);
console.log('hb_data.js', (fs.statSync('../../hb_data.js').size / 1024).toFixed(0), 'KB');
