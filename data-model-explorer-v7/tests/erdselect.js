// ERD: selecting several tables, or all of them, and moving them together: node tests/erdselect.js  (run `npm run build` first)
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
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(800); await p.click('[data-eq=all]').catch(() => {}); await p.waitForTimeout(2500);
  await p.click('[data-ez="0"]'); await p.waitForTimeout(500);
  // positions by table name (a dragged table is brought to the front, so the drawing's order changes)
  const NAMES = ['Test Project', 'Test Task', 'Test Resource'];
  const pos = async () => { const m = Object.fromEntries(await p.$$eval('.erdv svg g.node', g => g.map(x => [x.querySelector('text').textContent, x.getAttribute('transform')]))); return NAMES.map(n => m[n]); };
  const selN = () => p.locator('.erdv svg g.node.sel').count();
  const head = i => p.locator('.erdv svg g.node', { has: p.locator(`text:text-is("${NAMES[i]}")`) }).locator('text').first();
  const drag = async (i, dx, dy, mods = []) => { const bb = await head(i).boundingBox(); for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2 + dy, { steps: 6 }); await p.mouse.up();
    for (const m of mods) await p.keyboard.up(m); await p.waitForTimeout(300); };
  const n = await p.locator('.erdv svg g.node').count();
  ok(n >= 3, n + ' tables drawn');

  // one table moves on its own, as before
  let a = await pos(); await drag(0, 60, 0); let c = await pos();
  ok(a[0] !== c[0] && a.slice(1).every((t, i) => t === c[i + 1]) && await selN() === 0, 'dragging a table moves just that table');

  // Select all, then drag one: they all move by the same amount
  await p.click('[data-ea="selall"]'); await p.waitForTimeout(200);
  ok(await selN() === n && /Clear selection \(\d+\)/.test(await p.innerText('[data-ea="selall"]')), 'Select all selects every table');
  a = await pos(); await drag(1, 80, 40); c = await pos();
  const d = a.map((t, i) => { const [x0, y0] = t.match(/-?[\d.]+/g).map(Number), [x1, y1] = c[i].match(/-?[\d.]+/g).map(Number); return [Math.round(x1 - x0), Math.round(y1 - y0)].join(); });
  ok(new Set(d).size === 1 && d[0] !== '0,0', 'dragging one of them moves them all together (' + d.join(' ') + ')');

  // Esc clears; Ctrl+click picks two
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await selN() === 0 && /Select all/.test(await p.innerText('[data-ea="selall"]')), 'Esc clears the selection');
  for (const i of [0, 2]) { const bb = await head(i).boundingBox(); await p.keyboard.down('Control'); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.keyboard.up('Control'); }
  await p.waitForTimeout(200);
  ok(await selN() === 2, 'Ctrl+click adds tables to the selection');
  a = await pos(); await drag(2, -50, 30); c = await pos();
  ok(a[0] !== c[0] && a[2] !== c[2] && a[1] === c[1], 'the two selected tables move, the other stays');

  // Ctrl+A on the diagram, and Shift+drag a box over the background
  { const cvb = await p.locator('.erdv .cv').boundingBox(); await p.mouse.click(cvb.x + 8, cvb.y + cvb.height - 8); await p.waitForTimeout(200); }
  ok(await selN() === 0, 'a click on the background clears the selection');
  await p.keyboard.press('Control+a'); await p.waitForTimeout(200);
  ok(await selN() === n, 'Ctrl+A selects every table');
  await p.keyboard.press('Escape');
  const g0 = await p.locator('.erdv svg g.node', { has: p.locator('text:text-is("Test Resource")') }).locator('rect').first().boundingBox();
  await p.keyboard.down('Shift'); await p.mouse.move(g0.x - 20, g0.y - 20); await p.mouse.down(); await p.mouse.move(g0.x + g0.width + 20, g0.y + g0.height + 20, { steps: 8 }); await p.mouse.up(); await p.keyboard.up('Shift'); await p.waitForTimeout(200);
  const picked = (await p.$$eval('.erdv svg g.node.sel', g => g.map(x => x.querySelector('text').textContent))).join();
  ok(picked === 'Test Resource' && await p.locator('.erdband').count() === 0, 'Shift+drag a box over the background selects the tables inside it (' + (await p.$$eval('.erdv svg g.node.sel', g => g.map(x => x.querySelector('text').textContent))).join() + ')');

  // the arrangement is kept
  const before = await pos(); await p.click('#nav .navitem[data-view="__overview"]'); await p.waitForTimeout(400); await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(1500);
  ok(JSON.stringify(await pos()) === JSON.stringify(before), 'the moved positions are kept');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
