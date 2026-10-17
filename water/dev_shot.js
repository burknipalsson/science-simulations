// node dev_shot.js <scene> <out.png> [args] : render a dev scene in headless Chromium (real GPU)
const path = require('path');
const SP = '/tmp/claude-1000/-home-bp-workspace-claude/fab86ba8-25f1-4aab-a494-ef82e4c1167e/scratchpad';
const { chromium } = require(SP + '/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('console', m => console.log(m.text())); page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  page.setDefaultTimeout(0);
  await page.setContent('<body style="margin:0;background:#000"><canvas id=c width=1200 height=800></canvas></body>');
  for (const f of ['tip4p_cpu.js', 'ice.js', 'setup.js', 'md_gpu.js', 'viz.js', 'scenes.js', 'dev_scenes.js']) await page.addScriptTag({ path: path.join(__dirname, f) });
  const [scene, out, ...args] = process.argv.slice(2);
  await page.evaluate(([s, a]) => SCENES[s](...a), [scene, args]);
  await page.screenshot({ path: out });
  await browser.close();
})();
