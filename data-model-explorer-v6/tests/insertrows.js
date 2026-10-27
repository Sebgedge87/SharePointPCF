// Saving table details a sheet has no row for: node tests/insertrows.js  (run `npm run build` first)
// The details sit straight above the field list with no spare row, so the save inserts rows below the last detail and
// moves everything underneath down: the field list, Forms, merged cells, drop-down lists, conditional formatting, the
// frozen pane, named ranges, filters, print titles, and other sheets' formulas pointing at it. A sheet holding an Excel
// table is left alone, and the reason given.
const path = require('path'), fs = require('fs'), ExcelJS = require('exceljs'), JSZip = require('jszip');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function model() {
  const wb = new ExcelJS.Workbook();
  const dict = wb.addWorksheet('Table Dictionary');
  dict.addRows([[], [], ['', 'Area', 'Table Name'], ['', 'Grants', 'Need'], ['', 'Grants', 'Outcome']]);
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'];
  const table = (name, disp, logical) => {
    const ws = wb.addWorksheet(name);
    ws.addRows([['Entity', disp], ['Plural Display Name', disp + 's'], ['Description', disp + ' table'], ['Schema Name', 'formus_' + disp], ['Logical Name', logical],
      ['Is Custom Entity', 'True'], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'True'],
      ['', '', '', 'Pick a type from the list', '', '', '', 'None, Recommended or ApplicationRequired'],     // row 9: hints
      H,                                                                                                     // row 10: header
      [logical + 'id', 'formus_' + disp + 'Id', disp, 'Uniqueidentifier', 'Key', 'True', 'Simple', 'SystemRequired'],
      ['formus_name', 'formus_Name', 'Name', 'Text', 'Name', 'True', 'Simple', 'ApplicationRequired'],
      ['formus_score', 'formus_Score', 'Score', 'Whole number', '', 'True', 'Simple', 'None'],              // row 13
      [], ['Forms:'], ['', 'Form Name', 'Comments'], ['', 'Main form', '']]);                                // Forms: row 15
    ws.mergeCells('A15:C15');
    for (let r = 11; r <= 20; r++) ws.getCell('H' + r).dataValidation = { type: 'list', allowBlank: true, formulae: ['"None,Recommended,ApplicationRequired"'] };
    ws.addConditionalFormatting({ ref: 'C11:C13', rules: [{ type: 'containsText', operator: 'containsText', text: 'Score', style: { font: { bold: true } }, priority: 1 }] });
    ws.views = [{ state: 'frozen', ySplit: 10 }];
    return ws;
  };
  const need = table('Need (formus_Need)', 'Need', 'formus_need');
  need.autoFilter = 'A10:I13'; need.pageSetup.printTitlesRow = '10:10';
  wb.definedNames.add("'Need (formus_Need)'!$A$11:$A$13", 'NeedFields');
  const outcome = table('Outcome (formus_Outcome)', 'Outcome', 'formus_outcome');
  outcome.addTable({ name: 'OutcomeForms', ref: 'E16', columns: [{ name: 'Form' }, { name: 'Note' }], rows: [['Main', '']] });
  // a table whose sheet starts at the header row: no details at all
  const bare = wb.addWorksheet('Bare (formus_bare)');
  bare.addRows([H, ['formus_bareid', 'formus_BareId', 'Bare', 'Uniqueidentifier', 'Key', 'True', 'Simple', 'SystemRequired'], ['formus_name', 'formus_Name', 'Name', 'Text', 'Name', 'True', 'Simple', 'None']]);
  bare.getCell('H2').dataValidation = { type: 'list', allowBlank: true, formulae: ['"None,Recommended,ApplicationRequired"'] };
  const sum = wb.addWorksheet('Summary');
  sum.getCell('A1').value = { formula: "'Outcome (formus_Outcome)'!B1", result: 'Outcome' };
  sum.getCell('A2').value = { formula: "COUNTA('Need (formus_Need)'!A11:A13)&\" fields in 'Need (formus_Need)'!A11\"", result: '3' };
  sum.getCell('A3').value = { formula: "'Need (formus_Need)'!B1", result: 'Need' };
  const f = path.join(out, 'insert_rows.xlsx'); await wb.xlsx.writeFile(f);
  // as Excel saves it: with its hidden name for the filter, and its list of formula cells in calculation order
  const z = await JSZip.loadAsync(fs.readFileSync(f));
  z.file('xl/workbook.xml', (await z.file('xl/workbook.xml').async('string')).replace('</definedNames>', '<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">\'Need (formus_Need)\'!$A$10:$I$13</definedName></definedNames>'));
  z.file('xl/calcChain.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="A1" i="5" l="1"/><c r="A2"/><c r="A3"/></calcChain>');
  z.file('[Content_Types].xml', (await z.file('[Content_Types].xml').async('string')).replace('</Types>', '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'));
  z.file('xl/_rels/workbook.xml.rels', (await z.file('xl/_rels/workbook.xml.rels').async('string')).replace('</Relationships>', '<Relationship Id="rIdCalc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>'));
  fs.writeFileSync(f, await z.generateAsync({ type: 'nodebuffer' })); return f;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', await model()); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  const openTab = async n => { if (!await p.locator(`#nav .navitem:has-text("${n}")`).count()) await p.click('#nav [data-grp="Grants"]'); await p.click(`#nav .navitem:has-text("${n}")`); await p.waitForTimeout(400); };
  const setDetails = async (pn, pk) => { await p.click('[data-act="details"]'); await p.waitForSelector('.solbox');
    await p.fill('.solbox label:has-text("Primary Name Column") input', pn); await p.fill('.solbox label:has-text("Primary Key") input', pk); await p.click('.solbox [data-dd="save"]'); await p.waitForTimeout(300); };
  const download = async () => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), (async () => {
    await p.click('#btnExport'); await p.click('.menu [data-x="xlsx-orig"]'); await p.waitForSelector('.namebox'); await p.click('.namebox [data-n="1"]'); })()]); return d.path(); };

  // Need: two details with no row for them, and an edit further down
  await openTab('Need'); await setDetails('formus_name', 'formus_needid');
  await p.locator('#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("formus_score")) td[data-col="Description"]').dblclick();
  await p.keyboard.press('Control+A'); await p.keyboard.type('Score out of 10'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const saved = await download();
  ok(!await p.locator('.dlgbox:has-text("was stopped")').count(), 'the save is not stopped when the details have no empty row');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(saved); const ws = wb.getWorksheet('Need (formus_Need)');
  const v = a => { const c = ws.getCell(a).value; return c && typeof c === 'object' && c.richText ? c.richText.map(t => t.text).join('') : c; };
  ok(v('A9') === 'Primary Name Column' && v('B9') === 'formus_name' && v('A10') === 'Primary Key' && v('B10') === 'formus_needid', 'the two details are written in rows inserted below the last detail');
  ok(v('A8') === 'Audit Tracking' && String(v('D11')).startsWith('Pick a type') && v('A12') === 'Logical Name', 'the hint and header rows moved down by two');
  ok(v('A15') === 'formus_score' && v('E15') === 'Score out of 10', 'the field list moved, and the edit lands on the moved row');
  ok(v('A17') === 'Forms:' && v('B19') === 'Main form', 'the Forms section moved');
  ok(ws.model.merges.includes('A17:C17'), 'the merged Forms cell moved with it (' + ws.model.merges.join(', ') + ')');
  const dv = ws.dataValidations.model; ok(dv['H13'] && dv['H22'] && !dv['H11'], 'the drop-down lists moved with their rows');
  const cf = (ws.conditionalFormattings || []).map(c => c.ref); ok(cf.includes('C13:C15'), 'conditional formatting moved (' + cf.join(', ') + ')');
  ok(ws.views[0] && ws.views[0].ySplit === 12, 'the frozen header moved (' + (ws.views[0] && ws.views[0].ySplit) + ')');
  ok(String(v('A9')) === 'Primary Name Column' && ws.getCell('A9').style && ws.getCell('B9').value === 'formus_name', 'the new detail cells hold plain values');
  const zx = await JSZip.loadAsync(fs.readFileSync(saved)), wbXml = await zx.file('xl/workbook.xml').async('string');
  ok(/<definedName name="NeedFields"[^>]*>'Need \(formus_Need\)'!\$A\$13:\$A\$15</.test(wbXml), 'a named range on the sheet moved with its rows');
  ok(/_xlnm\._FilterDatabase"[^>]*>'Need \(formus_Need\)'!\$A\$12:\$I\$15</.test(wbXml) && /<autoFilter ref="A12:I15"/.test(await zx.file('xl/worksheets/sheet2.xml').async('string')), 'the filter moved (the sheet\'s and Excel\'s hidden name for it)');
  ok(/_xlnm\.Print_Titles"[^>]*>'Need \(formus_Need\)'!\$12:\$12</.test(wbXml), 'the print title rows moved');
  const sum = wb.getWorksheet('Summary'), fm = a => (sum.getCell(a).value || {}).formula;
  ok(fm('A2') === "COUNTA('Need (formus_Need)'!A13:A15)&\" fields in 'Need (formus_Need)'!A11\"", 'a formula on another sheet points at the moved rows (text in quotes left alone): ' + fm('A2'));
  ok(fm('A3') === "'Need (formus_Need)'!B1" && fm('A1') === "'Outcome (formus_Outcome)'!B1", 'references above the inserted rows, and to other sheets, are unchanged');
  ok(!zx.file('xl/calcChain.xml') && !/calcChain/.test(await zx.file('[Content_Types].xml').async('string')) && !/calcChain/.test(await zx.file('xl/_rels/workbook.xml.rels').async('string')), 'Excel\'s calculation chain is dropped, for Excel to rebuild');

  // the saved file opens with the details in place
  const p2 = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p2.goto(page_); await p2.waitForTimeout(1200); await p2.setInputFiles('#file', saved); await p2.waitForTimeout(2000); await p2.keyboard.press('Escape');
  if (!await p2.locator('#nav .navitem:has-text("Need")').count()) await p2.click('#nav [data-grp="Grants"]');
  await p2.click('#nav .navitem:has-text("Need")'); await p2.waitForTimeout(400);
  const chips = await p2.innerText('.vhead .chips');
  ok(/Primary name\s*:?\s*formus_name/i.test(chips) && /Primary key\s*:?\s*formus_needid(?!\s*\(assumed)/i.test(chips), 'reopened, the table shows its primary name and key');
  const lns = await p2.$$eval('#gridwrap tbody td[data-col="Logical Name"] .mono', c => c.map(x => x.textContent.trim()));
  ok(JSON.stringify(lns) === JSON.stringify(['formus_needid', 'formus_name', 'formus_score']), 'and the same three fields');
  await p2.close();

  // a table with no details at all: they go in rows inserted above the header
  if (!await p.locator('#nav .navitem:has-text("Bare")').count()) await p.click('#nav [data-grp]').catch(() => {});
  await p.click('#nav .navitem:has-text("Bare")'); await p.waitForTimeout(400);
  await p.click('[data-act="details"]'); await p.waitForSelector('.solbox');
  await p.fill('.solbox label:has-text("Primary Name Column") input', 'formus_name'); await p.click('.solbox [data-dd="save"]'); await p.waitForTimeout(300);
  const saved2 = await download(); const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(saved2); const bs = wb2.getWorksheet('Bare (formus_bare)');
  ok(bs.getCell('A1').value === 'Primary Name Column' && bs.getCell('B1').value === 'formus_name' && bs.getCell('A2').value === 'Logical Name' && bs.getCell('A4').value === 'formus_name' && bs.dataValidations.model['H3'] && !bs.dataValidations.model['H2'], 'with no details at all, the detail goes in a row inserted above the header');

  // Outcome: it holds an Excel table, so rows are not inserted, and the reason is given
  await openTab('Outcome'); await setDetails('formus_name', 'formus_outcomeid');
  const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 4000 }).catch(() => null), (async () => { await p.click('#btnExport'); await p.click('.menu [data-x="xlsx-orig"]'); })()]);
  await p.waitForSelector('.dlgbox', { timeout: 5000 }).catch(() => {});
  const msg = await p.innerText('.dlgbox').catch(() => '');
  ok(!d2 && /Outcome[\s\S]*Primary Name Column[\s\S]*the sheet holds an Excel table/.test(msg), 'a sheet holding an Excel table is not changed, and the reason is given');

  await p.click('.dlgbox button').catch(() => {});
  // the version is shown
  const ver = require('../package.json').version;
  ok(new RegExp('version ' + ver.replace(/\./g, '\\.')).test(await p.getAttribute('#btnHelp', 'title')), 'the ? button says which version this is (' + ver + ')');
  await p.click('#btnHelp'); await p.waitForTimeout(300);
  ok((await p.innerText('#main h1')).includes('version ' + ver), 'and so does How it works');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
