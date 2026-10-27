// Back and forward between screens: node tests/navigation.js  (run `npm run build` first)
const path = require('path');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const wbk = path.resolve(__dirname, '../samples/Import_Test_Model.xlsx');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2500); await p.keyboard.press('Escape');
  const head = async () => { await p.waitForTimeout(400); return (await p.innerText('#main')).slice(0, 200); };

  ok(/Overview/.test(await head()) && await p.isDisabled('#btnBack'), 'it opens on the Overview, with Back greyed out');
  if (!await p.locator('#nav .navitem:has-text("Test Task")').count()) await p.click('#nav [data-grp]');
  await p.click('#nav .navitem:has-text("Test Task")');
  ok(/Test Task/.test(await head()) && !await p.isDisabled('#btnBack'), 'opening a table makes Back available');
  await p.click('#nav .navitem[data-view="__issues"]');
  ok(/Checks/.test(await head()), 'Checks');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(800);
  ok(await p.locator('.erdv').count() === 1, 'then the ERD');

  await p.click('#btnBack');
  ok(/Checks/.test(await head()), 'Back returns to Checks');
  await p.goBack();
  ok(/Test Task/.test(await head()), 'the browser\'s Back returns to the table');
  await p.goBack();
  ok(/Overview/.test(await head()) && await p.isDisabled('#btnBack'), 'and then to the Overview, where Back is greyed out again');
  await p.goForward();
  ok(/Test Task/.test(await head()), 'Forward goes to the table again');
  await p.click('#nav .navitem[data-view="__all"]');
  ok(/All fields/.test(await head()), 'a new screen after going back');
  await p.click('#btnBack');
  ok(/Test Task/.test(await head()), 'and Back returns from it');
  // the same screen twice is one step
  await p.click('#nav .navitem:has-text("Test Task")'); await p.click('#nav .navitem[data-view="__overview"]'); await p.click('#btnBack');
  ok(/Test Task/.test(await head()), 'opening the same screen again is not an extra step');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
