const { run } = require('./climate.js');
const p = JSON.parse(process.argv[2]);
const log = console.log; let out = [];
console.log = (...a) => out.push(a.join(' '));
const r = run({ days: +process.argv[3] || 20, avgFrom: +process.argv[4] || 8, ph: Object.assign({ sstMode: true }, p) });
console.log = log;
console.log(JSON.stringify(p), '\n', out.find(l => l.startsWith('GLOBAL')));
