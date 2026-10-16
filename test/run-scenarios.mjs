import { chromium } from '/home/claude/soundapps-ads-demo/node_modules/playwright/index.mjs';
const only = process.argv[2] ? process.argv[2].split(',') : null;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto('file:///home/claude/soundapps-web-demo/dist/standalone.html');
await p.click('#start');
await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/claude-0/w-start.png' });
const ids = await p.evaluate(() => window.demo.guide && Object.keys(window.demo.guide) && [...document.querySelectorAll('[data-sel]')].map((b) => b.dataset.sel));
const out = [];
for (const id of ids) {
  if (only && !only.includes(id)) continue;
  const t0 = Date.now();
  await p.click(`[data-sel="${id}"]`); await p.click('[data-g="auto"]');
  await p.waitForFunction(() => window.demo.guide.run && window.demo.guide.run.status === 'done', null, { timeout: 120000 }).catch(() => {});
  const r = await p.evaluate(() => { const r = window.demo.guide.run; return { status: r.status, error: r.error, steps: r.steps.map((s) => [s.label, s.done]), forbids: r.forbids.map((f) => [f.label, f.violated]) }; });
  const dom = await p.evaluate(() => document.querySelector('#guide .verdict')?.textContent || '');
  const pass = dom === 'Sesuai PRD' && !r.error && r.steps.every((s) => s[1]) && r.forbids.every((f) => !f[1]);
  out.push([pass ? '✅' : '❌', id, ((Date.now() - t0) / 1000).toFixed(1) + 's', pass ? '' : JSON.stringify(r)]);
  console.log(out.at(-1).join('  '));
  if (id === 'alur') await p.screenshot({ path: '/tmp/claude-0/w-alur.png' });
}
await p.screenshot({ path: '/tmp/claude-0/w-end.png' });
console.log('JS errors:', errors.slice(0, 10));
await b.close();
