// Extra 2.0 screenshots: the eye on each relationship row, and a read-only copy. node shots2.js <page.html> <workbook.xlsx> <read-only.html> <outdir>
const B = process.env.NODE_MODULES; const fs = require('fs'), path = require('path'); const { chromium } = require(B + '/playwright');
const [page_, wbk, ro, out] = process.argv.slice(2); const SCALE = 1.25, boxes = JSON.parse(fs.readFileSync(path.join(out, 'boxes.json'), 'utf8'));
const box = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x, b.y, b.width, b.height].map(v => Math.round(v * SCALE)); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: SCALE })).newPage();
  await p.goto('file://' + page_); await p.waitForTimeout(1200); await p.setInputFiles('#file', wbk); await p.waitForTimeout(2500); await p.keyboard.press('Escape');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(600); await p.click('[data-eq=all]'); await p.waitForTimeout(2500); await p.click('[data-ez="0"]'); await p.waitForTimeout(400);
  await p.locator('#erdcv svg g.node[id*="entity-sample_testproject-"] .eyebtn[data-rk^="n:"]').click(); await p.waitForTimeout(2500); await p.mouse.move(5, 500); await p.waitForTimeout(300);
  boxes['18-erd-eyes'] = [await box(p, '#erdcv svg g.node[id*="entity-sample_testtask-"] .eyebtn'), await box(p, '#erdcv svg g.node[id*="entity-sample_testproject-"] .eyebtn[data-rk^="n:"]'), await box(p, '#erdhid a')];
  await p.screenshot({ path: path.join(out, '18-erd-eyes.png') });
  const q = await (await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: SCALE })).newPage();
  await q.goto('file://' + ro); await q.waitForTimeout(1800);
  await q.click('#btnExport'); await q.waitForTimeout(400);
  boxes['19-readonly'] = [await box(q, '.rochip'), await box(q, '#btnExport'), await box(q, '.menu [data-x="ro-xlsx"]')];
  await q.screenshot({ path: path.join(out, '19-readonly.png'), clip: { x: 0, y: 0, width: 1440, height: 460 } });
  fs.writeFileSync(path.join(out, 'boxes.json'), JSON.stringify(boxes, null, 1)); console.log('ok'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
