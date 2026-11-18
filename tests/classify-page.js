// Debug tool: prints how the matcher classifies every control on a page.
//   node tests/classify-page.js http://localhost:8765/greenhouse-like.html
//   node tests/classify-page.js tests/pages/lever-like.html
const { chromium } = require('playwright');
const path = require('path');

const SRC = ['text.js', 'util.js', 'matcher.js'].map((f) => path.resolve(__dirname, '..', 'src', f));

(async () => {
  const target = process.argv[2];
  if (!target) { console.error('usage: node tests/classify-page.js <url|file>'); process.exit(2); }
  const url = /^https?:|^file:/.test(target) ? target : 'file://' + path.resolve(target);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load' });
  for (const f of SRC) await page.addScriptTag({ path: f });
  const rows = await page.evaluate(() => {
    const M = window.JA.matcher;
    return M.collectControls(document).map((el) => {
      const c = M.classifyControl(el);
      return {
        kind: c && c.kind,
        key: c && c.key,
        part: c && c.part,
        section: M.sectionOf(el),
        label: c && c.label,
        group: c && c.hints.group,
        parts: c && c.hints.parts.slice(0, 3).join(' | '),
      };
    });
  });
  console.table(rows);
  await browser.close();
})();
