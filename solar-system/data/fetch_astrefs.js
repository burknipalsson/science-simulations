const fs = require('fs'); const { vec } = require('./fetch_horizons.js');
(async () => {
  const ids = { Eros: '433;', Hektor: '624;', Hilda: '153;', Ganymed: '1036;', Phaethon: '3200;', Apophis: '99942;', Chariklo: '10199;', Eris: '136199;', Achilles: '588;' };
  const jds = [2443144.5, 2451545.0, 2461200.5, 2462240.5, 2470000.5, 2479000.5];
  const out = {};
  for (const [n, id] of Object.entries(ids)) { out[n] = (await vec(id, jds, '500@10')).rows; console.error(n); }
  fs.writeFileSync('data/astrefs.json', JSON.stringify(out));
})();
