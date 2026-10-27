// Publishers and prefixes, and full text on hover: node tests/prefixes.js  (run `npm run build` first)
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
  const openPubs = async () => { await p.click('#btnCheck'); await p.click('.menu [data-ck="pubs"]'); await p.waitForSelector('#pubrows'); };
  const rows = () => p.$$eval('#pubrows .pubrow', rs => rs.map(r => [...r.querySelectorAll('input')].map(i => i.value)));

  // the settings start from the prefix guessed from the custom tables
  await openPubs();
  ok(JSON.stringify(await rows()) === JSON.stringify([['formus', 'formus', 'FORMUS', '']]), 'Publishers and prefixes starts with the prefix guessed from the workbook');
  ok(await p.inputValue('[data-msp]') === 'ms*, adx', 'Microsoft prefixes default to ms* and adx');
  // validation
  await p.click('[data-pubadd]'); await p.fill('#pubrows .pubrow:last-child [data-pk="prefix"]', 'msdyn');
  await p.click('[data-pubx="save"]');
  ok(/matches a Microsoft prefix/.test(await p.innerText('#puberr')), 'a Microsoft prefix cannot be one of yours');
  await p.fill('#pubrows .pubrow:last-child [data-pk="prefix"]', 'Bad!'); await p.click('[data-pubx="save"]');
  ok(/2 to 8 lower-case/.test(await p.innerText('#puberr')), 'a bad prefix is explained');
  // your publishers: formus with its details, plus cxp, ax and portal
  await p.fill('#pubrows .pubrow:last-child [data-pk="prefix"]', 'cxp');
  const r1 = '#pubrows .pubrow:first-child';
  await p.fill(r1 + ' [data-pk="pubName"]', 'FORMUS'); await p.fill(r1 + ' [data-pk="pubDisplay"]', 'Formus Pro'); await p.fill(r1 + ' [data-pk="optPrefix"]', '75047');
  for (const x of ['ax', 'portal']) { await p.click('[data-pubadd]'); await p.fill('#pubrows .pubrow:last-child [data-pk="prefix"]', x); }
  await p.fill('[data-msp]', 'ms*, adx, cr'); await p.click('[data-pubx="save"]'); await p.waitForTimeout(300);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('dme.pubs')));
  ok(saved.map(x => x.prefix).join() === 'formus,cxp,ax,portal' && saved[0].pubName === 'FORMUS' && saved[0].optPrefix === 75047 && saved[1].pubName === 'cxp' && saved[1].pubDisplay === 'CXP', 'saving keeps four publishers, filling in names that were left blank');
  await p.click('#btnCheck');
  ok(/formus_, cxp_, ax_, portal_/.test(await p.innerText('.menu [data-ck="pubs"]')), 'the Check menu lists your prefixes');
  await p.keyboard.press('Escape'); await p.mouse.click(700, 600);
  await openPubs();
  ok((await rows()).length === 4 && await p.inputValue('[data-msp]') === 'ms*, adx, cr', 'the settings are there when reopened');
  await p.click('[data-pubx="cancel"]');

  // the build dialog fills the publisher from the prefix
  await p.click('#btnBuild'); await p.waitForSelector('.solbox [data-k="prefix"]');
  const v = k => p.inputValue(`.solbox [data-k="${k}"]`);
  ok(await v('prefix') === 'formus' && await v('pubName') === 'FORMUS' && await v('pubDisplay') === 'Formus Pro' && await v('optPrefix') === '75047', 'Build solution uses the saved publisher for the prefix');
  ok((await p.$$eval('#dme-pfx option', o => o.map(x => x.value))).join() === 'formus,cxp,ax,portal', 'the Prefix box suggests your prefixes');
  await p.fill('.solbox [data-k="prefix"]', 'cxp'); await p.waitForTimeout(100);
  ok(await v('pubName') === 'cxp' && await v('pubDisplay') === 'CXP', 'picking another prefix fills in its publisher');
  await p.click('.solbox [data-sol="cancel"]');

  // Checks: a custom field with a prefix that is neither yours nor Microsoft's
  if (!await p.locator('#nav .navitem:has-text("Test Task")').count()) await p.click('#nav [data-grp]');
  await p.click('#nav .navitem:has-text("Test Task")'); await p.waitForTimeout(400);
  const lnCell = ln => p.locator(`#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("${ln}")) td[data-col="Logical Name"]`);
  const rename = async (from, to) => { await lnCell(from).dblclick(); await p.waitForSelector('td.editing input'); await p.fill('td.editing input', to); await p.keyboard.press('Enter'); await p.waitForTimeout(300); };
  const unknown = async () => { await p.click('#nav .navitem[data-view="__issues"]'); await p.waitForTimeout(300); const t = await p.innerText('#main'); await p.click('#nav .navitem:has-text("Test Task")'); await p.waitForTimeout(300); return t; };
  ok(!/Prefix not one of yours/.test(await unknown()), 'no prefix warnings while every prefix is yours');
  await rename('formus_duedate', 'zz_duedate');
  ok(/zz_duedate[\s\S]*"zz_" is not one of your prefixes/.test(await unknown()), 'a custom field with an unknown prefix is flagged');
  await rename('zz_duedate', 'cr_duedate');
  ok(!/"cr_" is not one of your prefixes/.test(await unknown()), 'a prefix listed as Microsoft\'s or another vendor\'s is not flagged');
  await rename('cr_duedate', 'portal_duedate');
  ok(!/not one of your prefixes/.test(await unknown()), 'one of your other prefixes is not flagged');
  await rename('portal_duedate', 'formus_duedate');

  // full text on hover: a drop-down shows its chosen value, clipped text shows in full
  const at = p.locator('#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("formus_duedate")) td[data-col="Attribute Type"]');
  await at.dblclick(); await p.waitForSelector('td.editing select'); await p.hover('td.editing select');
  const sel = await p.$eval('td.editing select', s => ({ title: s.title, text: s.selectedOptions[0].textContent.trim() }));
  ok(sel.title && sel.title === sel.text, 'hovering a drop-down shows its chosen value (' + sel.title + ')');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { const n = document.querySelector('#wbName'); n.textContent = 'A very long workbook name that cannot possibly fit in the header button at all.xlsx'; });
  await p.hover('#wbName');
  ok(/A very long workbook name/.test(await p.getAttribute('#wbName', 'title') || ''), 'hovering a name cut short shows it in full');
  ok(!(await p.getAttribute('#btnBuild', 'title') || '').includes('Build solution'), 'a tooltip set on purpose is left alone');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
