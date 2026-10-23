// Screenshots of the page inside an environment, on the stand-in Dataverse (tests/live-env.js), with red boxes recorded.
// NODE_MODULES=... node tools/live-screenshots.js <outdir>   then: python3 tools/guide-mark.py <outdir> <images>
const B = process.env.NODE_MODULES || require('path').resolve(__dirname, '../node_modules');
const path = require('path'), fs = require('fs'); const { chromium } = require(B + '/playwright');
const { environment, answer } = require('../tests/live-env');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'), 'utf8');
const ORG = 'https://contoso.crm11.dynamics.com', PAGE = ORG + '/WebResources/formus_/dme/DataModelExplorer.html', out = process.argv[2], SCALE = 1.25, boxes = {};
fs.mkdirSync(out, { recursive: true });
const box = async (p, sel, ox = 0, oy = 0) => { const b = await p.locator(sel).first().boundingBox(); return [b.x - ox, b.y - oy, b.width, b.height].map(v => Math.round(v * SCALE)); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const open = async managed => { const env = environment(managed), ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: SCALE });
    await ctx.route(ORG + '/**', r => r.request().url().startsWith(PAGE) ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.fulfill(answer(env, r.request().url())));
    const p = await ctx.newPage(); await p.goto(PAGE); await p.waitForTimeout(2500); return { env, p }; };
  // 20: the Environment panel, choosing a solution to load
  let { env, p } = await open(false);
  await p.selectOption('#livesol1', env.sol.solutionid); await p.waitForTimeout(200);
  const pr = await p.locator('#dvpanel').boundingBox();
  boxes['20-environment'] = [await box(p, '#livesol1', pr.x, pr.y), await box(p, '[data-live="load"]', pr.x, pr.y), await box(p, '#livesol2', pr.x, pr.y), await box(p, '#livemanaged', pr.x, pr.y)];
  await p.screenshot({ path: path.join(out, '20-environment.png'), clip: { x: pr.x, y: pr.y, width: pr.width, height: Math.min(pr.height, 700) } });
  // 21: managed environment check results
  ({ env, p } = await open(true));
  await p.setInputFiles('#file', path.join(root, 'samples/Import_Test_Model.xlsx')); await p.waitForTimeout(2500); await p.keyboard.press('Escape');
  if (!await p.isVisible('#dvpanel.open')) await p.click('#btnDv');
  await p.waitForSelector('#livesol2 option:nth-child(2)', { state: 'attached' }); await p.selectOption('#livesol2', env.sol.solutionid); await p.check('#livemanaged'); await p.click('[data-live="check"]');
  await p.waitForSelector('#dvpanel [data-ov="issues:dv"]', { timeout: 30000 }); await p.waitForTimeout(300);
  const pr2 = await p.locator('#dvpanel').boundingBox();
  boxes['21-environment-check'] = [await box(p, '#dvpanel .stats', pr2.x, pr2.y), await box(p, '#dvpanel [data-ov="issues:dv"]', pr2.x, pr2.y)];
  await p.screenshot({ path: path.join(out, '21-environment-check.png'), clip: { x: pr2.x, y: pr2.y, width: pr2.width, height: Math.min(pr2.height, 780) } });
  // 22: the differences in Checks
  await p.click('#dvpanel [data-ov="issues:dv"]'); await p.waitForTimeout(700);
  boxes['22-environment-differences'] = [await box(p, '#isswrap tbody tr:has-text("not in this workbook")'), await box(p, '#isswrap tbody tr:has-text("formus_extracode")'), await box(p, '#isswrap tbody tr:has-text("Changed directly")')];
  await p.screenshot({ path: path.join(out, '22-environment-differences.png') });
  fs.writeFileSync(path.join(out, 'boxes.json'), JSON.stringify(boxes, null, 1)); console.log('ok'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
