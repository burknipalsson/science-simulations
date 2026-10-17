// usage: node wind_run.js out.json '{"...options"}'  (headless Chromium on the real GPU)
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PW || '/tmp/claude-1000/-home-bp-workspace-claude/230dfc85-99e5-4a70-849b-9d3bbca8dc6b/scratchpad/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog', '--disable-features=GpuWatchdog'] });
  const page = await browser.newPage();
  page.on('console', m => console.log(m.text()));
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.setContent('<canvas id=c width=8 height=8></canvas>');
  const WT = path.join(__dirname, '../../../wind-tunnel');
  for (const f of [path.join(WT, 'lbm_gpu.js'), path.join(WT, 'shapes.js'), path.join(WT, 'viz.js'), path.join(__dirname, '../../person.js'), path.join(__dirname, 'wind_case.js')]) await page.addScriptTag({ path: f });
  const o = Object.assign({ dx: 0.01, Lx: 3.6, Ly: 2.0, Lz: 2.4, up: 1.1, theta: 0, U: 0.05, uReal: 2.8, z0: 0.3, zr: 1.5, nPart: 2048, rakeY: 0.6, rakeZ: 2.0, fps: 30, sub: 6, spin: 2.5, rec: 5.5, noBody: false }, JSON.parse(process.argv[3] || '{}'));
  const r = await page.evaluate(o => windCase(o), o);
  fs.writeFileSync(process.argv[2], JSON.stringify(r));
  await browser.close();
})();
