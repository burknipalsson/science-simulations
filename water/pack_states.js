// node pack_states.js <gen_states output file> : write states.js (gzip + base64 of each float32 state)
const fs = require('fs'), zlib = require('zlib');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.startsWith('STATE '));
const old = fs.existsSync('states.js') ? eval(fs.readFileSync('states.js', 'utf8').replace(/^window\.WATER_STATES = /, '(').replace(/;\s*$/, ')')) : {};
for (const l of lines) {
  const [, name, meta, b64] = l.match(/^STATE (\S+) (\{.*?\}) (\S+)$/);
  const raw = Buffer.from(b64, 'base64');
  const gz = zlib.gzipSync(raw, { level: 9 });
  old[name] = { meta: JSON.parse(meta), b64: gz.toString('base64') };
  console.log(name, JSON.parse(meta).n, (raw.length / 1024).toFixed(0) + ' KB raw', (gz.length / 1024).toFixed(0) + ' KB gz');
}
fs.writeFileSync('states.js', 'window.WATER_STATES = ' + JSON.stringify(old) + ';\n');
