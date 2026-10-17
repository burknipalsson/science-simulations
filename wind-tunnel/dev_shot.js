// Dev: run a scene for some steps on the GPU and save screenshots.  usage: node dev_shot.js <json opts> <out prefix>
const path = require('path');
const { chromium } = require(process.env.PW || '/tmp/claude-1000/-home-bp-workspace-claude/8c606473-aa7d-46ba-b83f-fcf536a43dd5/scratchpad/node_modules/playwright');
(async () => {
  const opts = JSON.parse(process.argv[2] || '{}'), out = process.argv[3] || '/tmp/claude-1000/-home-bp-workspace-claude/8c606473-aa7d-46ba-b83f-fcf536a43dd5/scratchpad/shot';
  const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog'] });
  const page = await browser.newPage({ viewport: { width: opts.w || 1400, height: opts.h || 800 } });
  page.on('console', m => console.log(m.text()));
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.setContent(`<body style="margin:0;background:#000"><canvas id=c width=${opts.w || 1400} height=${opts.h || 800}></canvas></body>`);
  for (const f of ['lbm_gpu.js', 'shapes.js', 'viz.js', 'dev_scene.js']) await page.addScriptTag({ path: path.join(__dirname, f) });
  const shots = opts.shots || [{}];
  await page.evaluate(o => DEV.setup(o), opts);
  for (let i = 0; i < shots.length; i++) {
    await page.evaluate(s => DEV.run(s), shots[i]);
    await page.screenshot({ path: `${out}${i}.png` });
  }
  await browser.close();
})();
