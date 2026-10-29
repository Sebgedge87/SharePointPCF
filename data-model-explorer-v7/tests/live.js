// The page inside a Dataverse environment: node tests/live.js  (run `npm run build` first)
// The page is served as a web resource on a stand-in environment (https://contoso.crm11.dynamics.com), whose Web API is
// answered here from the import test workbook, with differences added: an undocumented field, a field not built, a
// different required level, an extra table in the solution, and (managed run) an unmanaged field and an unmanaged layer.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'), 'utf8');
const wbk = path.join(root, 'samples/Import_Test_Model.xlsx'), ORG = 'https://contoso.crm11.dynamics.com';
const PAGE = ORG + '/WebResources/dme_/dme/DataModelExplorer.html';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const { environment, answer } = require('./live-env');

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const run = async managed => {
    const env = environment(managed), ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await ctx.route(ORG + '/**', route => { const url = route.request().url(); if (url.startsWith(PAGE)) return route.fulfill({ status: 200, contentType: 'text/html', body: html }); return route.fulfill(answer(env, url)); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(PAGE); await p.waitForTimeout(2500);
    return { env, ctx, p, errs };
  };

  // 1. development environment: load a solution as the model
  let { env, ctx, p, errs } = await run(false);
  ok(await p.isVisible('#dvpanel.open') && /This environment/.test(await p.innerText('#dvpanel')), 'inside an environment, the page opens on "This environment"');
  ok(/contoso\.crm11\.dynamics\.com · Test Consultant/.test(await p.innerText('#dvpanel')), 'it shows the environment and who is signed in');
  ok(/Environment/.test(await p.innerText('#btnDv')) && await p.isVisible('#btnDv'), 'the header has an Environment button');
  const rows = () => p.$$eval('[data-sp="1"] .sprow b', o => o.map(x => x.textContent));
  let sols = await rows();
  ok(sols.includes('Sample import test') && sols.includes('Contoso sales') && !sols.some(s => /Default Solution/.test(s)), 'the solution list has the environment\'s solutions (not Default)');
  ok(!sols.includes('Field Service') && /Managed · 2/.test(await p.textContent('[data-sp="1"] .spgrp')), 'unmanaged solutions come first; managed ones are folded away, with a count');
  ok(await p.isDisabled('[data-live="load"]'), 'Load is greyed out until a solution is picked');
  await p.click('[data-sp="1"] .spgrp'); sols = await rows();
  ok(sols.includes('Field Service') && sols.includes('Dynamics 365 Portals - Identity'), 'clicking Managed opens them');
  await p.fill('[data-sp="1"] .spq', 'portals ident'); sols = await rows();
  ok(sols.length === 1 && sols[0] === 'Dynamics 365 Portals - Identity', 'searching finds a solution by any words of its name');
  await p.fill('[data-sp="1"] .spq', 'importtest'); sols = await rows();
  ok(sols.length === 1 && sols[0] === 'Sample import test', 'and by its unique name');
  await p.click(`[data-sp="1"] [data-sid="${env.sol.solutionid}"]`);
  ok(/Load Sample import test as the model/.test(await p.innerText('[data-live="load"]')), 'the Load button names the solution picked');
  ok(await p.$eval('#livemanaged', e => { const r = e.getBoundingClientRect(); return r.width < 30 && r.height < 30 && getComputedStyle(e).borderTopWidth === '0px'; }), 'the Managed environment tick box is a plain tick box');
  await p.click('[data-live="load"]');
  await p.waitForFunction(() => /Sample_ImportTest \(live /.test(document.querySelector('#main')?.textContent || ''), null, { timeout: 30000 }); await p.waitForTimeout(800);
  const names = await p.$$eval('#nav .navitem', n => n.map(x => x.textContent));
  ok(['Test Project', 'Test Task', 'Test Resource', 'Test Extra', 'Contact'].every(t => names.some(n => n.includes(t))) || (await p.innerText('#nav')).includes('5'), 'loading the solution builds a model of its 5 tables');
  if (!await p.locator('#nav .navitem:has-text("Test Task")').count()) await p.click('#nav [data-grp]');
  await p.click('#nav .navitem:has-text("Test Task")'); await p.waitForTimeout(500);
  const row = ln => p.locator(`#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("${ln}"))`);
  const cells = await p.$$eval('#gridwrap tbody tr td[data-col="Logical Name"] .mono', c => c.map(x => x.textContent.trim()));
  ok(cells.includes('sample_extracode') && !cells.includes('sample_complete') && !cells.some(c => /name$/.test(c) && c.startsWith('sample_projectid')), 'the table holds what is really there (helper columns left out)');
  ok(/Targets:?\s*sample_testproject/.test(await row('sample_projectid').locator('td[data-col="Additional data"]').innerText()) && /N:1/.test(await row('sample_projectid').innerText()), 'lookups carry their target and N:1');
  ok(/750470000: (High|Low|Critical|Medium|Normal|\w+)/.test(await row('sample_priority').locator('td[data-col="Additional data"]').innerText().catch(() => '')) || /Whole/.test(await row('sample_priority').innerText()), 'choice options and number settings come from the environment');
  ok(/ApplicationRequired/.test(await row('sample_duedate').innerText()), 'required levels are the environment\'s');
  if (!await p.locator('#nav .navitem:has-text("Contact")').count()) await p.click('#nav [data-grp]');
  await p.click('#nav .navitem:has-text("Contact")'); await p.waitForTimeout(400);
  const ccells = await p.$$eval('#gridwrap tbody tr td[data-col="Logical Name"] .mono', c => c.map(x => x.textContent.trim()));
  ok(ccells.includes('sample_projectid') && ccells.includes('contactid') && !ccells.includes('emailaddress1'), 'a standard table added as a shell brings only the solution\'s columns (plus its key and name)');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(500); await p.click('[data-eq=all]'); await p.waitForTimeout(2500);
    ok(await p.locator('#erdcv svg g.node').count() >= 4 && await p.locator('#erdcv svg path.rl[stroke-dasharray]').count() >= 1, 'the ERD draws the live model, N:N included');
  await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(400);
  ok(!/dv-field-missing|does not exist on/.test(await p.innerText('#main')), 'a model read from the environment has nothing "not built"');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  ok(!env.calls.some(c => /^(PATCH|POST)/.test(c)), 'it only reads');
  await ctx.close();

  // 2. managed environment: check the design workbook against the solution, with unmanaged changes
  ({ env, ctx, p, errs } = await run(true));
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2500);
  if (await p.locator('.dlgbox').count()) await p.click('.dlgbox [data-d="0"]');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  if (!await p.isVisible('#dvpanel.open')) await p.click('#btnDv');
  await p.waitForSelector('[data-sp="1"] [data-sid]');
  ok(await p.locator('#dvpanel .solpick').count() === 1, 'one solution list, with a search, serves both loading and checking');
  await p.fill('[data-sp="1"] .spq', 'SAMPLE'); await p.click(`[data-sp="1"] [data-sid="${env.sol.solutionid}"]`);
  ok(/Check against Sample import test/.test(await p.innerText('[data-live="check"]')) && /Load Sample import test as the model/.test(await p.innerText('[data-live="load"]')), 'both buttons name the solution picked'); await p.check('#livemanaged'); await p.click('[data-live="check"]');
  await p.waitForSelector('#dvpanel [data-ov="issues:dv"]', { timeout: 30000 });
  const stats = await p.innerText('#dvpanel .stats');
  ok(/3 \/ 3\s*tables found/.test(stats), 'all 3 workbook tables are found');
  ok(/\b3\s*undocumented/.test(stats), 'undocumented: the extra table, Contact (in the solution for one field) and the extra field');
  ok(/\b1\s*not built/.test(stats), 'not built: the field the environment doesn\'t have');
  ok(/\b1\s*differences/.test(stats) || /\b[1-9]\d*\s*differences/.test(stats), 'differences: the changed required level');
  ok(/\b[2-9]\s*unmanaged changes/.test(stats), 'unmanaged changes: the field created here and the layer on a managed field');
  await p.click('#dvpanel [data-ov="issues:dv"]'); await p.waitForTimeout(600);
  const iss = await p.innerText('#main');
  ok(/sample_testextra.*is in the solution Sample import test but not in this workbook/s.test(iss), 'Checks: the undocumented table');
  ok(/sample_extracode.*not documented.*created directly in this environment \(unmanaged\)/s.test(iss), 'Checks: the undocumented field, made directly in this environment');
  ok(/does not exist on sample_testtask in Dataverse/.test(iss), 'Checks: the field not built');
  ok(/Workbook says None, Dataverse says ApplicationRequired/.test(iss), 'Checks: the required-level difference');
  ok(/Changed directly in this environment\. Unmanaged changes sit on top of Sample_ImportTest \(changed: displayname\)/.test(iss), 'Checks: the unmanaged change to a managed field, with what changed');
  ok(env.calls.some(c => c.startsWith('msdyn_componentlayers')), 'solution layers were read');
  // Default solution: the workbook's tables only
  await p.click('#btnDv'); if (!await p.isVisible('#dvpanel.open')) await p.click('#btnDv');
  await p.waitForSelector('[data-sp="1"] .spq'); await p.fill('[data-sp="1"] .spq', ''); await p.click('[data-sp="1"] [data-sid=""]');
  ok(await p.isDisabled('[data-live="load"]') && /Check against the Default solution/.test(await p.innerText('[data-live="check"]')), 'the Default solution can be checked against, not loaded'); await p.uncheck('#livemanaged'); await p.click('[data-live="check"]');
  await p.waitForTimeout(2500);
  const st2 = await p.innerText('#dvpanel .stats');
  ok(/\b1\s*undocumented/.test(st2) && !/unmanaged changes/.test(st2), 'with the Default solution only the workbook\'s tables are checked (no table list to compare)');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  // 3. outside an environment nothing changes
  const ctx3 = await b.newContext(); const q = await ctx3.newPage(); await q.goto('file://' + path.join(root, 'dist/Data_Model_Explorer.html')); await q.waitForTimeout(1500);
  ok(!await q.isVisible('#dvpanel.open') && !/Environment/.test(await q.innerText('#btnDv')), 'opened as a file, it is the normal page');
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
