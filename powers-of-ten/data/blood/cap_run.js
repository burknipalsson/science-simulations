// usage: node cap_run.js out.json '{options}'  (headless Chromium on the real GPU)
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PW || '/tmp/claude-1000/-home-bp-workspace-claude/230dfc85-99e5-4a70-849b-9d3bbca8dc6b/scratchpad/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog', '--disable-features=GpuWatchdog'] });
  const page = await browser.newPage();
  page.on('console', m => console.log(m.text()));
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.setContent('<canvas id=c width=8 height=8></canvas>');
  const B = path.join(__dirname, '../../../blood');
  for (const f of ['mesh.js', 'membrane.js', 'shape.js', 'units.js', 'pries.js', 'pack.js', 'gpu.js']) await page.addScriptTag({ path: path.join(B, f) });
  await page.addScriptTag({ path: path.join(__dirname, 'cap_case.js') });
  const o = Object.assign({ D: 7.4, L: 48, ncell: 4, u: 0.65, tune: 6, settle: 10, every: 0.5, frames: 121 }, JSON.parse(process.argv[3] || '{}'));
  const r = await page.evaluate(o => capCase(o), o);
  fs.writeFileSync(process.argv[2], JSON.stringify(r));
  await browser.close();
})();
