// Read-only copies: node tests/readonly.js  (run `npm run build` first)
// Makes an edit in the full page, exports a read-only copy, opens it, and checks it shows the edit but cannot change anything.
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), page_ = 'file://' + path.join(root, 'dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
const wbk = path.join(root, 'samples/Import_Test_Model.xlsx');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1000);
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  if (!await p.locator('#nav .navitem:has-text("Test Task")').count()) await p.click('#nav [data-grp="Import test"]');
  await p.click('#nav .navitem:has-text("Test Task")'); await p.waitForTimeout(500);
  const cell = p.locator('#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("formus_priority")) td[data-col="Description"]');
  await cell.dblclick(); await p.keyboard.press('Control+A'); await p.keyboard.type('Read-only check value'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);

  await p.click('#btnExport'); await p.waitForTimeout(200);
  ok(await p.locator('.menu [data-x="ro-copy"]').count() === 1, 'the full page offers Export → Read-only copy (.html)');
  await p.click('.menu [data-x="ro-copy"]'); await p.waitForSelector('.namebox');
  ok(/\(read-only\)\.html$/.test(await p.inputValue('.namebox input')), 'the copy is named "<workbook> (read-only).html"');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('.namebox [data-n="1"]')]);
  const ro = path.join(out, 'readonly_copy.html'); await d.saveAs(ro);
  const html = fs.readFileSync(ro, 'utf8');
  ok(/const DME_MODE = "readonly"/.test(html) && html.length > 1e6 && html.length < 4e6, `the copy is one self-contained page (${(html.length / 1e6).toFixed(1)} MB)`);

  // open the copy in a fresh browser profile, as a client would
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const q = await ctx2.newPage();
  const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.goto('file://' + ro); await q.waitForTimeout(1800);
  ok(await q.isVisible('.rochip') && /read-only/.test(await q.title()), 'the copy says it is read-only');
  ok(/Import_Test_Model/.test(await q.innerText('#main')), 'it opens straight onto the workbook inside it');
  for (const [sel, what] of [['#btnOpen', 'Load version'], ['#btnWb', 'the workbook selector'], ['#btnChanges', 'Changes'], ['#saveState', 'Saved']]) ok(!await q.isVisible(sel), what + ' is not shown');
  ok(!/Build a Dataverse solution/.test(await q.innerText('#main')), 'the Overview has no solution builder');
  if (!await q.locator('#nav .navitem:has-text("Test Task")').count()) await q.click('#nav [data-grp="Import test"]');
  await q.click('#nav .navitem:has-text("Test Task")'); await q.waitForTimeout(500);
  const c2 = q.locator('#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("formus_priority")) td[data-col="Description"]');
  ok(/Read-only check value/.test(await c2.innerText()), 'the edit made in the full page is in the copy');
  await c2.dblclick(); await q.waitForTimeout(300);
  ok(await q.locator('td.editing').count() === 0, 'double-clicking a cell does not edit it');
  ok(!await q.isVisible('[data-act="addrow"]') && !await q.isVisible('[data-act="details"]'), 'no Add field and no Table details editing');
  await c2.click(); await q.waitForTimeout(400);
  ok(!await q.isVisible('#detail [data-setkey]'), 'the field panel has no Set as primary key or name');
  await q.locator('#detail [data-fedit]').first().click(); await q.waitForTimeout(200);
  ok(await q.locator('#detail input, #detail textarea, #detail select').count() === 0, 'clicking a value in the field panel does not edit it');
  await q.keyboard.press('Escape');
  await q.click('#btnExport'); await q.waitForTimeout(200);
  const items = await q.$$eval('.menu [data-x]', bs => bs.map(x => x.dataset.x));
  ok(JSON.stringify(items) === '["csv","csv-all","xlsx-plain"]', 'Export offers only the view as CSV and a plain copy of the values (' + items.join(', ') + ')');
  await q.keyboard.press('Escape'); await q.mouse.click(700, 600);
  await q.click('#btnMore'); await q.waitForTimeout(200);
  ok(await q.locator('.menu [data-more="tmpl"]').count() === 0 && await q.locator('.menu [data-more="dv"]').count() === 1, 'More has the Dataverse check but not the template');
  await q.keyboard.press('Escape'); await q.mouse.click(700, 600);
  await q.click('#nav .navitem[data-view="__erd"]'); await q.waitForTimeout(600); await q.click('[data-eq=all]'); await q.waitForTimeout(2000);
  ok(await q.locator('#erdcv svg g.node').count() === 3, 'the ERD draws');
  await q.click('#nav .navitem[data-view="__issues"]'); await q.waitForTimeout(400);
  ok(await q.locator('#isswrap').count() === 1, 'Checks can be read');
  await q.setInputFiles('#file', wbk); await q.waitForTimeout(800);
  ok(/read-only copy/.test(await q.innerText('#toast')), 'opening another workbook is refused');
  const stored = await q.evaluate(() => new Promise(res => { const r = indexedDB.open('dme.files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f', { keyPath: 'id' }); r.onsuccess = () => { const g = r.result.transaction('f').objectStore('f').getAll(); g.onsuccess = () => res(g.result.length); g.onerror = () => res(-1) }; r.onerror = () => res(-1) }));
  ok(stored === 0, 'the copy keeps no workbook in the browser');
  ok(errs.length === 0 && errs2.length === 0, 'no page errors' + (errs.concat(errs2).length ? ': ' + errs.concat(errs2).join(' | ') : ''));

  // the build script makes one too
  const f2 = path.join(out, 'ro_build.html');
  execFileSync('python3', [path.join(root, 'build.py'), '--readonly', '--workbook', wbk, '--out', f2]);
  const h2 = fs.readFileSync(f2, 'utf8');
  ok(/const DME_MODE = "readonly"/.test(h2) && /Import_Test_Model\.xlsx/.test(h2), 'build.py --readonly --workbook makes a read-only page for that workbook');
  const plain = fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'), 'utf8');
  ok(/const DME_MODE = "edit"/.test(plain), 'the normal build is the full, editable page');
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
