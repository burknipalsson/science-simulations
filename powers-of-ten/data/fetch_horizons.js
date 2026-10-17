// Fetch heliocentric ecliptic J2000 state vectors (km, km/s) at the landing epoch from JPL Horizons,
// plus apparent alt/az of the Sun and Moon seen from Hallgrimskirkja (for validating the frame chain).
const fs = require('fs');
const EPOCH = '2026-10-16 13:00';            // UTC (TDB offset ignored at this level, 69 s)
const bodies = { mercury: 199, venus: 299, earth: 399, emb: 3, moon: 301, mars: 499, jupiter: 599, saturn: 699, uranus: 799, neptune: 899 };
const base = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=json';
async function q(params) {
  const u = base + Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
  const r = await fetch(u); const j = await r.json(); return j.result;
}
(async () => {
  const out = { epoch: EPOCH + ' UTC', states: {}, sky: {} };
  for (const [name, id] of Object.entries(bodies)) {
    const res = await q({ COMMAND: `'${id}'`, EPHEM_TYPE: 'VECTORS', CENTER: "'500@10'", REF_PLANE: 'ECLIPTIC',
      START_TIME: `'${EPOCH}'`, STOP_TIME: `'2026-10-16 13:01'`, STEP_SIZE: "'1m'", OUT_UNITS: 'KM-S', VEC_TABLE: '2', CSV_FORMAT: 'YES', TIME_TYPE: 'UT' });
    const line = res.split('$$SOE')[1].trim().split('\n')[0].split(',').map(s => s.trim());
    out.states[name] = line.slice(2, 8).map(Number);
  }
  for (const [name, id] of Object.entries({ sun: 10, moon: 301 })) {
    const res = await q({ COMMAND: `'${id}'`, EPHEM_TYPE: 'OBSERVER', CENTER: "'coord@399'", COORD_TYPE: 'GEODETIC',
      SITE_COORD: "'-21.92667,64.14167,0.075'", START_TIME: `'${EPOCH}'`, STOP_TIME: `'2026-10-16 13:01'`, STEP_SIZE: "'1m'",
      QUANTITIES: "'4,20'", CSV_FORMAT: 'YES', APPARENT: 'AIRLESS', ANG_FORMAT: 'DEG' });
    const line = res.split('$$SOE')[1].trim().split('\n')[0].split(',').map(s => s.trim());
    out.sky[name] = { line };
  }
  fs.writeFileSync(__dirname + '/horizons.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})();
