// Run GPU cases in headless Chromium on the real GPU.  usage: node gpu_run.js <case> [args...]
const path = require('path');
const { chromium } = require(process.env.PW || '/tmp/claude-1000/-home-bp-workspace-claude/252ea527-5c0f-4e10-abec-2c475371f89c/scratchpad/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog', '--disable-features=GpuWatchdog'] });
  const page = await browser.newPage();
  page.on('console', m => console.log(m.text()));
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.setContent('<canvas id=c width=8 height=8></canvas>');
  for (const f of ['mesh.js', 'membrane.js', 'shape.js', 'units.js', 'pries.js', 'pack.js', 'gpu.js', 'gpu_cases.js']) await page.addScriptTag({ path: path.join(__dirname, f) });
  const [name, ...args] = process.argv.slice(2);
  if (process.env.NOFIX) await page.evaluate(() => { window.NOFIX = 1; });
  await page.evaluate(([n, a]) => CASES[n](...a), [name, args]);
  await browser.close();
})();
