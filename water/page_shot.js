// node page_shot.js <out-prefix> [waitMs] [dpr] [actions-js] : load the built test page over http and screenshot
const SP = '/tmp/claude-1000/-home-bp-workspace-claude/fab86ba8-25f1-4aab-a494-ef82e4c1167e/scratchpad';
const { chromium } = require(SP + '/node_modules/playwright');
(async () => {
  const [out, wait = 8000, dpr = 1, actions = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: +dpr });
  page.on('console', m => console.log('console:', m.text())); page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.goto('http://localhost:8777/test.html');
  if (actions) await page.evaluate(actions);
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: `${out}_stage.png` });
  const info = await page.evaluate(() => ({ hud: document.getElementById('hud').innerText, clock: document.getElementById('clock').innerText, spf: APP && APP.state.spf, work: APP && APP.state.work, fdt: APP && APP.state.frameDt }));
  console.log(JSON.stringify(info));
  await page.screenshot({ path: `${out}_full.png`, fullPage: true });
  await browser.close();
})();
