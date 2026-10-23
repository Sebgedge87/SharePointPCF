// Round-trip test: node tests/roundtrip.js   (run `npm run build` first; needs Playwright + Chromium, CHROMIUM=/path if needed)
// Edits a workbook, exports it both ways and reads the files back, reloads, loads a newer version and an unrelated
// workbook, and checks that a save which cannot write every edit is refused. Workbooks are built on the fly.
const path = require('path'), fs = require('fs'), XLSX = require('xlsx'), JSZip = require('jszip');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });

// a small workbook in the template layout: Table Dictionary plus two table tabs
function model(file, o = {}) {
  const { ownership = 'UserOwned', notesCol = false, forms = ['Main form'], target = 'account', note = 'All table names to be validated with the client' } = o;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], ['', '', note],
    ['', 'Area', 'Table Name', 'Out of the box/custom table?', 'Static Data?', 'Purpose'],
    ['', 'Sales', 'Case', 'OOTB', 'No', 'Service requests'],
    ['', 'Sales', 'Organisation', 'OOTB', 'No', 'Customers']]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'].concat(notesCol ? ['Notes'] : []);
  const ent = (name, disp, schema, logical, code, rows) => {
    const aoa = [['Entity', disp], ['Plural Display Name', disp + 's'], ['Description', disp + ' table'], ['Schema Name', schema], ['Logical Name', logical],
      ['Object Type Code', code], ['Is Custom Entity', 'False'], ['Ownership Type', ownership], ['Audit Tracking', 'True'], [], H,
      ...rows.map(r => notesCol ? r.concat(['']) : r), [], [], ['Forms:'], ['', 'Form Name', 'Formus Comments'], ...forms.map(f => ['', f, ''])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  };
  ent('Case (incident)', 'Case', 'Incident', 'incident', 112, [
    ['incidentid', 'IncidentId', 'Case', 'Uniqueidentifier', '', 'False', 'Simple', 'SystemRequired', ''],
    ['customerid', 'CustomerId', 'Customer', 'Lookup', 'Who raised it', 'False', 'Simple', 'ApplicationRequired', 'Targets:\n' + target],
    ['title', 'Title', 'Case Title', 'Text', 'Short summary', 'False', 'Simple', 'None', '']]);
  ent('Organisation (account)', 'Organisation', 'Account', 'account', 1, [
    ['accountid', 'AccountId', 'Account', 'Uniqueidentifier', '', 'False', 'Simple', 'SystemRequired', '']]);
  const f = path.join(out, file); XLSX.writeFile(wb, f); return f;
}
// the same workbook, with the Case sheet's XML rewritten using a namespace prefix (<x:row>), as some generators write it
async function prefixed(src, file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(src));
  const p = 'xl/worksheets/sheet2.xml'; let xml = await zip.file(p).async('string');
  xml = xml.replace(' xmlns="', ' xmlns:x="').replace(/<(\/?)(?![?!])([A-Za-z]\w*)/g, '<$1x:$2');
  zip.file(p, xml); const f = path.join(out, file);
  fs.writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer' })); return f;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const count = async () => { const t = await p.$eval('#chgCount', e => e.style.display === 'none' ? '0' : e.textContent); return +t; };
  const download = async (act) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), act()]); return d.path(); };
  // workbook downloads ask for a file name first: keep the suggested one
  const exportAs = x => download(async () => { await p.click('#btnExport'); await p.click(`.menu [data-x="${x}"]`); if (/^xlsx/.test(x)) { await p.waitForSelector('.namebox'); await p.click('.namebox [data-n="1"]'); } });
  const load = async (f, answer) => {   // answer: 'carry' | 'separate' | undefined (no question expected)
    await p.setInputFiles('#file', f);
    if (answer) { await p.waitForSelector('.dlgbox'); await p.click(answer === 'carry' ? '.dlgbox [data-d="1"]' : '.dlgbox [data-d="0"]'); }
    await p.waitForTimeout(1200);
    await p.keyboard.press('Escape');   // close the "What changed" panel that opens after a load
  };
  const openCase = async () => {
    if (!await p.locator('#nav .navitem:has-text("Case")').count()) await p.click('#nav [data-grp="Sales"]');
    await p.click('#nav .navitem:has-text("Case")'); await p.waitForTimeout(300);
  };
  const row = ln => p.locator(`#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("${ln}"))`);
  const edit = async (ln, col, text) => {
    await row(ln).locator(`td[data-col="${col}"]`).dblclick();
    const el = row(ln).locator(`td[data-col="${col}"] textarea, td[data-col="${col}"] input`);
    await el.fill(text); await el.press('Enter'); await p.waitForTimeout(200);
  };

  const v1 = model('model_v1.xlsx');
  const v2 = model('model_v2.xlsx', { ownership: 'OrganizationOwned', notesCol: true, forms: ['Main form', 'Quick create'], target: 'contact' });
  const other = model('other_client.xlsx', { note: 'A different client' });

  await p.goto(page_); await p.waitForTimeout(1500);
  await load(v1);
  ok(/model_v1/.test(await p.innerText('#fileLabel')), 'workbook opens');

  // editing, and the save-state label
  await openCase();
  await edit('title', 'Description', 'Edited summary');
  await edit('incidentid', 'Display Name', '=HYPERLINK("x")');
  ok(await count() === 2, 'two edits recorded');
  ok(/^Saved$/.test((await p.innerText('#saveState')).replace(/^● /, '').trim()), 'save-state label says the edits are stored');

  // Esc cancels an edit in the row panel without closing the panel
  await row('customerid').locator('td[data-col="Required Level"]').click(); await p.waitForTimeout(400);
  await p.locator('#detail .fld[data-fcol="Description"] [data-fedit]').click(); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(await p.$eval('#detail', d => d.classList.contains('open')), 'Esc cancels a panel edit and leaves the panel open');
  await p.keyboard.press('Escape');

  // CSV: visible columns only, all columns on request, formulas neutralised
  const visible = await p.locator('#gridwrap table.grid thead th').count();
  const csvVis = fs.readFileSync(await exportAs('csv'), 'utf8').replace(/^﻿/, '');
  const csvAll = fs.readFileSync(await exportAs('csv-all'), 'utf8').replace(/^﻿/, '');
  ok(XLSX.read(csvVis, { type: 'string' }).Sheets.Sheet1 && csvVis.split('\r\n')[0].split(',').length === visible, `CSV has the ${visible} visible columns`);
  ok(csvAll.split('\r\n')[0].split(',').length === 14, 'CSV "all columns" has all 14 columns (9 in the workbook, 5 added from the template)');
  ok(csvVis.includes(`"'=HYPERLINK(""x"")"`), 'a value starting with = is written as text in CSV');

  // Download an updated copy: only the edited cells change, and the file reads back
  const upd = XLSX.readFile(await exportAs('xlsx-orig'));
  const cs = upd.Sheets['Case (incident)'];
  ok(cs.E14 && cs.E14.v === 'Edited summary' && cs.C12.v === '=HYPERLINK("x")', 'updated copy holds both edits in the right cells');
  ok(cs.E13.v === 'Who raised it' && cs.B6.v === 112 && cs.B6.t === 'n', 'updated copy leaves other cells (and numbers) as they were');

  // New version in template format: edits and a change log, and it loads back in
  const tf = await exportAs('xlsx');
  const tw = XLSX.readFile(tf);
  const tvals = XLSX.utils.sheet_to_json(tw.Sheets['Case (incident)'], { header: 1, defval: '' }).flat();
  ok(tvals.includes('Edited summary') && tw.SheetNames.includes('Change log'), 'template export holds the edits and a change log');
  ok(XLSX.utils.sheet_to_json(tw.Sheets['Change log'], { header: 1 }).length === 3, 'change log lists both edits');

  // edits survive a reload
  await p.reload(); await p.waitForTimeout(2000);
  ok(await count() === 2, 'edits survive a reload');

  // a newer version: edits carried over, and structural changes reported
  await load(v2, 'carry');
  ok(await count() === 2, 'carrying edits forward re-applies them to the newer version');
  await p.click('#btnVer'); await p.waitForTimeout(300);
  const diff = await p.innerText('#versions');
  ok(/COLUMN ADDED[\s\S]*Notes/.test(diff), 'comparison reports an added column');
  ok(/Ownership Type[\s\S]*UserOwned[\s\S]*OrganizationOwned/.test(diff), 'comparison reports a changed table detail');
  ok(/FORMS ADDED[\s\S]*Quick create/.test(diff), 'comparison reports an added form');
  ok(/RELATIONSHIP[\s\S]*customerid[\s\S]*contact[\s\S]*account/.test(diff), 'comparison reports a changed lookup target');
  const drows = fs.readFileSync(await download(() => p.click('#versions [data-act="exp-diff"]')), 'utf8');
  ok(/Column added/.test(drows) && /Table detail changed/.test(drows) && /Relationship removed/.test(drows), 'differences CSV includes the structural changes');

  // an unrelated workbook keeps its own (empty) set of edits
  await load(other, 'separate');
  ok(await count() === 0, 'a different workbook opens with none of the other workbook\'s edits');
  ok((await p.innerText('#wbName')) === 'other_client.xlsx', 'the workbook selector shows the open workbook');
  await p.click('#btnWb'); await p.waitForTimeout(200);
  const listed = await p.$$eval('.menu [data-wb] > span', e => e.map(x => x.textContent.replace(/^✓ /, '')));
  ok(['other_client.xlsx', 'model_v2.xlsx', 'model_v1.xlsx', 'Empty template'].every(n => listed.includes(n)), 'the selector lists every workbook kept in this browser, and the empty template');
  await p.click('.menu button:has-text("model_v2.xlsx")'); await p.waitForTimeout(1500);
  ok(await count() === 2 && (await p.innerText('#wbName')) === 'model_v2.xlsx', 'switching to the first workbook from the selector brings its edits back');
  ok(await p.$eval('#btnVer', e => e.style.display === 'none'), 'switching workbooks does not compare two different workbooks');

  // reopened next time: the Overview says which workbook came back, and offers to switch
  await p.reload(); await p.waitForTimeout(2000);
  ok(/Reopened model_v2\.xlsx, kept in this browser from last time/.test(await p.innerText('#main')), 'after a reload the Overview says which workbook was reopened');
  await p.click('#btnWb'); await p.click('.menu [data-wb="__files"]'); await p.waitForTimeout(300);
  ok(/not part of the HTML file/.test(await p.innerText('#files')), 'the Files panel explains the workbooks are kept by this browser, not the file');
  await p.click('#files [data-fclose]');

  // a save that cannot write every edit is refused, and the edit is kept
  await load(await prefixed(other, 'prefixed.xlsx'), 'separate');
  await openCase();
  await edit('title', 'Description', 'Cannot be placed');
  await p.click('#btnExport'); await p.click('.menu [data-x="xlsx-orig"]');
  const stopped = await p.waitForSelector('.dlgbox', { timeout: 10000 }).then(() => p.innerText('.dlgbox')).catch(() => '');
  ok(/stopped/.test(stopped) && /Case/.test(stopped) && /Description/.test(stopped), 'download is refused and names the edit it could not write');
  await p.click('.dlgbox [data-d="1"]');
  ok(await count() === 1, 'the refused edit is kept');

  // a converted metadata export is a fresh start: no comparison against the file open before it, even after a reload
  const exp = path.join(out, 'fake_export.xlsx');
  if (fs.existsSync(exp)) {
    await load(exp); await p.waitForSelector('.convbtns button', { timeout: 30000 }).catch(() => {});
    if (await p.locator('.convbtns button').count()) await p.click('.convbtns button');
    await p.waitForTimeout(1200); await p.reload(); await p.waitForTimeout(2000);
    ok(await p.$eval('#btnVer', e => e.style.display === 'none'), 'a converted export shows no comparison after a reload');
  } else console.log('SKIP converted-export check (run tests/smoke.js first to create fake_export.xlsx)');

  // Remove all: back to the empty template, with nothing kept
  await p.click('#btnWb'); await p.click('.menu [data-wb="__files"]'); await p.waitForTimeout(300);
  await p.click('[data-fa="clearall"]'); await p.click('.dlgbox [data-d="1"]'); await p.waitForTimeout(2500);
  ok((await p.innerText('#wbName')) === 'No workbook open' && /Open your data model to begin/.test(await p.innerText('#main')) && !/Or reopen one/.test(await p.innerText('#main')), 'Remove all starts again with the empty template and nothing kept');
  ok((await p.$$eval('.menu [data-wb]', e => e.length).catch(() => 0)) === 0 && await count() === 0, 'no edits are left after Remove all');

  // small screens: the sidebar opens from the menu button
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(200);
  await p.click('#btnNav'); await p.waitForTimeout(150);
  ok(await p.locator('.side').isVisible(), 'on a phone-sized screen the table list opens from the ☰ button');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();
