const fs = require('fs');
async function vecRange(cmd, start, stop, step, center = '500@10') {
  const p = new URLSearchParams({ format: 'text', COMMAND: `'${cmd}'`, EPHEM_TYPE: 'VECTORS', CENTER: `'${center}'`,
    START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: `'${step}'`, OUT_UNITS: 'AU-D', REF_PLANE: 'ECLIPTIC',
    VEC_TABLE: '2', CSV_FORMAT: 'YES', TIME_TYPE: 'TDB' });
  const t = await (await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + p)).text();
  const m = t.match(/\$\$SOE([\s\S]*)\$\$EOE/);
  if (!m) { console.error(cmd, t.slice(-1500)); return []; }
  return m[1].trim().split('\n').map(l => l.split(',').map(s => s.trim())).map(r => [+r[0], ...r.slice(2, 8).map(Number)]);
}
(async () => {
  const out = { small: {}, craft: {} };
  const small = { Halley: 'DES=1P;CAP;NOFRAG', Encke: 'DES=2P;CAP;NOFRAG', 'Swift–Tuttle': 'DES=109P;CAP;NOFRAG', 'Tempel–Tuttle': 'DES=55P;CAP;NOFRAG', 'Hale–Bopp': 'DES=C/1995 O1;CAP;NOFRAG',
    Eris: '136199;', Makemake: '136472;', Haumea: '136108;', Sedna: '90377;', Gonggong: '225088;', Quaoar: '50000;', Arrokoth: '486958;', Apophis: '99942;' };
  for (const [n, id] of Object.entries(small)) { out.small[n] = (await vecRange(id, 'JD2461041.5', 'JD2461042.5', '1 d'))[0]; console.error(n, !!out.small[n]); }
  // spacecraft: coarse track + fine windows around encounters
  const craft = {
    'Voyager 1': ['-31', '1977-09-06', [['1979-02-20', '1979-03-20'], ['1980-10-27', '1980-11-27']]],
    'Voyager 2': ['-32', '1977-08-21', [['1979-06-24', '1979-07-24'], ['1981-08-10', '1981-09-10'], ['1986-01-10', '1986-02-08'], ['1989-08-10', '1989-09-08']]],
    'New Horizons': ['-98', '2006-01-20', [['2007-02-14', '2007-03-14'], ['2015-07-01', '2015-07-28']]],
    'Pioneer 10': ['-23', '1972-03-04', [['1973-11-20', '1973-12-20']]],
    'Pioneer 11': ['-24', '1973-04-07', [['1974-11-20', '1974-12-18'], ['1979-08-18', '1979-09-15']]],
  };
  for (const [n, [id, start, wins]] of Object.entries(craft)) {
    const coarse = await vecRange(id, start, '2026-01-01', '8 d');
    let fine = []; for (const [a, b] of wins) fine = fine.concat(await vecRange(id, a, b, '4 h'));
    const all = coarse.filter(r => !wins.some(([a, b]) => false)).concat(fine).sort((x, y) => x[0] - y[0]);
    const dedup = all.filter((r, i) => i === 0 || r[0] - all[i - 1][0] > 1e-6);
    out.craft[n] = dedup; console.error(n, coarse.length, fine.length);
  }
  fs.writeFileSync('data/notable.json', JSON.stringify(out));
})();
