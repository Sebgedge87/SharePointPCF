// Smoke test: node tests/smoke.js   (needs playwright and Chromium; set CHROMIUM=/path/to/chromium if not on the default path)
const path = require('path'), fs = require('fs'), XLSX = require('xlsx');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });

// a tiny Metadata Document Generator export, built on the fly (no client data in the repo)
function fakeExport() {
  const wb = XLSX.utils.book_new();
  const H = ['Entity', 'Plural Display Name', 'Description', 'Schema Name', 'Logical Name', 'Object Type Code', 'Is Custom Entity', 'Ownership Type', 'IsAuditEnabled'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], H,
    ['Organisation', 'Organisations', 'Org', 'Account', 'account', 1, false, 'UserOwned', 'True'],
    ['Case', 'Cases', 'Case', 'Incident', 'incident', 112, false, 'UserOwned', 'True'],
    ['Need', 'Needs', 'Need', 'fp_Need', 'fp_need', 10001, true, 'UserOwned', 'False']]), 'Entities list');
  const A = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Secured', 'Additional data'];
  const sheet = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([A, ...rows]), n);
  sheet('Organisation (Account)', [['accountid', 'AccountId', 'Account', 'Uniqueidentifier', '', 'False', 'Simple', 'SystemRequired', 'False', '']]);
  sheet('Case (Incident)', [['customerid', 'CustomerId', 'Customer', 'Lookup', '', 'False', 'Simple', 'None', 'False', 'Targets:\naccount'], ['fp_needid', 'fp_NeedId', 'Need', 'Lookup', '', 'True', 'Simple', 'None', 'False', 'Targets:\nfp_need']]);
  sheet('Need (fp_Need)', [['fp_name', 'fp_Name', 'Name', 'Text', '', 'True', 'Simple', 'None', 'False', '']]);
  const f = path.join(out, 'fake_export.xlsx'); XLSX.writeFile(wb, f); return f;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

  await p.goto(page_); await p.waitForTimeout(1500);
  ok(await p.locator('#nav .navitem').count() > 1, 'opens with the bundled workbook');

  await p.setInputFiles('#file', fakeExport());
  await p.waitForSelector('.convbtns button', { timeout: 30000 });
  ok(/3 \/ 3/.test(await p.innerText('.convbox')), 'metadata export converts (3 tables)');
  await p.click('.convbtns button'); await p.waitForTimeout(1500);
  ok(/fake_export\.xlsx/.test(await p.innerText('#fileLabel')) && !/converted/.test(await p.innerText('#fileLabel')), 'converted workbook is open, under the export\'s own name');

  await p.click('#nav .navitem:has-text("ERD")'); await p.waitForTimeout(2500);
  await p.click('[data-eq=all]'); await p.waitForTimeout(2500);
  ok(await p.locator('#erdcv svg g.node').count() > 0, 'ERD draws');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.tb [data-ea="expmenu"]').then(() => p.click('.tb [data-ea="drawio"]'))]);
  const xml = fs.readFileSync(await dl.path(), 'utf8');
  ok(/<mxfile/.test(xml) && /startArrow=none;endArrow=none/.test(xml) && !/ERzeroToMany/.test(xml), 'draw.io export is valid mxGraph XML, with relationships of unrecorded type as plain lines');

  await p.reload(); await p.waitForTimeout(2000);
  ok(/fake_export\.xlsx/.test(await p.innerText('#fileLabel')), 'open workbook survives a reload');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();
