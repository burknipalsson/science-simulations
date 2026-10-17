const fs = require('fs');
(async () => {
  const p = new URLSearchParams({ format: 'text', COMMAND: "'301'", EPHEM_TYPE: 'VECTORS', CENTER: "'500@399'",
    START_TIME: "'1876-01-01'", STOP_TIME: "'2176-01-01'", STEP_SIZE: "'97 d'", OUT_UNITS: 'AU-D', REF_PLANE: 'ECLIPTIC',
    VEC_TABLE: '2', CSV_FORMAT: 'YES', TIME_TYPE: 'TDB' });
  const t = await (await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + p)).text();
  const m = t.match(/\$\$SOE([\s\S]*)\$\$EOE/);
  const rows = m[1].trim().split('\n').map(l => l.split(',').map(s => s.trim())).map(r => ({ jd: +r[0], s: r.slice(2, 8).map(Number) }));
  fs.writeFileSync('data/moonfit.json', JSON.stringify(rows)); console.log(rows.length);
})();
