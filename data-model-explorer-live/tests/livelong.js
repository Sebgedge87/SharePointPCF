// Loading a solution as the data model when a choice has more options than fit in an Excel cell: node tests/livelong.js
// (run `npm run build` first). A choice with 3,000 options makes Additional data longer than Excel's 32,767 characters;
// the model still loads, the text is cut with a note, and the page says which cell.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'dist/Data_Model_Explorer.html'), 'utf8');
const ORG = 'https://contoso.crm11.dynamics.com', PAGE = ORG + '/WebResources/formus_/dme/DataModelExplorer.html';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const { environment, answer } = require('./live-env');

(async () => {
  const env = environment(false);
  env.ents.formus_testproject._d.formus_status.OptionSet.Options = Array.from({ length: 3000 }, (_, i) => ({ Value: 750470000 + i, Label: { UserLocalizedLabel: { Label: 'Project status option number ' + (i + 1) } } }));
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(ORG + '/**', route => { const url = route.request().url(); if (url.startsWith(PAGE)) return route.fulfill({ status: 200, contentType: 'text/html', body: html }); return route.fulfill(answer(env, url)); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGE); await p.waitForTimeout(2500);
  await p.click(`[data-sp="1"] [data-sid="${env.sol.solutionid}"]`); await p.click('[data-live="load"]');
  await p.waitForSelector('.dlgbox', { timeout: 30000 }).catch(() => {});
  const msg = await p.innerText('.dlgbox').catch(() => '');
  ok(/too long for Excel[\s\S]*The model of FORMUS import test[\s\S]*1 cell[\s\S]*Project[^!]*!I\d+/.test(msg), 'the page says which cell was too long for Excel: ' + msg.replace(/\s+/g, ' ').slice(-60));
  ok(!/Text length must not exceed/.test(await p.innerText('#dvpanel').catch(() => '')), 'the load does not stop with "Text length must not exceed 32767 characters"');
  await p.click('.dlgbox button').catch(() => {});
  await p.waitForFunction(() => /FORMUS_ImportTest \(live /.test(document.querySelector('#main')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  if (!await p.locator('#nav .navitem:has-text("Test Project")').count()) await p.click('#nav [data-grp]');
  await p.click('#nav .navitem:has-text("Test Project")'); await p.waitForTimeout(500);
  const add = await p.locator('#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("formus_status")) td[data-col="Additional data"]').innerText().catch(() => '');
  ok(/Project status option number 1\b/.test(add), 'the model is loaded, with the start of the option list');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
