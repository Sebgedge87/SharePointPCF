// The page as separate web resources (dist/web): node tests/webfiles.js  (run `npm run build` first)
// The files are served on a stand-in environment, as Dataverse serves them: the page, app.js and lib/*.js. Checked: it
// runs inside the environment as the single file does, a read-only copy has the code and libraries written in, and a
// missing library or a mix of versions is reported on the page.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'dist/web'), out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
const ORG = 'https://contoso.crm11.dynamics.com', BASE = ORG + '/WebResources/dme_/dme/', PAGE = BASE + 'DataModelExplorer.html';
const wbk = path.join(root, 'samples/Import_Test_Model.xlsx');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const { environment, answer } = require('./live-env');

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const files = fs.readdirSync(web, { recursive: true }).filter(f => fs.statSync(path.join(web, f)).isFile()).map(f => f.replace(/\\/g, '/')).sort();
  ok(JSON.stringify(files) === JSON.stringify(['DataModelExplorer.html', 'app.js', 'lib/exceljs.min.js', 'lib/jszip.min.js', 'lib/xlsx.full.min.js']), 'dist/web holds the page, app.js and the three libraries');
  const page = fs.readFileSync(path.join(web, 'DataModelExplorer.html'), 'utf8'), single = fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'), 'utf8');
  const build = /const DME_BUILD = "([^"]+)"/.exec(page)[1];
  ok(page.length < 300e3 && /<script src="app\.js\?v=[^"]+"><\/script>/.test(page) && (page.match(/<script src="lib\//g) || []).length === 3, `the page is small (${(page.length / 1e3).toFixed(0)} KB) and loads app.js and the libraries`);
  ok(new RegExp(`const APP_BUILD="${build}"`).test(fs.readFileSync(path.join(web, 'app.js'), 'utf8')) && single.includes(`const DME_BUILD = "${build}"`), 'the page, app.js and the single file carry the same build id (' + build + ')');

  const requested = [];
  const serve = async ({ override = {}, managed = false } = {}) => {
    const env = environment(managed), ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await ctx.route(ORG + '/**', route => {
      const url = route.request().url();
      if (url.startsWith(BASE)) {
        const rel = decodeURIComponent(url.slice(BASE.length).split('?')[0]); requested.push(rel);
        if (rel in override) return override[rel] === null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'application/javascript', body: override[rel] });
        const f = path.join(web, rel); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: rel.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(f) });
      }
      return route.fulfill(answer(env, url));
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(PAGE); await p.waitForTimeout(2500);
    return { ctx, p, errs, env };
  };

  // 1. inside an environment, as separate web resources
  let { ctx, p, errs } = await serve();
  ok(['app.js', 'lib/xlsx.full.min.js', 'lib/exceljs.min.js', 'lib/jszip.min.js'].every(f => requested.includes(f)), 'the page asks for app.js and each library');
  ok(await p.isVisible('#dvpanel.open') && /This environment/.test(await p.innerText('#dvpanel')), 'it runs inside the environment, opening on "This environment"');
  ok(!await p.locator('#partsbad').count(), 'with every part from the same build, no warning is shown');
  await p.keyboard.press('Escape');
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  ok(/Import_Test_Model/.test(await p.innerText('#main')), 'a workbook opens as usual (SheetJS and ExcelJS loaded from their own files)');

  // 2. a read-only copy is still one file
  await p.click('#btnExport'); await p.click('.menu [data-x="ro-copy"]'); await p.waitForSelector('.namebox');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('.namebox [data-n="1"]')]);
  const ro = path.join(out, 'webfiles_readonly.html'); await d.saveAs(ro);
  const roHtml = fs.readFileSync(ro, 'utf8');
  ok(!/<script src="[^"]+"><\/script>/.test(roHtml) && /const DME_MODE = "readonly"/.test(roHtml) && roHtml.length > 1.5e6, `the read-only copy has app.js and the libraries written in (${(roHtml.length / 1e6).toFixed(1)} MB, no <script src>)`);
  const q = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.goto('file://' + ro); await q.waitForTimeout(1800);
  ok(await q.isVisible('.rochip') && /Import_Test_Model/.test(await q.innerText('#main')) && !await q.locator('#partsbad').count(), 'and opens on its own as a file, onto the workbook');
  ok(!errs2.length, 'no page errors in the copy' + (errs2.length ? ': ' + errs2.join(' | ') : ''));
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await ctx.close();

  // 3. app.js from another build (an old copy in the browser's cache, or an import that did not finish)
  const other = fs.readFileSync(path.join(web, 'app.js'), 'utf8').replace(`const APP_BUILD="${build}"`, 'const APP_BUILD="5.9.9-0000000000"');
  ({ ctx, p } = await serve({ override: { 'app.js': other } }));
  ok(await p.isVisible('#partsbad') && /different versions[\s\S]*Ctrl\+F5/.test(await p.innerText('#partsbad')), 'parts from different versions are reported, with what to do');
  await ctx.close();

  // 4. a library that did not load
  ({ ctx, p } = await serve({ override: { 'lib/exceljs.min.js': null } }));
  ok(await p.isVisible('#partsbad') && /did not load: ExcelJS/.test(await p.innerText('#partsbad')), 'a library that did not load is named');
  await ctx.close();

  // 5. the single file, opened as a file, has no warning
  const s = await (await b.newContext()).newPage(); await s.goto('file://' + path.join(root, 'dist/Data_Model_Explorer.html')); await s.waitForTimeout(1500);
  ok(!await s.locator('#partsbad').count() && !/<script src="[^"]+"><\/script>/.test(single), 'the single file has everything written in, and no warning');

  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
