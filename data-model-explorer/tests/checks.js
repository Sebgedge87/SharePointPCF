// Overview, data-model checks and the Dataverse comparison: node tests/checks.js
// (run `npm run build` first; needs Playwright + Chromium, CHROMIUM=/path if needed). Everything is built on the fly.
const path = require('path'), fs = require('fs'), XLSX = require('xlsx');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });

// a workbook with one of each problem the checks look for
function workbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], ['', '', 'Tables'],
    ['', 'Area', 'Table Name', 'Out of the box/custom table?', 'Purpose'],
    ['', 'Service', 'Case', 'OOTB', 'Requests'], ['', 'Service', 'Organisation', 'OOTB', ''], ['', 'Service', 'Ghost', 'Custom', '']]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'];
  const ent = (name, disp, logical, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', disp], ['Plural Display Name', disp + 's'],
    ['Description', disp], ['Schema Name', disp], ['Logical Name', logical], ['Object Type Code', 1], ['Is Custom Entity', 'False'], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'True'], [], H, ...rows]), name);
  const f = (ln, type, o = {}) => [ln, ln, o.disp || ln, type, o.desc || '', o.custom || 'False', 'Simple', o.req || 'None', o.add || ''];
  ent('Case (incident)', 'Case', 'incident', [
    f('incidentid', 'Uniqueidentifier', { req: 'SystemRequired' }),
    f('customerid', 'Customer', { add: 'Targets:\naccount\ncontact', desc: 'Who raised it' }),   // contact has no tab
    f('title', 'Text'),                                                                       // Dataverse: ApplicationRequired
    f('title', 'Text'),                                                                       // duplicate
    f('', 'Text', { disp: 'Mystery' }),                                                       // no logical name
    f('Bad Name', 'Text'),                                                                    // format
    f('prioritycode', ''),                                                                    // no type
    f('mycustom', 'Text', { custom: 'True' }),                                                // no publisher prefix
    f('fp_needid', 'Lookup'),                                                                 // no targets; Dataverse relates it to fp_need
    f('fp_oldfield', 'Text'),                                                                 // not in Dataverse
    f('severitycode', 'Choice'),                                                              // Dataverse: Integer
    f('parentcaseid', 'Lookup', { add: 'Targets:\nincident' }),                               // matches Dataverse
    f('regardingid', 'Lookup', { add: 'Targets:\naccount' })]);                               // no such relationship in Dataverse
  ent('Organisation (account)', 'Organisation', 'account', [
    f('accountid', 'Uniqueidentifier', { req: 'SystemRequired' }),
    f('ownerid', 'Owner', { req: 'SystemRequired', add: 'Targets:\nsystemuser\nteam' })]);    // owner: must not be flagged
  ent('Note (annotation)', 'Note', 'annotation', [f('subject', 'Text')]);                    // not in the dictionary, no primary key listed
  const file = path.join(out, 'checks.xlsx'); XLSX.writeFile(wb, file); return file;
}
// what the Dataverse Web API returns for the links the page builds
function dataverse() {
  const L = s => ({ UserLocalizedLabel: { Label: s } });
  const a = (ln, type, o = {}) => ({ LogicalName: ln, SchemaName: ln, AttributeType: type, RequiredLevel: { Value: o.req || 'None' }, IsCustomAttribute: !!o.custom, DisplayName: L(o.label || ln), AttributeOf: o.of || null });
  const cas = { Delete: 'Cascade', Assign: 'NoCascade', Share: 'NoCascade', Reparent: 'NoCascade' };
  const m1 = (schema, attr, target, from = 'incident') => ({ SchemaName: schema, ReferencingEntity: from, ReferencingAttribute: attr, ReferencedEntity: target, CascadeConfiguration: cas });
  const nn = { SchemaName: 'fp_incident_account', Entity1LogicalName: 'incident', Entity2LogicalName: 'account', IntersectEntityName: 'fp_incident_account' };
  const incident = { LogicalName: 'incident', SchemaName: 'Incident', PrimaryIdAttribute: 'incidentid', PrimaryNameAttribute: 'title', OwnershipType: 'UserOwned', IsCustomEntity: false, DisplayName: L('Case'),
    Attributes: [a('incidentid', 'Uniqueidentifier', { req: 'SystemRequired' }), a('customerid', 'Customer'), a('customeridname', 'String', { of: 'customerid' }), a('title', 'String', { req: 'ApplicationRequired' }),
      a('prioritycode', 'Picklist'), a('mycustom', 'String', { custom: true }), a('fp_needid', 'Lookup', { custom: true }), a('severitycode', 'Integer'), a('parentcaseid', 'Lookup'),
      a('regardingid', 'Lookup'), a('new_secret', 'String', { custom: true, label: 'Secret' }), a('createdon', 'DateTime'), a('bad name', 'String')],
    ManyToOneRelationships: [m1('incident_customer_accounts', 'customerid', 'account'), m1('incident_customer_contacts', 'customerid', 'contact'), m1('incident_parent_incident', 'parentcaseid', 'incident'), m1('fp_need_incident', 'fp_needid', 'fp_need')],
    OneToManyRelationships: [{ SchemaName: 'incident_parent_incident', ReferencedEntity: 'incident', ReferencingEntity: 'incident', ReferencingAttribute: 'parentcaseid', CascadeConfiguration: cas }],
    ManyToManyRelationships: [nn], Keys: [{ LogicalName: 'fp_ticketref', KeyAttributes: ['ticketnumber'] }] };
  const account = { LogicalName: 'account', SchemaName: 'Account', PrimaryIdAttribute: 'accountid', PrimaryNameAttribute: 'name', OwnershipType: 'UserOwned', IsCustomEntity: false,
    Attributes: [a('accountid', 'Uniqueidentifier', { req: 'SystemRequired' }), a('ownerid', 'Owner', { req: 'SystemRequired' })],
    ManyToOneRelationships: [m1('owner_accounts', 'ownerid', 'owner', 'account')], OneToManyRelationships: [], ManyToManyRelationships: [nn], Keys: [] };
  const annotation = { '@odata.context': 'https://contoso.crm11.dynamics.com/api/data/v9.2/$metadata#EntityDefinitions/$entity', LogicalName: 'annotation', PrimaryIdAttribute: 'annotationid', OwnershipType: 'UserOwned',
    Attributes: [a('annotationid', 'Uniqueidentifier'), a('subject', 'String')], ManyToOneRelationships: [], OneToManyRelationships: [], ManyToManyRelationships: [], Keys: [] };
  const f1 = path.join(out, 'dv_batch1.json'), f2 = path.join(out, 'dv_annotation.json'), bad = path.join(out, 'dv_bad.json');
  fs.writeFileSync(f1, JSON.stringify({ '@odata.context': 'https://contoso.crm11.dynamics.com/api/data/v9.2/$metadata#EntityDefinitions(LogicalName)', value: [incident, account] }));
  fs.writeFileSync(f2, JSON.stringify(annotation));   // the one-table-per-link shape
  fs.writeFileSync(bad, '{"error":{"code":"0x0","message":"Principal user is missing prvReadEntity"}}');
  return [f1, f2, bad];
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const checks = async () => { await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(300);
    while (await p.locator('[data-iclr]').count()) { await p.locator('[data-iclr]').first().click(); await p.waitForTimeout(100); }   // the page keeps its last filter, like table views
    return p.$$eval('#isswrap tbody tr', rs => rs.map(r => [...r.cells].map(c => c.innerText.trim()))); };
  const has = (rows, check, field) => rows.some(r => r[3] === check && (field == null || r[2] === field));
  const download = async act => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), act()]); return fs.readFileSync(await d.path(), 'utf8'); };
  const [dv1, dv2, dvBad] = dataverse();

  await p.goto(page_); await p.waitForTimeout(1500);
  // before anything is opened: the built-in starter template is not treated as a data model
  ok(/Open your data model to begin/.test(await p.innerText('#main')) && (await p.innerText('#btnOpen')).trim() === 'Open workbook…', 'with no workbook open, the Overview says so and offers Open workbook');
  ok((await p.innerText('#nav .navitem[data-view="__issues"]')).includes('0 errors · 0 warnings'), 'the starter template is not checked');
  await p.setInputFiles('#file', workbook()); await p.waitForTimeout(1500); await p.keyboard.press('Escape');

  // landing page
  ok(/Overview/.test(await p.innerText('#main .ov h1')), 'opens on the Overview');
  const tile = async label => (await p.locator(`.ovtile:has(span:text-is("${label}")) b`).innerText()).trim();
  ok(await tile('unresolved lookups') === '2', 'Overview counts 2 unresolved lookups');
  ok(/Fields with a description[\s\S]*1 of 16/.test(await p.innerText('.ov')), 'Overview shows documentation completeness');
  ok(/Least described tables/.test(await p.innerText('.ov')), 'Overview lists the least described tables');

  // the checks
  let rows = await checks();
  for (const [check, field] of [['Duplicate field', 'title'], ['Field without a logical name', 'Mystery'], ['Logical name format', 'Bad Name'], ['No attribute type', 'prioritycode'],
    ['Custom field without a publisher prefix', 'mycustom'], ['Lookup without targets', 'fp_needid'], ['Lookup to a table not in the workbook', 'contact'],
    ['Dictionary entry with no table tab', 'Ghost'], ['Table missing from the dictionary', ''], ['No primary key field listed', '']])
    ok(has(rows, check, field), `check found: ${check}${field ? ' (' + field + ')' : ''}`);
  ok(!rows.some(r => /systemuser|team/.test(r[4]) && r[3] === 'Lookup to a table not in the workbook'), 'lookups to user and team are not flagged');
  const csvText = await download(() => p.click('[data-act="iss-csv"]'));
  ok(/Severity,Table/.test(csvText) && /Lookup to a table not in the workbook/.test(csvText), 'checks export as CSV');

  // a finding opens its row, and fixing it clears the finding
  await p.locator('#isswrap tbody tr:has(td .cell:text-is("Duplicate field"))').first().click(); await p.waitForTimeout(500);
  ok(/Case/.test(await p.innerText('.vhead h1')), 'clicking a finding opens its table');
  const dup = p.locator('#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("title"))').nth(1).locator('td[data-col="Logical Name"]');
  await dup.dblclick(); const inp = p.locator('#gridwrap td.editing input'); await inp.fill('title2'); await inp.press('Enter'); await p.waitForTimeout(200);
  rows = await checks();
  ok(!has(rows, 'Duplicate field'), 'fixing the duplicate removes the finding');

  // tiles lead to filtered checks
  await p.click('#nav .navitem[data-view="__overview"]'); await p.waitForTimeout(200);
  await p.click('.ovtile:has(span:text-is("unresolved lookups"))'); await p.waitForTimeout(300);
  ok(await p.locator('#isswrap tbody tr').count() === 2 && /Lookup checks/.test(await p.innerText('.toolbar')), 'the unresolved-lookups tile opens just those 2 findings');

  // Dataverse links
  await p.click('#btnMore'); await p.click('.menu [data-more="dv"]'); await p.waitForTimeout(200);
  await p.fill('#dvorg', 'javascript:alert(1)'); await p.waitForTimeout(100);
  ok(await p.locator('#dvlinks a').count() === 0, 'an invalid environment URL gives no links');
  await p.fill('#dvorg', 'https://contoso.crm11.dynamics.com/'); await p.waitForTimeout(100);
  const href = await p.locator('#dvlinks a').first().getAttribute('href');
  ok(href.startsWith('https://contoso.crm11.dynamics.com/api/data/v9.2/EntityDefinitions?$select=') && href.includes("LogicalName eq 'incident'") && href.includes('ManyToManyRelationships'), 'Dataverse links are built for the workbook\'s tables');
  ok(await p.locator('#dvlinks details a').count() === 3, 'a one-link-per-table fallback is offered');

  // a Dataverse error response is explained, not imported
  await p.setInputFiles('#dvfile', dvBad); await p.waitForSelector('.dlgbox');
  ok(/prvReadEntity/.test(await p.innerText('.dlgbox')), 'a Dataverse error file is reported with its message');
  await p.click('.dlgbox [data-d="1"]');

  // import, and compare
  await p.setInputFiles('#dvfile', [dv1, dv2]); await p.waitForTimeout(800);
  ok(/3 of 3 workbook tables found/.test(await p.innerText('#toast')), 'imports both JSON shapes (3 tables found)');
  rows = await checks();
  for (const [check, field] of [['Required level differs from Dataverse', 'title'], ['Attribute type differs from Dataverse', 'severitycode'], ['Field not in Dataverse', 'fp_oldfield'],
    ['Relationship not in Dataverse', 'regardingid'], ['Dataverse relationship not documented', 'fp_needid'], ['Custom Dataverse field not documented', 'new_secret'], ['Standard Dataverse fields not listed', '']])
    ok(has(rows, check, field), `Dataverse check found: ${check}${field ? ' (' + field + ')' : ''}`);
  ok(!rows.some(r => r[2] === 'ownerid' || (r[2] === 'customerid' && /Dataverse/.test(r[3]))), 'owner and customer lookups that match Dataverse are not flagged');
  ok(!rows.some(r => r[2] === 'customeridname'), 'helper fields (AttributeOf) are ignored');
  ok(!has(rows, 'No primary key field listed', '') || rows.filter(r => r[3] === 'No primary key field listed').every(r => /annotationid/.test(r[4])), 'primary key check uses the Dataverse primary key name');

  // table page and ERD
  await p.locator('#isswrap tbody tr:has(td .cell:text-is("Attribute type differs from Dataverse"))').first().click(); await p.waitForTimeout(500);
  const sec = await p.innerText('#gridwrap .subs');
  ok(/From Dataverse/.test(sec) && /incident_customer_accounts/.test(sec) && /Cascade \/ NoCascade/.test(sec) && /N:N/.test(sec) && /fp_ticketref/.test(sec), 'table page shows relationships, cascade settings and keys from Dataverse');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(1500); await p.click('[data-eq=all]'); await p.waitForTimeout(2500);
  ok((await p.inputValue('#erdsrc')).includes('}o..o{'), 'ERD includes the N:N relationship');
  ok(await p.locator('#erdcv svg g.node').count() > 0 && !(await p.locator('#erdcv .err').count()), 'ERD draws with N:N lines');
  const xml = await download(() => p.click('.tb [data-ea="drawio"]'));
  ok(/dashed=1/.test(xml), 'draw.io export draws N:N as a dashed line');

  // kept after a reload, and removable
  await p.reload(); await p.waitForTimeout(2200);
  ok(/checked against https:\/\/contoso\.crm11\.dynamics\.com/.test(await p.innerText('.ov .sub')), 'Dataverse metadata is kept after a reload');
  await p.click('#btnMore'); await p.click('.menu [data-more="dv"]'); await p.waitForTimeout(200); await p.click('[data-dv="remove"]'); await p.click('.dlgbox [data-d="1"]'); await p.waitForTimeout(300);
  rows = await checks();
  ok(!rows.some(r => /Dataverse/.test(r[3])), 'removing the metadata removes the Dataverse findings');

  // same-named tables in the dictionary link to their own tabs; lookups to a missing table give one finding,
  // a warning only when the table has your own prefix
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name'], ['', '', 'Email'], ['', '', 'Email'], ['', '', 'Thing']]), 'Table Dictionary');
    const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data'];
    const ent = (name, disp, logical, custom, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', disp], ['Plural Display Name', disp], ['Description', ''], ['Schema Name', logical],
      ['Logical Name', logical], ['Object Type Code', 1], ['Is Custom Entity', custom], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'False'], [], H, ...rows]), name);
    const lk = (ln, t) => [ln, ln, ln, 'Lookup', 'x', 'False', 'Simple', 'None', 'Targets:\n' + t];
    ent('Email (Email)', 'Email', 'email', 'False', [['activityid', 'ActivityId', 'Id', 'Uniqueidentifier', 'x', 'False', 'Simple', 'None', ''], lk('createdbyexternalparty', 'externalparty')]);
    ent('Email (msdynmkt_email)', 'Email', 'msdynmkt_email', 'True', [['msdynmkt_emailid', 'Id', 'Id', 'Uniqueidentifier', 'x', 'False', 'Simple', 'None', ''], lk('createdbyexternalparty', 'externalparty'), lk('modifiedbyexternalparty', 'externalparty')]);
    ent('Thing (xyz_thing)', 'Thing', 'xyz_thing', 'True', [['xyz_thingid', 'Id', 'Id', 'Uniqueidentifier', 'x', 'False', 'Simple', 'None', ''], lk('xyz_widgetid', 'xyz_widget')]);
    const f = path.join(out, 'dupnames.xlsx'); XLSX.writeFile(wb, f);
    await p.setInputFiles('#file', f);
    if (await p.locator('.dlgbox').count() || await p.waitForSelector('.dlgbox', { timeout: 2000 }).catch(() => null)) await p.click('.dlgbox [data-d="0"]');
    await p.waitForTimeout(1200); await p.keyboard.press('Escape');
    rows = await checks();
    ok(!has(rows, 'Table missing from the dictionary'), 'two dictionary entries named "Email" link to the two Email tabs');
    const ext = rows.filter(r => r[3] === 'Lookup to a table not in the workbook' && r[2] === 'externalparty');
    ok(ext.length === 1 && ext[0][0] === 'Info' && ext[0][1] === '2 tables' && /3 fields/.test(ext[0][4]), 'lookups to a missing standard table give one Info finding (3 fields, 2 tables)');
    ok(rows.some(r => r[3] === 'Lookup to a table not in the workbook' && r[2] === 'xyz_widget' && r[0] === 'Warning'), 'a missing table with your own prefix is a Warning');
  }

  // small screens
  await p.setViewportSize({ width: 390, height: 800 }); await p.click('#btnNav'); await p.click('#nav .navitem[data-view="__overview"]');
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Overview fits a phone-sized screen without sideways scrolling');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();
