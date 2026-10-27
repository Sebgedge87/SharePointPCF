// Adding rows in the page: node tests/addrows.js   (run `npm run build` first; needs Playwright + Chromium, CHROMIUM=/path if needed)
// Adds fields, a lookup and an N:N to a table, a row to the Table Dictionary, then saves, exports, reloads, carries the
// rows to a newer version and removes them. Workbooks are built on the fly.
const path = require('path'), fs = require('fs'), XLSX = require('xlsx');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });

// Case: header on row 11, fields on rows 12-14, two empty rows, then Forms: on row 17
function model(file, extra = [], old = false, gap = false) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], ['', '', 'Tables'],
    ['', 'Area', 'Table Name', 'Out of the box/custom table?', 'Static Data?', 'Purpose'],
    ['', 'Sales', 'Case', 'OOTB', 'No', 'Service requests'],
    ['', 'Sales', 'Organisation', 'OOTB', 'No', 'Customers']]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'].concat(old ? [] : ['Add to RAF Form?', 'Comment', 'Relationship Type', 'Relationship Name', 'Cascade Delete']);
  const ent = (name, disp, schema, logical, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', disp], ['Plural Display Name', disp + 's'],
    ['Description', disp + ' table'], ['Schema Name', schema], ['Logical Name', logical], ['Object Type Code', 1], ['Is Custom Entity', 'False'],
    ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'True'], ...(gap ? [[], []] : []), [], H, ...rows, [], [], ['Forms:'], ['', 'Form Name', 'Formus Comments'], ['', 'Main form', '']]), name);
  ent('Case (incident)', 'Case', 'Incident', 'incident', [
    ['incidentid', 'IncidentId', 'Case', 'Uniqueidentifier', '', 'False', 'Simple', 'SystemRequired', ''],
    ['customerid', 'CustomerId', 'Customer', 'Lookup', 'Who raised it', 'False', 'Simple', 'ApplicationRequired', 'Targets:\naccount'],
    ['title', 'Title', 'Case Title', 'Text', 'Short summary', 'False', 'Simple', 'None', ''], ...extra]);
  ent('Organisation (account)', 'Organisation', 'Account', 'account', [['accountid', 'AccountId', 'Account', 'Uniqueidentifier', '', 'False', 'Simple', 'SystemRequired', '']]);
  const f = path.join(out, file); XLSX.writeFile(wb, f); return f;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage();
  // Save as… downloads here, as in a browser without a save dialog (Firefox, Safari); tests/save.js covers the dialog
  await p.addInitScript(() => { delete Window.prototype.showSaveFilePicker; delete window.showSaveFilePicker; });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const count = async () => +(await p.$eval('#chgCount', e => e.style.display === 'none' ? '0' : e.textContent));
  const download = async act => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), act()]); return d.path(); };
  // workbook downloads ask for a file name first: keep the suggested one
  const exportAs = x => download(async () => { await p.click('#btnExport'); await p.click(`.menu [data-x="${x}"]`); if (/^xlsx/.test(x)) { await p.waitForSelector('.namebox'); await p.click('.namebox [data-n="1"]'); } });
  const load = async (f, answer) => {
    await p.setInputFiles('#file', f);
    if (answer) { await p.waitForSelector('.dlgbox'); await p.click(answer === 'carry' ? '.dlgbox [data-d="1"]' : '.dlgbox [data-d="0"]'); }
    await p.waitForTimeout(1200); await p.keyboard.press('Escape');
  };
  const openTab = async name => {
    if (!await p.locator(`#nav .navitem:has-text("${name}")`).count()) await p.click('#nav [data-grp="Sales"]');
    await p.click(`#nav .navitem:has-text("${name}")`); await p.waitForTimeout(300);
  };
  const row = ln => p.locator(`#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("${ln}"))`);
  const dlgv = k => p.$eval(`.solbox [data-k="${k}"]`, e => e.value);
  const addField = async (o, submit = true) => {
    await p.click('[data-act="addrow"]'); await p.waitForSelector('.solbox');
    if (o.kind) await p.selectOption('.solbox [data-k="kind"]', o.kind);
    for (const k of ['Display Name', 'Attribute Type', 'target', 'Logical Name']) if (o[k] != null) await p.fill(`.solbox [data-k="${k}"]`, o[k]);
    if (submit) { await p.click('.solbox [data-add="go"]'); await p.waitForTimeout(300); }
  };

  await p.goto(page_); await p.waitForTimeout(1500);
  const v1 = model('add_v1.xlsx');
  await load(v1); await openTab('Case');

  // the primary key is marked, and assumed from the table name when the workbook doesn't record it
  ok(/Primary key\s*:?\s*incidentid\s*\(assumed\)/i.test(await p.innerText('.vhead .chips')), 'the header shows the primary key, marked as assumed');
  ok(/Primary name\s*:?\s*not set/i.test(await p.innerText('.vhead .chips')), 'the header says when no primary name column is recorded');
  ok(/Primary key/.test(await row('incidentid').locator('td').first().innerText()), 'the primary key row is tagged in the field list');

  // a plain field: names follow the display name
  await p.click('[data-act="addrow"]'); await p.waitForSelector('.solbox');
  await p.fill('.solbox [data-k="Display Name"]', 'Priority Score');
  ok(await dlgv('Logical Name') === 'new_priorityscore' && await dlgv('Schema Name') === 'new_PriorityScore', 'logical and schema names are suggested from the display name');
  ok(!await p.isVisible('.solbox [data-f="target"]'), 'the related-table box is hidden for a plain field');
  await p.fill('.solbox [data-k="Attribute Type"]', 'Integer');
  await p.click('.solbox [data-add="go"]'); await p.waitForTimeout(300);
  ok(await row('new_priorityscore').count() === 1, 'the new field is in the grid');
  ok(/ADDED/.test(await row('new_priorityscore').innerText()), 'the new row is tagged ADDED');
  ok(await p.$eval('#detail', d => d.classList.contains('open')) && /Priority Score/.test(await p.innerText('#detail h3')), 'the new row opens in the detail panel to fill in');
  ok(await count() === 1, 'the Changes count shows one added row');

  // a lookup needs its table, and a duplicate name is refused
  await addField({ 'Display Name': 'Parent Org', 'Attribute Type': 'Lookup' }, false);
  ok(await p.isVisible('.solbox [data-f="target"]'), 'the related-table box appears for a lookup');
  await p.click('.solbox [data-add="go"]'); await p.waitForTimeout(150);
  ok(/Pick the table the lookup points to/.test(await p.innerText('#adderr')), 'a lookup without a table is refused');
  await p.fill('.solbox [data-k="target"]', 'account'); await p.fill('.solbox [data-k="Logical Name"]', 'title');
  await p.click('.solbox [data-add="go"]'); await p.waitForTimeout(150);
  ok(/already in this table/.test(await p.innerText('#adderr')), 'a logical name already in the table is refused');
  await p.fill('.solbox [data-k="Logical Name"]', 'new_parentorg');
  await p.click('.solbox [data-add="go"]'); await p.waitForTimeout(300);
  const ad = await row('new_parentorg').locator('td[data-col="Additional data"]').innerText();
  ok(/Targets[\s:]*account/.test(ad), 'the lookup records its table in Additional data' + (/account/.test(ad) ? '' : ': ' + ad));
  ok(await row('new_parentorg').locator('td[data-col="Relationship Type"]').innerText() === 'N:1', 'the lookup is marked N:1');

  // an N:N relationship row
  await addField({ kind: 'nn', target: 'account' }, false);
  ok(await dlgv('Logical Name') === 'new_incident_account', 'an N:N relationship name is suggested from the two tables');
  ok(!await p.isVisible('.solbox [data-f="Attribute Type"]'), 'field type is hidden for an N:N');
  await p.click('.solbox [data-add="go"]'); await p.waitForTimeout(300);
  ok(await row('new_incident_account').count() === 1 && await count() === 3, 'the N:N row is added');

  // the generator and the checks see the new rows
  await p.click('#btnExport'); await p.click('.menu [data-x="solution"]'); await p.waitForSelector('.solbox');
  await p.fill('.solbox [data-k="prefix"]', 'new'); await p.waitForTimeout(500);
  const sum = await p.innerText('#solsum');
  ok(/2 fields, 1 one-to-many and 1 many-to-many/.test(sum), 'the solution generator picks up the added fields, lookup and N:N' + (/2 fields, 1 one-to-many and 1 many-to-many/.test(sum) ? '' : ': ' + sum + ' / ' + await p.innerText('#solerr') + ' / ' + errs.join(' | ')));
  await p.click('.solbox [data-sol="cancel"]');

  // saving into the original: Case has two empty rows before Forms:, so three new rows are refused
  await p.click('#btnExport'); await p.click('.menu [data-x="xlsx-orig"]'); await p.waitForSelector('.dlgbox');
  ok(/no empty row for this new row/.test(await p.innerText('.dlgbox')), 'a new row with no room above Forms is refused, not squeezed in');
  await p.click('.dlgbox [data-d="1"]');

  // remove the N:N from the Changes panel
  await p.click('#btnChanges'); await p.waitForTimeout(200);
  ok(/Rows added \(3\)/.test(await p.innerText('#changes')), 'the Changes panel lists the added rows');
  await p.locator('#changes .chg:has-text("new_incident_account") [data-arm]').click(); await p.waitForTimeout(300);
  ok(await row('new_incident_account').count() === 0 && await count() === 2, 'an added row can be removed from the Changes panel');
  await p.keyboard.press('Escape');

  const upd = XLSX.readFile(await exportAs('xlsx-orig'));
  const cs = upd.Sheets['Case (incident)'];
  ok(cs.A15.v === 'new_priorityscore' && cs.D15.v === 'Integer' && cs.A16.v === 'new_parentorg' && /Targets: account/.test(cs.I16.v) && cs.L16.v === 'N:1', 'the updated copy has the new rows in the empty rows after the field list');
  ok(cs.A17.v === 'Forms:' && cs.B19.v === 'Main form', 'nothing below the field list moved');

  // a workbook download asks for the name first, suggesting the next version number
  await p.click('#btnExport'); await p.click('.menu [data-x="xlsx"]'); await p.waitForSelector('.namebox');
  ok(await p.$eval('.namebox input', i => i.value) === 'add_v2.xlsx', 'the rename dialog suggests the next version (add_v1 -> add_v2)');
  await p.click('.namebox [data-n="0"]'); await p.waitForTimeout(300);
  ok(!await p.$('.namebox'), 'cancelling the rename dialog downloads nothing');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), (async () => { await p.click('#btnExport'); await p.click('.menu [data-x="xlsx-orig"]'); await p.waitForSelector('.namebox'); await p.fill('.namebox input', 'Renamed model'); await p.keyboard.press('Enter'); })()]);
  ok(dl.suggestedFilename() === 'Renamed model.xlsx', 'the file is saved under the name typed, with .xlsx added');
  const tw = XLSX.readFile(await exportAs('xlsx'));
  const tr = XLSX.utils.sheet_to_json(tw.Sheets['Case (incident)'], { header: 1, defval: '' }).map(r => r[0]);
  ok(tr.indexOf('new_parentorg') === tr.indexOf('title') + 2 && tr.indexOf('new_priorityscore') === tr.indexOf('title') + 1, 'the template export lists the new rows after the existing fields');

  // reload, then carry to a newer version
  await p.reload(); await p.waitForTimeout(2000); await openTab('Case');
  ok(await row('new_priorityscore').count() === 1 && await count() === 2, 'added rows survive a reload');
  await load(model('add_v2.xlsx', [['new_priorityscore', 'new_PriorityScore', 'Priority Score', 'Integer', '', 'True', 'Simple', 'None', '']]), 'carry');
  await openTab('Case');
  ok(await row('new_parentorg').count() === 1, 'an added row is carried to a newer version');
  ok(await row('new_priorityscore').count() === 1, 'a row the newer version already has is not added twice');
  await p.click('#btnChanges'); await p.waitForTimeout(200);
  ok(/already has a field with this logical name/.test(await p.innerText('#changes')), 'and you are asked about it');
  await p.locator('#changes [data-pdrop]').first().click(); await p.waitForTimeout(200); await p.keyboard.press('Escape');

  // remove from the detail panel
  await row('new_parentorg').locator('td[data-col="Display Name"]').click(); await p.waitForTimeout(400);
  await p.click('#detail [data-rmrow]'); await p.waitForTimeout(300);
  ok(await row('new_parentorg').count() === 0 && await count() === 0, 'an added row can be removed from its detail panel');

  // a row in the Table Dictionary
  await p.click('#nav .navitem:has-text("Table Dictionary")'); await p.waitForTimeout(300);
  ok(/Add row/.test(await p.innerText('[data-act="addrow"]')), 'other sheets offer "Add row"');
  const before = await p.locator('#gridwrap tbody tr').count();
  await p.click('[data-act="addrow"]'); await p.waitForTimeout(400);
  ok(await p.locator('#gridwrap tbody tr').count() === before + 1 && await p.$eval('#detail', d => d.classList.contains('open')), 'a blank row is added and opened');
  await p.locator('#detail .fld[data-fcol="Table Name"] [data-fedit]').click();
  await p.locator('#detail .fld[data-fcol="Table Name"] textarea').fill('Invoice'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok(await p.locator('#gridwrap td[data-col="Table Name"]:has-text("Invoice")').count() === 1, 'the new dictionary row takes values');

  // Revert all removes added rows too
  await p.click('#btnChanges'); await p.click('#changes [data-act="revert-all"]'); await p.click('.dlgbox [data-d="1"]'); await p.waitForTimeout(300);
  ok(await count() === 0 && await p.locator('#gridwrap td[data-col="Table Name"]:has-text("Invoice")').count() === 0, 'Revert all removes the added rows');

  // an older workbook without the relationship columns: they are added from the template, and written with the first value
  await load(model('add_old.xlsx', [], true)); await openTab('Case');
  const heads = await p.$$eval('#gridwrap thead th', e => e.map(x => x.innerText));
  ok(!heads.some(h => h.startsWith('Relationship Name')), 'Relationship Name is hidden by default (it is optional)');
  ok(['Relationship Type', 'Cascade Delete', 'Comment'].every(c => heads.some(h => h.startsWith(c) && /added/i.test(h))), 'columns the template has but the workbook lacks are added, and marked');
  await row('customerid').locator('td[data-col="Relationship Type"]').dblclick();
  await p.selectOption('#gridwrap td[data-col="Relationship Type"] select', 'N:1'); await p.waitForTimeout(200);
  await addField({ kind: 'nn', target: 'account' });
  ok(await row('new_incident_account').count() === 1, 'an N:N can be added once the column is there');
  const oc = XLSX.readFile(await exportAs('xlsx-orig')).Sheets['Case (incident)'];
  ok(oc.L11 && oc.L11.v === 'Relationship Type' && oc.L13.v === 'N:1', 'saving writes the added column\'s header and value into the file');
  ok(oc.L10 && /N:1/.test(oc.L10.v), 'and its hint from the template');
  ok(oc.A15.v === 'new_incident_account' && oc.L15.v === 'N:N' && !oc.J11 && !oc.M11, 'unused added columns are left out of the file');

  // marking a field as the primary key or primary name; details go in the empty rows above the field list
  await load(model('add_pk.xlsx', [], false, true), 'separate'); await openTab('Case');
  const chips = () => p.innerText('.vhead .chips');
  await row('title').locator('td[data-col="Display Name"]').click(); await p.waitForTimeout(400);
  await p.click('#detail [data-setkey="pn"]'); await p.waitForTimeout(300);
  ok(/Primary name\s*:?\s*title/i.test(await chips()), 'Set as primary name records it in the table details');
  await row('title').locator('td[data-col="Display Name"]').click(); await p.waitForTimeout(400);
  await p.click('#detail [data-setkey="pk"]'); await p.waitForTimeout(300);
  ok(/Primary key\s*:?\s*title(?!\s*\(assumed)/i.test(await chips()), 'Set as primary key records any field as the key');
  ok(/Primary key/.test(await row('title').locator('td').first().innerText()), 'and the field is tagged Primary key');
  ok(/unique identifiers/.test(await p.innerText('#toast')), 'a key that is not a unique identifier is pointed out');
  await p.click('#detail [data-dclose]'); await p.waitForTimeout(200);
  await p.click('[data-act="details"]'); await p.waitForSelector('.solbox');
  ok(await p.locator('.solbox label:has-text("Has Notes") input').count() === 1, 'the Table details dialog includes details from the template the table lacks');
  await p.fill('.solbox label:has-text("Primary Key") input', 'incidentid'); await p.click('.solbox [data-dd="save"]'); await p.waitForTimeout(300);
  ok(/Primary key\s*:?\s*incidentid(?!\s*\(assumed)/i.test(await chips()) && await count() === 2, 'Table details changes the key, and both details count as changes');
  const kc = XLSX.readFile(await exportAs('xlsx-orig')).Sheets['Case (incident)'];
  ok(kc.A10.v === 'Primary Name Column' && kc.B10.v === 'title' && kc.A11.v === 'Primary Key' && kc.B11.v === 'incidentid', 'saving writes the new details into the empty rows above the field list');
  ok(kc.A9.v === 'Audit Tracking' && kc.A13.v === 'Logical Name', 'nothing else moved');
  await p.reload(); await p.waitForTimeout(2000); await openTab('Case');
  ok(/Primary name\s*:?\s*title/i.test(await chips()), 'changed details survive a reload');

  // changing a field to Lookup asks for its table and writes "Targets:" into Additional data
  const setType = async (ln, t) => { await row(ln).locator('td[data-col="Attribute Type"]').dblclick(); await p.waitForSelector('td.editing select'); await p.selectOption('td.editing select', t); await p.waitForTimeout(300); };
  await setType('title', 'Lookup');
  ok(await p.locator('.solbox h3:has-text("Which table does Case Title look up to?")').count() === 1, 'changing a field to Lookup asks which table it looks up to');
  await p.click('.solbox [data-lta="go"]'); await p.waitForTimeout(200);
  ok(/Pick a table/.test(await p.innerText('#lterr')), 'it needs a table name');
  await p.fill('.solbox [data-lt]', 'account'); await p.click('.solbox [data-lta="go"]'); await p.waitForTimeout(400);
  ok(/Targets:?\s*account/.test(await row('title').locator('td[data-col="Additional data"]').innerText()) && await row('title').locator('td[data-col="Relationship Type"]').innerText() === 'N:1', 'it adds "Targets: account" to Additional data and N:1 as the Relationship Type');
  await setType('title', 'Uniqueidentifier'); await setType('title', 'Lookup');
  ok(await p.locator('.solbox').count() === 0, 'a lookup that already has a target is not asked again');
  await setType('title', 'Uniqueidentifier');
  ok(await p.locator('.solbox').count() === 0, 'other types are not asked about');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();
