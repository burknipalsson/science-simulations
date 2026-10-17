// Run GPU cases in headless Chromium on the real GPU.  usage: node gpu_run.js <case> [args...]
const path = require('path');
const SP = '/tmp/claude-1000/-home-bp-workspace-claude/0d0a3e2d-f998-4bfd-ba6b-319a3e10fcef/scratchpad';
const { chromium } = require(process.env.PW || SP + '/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog', '--disable-features=GpuWatchdog'] });
  const page = await browser.newPage();
  page.on('console', m => console.log(m.text()));
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.setContent('<canvas id=c width=8 height=8></canvas>');
  for (const f of ['tdse_cpu.js', 'tdse_gpu.js', 'scenes.js', 'hydrogen.js', 'atom.js', 'gpu_cases.js']) await page.addScriptTag({ path: path.join(__dirname, f) });
  const [name, ...args] = process.argv.slice(2);
  page.setDefaultTimeout(0);
  await page.evaluate(([n, a]) => CASES[n](...a), [name, args]);
  await browser.close();
})();
