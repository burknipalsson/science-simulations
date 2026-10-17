// Screenshot the built page in headless Chromium on the GPU.
// usage: node page_shot.js out.png [width] [height] [waitMs] [js-to-run-before-wait] [scrollSelector]
const SP = '/tmp/claude-1000/-home-bp-workspace-claude/0d0a3e2d-f998-4bfd-ba6b-319a3e10fcef/scratchpad';
const { chromium } = require(SP + '/node_modules/playwright');
(async () => {
  const [out, w = 1400, h = 1000, wait = 6000, js = '', sel = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog', '--disable-features=GpuWatchdog'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DPR || 1) });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || process.env.LOG) console.log('console:', m.text()); });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.addInitScript(() => { window.__DEV = true; });
  await page.goto('http://localhost:8778/test.html');
  if (js) await page.evaluate(js);
  await page.waitForTimeout(+wait);
  if (sel) await page.evaluate(s => document.querySelector(s).scrollIntoView(), sel);
  if (sel) await page.waitForTimeout(800);
  const info = await page.evaluate(() => typeof APP !== 'undefined' && APP ? JSON.stringify({ N: APP.state.N, bench: APP.state.benchMs, spf: APP.state.spf, fired: APP.state.fired, landed: APP.state.landed }) : 'no APP');
  console.log(info);
  await page.screenshot({ path: out, fullPage: !!process.env.FULL });
  await browser.close();
})();
