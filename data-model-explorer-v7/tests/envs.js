// Several environments at once, as the XrmToolBox tool offers them: node tests/envs.js  (run `npm run build` first)
// The tool's endpoints (/__dme/envs, /__dme/env/<id>/api/data/...) are stood in for here: "Contoso Dev" is the page's own
// environment and "Contoso Test" a second one where a column is missing, a required level differs and the solution
// is a later version.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'), 'utf8');
const wbk = path.join(root, 'samples/Import_Test_Model.xlsx'), ORG = 'https://contoso.crm11.dynamics.com', TEST = 'https://contosotest.crm11.dynamics.com';
const PAGE = ORG + '/WebResources/dme_/dme/DataModelExplorer.html';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const { environment, answer } = require('./live-env');

(async () => {
  const dev = environment(false), test = environment(false);
  const task = test.ents.sample_testtask; task.Attributes = task.Attributes.filter(a => a.LogicalName !== 'sample_estimatedhours');   // not built in Test
  test.ents.sample_testproject.Attributes.find(a => a.LogicalName === 'sample_name').RequiredLevel = { Value: 'None' };               // set differently in Test
  test.sol.version = '1.1.0.0';
  const calls = [];
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(ORG + '/**', route => {
    const url = route.request().url(), u = new URL(url);
    if (url.startsWith(PAGE)) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (u.pathname.startsWith('/__dme/')) calls.push(u.pathname + u.search);
    if (u.pathname === '/__dme/envs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ envs: [{ id: '0', name: 'Contoso Dev', url: ORG, main: true }, { id: 't1', name: 'Contoso Test', url: TEST, main: false }] }) });
    if (u.pathname === '/__dme/envs/add') return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' });
    if (u.pathname === '/__dme/envs/remove') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (u.pathname.startsWith('/__dme/env/t1/')) return route.fulfill(answer(test, TEST + u.pathname.slice('/__dme/env/t1'.length) + u.search));
    return route.fulfill(answer(dev, url));
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGE); await p.waitForTimeout(2500);

  const panel = await p.innerText('#dvpanel');
  ok(/Other environments[\s\S]*Contoso Dev[\s\S]*this one[\s\S]*Contoso Test/i.test(panel), 'inside XrmToolBox the panel lists the environments: this one and the extra connection');
  await p.click('[data-env="add"]'); await p.waitForTimeout(300);
  ok(calls.includes('/__dme/envs/add'), 'Add environment… asks XrmToolBox for another connection');
  ok(await p.isDisabled('[data-env="drift"]'), 'Compare across them waits for a solution');

  // one solution across the environments
  await p.click(`[data-sp="1"] [data-sid="${dev.sol.solutionid}"]`);
  ok(/Compare Sample import test across them/.test(await p.innerText('[data-env="drift"]')), 'the compare button names the solution picked');
  await p.click('[data-env="drift"]');
  await p.waitForSelector('.envgrid', { timeout: 30000 }); await p.waitForTimeout(300);
  let page = await p.innerText('#main');
  ok(/Compare Sample import test across environments/.test(page) && /Version 1\.0\.0\.0[\s\S]*Version 1\.1\.0\.0/.test(page), 'the results show each environment with its solution version');
  const row = async (field, what) => p.$$eval('.envgrid tbody tr', (rs, [f, w]) => rs.map(r => [...r.cells].map(c => c.textContent.trim())).find(c => c[1] === f && (!w || c[2].includes(w))), [field, what]);
  let r = await row('sample_estimatedhours');
  ok(r && /Missing/.test(r[2]) && !/Missing/.test(r[3]) && r[4] === 'Missing', 'a column missing from Test is shown (' + (r && r.join(' | ')) + ')');
  r = await row('sample_name', 'Required');
  ok(r && /ApplicationRequired/.test(r[3]) && /None/.test(r[4]), 'a column set differently shows each environment\'s value (' + (r && r.join(' | ')) + ')');
  ok(!(await row('sample_duedate')), 'columns that match everywhere are not listed');
  ok(calls.some(c => c.startsWith('/__dme/env/t1/api/data/v9.2/EntityDefinitions')), 'Test is read through the tool, with its own connection');

  // the workbook against each environment
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  await p.click('#btnDv'); await p.waitForSelector('#dvpanel.open'); await p.waitForTimeout(300);
  await p.click(`[data-sp="1"] [data-sid="${dev.sol.solutionid}"]`);
  await p.click('[data-env="checkall"]');
  await p.waitForFunction(() => /against each environment/.test(document.querySelector('#main')?.textContent || ''), null, { timeout: 30000 }); await p.waitForTimeout(300);
  r = await row('sample_estimatedhours', 'Field not in Dataverse');
  ok(r && r[3] === '✓' && r[4] === 'Not built', 'the workbook against each environment: a field built in Dev but not in Test (' + (r && r.join(' | ')) + ')');
  r = await row('sample_extracode');
  ok(r && /Undocumented/.test(r[3]) && /Undocumented/.test(r[4]), 'something undocumented in both shows in both');
  await p.fill('#envq', 'estimatedhours'); await p.waitForTimeout(200);
  ok(await p.locator('.envgrid tbody tr').count() === 1, 'the filter narrows the rows');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-envcsv]')]);
  ok(/^Environments - Import_Test_Model\.xlsx\.csv$/.test(d.suggestedFilename()), 'Download CSV (' + d.suggestedFilename() + ')');
  ok(!/Text length|Not read/.test(await p.innerText('#main')), 'every environment was read');
  // the page's own checks are unchanged by the comparison
  await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(400);
  ok(!/Contoso Test/.test(await p.innerText('#main')), 'Checks still show the page\'s own environment only');
  await p.click('#btnDv'); await p.waitForTimeout(300);
  await p.click('[data-env="remove"][data-envid="t1"]'); await p.waitForTimeout(300);
  ok(calls.includes('/__dme/envs/remove?id=t1'), 'an extra environment can be removed');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
