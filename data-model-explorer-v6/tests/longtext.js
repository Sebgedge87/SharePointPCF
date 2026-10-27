// Text longer than Excel allows in a cell (32,767 characters): node tests/longtext.js  (run `npm run build` first)
// A long list of choice options, say. The exports cut it to fit, mark the cut, and say which cells were cut.
const path = require('path'), fs = require('fs'), ExcelJS = require('exceljs'), XLSX = require('xlsx');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const LONG = 'Options:\n' + Array.from({ length: 2600 }, (_, i) => `${100000000 + i}: Option number ${i + 1}`).join('\n');

(async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Table Dictionary').addRows([[], [], ['', 'Area', 'Table Name'], ['', 'Core', 'Thing']]);
  wb.addWorksheet('Thing (fp_Thing)').addRows([['Entity', 'Thing'], ['Schema Name', 'fp_Thing'], ['Logical Name', 'fp_thing'], [],
    ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'],
    ['fp_thingid', 'fp_ThingId', 'Thing', 'Uniqueidentifier', '', 'True', 'Simple', 'SystemRequired', ''],
    ['fp_kind', 'fp_Kind', 'Kind', 'Choice', 'A long choice', 'True', 'Simple', 'None', LONG]]);
  const src = path.join(out, 'long_text.xlsx'); await wb.xlsx.writeFile(src);
  ok(LONG.length > 32767, `the workbook has a cell of ${LONG.length} characters`);

  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', src); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  const exp = async x => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), (async () => { await p.click('#btnExport'); await p.click(`.menu [data-x="${x}"]`); await p.waitForSelector('.namebox'); await p.click('.namebox [data-n="1"]'); })()]); const f = path.join(out, 'long_' + x + '.xlsx'); await d.saveAs(f); return f; };
  for (const [x, what] of [['xlsx-plain', 'Values only'], ['xlsx', 'Rebuilt in the current template']]) {
    const f = await exp(x); await p.waitForSelector('.dlgbox', { timeout: 5000 }).catch(() => {});
    const msg = await p.innerText('.dlgbox').catch(() => '');
    ok(/too long for Excel[\s\S]*1 cell held more than the 32,767 characters[\s\S]*Thing \(fp_Thing\)!I\d+/.test(msg), `${what}: the file is written, and the page says which cell was cut`);
    await p.click('.dlgbox button').catch(() => {});
    const w = XLSX.readFile(f), ws = w.Sheets['Thing (fp_Thing)'], cell = Object.keys(ws).map(k => ws[k]).find(c => c && typeof c.v === 'string' && c.v.startsWith('Options:'));
    ok(cell && cell.v.length <= 32767 && /\[cut: Excel holds 32,767 characters in a cell; this had [\d,]+\]$/.test(cell.v) && cell.v.startsWith(LONG.slice(0, 1000)), `${what}: the cell keeps its start, fits (${cell && cell.v.length}) and ends with a note`);
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
