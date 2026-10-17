const fs = require('fs'); const { vec } = require('./fetch_horizons.js');
(async () => {
  const jds = []; for (let k = -40; k <= 40; k++) jds.push(2461041.5 + k * 365.25 * 2 + 0.37 * k);
  const m = await vec('301', jds, '500@399');
  fs.writeFileSync('data/moongeo.json', JSON.stringify(m.rows));
})();
