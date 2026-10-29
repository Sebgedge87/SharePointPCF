// Comparing a workbook with an exported solution (.zip), opened as a file: node tests/solutionzip.js  (run `npm run build` first)
// The solution is built from the workbook by the page itself (the same layout Power Apps exports), then the workbook is
// changed and compared with it.
const path = require('path'), fs = require('fs'), XLSX = require('xlsx'), JSZip = require('jszip');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function model() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name'], ['', 'Events', 'Event'], ['', 'Events', 'Draft'], ['', 'Core', 'Contact'], ['', 'Core', 'Account']]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data', 'Add to RAF Form?', 'Comment', 'Relationship Type', 'Relationship Name', 'Cascade Delete'];
  const ent = (name, disp, schema, logical, custom, details, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', disp], ['Plural Display Name', disp + 's'],
    ['Description', disp], ['Schema Name', schema], ['Logical Name', logical], ['Object Type Code', 1], ['Is Custom Entity', custom], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'False'], ...details, [], H, ...rows]), name);
  const f = (ln, sch, disp, type, add = '', o = {}) => [ln, sch, disp, type, disp, o.custom || 'True', 'Simple', o.req || 'None', add, '', '', o.rt || '', '', ''];
  ent('Event (fp_Event)', 'Event', 'fp_Event', 'fp_event', 'True', [['Primary Name Column', 'fp_name'], ['Primary Key', 'fp_eventid']], [
    f('fp_eventid', 'fp_EventId', 'Event', 'Uniqueidentifier'), f('fp_name', 'fp_Name', 'Name', 'Text', 'Max length: 100', { req: 'ApplicationRequired' }),
    f('fp_capacity', 'fp_Capacity', 'Capacity', 'Whole number'), f('fp_start', 'fp_Start', 'Start', 'DateTime', 'Format: DateOnly'),
    f('fp_contactid', 'fp_ContactId', 'Organiser', 'Lookup', 'Targets:\ncontact', { rt: 'N:1' })]);
  ent('Draft (fp_Draft)', 'Draft', 'fp_Draft', 'fp_draft', 'True', [], [f('fp_draftid', 'fp_DraftId', 'Draft', 'Uniqueidentifier'), f('fp_code', 'fp_Code', 'Code', 'Text')]);
  ent('Contact (Contact)', 'Contact', 'Contact', 'contact', 'False', [['Primary Name Column', 'fullname'], ['Primary Key', 'contactid']], [
    f('contactid', 'ContactId', 'Contact', 'Uniqueidentifier', '', { custom: 'False' }), f('firstname', 'FirstName', 'First Name', 'Text', '', { custom: 'False' }), f('fp_extra', 'fp_Extra', 'Extra', 'Text')]);
  ent('Account (Account)', 'Account', 'Account', 'account', 'False', [['Primary Name Column', 'name'], ['Primary Key', 'accountid']], [f('accountid', 'AccountId', 'Account', 'Uniqueidentifier', '', { custom: 'False' }), f('name', 'Name', 'Name', 'Text', '', { custom: 'False' })]);
  const file = path.join(out, 'solzip_model.xlsx'); XLSX.writeFile(wb, file); return file;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', model()); await p.waitForTimeout(2000); await p.keyboard.press('Escape');

  // build the solution with the page
  await p.click('#btnBuild'); await p.waitForSelector('.solbox');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('.solbox [data-sol="go"]')]);
  const outer = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
  const solFile = path.join(out, 'FP_DataModel_1_0_0_0.zip'); fs.writeFileSync(solFile, await outer.file('FP_DataModel_1_0_0_0.zip').async('nodebuffer'));

  // one Dataverse panel: as a file it asks for a solution, with no URL or links
  await p.click('#btnCheck');
  ok(/Compare with a solution/.test(await p.innerText('.menu [data-ck="dv"]')), 'the Check menu offers Compare with a solution…');
  await p.click('.menu [data-ck="dv"]'); await p.waitForSelector('#dvpanel.open');
  ok(await p.locator('#dvpanel [data-dv="pick"]:has-text("Add a solution (.zip)")').count() === 1 && await p.locator('#dvorg, #dvlinks').count() === 0, 'opened as a file, the panel asks for a solution (no environment URL or links)');
  ok(/Solutions[\s\S]*Export/.test(await p.innerText('#dvpanel')), 'it says how to export a solution from Power Apps');

  // compare with the solution just built: everything that was built matches
  await p.setInputFiles('#dvfile', solFile); await p.waitForTimeout(1500);
  const stats = await p.innerText('#dvpanel .stats');
  ok(/2 \/ 4\s*tables in the solution/.test(stats), 'the panel counts the workbook tables in the solution (Event and Contact)');
  ok(/FP data model/.test(await p.innerText('#dvpanel header')), 'the panel names the solution');
  await p.click('#dvpanel [data-ov="issues:dv"]'); await p.waitForTimeout(500);
  let iss = await p.innerText('#main');
  ok(/"fp_draft" is not in the solution FP data model/.test(iss), 'a table of yours that is not in the solution is flagged (Draft could not be built)');
  ok(!/"account" is not in the solution/.test(iss), 'a standard table the solution does not hold (Account) is not flagged');
  ok(!/firstname[\s\S]{0,80}not on contact/.test(iss), 'Contact is in the solution as a shell: its standard columns are not reported missing');
  ok(!/fp_capacity|fp_start|fp_extra|fp_contactid/.test(iss), 'the columns that were built match');

  // change the workbook: rename a column and change a type
  if (!await p.locator('#nav .navitem:has-text("Event")').count()) await p.click('#nav [data-grp="Events"]');
  await p.click('#nav .navitem:has-text("Event")'); await p.waitForTimeout(400);
  const cell = (ln, col) => p.locator(`#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("${ln}")) td[data-col="${col}"]`);
  await cell('fp_capacity', 'Logical Name').dblclick(); await p.fill('td.editing input', 'fp_seats'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await cell('fp_start', 'Attribute Type').dblclick(); await p.selectOption('td.editing select', 'Whole number'); await p.waitForTimeout(300);
  await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(500);
  iss = await p.innerText('#main');
  ok(/fp_seats[\s\S]{0,120}This field is not on fp_event in the solution FP data model/.test(iss), 'a column the solution does not have is "not built"');
  ok(/Custom field "fp_capacity"[\s\S]{0,60}not documented/.test(iss), 'a column in the solution but not in the workbook is undocumented');
  ok(/fp_start[\s\S]{0,120}Workbook says Whole number, Dataverse says DateTime/.test(iss), 'a type difference is found');

  // the comparison is kept with the workbook
  await p.reload(); await p.waitForTimeout(2500);
  await p.click('#btnCheck'); await p.click('.menu [data-ck="dv"]'); await p.waitForSelector('#dvpanel.open');
  ok(/FP data model/.test(await p.innerText('#dvpanel header')) && /tables in the solution/.test(await p.innerText('#dvpanel')), 'the comparison is still there after a reload');

  // not a solution
  const bad = path.join(out, 'not_a_solution.zip'); const z = new JSZip(); z.file('readme.txt', 'hello'); fs.writeFileSync(bad, await z.generateAsync({ type: 'nodebuffer' }));
  await p.setInputFiles('#dvfile', bad); await p.waitForSelector('.dlgbox');
  ok(/not a Dataverse solution/.test(await p.innerText('.dlgbox')), 'a zip that is not a solution is explained');
  await p.click('.dlgbox button');

  // remove
  await p.click('#dvpanel [data-dv="remove"]'); await p.click('.dlgbox [data-d="1"]'); await p.waitForTimeout(500);
  ok(await p.locator('#dvpanel [data-dv="pick"]:has-text("Add a solution (.zip)")').count() === 1, 'Remove forgets the solution');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
