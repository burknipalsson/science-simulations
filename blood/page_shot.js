// screenshot the built page from the scratchpad server: node page_shot.js out.png [w h dpr wait_ms scroll_to_id]
const { chromium } = require('/tmp/claude-1000/-home-bp-workspace-claude/252ea527-5c0f-4e10-abec-2c475371f89c/scratchpad/node_modules/playwright');
(async () => {
  const [out, w = 1400, h = 900, dpr = 1, wait = 8000, sel = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  page.on('console', m => { if (m.type() !== 'log' || /error|warn|DBG/i.test(m.text())) console.log(m.type(), m.text()); });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.goto('http://localhost:8791/test.html' + (process.env.Q || ''));
  await page.waitForTimeout(+wait);
  if (sel) { await page.evaluate(s => document.getElementById(s).scrollIntoView(), sel); await page.waitForTimeout(1500); }
  await page.screenshot({ path: out });
  await browser.close();
})();
