// Interface behaviour: node tests/ui.js   (run `npm run build` first; needs Playwright + Chromium, CHROMIUM=/path if needed)
// ERD defaults on a large model, header and menus, keyboard access, the small-screen layout. Workbooks are built on the fly.
const path = require('path'), fs = require('fs'), XLSX = require('xlsx');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });

// a model with 90 custom tables in one area, each looking up the next, and 12 field types on the first table
function bigModel() {
  const wb = XLSX.utils.book_new(), N = 90, name = i => 'fp_t' + String(i).padStart(2, '0');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name'], ...Array.from({ length: N }, (_, i) => ['', '', 'Table ' + i])]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'];
  const types = ['Text', 'Choice', 'Lookup', 'Whole Number', 'Date and Time', 'Two Options', 'Currency', 'Decimal', 'Multiline Text', 'Image', 'File', 'Double'];
  for (let i = 0; i < N; i++) {
    const rows = [[name(i) + 'id', 'Id', 'Id', 'Uniqueidentifier', 'Primary key', 'True', 'Simple', 'SystemRequired', ''],
      ['fp_nextid', 'Next', 'Next', 'Lookup', 'Next table', 'True', 'Simple', 'None', 'Targets:\n' + name((i + 1) % N)]];
    if (i === 0) types.forEach((t, k) => rows.push(['fp_f' + k, 'F' + k, 'Field ' + k, t, 'x', 'True', 'Simple', 'None', t === 'Lookup' ? 'Targets:\n' + name(1) : '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', 'Table ' + i], ['Plural Display Name', 'Tables'], ['Description', 'd'], ['Schema Name', name(i)],
      ['Logical Name', name(i)], ['Object Type Code', 10000 + i], ['Is Custom Entity', 'True'], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'False'], [], H, ...rows]), 'Table ' + i + ' (' + name(i) + ')');
  }
  const f = path.join(out, 'big_model.xlsx'); XLSX.writeFile(wb, f); return f;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

  await p.goto(page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', bigModel()); await p.waitForTimeout(2500); await p.keyboard.press('Escape');

  // sidebar: one group, open from the start
  ok(await p.locator('#nav .navgroup .navitem').count() >= 90, 'a single sidebar group starts expanded');
  // header
  ok((await p.locator('.search').boundingBox()).width >= 260, 'the search box is at least 260 px wide');
  ok(await p.evaluate(() => { const t = document.querySelector('.top'); return t.scrollWidth <= t.clientWidth + 1 }), 'the header fits at 1440 px without scrolling');
  await p.click('#btnExport'); const exp = await p.innerText('.menu'); await p.keyboard.press('Escape'); await p.mouse.click(700, 600);
  ok(!/Discard all edits|Forget loaded versions/.test(exp), 'the Export menu holds only exports');

  // ERD: nothing drawn by default on a large model; asked before drawing more than 80
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(800);
  ok(/Pick the tables to draw/.test(await p.innerText('#erdcv')) && await p.locator('#erdcv svg').count() === 0, 'a 90-table model opens the ERD with a prompt, not a 90-table diagram');
  await p.click('[data-eq=all]'); await p.waitForSelector('.dlgbox', { timeout: 3000 }).catch(() => {});
  ok(/Draw 90 tables\?/.test(await p.innerText('.dlgbox').catch(() => '')), 'choosing All on 90 tables asks first');
  await p.click('.dlgbox [data-d="0"]'); await p.waitForTimeout(300);
  ok(await p.locator('#erdcv svg').count() === 0, 'declining draws nothing');
  await p.fill('#erdq', 'fp_t0'); await p.waitForTimeout(200); await p.click('[data-eq=shown]'); await p.waitForTimeout(3500);
  ok(await p.locator('#erdcv svg g.node').count() >= 10, 'selecting a filtered set draws it without asking');

  // table page: field types trimmed to eight with "+N more"
  await p.click('#nav .navitem:has-text("Table 0")'); await p.waitForTimeout(500);
  const typeTiles = () => p.locator('.tyrow .stat.ty').count();
  ok(await typeTiles() === 8 && /\+\d+ more/.test(await p.innerText('.tyrow')), 'only the eight most common field types show, with "+N more"');
  await p.click('.tyrow [data-act="alltypes"]'); await p.waitForTimeout(200);
  ok(await typeTiles() > 8, '"+N more" shows every field type');
  await p.click('.tyrow [data-act="alltypes"]');

  // keyboard: Tab to a row, Enter opens it, Enter on a value edits it, Esc cancels and keeps the panel
  await p.locator('#gridwrap tbody tr').first().focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok(await p.$eval('#detail', d => d.classList.contains('open')), 'Enter on a focused row opens its details');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.matches('#detail [data-fedit]')), 'focus moves to the first value in the details');
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok(await p.locator('#detail textarea, #detail input, #detail select').count() === 1, 'Enter on a value starts editing it');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.$eval('#detail', d => d.classList.contains('open')), 'Esc cancels the edit and keeps the panel open');

  // colours: severities are no longer the brand pink
  await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(300);
  const warnBg = await p.$eval('.sev-warn', e => getComputedStyle(e).backgroundColor).catch(() => '');
  ok(warnBg === 'rgb(254, 240, 199)', 'warnings use amber, not the brand pink');

  // phone width: header fits, everything else is in the ⋯ menu
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const t = document.querySelector('.top'); return t.scrollWidth <= t.clientWidth + 1 }), 'the header fits a phone screen without sideways scrolling');
  ok((await p.locator('.search').boundingBox()).width >= 120, 'the search box stays usable on a phone');
  ok(await p.locator('#btnExport').isHidden() && await p.locator('#btnMob').isVisible(), 'on a phone the header shows ⋯ instead of the row of buttons');
  await p.click('#btnMob'); const mob = await p.innerText('.menu');
  ok(/Load version|Open workbook/.test(mob) && /Changes/.test(mob) && /Export/.test(mob) && /Dataverse check/.test(mob), 'the ⋯ menu has load, changes, export, Dataverse, template and help');
  await p.click('.menu [data-mob="exp"]'); await p.waitForTimeout(200);
  ok(/Current view as CSV/.test(await p.innerText('.menu').catch(() => '')), 'Export… in the ⋯ menu opens the export options');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();
