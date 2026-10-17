const fs = require('fs'); const { vec, BODIES } = require('./fetch_horizons.js');
(async () => {
  const jds = process.argv.slice(3).map(Number), out = {};
  for (const [name, id] of BODIES) {
    const ok = id.includes(';') ? jds.filter(j => j > 2305448 && j < 2634160) : jds;
    if (!ok.length) continue;
    out[name] = await vec(id, ok); console.error(name, out[name].rows.length);
  }
  fs.writeFileSync(`data/${process.argv[2]}.json`, JSON.stringify(out));
})();
