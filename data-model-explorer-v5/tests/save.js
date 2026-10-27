// Save, Save as… and Ctrl+S: node tests/save.js  (run `npm run build` first)
// The browser's save dialog and file handles are stood in for, so the files written can be read back here.
const path = require('path'), XLSX = require('xlsx');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const wbk = path.resolve(__dirname, '../samples/Import_Test_Model.xlsx');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  await p.addInitScript(() => {
    window.__picks = 0; window.__writes = 0;
    const handle = name => ({
      kind: 'file', name, data: new Uint8Array(),
      async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' },
      async createWritable() { const h = this, parts = []; return { async write(x) { parts.push(x) }, async close() { h.data = new Uint8Array(await new Blob(parts).arrayBuffer()); window.__writes++ } } },
      async getFile() { return new File([this.data], this.name) },
    });
    window.showSaveFilePicker = async o => { window.__picks++; return (window.__last = handle('Saved ' + o.suggestedName)) };
  });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  const menu = async () => { await p.click('#btnExport'); await p.waitForTimeout(150); const m = await p.$$eval('.menu [data-x]', o => o.map(x => x.dataset.x)); const t = await p.innerText('.menu'); return { m, t } };
  const close = () => p.keyboard.press('Escape');
  const saved = async () => XLSX.read(await p.evaluate(() => Array.from(window.__last.data)), { type: 'array' });
  const edit = async (ln, v) => {
    if (!await p.locator('#nav .navitem:has-text("Test Task")').count()) await p.click('#nav [data-grp]');
    await p.click('#nav .navitem:has-text("Test Task")'); await p.waitForTimeout(300);
    await p.locator(`#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("${ln}")) td[data-col="Description"]`).dblclick();
    await p.keyboard.press('Control+A'); await p.keyboard.type(v); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  };
  const desc = (wb, ln) => { const ws = wb.Sheets[Object.keys(wb.Sheets).find(n => /TestTask/.test(n))]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }); const h = rows.findIndex(r => r.includes('Logical Name') && r.includes('Schema Name')); const r = rows.find(r => r[rows[h].indexOf('Logical Name')] === ln); return r && r[rows[h].indexOf('Description')] };

  // the menu
  let { m, t } = await menu();
  ok(JSON.stringify(m) === JSON.stringify(['save', 'xlsx-orig', 'xlsx', 'xlsx-plain', 'ro-copy', 'csv', 'solution', 'ps1', 'manual', 'log']), 'Save & share: Save, Save as…, two other formats, share, build and the log (' + m.join(', ') + ')');
  ok(/SAVE[\s\S]*Save\s*Ctrl\+S[\s\S]*Choose where to save it[\s\S]*Save as…[\s\S]*OTHER FORMATS[\s\S]*Rebuilt in the current template[\s\S]*Values only, no formatting[\s\S]*SHARE[\s\S]*include hidden columns[\s\S]*BUILD[\s\S]*LOGS/i.test(t), 'grouped as Save / Other formats / Share / Build / Logs, with no "original file" or "updated copy" wording');
  ok(!/original file|updated copy|New version in template format/i.test(t), 'none of the old names are left');
  await close();

  // the first Ctrl+S asks where, and links the page to that file
  await edit('formus_priority', 'First save');
  await p.keyboard.press('Control+s'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => [window.__picks, window.__writes].join()) === '1,1', 'Ctrl+S with no linked file asks where to save, once, and writes it');
  ok(desc(await saved(), 'formus_priority') === 'First save', 'the saved file has the edit');
  ok(/linked to file/.test(await p.innerText('#fileLabel')) && /Saved Import_Test_Model/.test(await p.innerText('#fileLabel')), 'the page is now linked to the saved file');

  // then Save goes straight to that file, with no questions
  await edit('formus_priority', 'Second save');
  ({ t } = await menu()); ok(/Writes 1 change into Saved Import_Test_Model\.xlsx/.test(t), 'the menu says where Save writes'); await close();
  await p.keyboard.press('Control+s'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => [window.__picks, window.__writes].join()) === '1,2' && !await p.locator('.dlgbox').count(), 'the next Save writes to the same file without asking anything');
  ok(desc(await saved(), 'formus_priority') === 'Second save', 'and the file has the new edit');
  ({ t } = await menu()); ok(/No changes to save · linked to Saved Import_Test_Model\.xlsx/.test(t), 'with nothing left to save, the menu says so'); await close();

  // another program changed the file: Save asks first
  await p.evaluate(() => { window.__last.data = new Uint8Array([...window.__last.data, 0]) });
  await edit('formus_priority', 'Third save');
  await p.keyboard.press('Control+s'); await p.waitForSelector('.dlgbox');
  ok(/The file changed on disk/.test(await p.innerText('.dlgbox')), 'if another program changed the file, Save asks before overwriting it');
  await p.click('.dlgbox [data-d="1"]'); await p.waitForTimeout(1500);
  ok(desc(await saved(), 'formus_priority') === 'Third save', 'and saves when told to');

  // Save as… asks again, and the page saves there from then on
  await edit('formus_priority', 'Save as');
  await p.click('#btnExport'); await p.click('.menu [data-x="xlsx-orig"]'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => window.__picks) === 2 && desc(await saved(), 'formus_priority') === 'Save as', 'Save as… asks where, and writes there');

  // CSV: one item, with a tick box for the hidden columns
  await p.click('#nav .navitem:has-text("Test Task")'); await p.waitForTimeout(300);
  await p.click('#btnExport'); await p.check('.menu #csvAll');
  ok(await p.isVisible('.menu'), 'ticking the box leaves the menu open');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('.menu [data-x="csv"]')]);
  ok(/\(all columns\)\.csv$/.test(d.suggestedFilename()), 'with the box ticked, the CSV has all columns (' + d.suggestedFilename() + ')');
  const [d2] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('#btnExport'); await p.click('.menu [data-x="csv"]') })()]);
  ok(!/all columns/.test(d2.suggestedFilename()), 'unticked, the visible columns only');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
