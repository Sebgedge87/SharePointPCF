// The ERD with one table's relationship panel open and a relationship hidden. node shot.js <page.html> <workbook.xlsx> <outdir>
const B = process.env.NODE_MODULES; const fs = require('fs'), path = require('path'); const { chromium } = require(B + '/playwright');
const [page_, wbk, out] = process.argv.slice(2); const SCALE = 1.25;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: SCALE })).newPage();
  await p.goto('file://' + page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(1800); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(600); await p.click('[data-eq=all]'); await p.waitForTimeout(3000);
  const btn = p.locator('.erdv .lst label:has(.lg:text-is("formus_testproject")) [data-relopen]'); await btn.click(); await p.waitForTimeout(300);
  console.log(await p.innerText('[data-relpanel]'));
  const cb = p.locator('[data-relpanel] label').nth(1); await cb.locator('input').uncheck(); await p.waitForTimeout(3000);
  await btn.evaluate(e => { document.querySelector('.erdv .ctl').scrollTop = 1e5; const l = document.getElementById('erdlst'); l.scrollTop = e.closest('label').offsetTop - l.offsetTop - 8; }); await p.waitForTimeout(300);
  const boxes = []; for (const l of [btn, cb, p.locator('#erdhid a')]) { const bb = await l.boundingBox(); boxes.push([bb.x, bb.y, bb.width, bb.height].map(v => Math.round(v * SCALE))); }
  await p.screenshot({ path: path.join(out, '18-erd-hide.png') });
  fs.writeFileSync(path.join(out, 'boxes.json'), JSON.stringify({ '18-erd-hide': boxes }));
  console.log(await p.innerText('#erdinfo')); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
