// The guide's picture of comparing environments: NODE_MODULES=... node tools/envs-screenshot.js <out.png>
// Uses the stand-in environments of tests/envs.js (Dev, and a Test where a column is missing and one is set differently).
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.NODE_MODULES + '/playwright');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'), 'utf8');
const ORG = 'https://contoso.crm11.dynamics.com', TEST = 'https://contosotest.crm11.dynamics.com', PAGE = ORG + '/WebResources/dme_/dme/DataModelExplorer.html';
const { environment, answer } = require(path.join(root, 'tests/live-env'));
(async () => {
  const dev = environment(false), test = environment(false);
  const task = test.ents.sample_testtask; task.Attributes = task.Attributes.filter(a => a.LogicalName !== 'sample_estimatedhours');
  test.ents.sample_testproject.Attributes.find(a => a.LogicalName === 'sample_name').RequiredLevel = { Value: 'None' }; test.sol.version = '1.1.0.0';
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 760 }, deviceScaleFactor: 1.25 });
  await ctx.route(ORG + '/**', route => { const url = route.request().url(), u = new URL(url);
    if (url.startsWith(PAGE)) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (u.pathname === '/__dme/envs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ envs: [{ id: '0', name: 'Contoso Dev', url: ORG, main: true }, { id: 't1', name: 'Contoso Test', url: TEST, main: false }] }) });
    if (u.pathname.startsWith('/__dme/env/t1/')) return route.fulfill(answer(test, TEST + u.pathname.slice('/__dme/env/t1'.length) + u.search));
    return route.fulfill(answer(dev, url)); });
  const p = await ctx.newPage(); await p.goto(PAGE); await p.waitForTimeout(2500);
  await p.click(`[data-sp="1"] [data-sid="${dev.sol.solutionid}"]`); await p.click('[data-env="drift"]');
  await p.waitForSelector('.envgrid', { timeout: 30000 }); await p.waitForTimeout(500);
  await p.screenshot({ path: process.argv[2], clip: { x: 272, y: 56, width: 1168, height: 420 } });
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
