// Fetch state vectors from JPL Horizons (DE441) — barycentric, ecliptic J2000, AU and AU/day, TDB.
const fs = require('fs');
const BODIES = [
  ['Sun', '10'], ['Mercury', '199'], ['Venus', '299'], ['Earth', '399'], ['Moon', '301'],
  ['Mars', '4'], ['Jupiter', '5'], ['Saturn', '6'], ['Uranus', '7'], ['Neptune', '8'], ['Pluto', '9'],
  ['Ceres', '1;'], ['Pallas', '2;'], ['Vesta', '4;'], ['Hygiea', '10;'],
];
async function vec(cmd, jds, center = '500@0') {
  const p = new URLSearchParams({
    format: 'text', COMMAND: `'${cmd}'`, EPHEM_TYPE: 'VECTORS', CENTER: `'${center}'`,
    TLIST: jds.map(j => `'${j}'`).join(' '), TLIST_TYPE: 'JD', OUT_UNITS: 'AU-D', REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'ICRF', VEC_TABLE: '2', CSV_FORMAT: 'YES', TIME_TYPE: 'TDB', OBJ_DATA: 'YES',
  });
  const r = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + p);
  const t = await r.text();
  const m = t.match(/\$\$SOE([\s\S]*)\$\$EOE/);
  if (!m) throw new Error(cmd + ': ' + t.slice(0, 3000));
  const gm = t.match(/GM[^=\n]*km\^3\/s\^2\s*=\s*([0-9.]+)/);
  const rows = m[1].trim().split('\n').map(l => l.split(',').map(s => s.trim()));
  return { gm: gm ? +gm[1] : null, rows: rows.map(r => ({ jd: +r[0], s: r.slice(2, 8).map(Number) })) };
}
module.exports = { vec, BODIES };
if (require.main === module) (async () => {
  const which = process.argv[2];
  const jds = process.argv.slice(3).map(Number);
  const out = {};
  for (const [name, id] of BODIES) {
    const v = await vec(id, jds);
    out[name] = v; console.error(name, v.gm, v.rows.length);
  }
  fs.writeFileSync(`data/${which}.json`, JSON.stringify(out));
})();
