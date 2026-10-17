// screenshot a page served from this folder: node shot.js 'dev.html?..' out.png [w h dpr]
const { chromium } = require('/tmp/claude-1000/-home-bp-workspace-claude/252ea527-5c0f-4e10-abec-2c475371f89c/scratchpad/node_modules/playwright');
(async () => {
  const [url, out, w = 1400, h = 800, dpr = 1] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  page.on('console', m => console.log(m.text())); page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.goto('http://localhost:8790/' + url);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 300000 });
  await page.screenshot({ path: out });
  await browser.close();
})();
