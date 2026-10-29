// Dark mode: node tests/theme.js  (run `npm run build` first)
// Automatic follows the system; the header's theme button picks Dark or Light and it is remembered. The ERD drawn on
// the page follows the theme, while what is exported keeps its light colours.
const path = require('path');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const wbk = path.resolve(__dirname, '../samples/Import_Test_Model.xlsx');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const bg = p => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const dark = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return r + g + b < 150; };

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for (const scheme of ['light', 'dark']) {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
    await p.goto(page_); await p.waitForTimeout(1000);
    ok(dark(await bg(p)) === (scheme === 'dark') && /Automatic/.test(await p.getAttribute('#btnTheme', 'title')), `Automatic follows a ${scheme} system`);
    await p.close();
  }
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1000);
  await p.click('#btnTheme'); await p.waitForTimeout(200);
  ok(dark(await bg(p)) && /Dark/.test(await p.getAttribute('#btnTheme', 'title')), 'the theme button switches to Dark');
  await p.reload(); await p.waitForTimeout(1200);
  ok(dark(await bg(p)), 'and Dark is remembered after a reload');
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  const txt = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.btn.primary')); return [c.backgroundColor, c.color]; });
  ok(/255, 255, 255/.test(txt[1]) && !/255, 255, 255/.test(txt[0]), 'filled buttons keep white text on a fill');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(800); await p.click('[data-eq=all]').catch(() => {}); await p.waitForTimeout(2000);
  const box = await p.evaluate(() => { const r = document.querySelector('.erdv svg g.node rect'); return [r.getAttribute('fill'), getComputedStyle(r).fill]; });
  ok(box[0] === '#FFFFFF' && dark(box[1]), 'the ERD on the page is dark, while its drawing (what is exported) keeps white tables (' + box.join(' / ') + ')');
  await p.click('#btnTheme'); await p.waitForTimeout(200);
  ok(!dark(await bg(p)) && /Light/.test(await p.getAttribute('#btnTheme', 'title')), 'then Light');
  await p.click('#btnTheme'); await p.waitForTimeout(200);
  ok(/Automatic/.test(await p.getAttribute('#btnTheme', 'title')) && await p.evaluate(() => !document.documentElement.hasAttribute('data-theme')), 'and back to Automatic');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
