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

// a model with areas: Sales (3 tables), Service (2), and one table whose dictionary entry has no area
function areaModel() {
  const wb = XLSX.utils.book_new();
  const T = [['Account', 'fp_a1', 'Sales'], ['Lead', 'fp_a2', 'Sales'], ['Quote', 'fp_a3', 'Sales'], ['Case', 'fp_s1', 'Service'], ['Queue', 'fp_s2', 'Service'], ['Ghost', 'fp_x1', '']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name', 'Purpose'], ...T.map(t => ['', t[2], t[0], 'p'])]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'];
  T.forEach(([disp, ln], i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', disp], ['Plural Display Name', disp], ['Description', 'd'], ['Schema Name', ln],
    ['Logical Name', ln], ['Object Type Code', 20000 + i], ['Is Custom Entity', 'True'], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'False'], [], H,
    ['fp_name', 'Name', 'Name', 'Text', 'x', 'True', 'Simple', 'None', ''],
    ...(ln === 'fp_a1' ? [['fp_total', 'Total', 'Total value', 'Currency', 'Sum of quotes', 'True', 'Calculated', 'None', 'Precision: 2']] : ln === 'fp_a2' ? [['fp_count', 'Count', 'Open count', 'Whole number', 'Rollup of open items', 'True', 'Rollup', 'None', '']] : []),
    ['fp_linkid', 'Link', 'Link', 'Lookup', 'x', 'True', 'Simple', 'None', 'Targets:\n' + (ln === 'fp_s1' ? 'fp_a1' : ln === 'fp_s2' ? 'fp_s1' : 'fp_a1')]]), disp + ' (' + ln + ')'));
  const f = path.join(out, 'area_model.xlsx'); XLSX.writeFile(wb, f); return f;
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
  ok(/Fill in Area in the Table Dictionary/.test(await p.innerText('.erdv .ctl')) && !(await p.locator('[data-areabtn="erd"]').count()), 'with no areas, the ERD explains how to get the area filter');
  await p.click('[data-eq=all]'); await p.waitForSelector('.dlgbox', { timeout: 3000 }).catch(() => {});
  ok(/Draw 90 tables\?/.test(await p.innerText('.dlgbox').catch(() => '')), 'choosing All on 90 tables asks first');
  await p.click('.dlgbox [data-d="0"]'); await p.waitForTimeout(300);
  ok(await p.locator('#erdcv svg').count() === 0, 'declining draws nothing');
  await p.fill('#erdq', 'fp_t0'); await p.waitForTimeout(200); await p.click('[data-eq=shown]'); await p.waitForTimeout(3500);
  ok(await p.locator('#erdcv svg g.node').count() >= 10, 'selecting a filtered set draws it without asking');
  // the first view is sized to the screen resolution, not squeezed into the panel; Fit then fits the panel
  const sz = () => p.evaluate(() => { const s = document.querySelector('#erdcv svg'), c = document.getElementById('erdcv'); return { svg: s.getBoundingClientRect().width, panel: c.clientWidth, screen: screen.width }; });
  const z0 = await sz();
  ok(z0.svg > z0.panel && z0.svg <= z0.screen, `the ERD opens at the screen's size, past the panel (${Math.round(z0.svg)}px drawn, ${z0.panel}px panel, ${z0.screen}px screen)`);
  await p.click('[data-ez="0"]'); await p.waitForTimeout(400);
  const z1 = await sz();
  ok(z1.svg <= z1.panel, 'Fit fits the whole diagram in the panel');

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

  // areas: ERD, Checks and All fields filter by the Table Dictionary's areas; editing an Area applies at once
  await p.setInputFiles('#file', areaModel()); await p.waitForTimeout(800);
  if (await p.locator('.dlgbox').count()) await p.click('.dlgbox [data-d="0"]');
  await p.waitForTimeout(1500); await p.keyboard.press('Escape');
  const pickAreas = async (btn, names) => {
    await p.click(btn); await p.waitForTimeout(150); await p.click('.pop [data-pa="none"]');
    for (const n of names) await p.check(`.pop [data-area="${n}"]`);
    await p.click('.pop [data-pa="apply"]'); await p.waitForTimeout(400);
  };
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(800);
  const listed = await p.$$eval('.erdv .lst h4', h => h.map(x => x.textContent));
  ok(['Sales', 'Service', 'Other tables'].every(a => listed.includes(a)), 'the ERD lists tables under their areas');
  await pickAreas('[data-areabtn="erd"]', ['Service']); await p.waitForTimeout(2500);
  ok(JSON.stringify(await p.$$eval('.erdv .lst h4', h => h.map(x => x.textContent))) === '["Service"]', 'choosing Service narrows the ERD list to Service');
  ok(/^2 tables/.test(await p.innerText('#erdinfo')) && await p.locator('#erdcv svg g.node').count() >= 2, 'and draws the two Service tables (plus what they look up)');
  ok(/Area: Service/.test(await p.innerText('[data-areabtn="erd"]')), 'the Area button shows the choice');
  await p.check('#erdacol'); await p.waitForTimeout(2500);
  ok(/classDef ar\d+c stroke:/.test(await p.inputValue('#erdsrc')) && /Service/.test(await p.innerText('#erdlegend')), 'Colour by area colours each table by its area, with a legend');
  ok(await p.locator('#erdcv svg g.node').count() >= 3 && !(await p.locator('#erdcv .err').count()), 'and the coloured diagram draws (Mermaid rejects decimal line widths)');
  const dio = await (async () => { const [d] = await Promise.all([p.waitForEvent('download'), p.click('.tb [data-ea="drawio"]')]); return fs.readFileSync(await d.path(), 'utf8'); })();
  ok(/strokeColor=#BB1C73/.test(dio) || /strokeColor=#1B7F5C/.test(dio) || /strokeColor=#0A4873/.test(dio), 'the draw.io file carries the area colours');

  // hiding a table's relationships: Case looks up Account, and Queue looks up Case
  const caseBtn = p.locator('.erdv .lst label:has(.lg:text-is("fp_s1")) [data-relopen]');
  ok(/2 rel/.test(await caseBtn.innerText()), 'a table in the ERD list shows how many relationships it has');
  await caseBtn.click(); await p.waitForTimeout(200);
  const relTxt = await p.innerText('[data-relpanel]');
  ok(/Link → Account/.test(relTxt) && /Link ← Queue/.test(relTxt), 'its panel lists its own lookups and the lookups to it');
  const nodePos = async () => { await p.waitForSelector('#erdcv svg g.node[id*="entity-fp_s1-"]', { timeout: 15000 }); return p.evaluate(() => { const all = JSON.parse(localStorage.getItem('dme.erdpos')), pos = all[Object.keys(all).pop()]; return JSON.stringify([pos.fp_s1, pos.fp_s2].map(a => a && a.map(Math.round))); }); };
  const before = await nodePos();
  ok(/fp_a1\[/.test(await p.inputValue('#erdsrc')), 'before hiding, Account is drawn as the table Case looks up');
  await p.uncheck('[data-relk="l:fp_s1|fp_linkid|fp_a1"]'); await p.waitForTimeout(2500);
  ok(!/fp_a1\[/.test(await p.inputValue('#erdsrc')) && /1 hidden by you/.test(await p.innerText('#erdinfo')), 'unticking Case → Account removes that line (and the Account table it brought in)');
  ok(/fp_s2.*fp_s1|fp_s1.*fp_s2/.test((await p.inputValue('#erdsrc')).split('\n').filter(l => /:/.test(l) && /fp_s/.test(l)).join('\n')), 'the other relationship stays');
  { const after = await nodePos(); ok(after === before, 'the tables stay where they were' + (after === before ? '' : ' (' + before + ' → ' + after + ')')); }
  ok(/1 of 2 hidden/.test(await caseBtn.innerText()) && /1 hidden relationship/.test(await p.innerText('#erdhid')), 'the list and the panel header show what is hidden');
  ok(await p.evaluate(() => Object.keys(localStorage).some(k => (localStorage.getItem(k) || '').includes('l:fp_s1|fp_linkid|fp_a1'))), 'hidden relationships are remembered');
  await p.click('[data-relpanel] [data-relall][data-on="0"]'); await p.waitForTimeout(2500);
  ok(/0 relationships/.test(await p.innerText('#erdinfo')) && /2 of 2 hidden/.test(await caseBtn.innerText()), 'Hide all hides every relationship of the table');
  await p.click('#erdhid [data-hidclear]'); await p.waitForTimeout(2500);
  ok(/fp_a1\[/.test(await p.inputValue('#erdsrc')) && !/hidden by you/.test(await p.innerText('#erdinfo')) && !(await p.innerText('#erdhid')), 'show all brings every relationship back');

  await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(300);
  await pickAreas('[data-areabtn="iss"]', ['Sales']);
  const issTables = await p.$$eval('#isswrap tbody tr td:nth-child(2)', c => c.map(x => x.innerText.trim()));
  ok(issTables.length > 0 && issTables.every(t => ['Account', 'Lead', 'Quote'].includes(t)), 'Checks can be filtered to the Sales area');

  await p.click('#nav .navitem[data-view="__all"]'); await p.waitForTimeout(400);
  await pickAreas('[data-areabtn="all"]', ['Service']);
  ok(/^4 of 14 rows/.test(await p.innerText('#count')), 'All fields can be filtered to the Service area (4 of 14 fields)');
  await p.click('[data-clr="areas"]'); await p.waitForTimeout(300);
  ok(/^14 rows/.test(await p.innerText('#count')), 'the area filter clears from its chip');

  // calculated and rollup fields: listed to build by hand, per table
  await p.click('#nav .navitem[data-view="__overview"]'); await p.waitForTimeout(300);
  ok(/To build by hand[\s\S]*2 calculated or rollup fields in 2 tables \(1 calculated, 1 rollup\)/.test(await p.innerText('.ov')), 'the Overview counts the fields to build by hand');
  const [dlm] = await Promise.all([p.waitForEvent('download'), p.click('[data-ov="manual"]')]);
  const mw = XLSX.readFile(await dlm.path());
  ok(JSON.stringify(mw.SheetNames) === '["Summary","By table","All fields"]', 'the hand-build list has Summary, By table and All fields sheets');
  const allRows = XLSX.utils.sheet_to_json(mw.Sheets['All fields']);
  ok(allRows.length === 2 && allRows.some(r => r.Table === 'Account' && r['Logical Name'] === 'fp_total' && r.Kind === 'Calculated' && r.Area === 'Sales')
     && allRows.some(r => r.Table === 'Lead' && r['Logical Name'] === 'fp_count' && r.Kind === 'Rollup'), 'it lists each field with its table, area and kind');
  const byT = XLSX.utils.sheet_to_json(mw.Sheets['By table'], { header: 1 }).map(r => r[0] || '');
  ok(byT.some(c => /^Account\s+\(fp_a1\)/.test(c)) && byT.some(c => /^Lead\s+\(fp_a2\)/.test(c)), 'the By table sheet has a heading per table');
  await p.click('#nav .navitem[data-view="__issues"]'); await p.selectOption('#irule', 'manual-build'); await p.waitForTimeout(300);
  ok(await p.locator('#isswrap tbody tr').count() === 2, 'Checks lists them under "Calculated or rollup field to create by hand"');
  await p.selectOption('#irule', '');

  // give Ghost an area in the dictionary: it moves to Service straight away
  await p.click('#nav .navitem:has-text("Table Dictionary")'); await p.waitForTimeout(400);
  const cell = p.locator('#gridwrap tbody tr:has(td[data-col="Table Name"]:has-text("Ghost")) td[data-col="Area"]');
  await cell.dblclick(); await p.waitForTimeout(150);
  if (await p.locator('#gridwrap td.editing select').count()) await p.selectOption('#gridwrap td.editing select', 'Service');
  else { await p.fill('#gridwrap td.editing input, #gridwrap td.editing textarea', 'Service'); await p.keyboard.press('Enter'); }
  await p.waitForTimeout(400);
  ok((await p.innerText('#nav [data-grp="Service"]')).includes('3'), 'editing Area in the dictionary regroups the sidebar at once (Service now has 3)');
  ok(!(await p.locator('#nav [data-grp="Other tables"]').count()), 'and the "no area" group is gone');

  // a template with an extra table-detail row and an extra field column reads both
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name', 'Purpose'], ['', 'Sales', 'Widget', 'p']]), 'Table Dictionary');
    const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data', 'Data Owner'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', 'Widget'], ['Plural Display Name', 'Widgets'], ['Description', 'd'], ['Schema Name', 'fp_widget'], ['Logical Name', 'fp_widget'],
      ['Object Type Code', 1], ['Is Custom Entity', 'True'], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'False'], ['Primary Name Column', 'fp_name'], ['', '', '', '', '', '', '', '', '', 'Who owns the data'], H,
      ['fp_widgetid', 'Id', 'Id', 'Uniqueidentifier', 'x', 'True', 'Simple', 'None', '', 'IT'], ['fp_name', 'Name', 'Name', 'Text', 'x', 'True', 'Simple', 'ApplicationRequired', 'Format: Text\nMax length: 100', 'Sales ops']]), 'Widget (fp_widget)');
    const f = path.join(out, 'extra_cols.xlsx'); XLSX.writeFile(wb, f);
    await p.setInputFiles('#file', f); await p.waitForTimeout(800); if (await p.locator('.dlgbox').count()) await p.click('.dlgbox [data-d="0"]');
    await p.waitForTimeout(1500); await p.keyboard.press('Escape');
    if (!await p.locator('#nav .navitem:has-text("Widget")').count()) await p.click('#nav [data-grp="Sales"]');
    await p.click('#nav .navitem:has-text("Widget")'); await p.waitForTimeout(500);
    ok(await p.locator('#gridwrap table.grid thead th:has-text("Data Owner")').count() === 1 && /Sales ops/.test(await p.innerText('#gridwrap')), 'a new field column appears in the grid with its values');
    ok(await p.locator('#gridwrap table.grid thead th:has-text("Data Owner") .xtag').count() === 1, 'and is tagged "new" when the template does not have it');
    ok(/Who owns the data/.test(await p.$eval('#gridwrap table.grid thead th:has-text("Data Owner")', e => e.title)), 'its hint text shows on the column heading');
    await p.locator('#gridwrap tbody tr').first().click(); await p.waitForTimeout(400);
    ok(/Data Owner[\s\S]*IT/i.test(await p.innerText('#detail')), 'and in the row details, where it can be edited');
    ok(!/Primary Name Column/.test(await p.$eval('#gridwrap table.grid thead', e => e.innerText)), 'a tenth table-detail row is read as a detail, not as column hints');
    await p.keyboard.press('Escape');
  }

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
