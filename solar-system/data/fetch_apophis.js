const fs = require('fs');
(async () => {
  const p = new URLSearchParams({ format: 'text', COMMAND: "'99942;'", EPHEM_TYPE: 'VECTORS', CENTER: "'500@10'", START_TIME: "'2029-03-01'", STOP_TIME: "'2029-05-31'", STEP_SIZE: "'2 h'", OUT_UNITS: 'AU-D', REF_PLANE: 'ECLIPTIC', VEC_TABLE: '2', CSV_FORMAT: 'YES', TIME_TYPE: 'TDB' });
  const t = await (await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + p)).text();
  const m = t.match(/\$\$SOE([\s\S]*)\$\$EOE/);
  const rows = m[1].trim().split('\n').map(l => l.split(',').map(s => s.trim())).map(r => [+r[0], ...r.slice(2, 8).map(Number)]);
  const nb = JSON.parse(fs.readFileSync('data/notable.json')); nb.craft['Apophis 2029'] = rows; fs.writeFileSync('data/notable.json', JSON.stringify(nb)); console.log(rows.length);
})();
