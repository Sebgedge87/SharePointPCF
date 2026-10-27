// Solution generator: node tests/solution.js   (run `npm run build` first; needs Playwright + Chromium, CHROMIUM=/path if needed)
// Optional: set PAC=/path/to/pac (and DOTNET_ROOT if needed) to also unpack and re-pack the generated solution with
// Microsoft's SolutionPackager (pac solution unpack / pack), which checks the files are a well-formed solution.
const path = require('path'), fs = require('fs'), XLSX = require('xlsx'), JSZip = require('jszip'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });

function model() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name', 'Purpose'],
    ['', 'Events', 'Event', 'p'], ['', 'Events', 'Venue', 'p'], ['', 'Events', 'No Name', 'p'], ['', 'Core', 'Contact', 'p']]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data', 'Add to RAF Form?', 'Comment', 'Relationship Type', 'Relationship Name', 'Cascade Delete'];
  const ent = (name, disp, schema, logical, custom, details, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', disp], ['Plural Display Name', disp + 's'],
    ['Description', disp + ' table'], ['Schema Name', schema], ['Logical Name', logical], ['Object Type Code', 10000], ['Is Custom Entity', custom], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'True'],
    ...details, [], H, ...rows]), name);
  const f = (ln, sch, disp, type, add = '', o = {}) => [ln, sch, disp, type, o.desc || disp + ' field', 'True', o.kind || 'Simple', o.req || 'None', add, '', '', o.rt || '', o.rn || '', o.cd || ''];
  ent('Event (fp_Event)', 'Event', 'fp_Event', 'fp_event', 'True', [['Primary Name Column', 'fp_name'], ['Primary Key', 'fp_eventid'], ['Is Activity', 'False'], ['Has Notes', 'True'], ['Has Activities', 'False']], [
    f('fp_eventid', 'fp_EventId', 'Event', 'Uniqueidentifier'),
    f('fp_name', 'fp_Name', 'Name', 'Text', 'Format: Text\nMax length: 200', { req: 'ApplicationRequired' }),
    f('fp_email', 'fp_Email', 'Contact email', 'Text', 'Format: Email\nMax length: 100'),
    f('fp_notes', 'fp_Notes', 'Notes', 'Multiline Text', 'Format: TextArea\nMax length: 4000'),
    f('fp_capacity', 'fp_Capacity', 'Capacity', 'Whole number', 'Minimum value: 0\nMaximum value: 5000'),
    f('fp_big', 'fp_Big', 'Big number', 'BigInt', 'Minimum value: -9223372036854775808\nMaximum value: 9223372036854775807'),
    f('fp_rate', 'fp_Rate', 'Rate', 'Decimal', 'Minimum value: 0\nMaximum value: 100\nPrecision: 3'),
    f('fp_ratio', 'fp_Ratio', 'Ratio', 'Double', 'Minimum value: 0\nMaximum value: 1\nPrecision: 4'),
    f('fp_price', 'fp_Price', 'Price', 'Currency', 'Minimum value: 0\nMaximum value: 1000000\nPrecision: 2'),
    f('fp_price_base', 'fp_Price_Base', 'Price (Base)', 'Currency', 'Precision: 2'),
    f('fp_start', 'fp_Start', 'Start date', 'DateTime', 'Format: DateOnly'),
    f('fp_doors', 'fp_Doors', 'Doors open', 'DateTime', 'Format: DateAndTime'),
    f('fp_public', 'fp_Public', 'Public', 'Two options', 'True: Public\nFalse: Private\nDefault Value: True'),
    f('fp_status', 'fp_Status', 'Status', 'Choice', 'Options:\n120000000: Draft (no color)\n120000001: Live (no color)\nDefault: 120000000'),
    f('fp_tags', 'fp_Tags', 'Tags', 'Choices', 'Options:\n120000010: Family\n120000011: Outdoor\nDefault: N/A'),
    f('fp_venueid', 'fp_VenueId', 'Venue', 'Lookup', 'Targets:\nfp_venue', { rt: 'N:1', cd: 'Restrict' }),
    f('fp_contactid', 'fp_ContactId', 'Organiser', 'Lookup', 'Targets:\ncontact'),
    f('fp_customerid', 'fp_CustomerId', 'Customer', 'Customer', 'Targets:\naccount\ncontact', { rt: 'N:1' }),
    f('fp_regardingid', 'fp_RegardingId', 'Regarding', 'Lookup', 'Targets:\naccount\ncontact'),
    f('fp_total', 'fp_Total', 'Total', 'Currency', 'Precision: 2', { kind: 'Calculated' }),
    f('fp_photo', 'fp_Photo', 'Photo', 'Image'),
    f('fp_createdon', 'fp_CreatedOn', 'Created on', 'DateTime', 'Format: DateAndTime'),
    ['fp_event_contact', '', 'Attendees', '', 'People attending', 'True', '', '', 'Targets:\ncontact', '', '', 'N:N', '', '']]);
  ent('Venue (fp_Venue)', 'Venue', 'fp_Venue', 'fp_venue', 'True', [['Primary Name Column', 'fp_name'], ['Primary Key', 'fp_venueid']], [
    f('fp_venueid', 'fp_VenueId', 'Venue', 'Uniqueidentifier'), f('fp_name', 'fp_Name', 'Name', 'Text', 'Format: Text\nMax length: 100')]);
  ent('No Name (fp_NoName)', 'No Name', 'fp_NoName', 'fp_noname', 'True', [], [f('fp_nonameid', 'fp_NoNameId', 'No Name', 'Uniqueidentifier'), f('fp_code', 'fp_Code', 'Code', 'Text', 'Max length: 10')]);
  ent('Contact (Contact)', 'Contact', 'Contact', 'contact', 'False', [['Primary Name Column', 'fullname'], ['Primary Key', 'contactid']], [
    ['contactid', 'ContactId', 'Contact', 'Uniqueidentifier', '', 'False', 'Simple', 'SystemRequired', '', '', '', '', '', ''],
    ['firstname', 'FirstName', 'First Name', 'Text', '', 'False', 'Simple', 'Recommended', 'Format: Text\nMax length: 50', '', '', '', '', ''],
    f('fp_extra', 'fp_Extra', 'Extra', 'Text', 'Format: Text\nMax length: 50'),
    f('fp_eventid', 'fp_EventId', 'Main event', 'Lookup', 'Targets:\nfp_event', { rt: 'N:1', rn: 'fp_event_contact_main' }),
    f('fp_badlink', 'fp_BadLink', 'Bad link', 'Lookup', 'Targets:\nfp_noname')]);
  const file = path.join(out, 'solution_model.xlsx'); XLSX.writeFile(wb, file); return file;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  await p.goto(page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', model()); await p.waitForTimeout(1500); await p.keyboard.press('Escape');

  // checks for the new columns and details
  await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(300);
  const rows = await p.$$eval('#isswrap tbody tr', rs => rs.map(r => [...r.cells].map(c => c.innerText.trim())));
  ok(rows.some(r => r[1] === 'No Name' && r[3] === 'No primary name column' && r[0] === 'Error'), 'a new table without a primary name column is an error');
  ok(rows.some(r => r[1] === 'Event' && r[3] === 'Relationship type not recorded' && /fp_contactid → contact/.test(r[4])), 'a lookup without a Relationship Type is flagged for review');
  ok(!rows.some(r => /fp_venueid → fp_venue|fp_eventid → fp_event/.test(r[4])), 'lookups with Relationship Type N:1 are not flagged');
  ok(rows.some(r => r[0] === 'Warning' && r[3] === 'Copy of a system field' && /Dataverse creates createdon on every table/.test(r[4])), 'a prefixed copy of a system field (fp_createdon) is flagged');
  ok(!rows.some(r => r[3] === 'Copy of a system field' && /"createdon"/.test(r[4])), 'the real system fields are not flagged');
  // table page: primary name tag and the N:N row
  if (!await p.locator('#nav .navitem:has-text("Event")').count()) await p.click('#nav [data-grp="Events"]');
  await p.click('#nav .navitem:has-text("Event")'); await p.waitForTimeout(400);
  ok(/Primary name:\s*fp_name/.test(await p.innerText('.vhead')), 'the table header shows its primary name column');
  ok(await p.locator('#gridwrap tr:has(.mono:text-is("fp_name")) .pill:has-text("Primary name")').count() === 1, 'the primary name row is tagged');
  ok(await p.locator('#gridwrap tr:has(.mono:text-is("fp_event_contact")) .pill:has-text("N:N")').count() === 1, 'the N:N row is tagged as a relationship');
  // ERD: recorded N:1 lines have ends, the unrecorded one is plain, the N:N row is drawn
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(800); await p.click('[data-eq=all]'); await p.waitForTimeout(3000);
  const src = await p.inputValue('#erdsrc');
  ok(/fp_venue \|o--o\{ fp_event/.test(src) && /contact \}\|--\|\{ fp_event/.test(src) && /fp_event \}o\.\.o\{ contact/.test(src), 'ERD: recorded N:1 has ends, the unrecorded lookup is plain, the N:N row is drawn');

  // the dialog
  await p.click('#btnExport'); await p.click('.menu [data-x="solution"]'); await p.waitForSelector('.solbox');
  const val = async k => p.inputValue(`.solbox [data-k="${k}"]`);
  ok(await val('prefix') === 'fp' && await val('optPrefix') === '12000' && await val('solName') === 'FP_DataModel' && await val('version') === '1.0.0.0', 'the dialog suggests the prefix, choice value prefix, solution name and version from the workbook');
  await p.waitForTimeout(400);
  const sum = await p.innerText('#solsum');
  ok(/2 new tables/.test(sum) && /1 existing table/.test(sum) && /1 to build by hand/.test(sum) && /not included/.test(sum) && /No Name/.test(sum), 'the dialog summarises what will and will not be built');
  await p.fill('.solbox [data-k="prefix"]', 'X!'); await p.waitForTimeout(400);
  ok(/Prefix: 2 to 8 lower-case/.test(await p.innerText('#solerr')), 'an invalid prefix is explained');
  await p.click('.solbox [data-sol="go"]'); await p.waitForTimeout(300);
  ok(await p.locator('.solbox').count() === 1, 'Generate does nothing while the settings are invalid');
  await p.fill('.solbox [data-k="prefix"]', 'fp'); await p.fill('.solbox [data-k="pubDisplay"]', 'Formus Events'); await p.waitForTimeout(400);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('.solbox [data-sol="go"]')]);
  ok(dl.suggestedFilename() === 'FP_DataModel_1_0_0_0 build.zip', 'Generate downloads one build zip');
  const outerPath = path.join(out, 'build.zip'); await dl.saveAs(outerPath);

  // what's in the download
  const outer = await JSZip.loadAsync(fs.readFileSync(outerPath));
  ok(['FP_DataModel_1_0_0_0.zip', 'import.ps1', 'build-report.csv', 'calculated-and-rollup-fields.xlsx', 'README.txt'].every(n => outer.file(n)), 'the build zip holds the solution, import.ps1, the report, the hand-build list and a README');
  const innerBytes = await outer.file('FP_DataModel_1_0_0_0.zip').async('nodebuffer'); fs.writeFileSync(path.join(out, 'FP_DataModel_1_0_0_0.zip'), innerBytes);
  const inner = await JSZip.loadAsync(innerBytes);
  ok(['[Content_Types].xml', 'solution.xml', 'customizations.xml'].every(n => inner.file(n)), 'the solution zip has [Content_Types].xml, solution.xml and customizations.xml');
  const sol = await inner.file('solution.xml').async('string'), cus = await inner.file('customizations.xml').async('string');
  const wellFormed = await p.evaluate(xs => xs.map(x => new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('parsererror').length === 0), [sol, cus]);
  ok(wellFormed.every(Boolean), 'solution.xml and customizations.xml are well-formed XML');
  ok(/<UniqueName>FP_DataModel<\/UniqueName>/.test(sol) && /<Version>1\.0\.0\.0<\/Version>/.test(sol) && /<Managed>0<\/Managed>/.test(sol), 'solution.xml: name, version, unmanaged');
  ok(/<CustomizationPrefix>fp<\/CustomizationPrefix>/.test(sol) && /<CustomizationOptionValuePrefix>12000<\/CustomizationOptionValuePrefix>/.test(sol) && /description="Formus Events"/.test(sol), 'solution.xml: publisher with prefix, choice value prefix and display name');
  ok(/<RootComponent type="1" schemaName="fp_event" behavior="0" \/>/.test(sol) && /<RootComponent type="1" schemaName="fp_venue" behavior="0" \/>/.test(sol) && /<RootComponent type="1" schemaName="contact" behavior="2" \/>/.test(sol) && !/fp_noname/.test(sol), 'solution.xml: new tables in full, Contact as a shell, the table without a primary name left out');

  const entity = n => (cus.match(new RegExp('<Entity><Name [^>]*>' + n + '</Name>[\\s\\S]*?</Entity>')) || [''])[0];
  const attr = (e, ln) => (e.match(new RegExp('<attribute PhysicalName="[^"]*"><Type>[^<]*</Type><Name>' + ln + '</Name>[\\s\\S]*?</attribute>')) || [''])[0];
  const ev = entity('fp_Event'), co = entity('Contact');
  const typeOf = ln => (attr(ev, ln).match(/<Type>([^<]*)<\/Type>/) || [])[1];
  const expect = { fp_eventid: 'primarykey', fp_name: 'nvarchar', fp_email: 'nvarchar', fp_notes: 'ntext', fp_capacity: 'int', fp_big: 'bigint', fp_rate: 'decimal', fp_ratio: 'float', fp_price: 'money', fp_start: 'datetime', fp_doors: 'datetime', fp_public: 'bit', fp_status: 'picklist', fp_tags: 'multiselectpicklist', fp_venueid: 'lookup', fp_contactid: 'lookup', fp_customerid: 'customer' };
  const wrong = Object.entries(expect).filter(([ln, t]) => typeOf(ln) !== t).map(([ln, t]) => ln + ' expected ' + t + ' got ' + typeOf(ln));
  ok(!wrong.length, 'every supported field type maps to the right Dataverse type' + (wrong.length ? ': ' + wrong.join(', ') : ''));
  ok(!attr(ev, 'fp_createdon') && /fp_createdon,Field,Not included,"?Dataverse creates createdon on every table/.test(await outer.file('build-report.csv').async('string')), 'the copy of createdon is not built, and the report says why');
  ok(['fp_price_base', 'fp_total', 'fp_photo', 'fp_regardingid', 'fp_event_contact'].every(ln => !attr(ev, ln)), 'left out of the table: currency base, calculated, image, multi-table lookup, and the N:N row');
  ok(/PrimaryName\|/.test(attr(ev, 'fp_name')) && /<RequiredLevel>required<\/RequiredLevel>/.test(attr(ev, 'fp_name')) && /<MaxLength>200<\/MaxLength>/.test(attr(ev, 'fp_name')), 'the primary name column is marked, required, with its length');
  ok(/<Format>email<\/Format>/.test(attr(ev, 'fp_email')) && /<MaxLength>4000<\/MaxLength>/.test(attr(ev, 'fp_notes')) && /<MinValue>0<\/MinValue><MaxValue>5000<\/MaxValue>/.test(attr(ev, 'fp_capacity')) && /<Accuracy>3<\/Accuracy>/.test(attr(ev, 'fp_rate')), 'text format, memo length, number range and precision carry over');
  ok(/<Format>date<\/Format>[\s\S]*<Behavior>2<\/Behavior>/.test(attr(ev, 'fp_start')) && /<Format>datetime<\/Format>[\s\S]*<Behavior>1<\/Behavior>/.test(attr(ev, 'fp_doors')), 'date-only and date-and-time fields get the right format and behaviour');
  ok(/<AppDefaultValue>1<\/AppDefaultValue>/.test(attr(ev, 'fp_public')) && /description="Public"/.test(attr(ev, 'fp_public')) && /description="Private"/.test(attr(ev, 'fp_public')), 'Yes/No labels and default carry over');
  ok(/<option value="120000000" ExternalValue="" IsHidden="0"><labels><label description="Draft"/.test(attr(ev, 'fp_status')) && /<AppDefaultValue>120000000<\/AppDefaultValue>/.test(attr(ev, 'fp_status')) && /value="120000011"/.test(attr(ev, 'fp_tags')), 'choice values, labels (without "no color") and default carry over');
  ok(/<OwnershipTypeMask>UserOwned<\/OwnershipTypeMask>/.test(ev) && /<HasRelatedNotes>True<\/HasRelatedNotes>/.test(ev) && !/HasRelatedActivities/.test(ev) && /<LocalizedCollectionName description="Events"/.test(ev), 'table settings: ownership, notes, plural name');
  ok(/<entity Name="Contact" unmodified="1">/.test(co) && attr(co, 'fp_extra') && attr(co, 'fp_eventid') && !attr(co, 'firstname') && !attr(co, 'fp_badlink'), 'Contact holds only your new fields (not Microsoft\'s, not a link to a left-out table)');
  const rel = n => (cus.match(new RegExp('<EntityRelationship Name="' + n + '">[\\s\\S]*?</EntityRelationship>')) || [''])[0];
  const venueRel = (cus.match(/<EntityRelationship Name="fp_venue_event_venueid">[\s\S]*?<\/EntityRelationship>/) || [''])[0];
  ok(/<ReferencedEntityName>fp_Venue<\/ReferencedEntityName>/.test(venueRel) && /<ReferencingEntityName>fp_Event<\/ReferencingEntityName>/.test(venueRel) && /<CascadeDelete>Restrict<\/CascadeDelete>/.test(venueRel), 'lookup relationship: generated name, both tables, and the Cascade Delete setting');
  ok(/<ReferencedEntityName>fp_Event<\/ReferencedEntityName>/.test(rel('fp_event_contact_main')) && /<CascadeDelete>RemoveLink<\/CascadeDelete>/.test(rel('fp_event_contact_main')), 'a Relationship Name from the workbook is used, with Remove Link by default');
  ok((cus.match(/<ReferencingAttributeName>fp_CustomerId<\/ReferencingAttributeName>/g) || []).length === 2, 'a customer lookup gets two relationships (account and contact)');
  ok(/<EntityRelationshipType>ManyToMany<\/EntityRelationshipType>[\s\S]*<FirstEntityName>fp_Event<\/FirstEntityName><SecondEntityName>Contact<\/SecondEntityName><IntersectEntityName>fp_event_contact<\/IntersectEntityName>/.test(rel('fp_event_contact')), 'the N:N row becomes a many-to-many relationship');

  const report = await outer.file('build-report.csv').async('string');
  ok(/No Name,fp_noname,Table,Not included,no Primary Name Column/.test(report) && /fp_regardingid,Field,Not included,"?lookup to several tables/.test(report) && /fp_photo,Field,Not included,Image field/.test(report) && /fp_badlink,Field,Not included,its table fp_noname is not in this solution/.test(report) && /fp_total,Field,Build by hand/.test(report), 'the build report says what was left out and why');
  // element names as in solutions exported by Dataverse (checked against Microsoft's CoE Starter Kit); the first import failed on the plural name
  ok(/<LocalizedCollectionNames><LocalizedCollectionName description="Events" languagecode="1033" \/><\/LocalizedCollectionNames>/.test(cus) && !/<LocalizedCollectionNames><LocalizedName/.test(cus), 'the table plural name is a LocalizedCollectionName (Dataverse refused the import without it)');
  ok(/<CascadeDelete>Restrict<\/CascadeDelete><CascadeArchive>NoCascade<\/CascadeArchive>/.test(cus), 'one-to-many relationships carry CascadeArchive');
  ok(/<AssociationRoleOrdinal>1<\/AssociationRoleOrdinal>[\s\S]*<AssociationRoleOrdinal>2<\/AssociationRoleOrdinal>/.test(rel('fp_event_contact')) && !/RelationshipDescription|RelationshipRoleType/.test(rel('fp_event_contact')), 'N:N roles are numbered 1 and 2, with no description, as exported');
  ok(!/MobileOfflineEnabled|HasRelatedActivities|<Length>[^<]*<\/Length><displaynames><displayname description="Notes"/.test(cus) && /<CanModifyMobileClientOffline>1<\/CanModifyMobileClientOffline>/.test(cus) && /<HasRelatedNotes>True<\/HasRelatedNotes>/.test(cus), 'table settings use the exported names');
  ok(/<option value="1" ExternalValue="" IsHidden="0">/.test(cus) && /<OptionSetType>bit<\/OptionSetType><IntroducedVersion>[^<]*<\/IntroducedVersion><IsCustomizable>1<\/IsCustomizable><ExternalTypeName><\/ExternalTypeName>/.test(cus), 'option sets are written as exported');
  ok(/<Type>multiselectpicklist<\/Type>(?:(?!<\/attribute>)[\s\S])*<OptionSetName>/.test(cus) && !/<Type>multiselectpicklist<\/Type>(?:(?!<\/attribute>)[\s\S])*<AppDefaultValue>/.test(cus), 'multi-select choices have no AppDefaultValue');
  const ps1 = await outer.file('import.ps1').async('string');
  ok(/'FP_DataModel_1_0_0_0\.zip'/.test(ps1) && /pac solution import --path \$solution --publish-changes --async/.test(ps1) && /pac auth create --environment \$EnvironmentUrl/.test(ps1), 'import.ps1 signs in with pac and imports the solution');
  ok(/dotnet tool install --global Microsoft\.PowerApps\.CLI\.Tool/.test(ps1) && /winget install --id Microsoft\.PowerAppsCLI/.test(ps1) && /Get-Command pac/.test(ps1), 'import.ps1 checks for pac and installs it if missing');
  ok(/-SolutionPath/.test(ps1) && /Unblock-File/.test(ps1) && /\r\n/.test(ps1), 'import.ps1 takes -SolutionPath, says how to unblock it, and has Windows line endings');
  fs.writeFileSync(path.join(out, 'import_bundled.ps1'), ps1);
  // the script on its own, from the Export menu
  const [sd] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('#btnExport'); await p.click('.menu [data-x="ps1"]'); })()]);
  const solo = fs.readFileSync(await sd.path(), 'utf8');
  ok(sd.suggestedFilename() === 'import.ps1' && /Get-ChildItem -Path \$PSScriptRoot -Filter \*\.zip/.test(solo) && /-SolutionPath/.test(solo) && /pac solution import --path \$solution/.test(solo) && !/FP_DataModel/.test(solo), 'Export -> Import script downloads a general import.ps1 that finds the solution zip next to it');
  fs.writeFileSync(path.join(out, 'import_solo.ps1'), solo);
  ok(XLSX.utils.sheet_to_json(XLSX.read(await outer.file('calculated-and-rollup-fields.xlsx').async('nodebuffer')).Sheets['All fields']).some(r => r['Logical Name'] === 'fp_total'), 'the hand-build list is included');

  // tables only: each new table with its primary name column, nothing else
  await p.click('#btnExport'); await p.click('.menu [data-x="solution"]'); await p.waitForSelector('.solbox');
  ok(await p.isChecked('.solbox [name="solscope"][value="all"]'), 'the dialog starts on tables, fields and relationships');
  await p.check('.solbox [name="solscope"][value="tables"]'); await p.waitForTimeout(500);
  const tsum = await p.innerText('#solsum');
  ok(/2 new tables, each with its primary name column/.test(tsum) && /left out/.test(tsum) && /No Name/.test(tsum) && !/existing table/.test(tsum), 'choosing Tables only changes the summary');
  const [tdl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('.solbox [data-sol="go"]')]);
  const touter = await JSZip.loadAsync(fs.readFileSync(await tdl.path()));
  const tinnerBytes = await touter.file('FP_DataModel_1_0_0_0.zip').async('nodebuffer'); fs.writeFileSync(path.join(out, 'FP_TablesOnly.zip'), tinnerBytes);
  const tinner = await JSZip.loadAsync(tinnerBytes);
  const tsol = await tinner.file('solution.xml').async('string'), tcus = await tinner.file('customizations.xml').async('string');
  const tev = (tcus.match(/<Entity><Name [^>]*>fp_Event<\/Name>[\s\S]*?<\/Entity>/) || [''])[0];
  const tattrs = (tev.match(/<attribute PhysicalName="[^"]*"><Type>[^<]*<\/Type><Name>([^<]*)<\/Name>/g) || []).map(x => x.replace(/.*<Name>/, '').replace('</Name>', ''));
  ok(/schemaName="fp_event" behavior="0"/.test(tsol) && /schemaName="fp_venue" behavior="0"/.test(tsol) && !/schemaName="contact"/.test(tsol), 'tables only: the new tables are in the solution, Contact is not');
  ok(tattrs.includes('fp_name') && !tattrs.some(a => /^fp_(email|capacity|status|venueid|customerid)$/.test(a)), 'tables only: Event has its primary name column and none of the other fields (' + tattrs.join(', ') + ')');
  ok(!/<EntityRelationship Name=/.test(tcus) && /PrimaryName\|/.test(tev), 'tables only: no relationships, and the primary name column is marked');
  const treport = await touter.file('build-report.csv').async('string');
  ok(/fp_email,Field,Left out,tables-only build/.test(treport) && /fp_event_contact,N:N relationship,Left out/.test(treport) && /No Name,fp_noname,Table,Not included/.test(treport), 'the report lists what was left out, and still says why No Name is not included');
  ok(!touter.file('calculated-and-rollup-fields.xlsx') && /Tables only/.test(await touter.file('README.txt').async('string')), 'tables only: no hand-build list, and the README says it is a tables-only build');
  await p.click('#btnExport'); await p.click('.menu [data-x="solution"]'); await p.waitForSelector('.solbox');
  ok(await p.isChecked('.solbox [name="solscope"][value="tables"]'), 'the choice is remembered for this workbook');
  await p.click('.solbox [data-sol="cancel"]');

  if (process.env.PAC) {
    const run = args => { try { return { ok: true, out: execFileSync(process.env.PAC, args, { encoding: 'utf8', stdio: 'pipe', timeout: 300000 }) } } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') } } };
    const unp = path.join(out, 'unpacked'); fs.rmSync(unp, { recursive: true, force: true });
    const u = run(['solution', 'unpack', '--zipfile', path.join(out, 'FP_DataModel_1_0_0_0.zip'), '--folder', unp, '--packagetype', 'Unmanaged']);
    ok(u.ok && fs.existsSync(path.join(unp, 'Entities', 'fp_Event', 'Entity.xml')) && fs.existsSync(path.join(unp, 'Other', 'Relationships.xml')), 'pac solution unpack reads the generated solution' + (u.ok ? '' : ': ' + u.out.slice(-600)));
    const repack = path.join(out, 'repacked.zip'); fs.rmSync(repack, { force: true });
    const k = run(['solution', 'pack', '--zipfile', repack, '--folder', unp, '--packagetype', 'Unmanaged']);
    ok(k.ok && fs.existsSync(repack), 'pac solution pack re-packs it' + (k.ok ? '' : ': ' + k.out.slice(-600)));
    const tunp = path.join(out, 'unpacked-tables'); fs.rmSync(tunp, { recursive: true, force: true });
    const tu = run(['solution', 'unpack', '--zipfile', path.join(out, 'FP_TablesOnly.zip'), '--folder', tunp, '--packagetype', 'Unmanaged']);
    const tk = tu.ok && run(['solution', 'pack', '--zipfile', path.join(out, 'repacked-tables.zip'), '--folder', tunp, '--packagetype', 'Unmanaged']);
    ok(tu.ok && tk.ok && fs.existsSync(path.join(tunp, 'Entities', 'fp_Event', 'Entity.xml')), 'pac unpacks and re-packs the tables-only solution too' + (tu.ok && tk.ok ? '' : ': ' + (tk ? tk.out : tu.out).slice(-600)));
  } else console.log('SKIP pac unpack/pack check (set PAC=/path/to/pac to run it)');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
})();
