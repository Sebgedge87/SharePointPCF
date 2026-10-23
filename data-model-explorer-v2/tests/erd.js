// ERD drawing (2.0: drawn by the page itself, no Mermaid): node tests/erd.js  (run `npm run build` first)
const path = require('path'), fs = require('fs'), XLSX = require('xlsx');
const { chromium } = require('playwright');
const page_ = 'file://' + path.resolve(__dirname, '../dist/Data_Model_Explorer.html');
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// N tables, each with 3 lookups (recorded as N:1) and one N:N row on every tenth table
function model(N, file) {
  const wb = XLSX.utils.book_new(), name = i => 'pe_t' + String(i).padStart(3, '0');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name'], ...Array.from({ length: N }, (_, i) => ['', 'Area ' + (i % 4), 'Table ' + i])]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data', 'Relationship Type'];
  for (let i = 0; i < N; i++) {
    const n = name(i), rows = [[n + 'id', 'Id', 'Id', 'Uniqueidentifier', 'Primary key', 'True', 'Simple', 'SystemRequired', '', ''], ['pe_name', 'Name', 'Name', 'Text', 'x', 'True', 'Simple', 'None', '', '']];
    for (let k = 0; k < 3; k++) rows.push(['pe_l' + k + 'id', 'L' + k, 'Link ' + k, 'Lookup', 'x', 'True', 'Simple', k ? 'None' : 'ApplicationRequired', 'Targets:\n' + name((i * 7 + k * 13 + 1) % N), 'N:1']);
    if (i % 10 === 0) rows.push(['pe_nn' + i, 'NN', 'Pairs ' + i, 'N:N', 'x', 'True', 'Simple', 'None', 'Targets:\n' + name((i + 5) % N), 'N:N']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', 'Table ' + i], ['Plural Display Name', 'Tables'], ['Description', 'd'], ['Schema Name', n], ['Logical Name', n], ['Object Type Code', 30000 + i],
      ['Is Custom Entity', 'True'], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'False'], ['Primary Name Column', 'pe_name'], [], H, ...rows]), ('Table ' + i + ' (' + n + ')').slice(0, 31));
  }
  const f = path.join(out, file); XLSX.writeFile(wb, f); return f;
}

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_); await p.waitForTimeout(1000);
  ok(await p.evaluate(() => typeof window.mermaid === 'undefined'), 'the page no longer carries the Mermaid library');

  await p.setInputFiles('#file', model(20, 'erd20.xlsx')); await p.waitForTimeout(2500); await p.keyboard.press('Escape');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(600);
  await p.click('[data-eq=all]'); await p.waitForTimeout(3000);
  ok(await p.locator('#erdcv svg g.node').count() === 20, 'all 20 tables are drawn as boxes');
  const lines = await p.evaluate(() => { const s = document.querySelector('#erdcv svg'); return { paths: s.querySelectorAll('path.rl').length, dashed: s.querySelectorAll('path.rl[stroke-dasharray]').length, many: s.querySelectorAll('path.rl[marker-end="url(#erdm-many-e)"]').length, one: s.querySelectorAll('path.rl[marker-start="url(#erdm-one-s)"]').length, zone: s.querySelectorAll('path.rl[marker-start="url(#erdm-zone-s)"]').length, markers: s.querySelectorAll('defs marker').length }; });
  ok(lines.paths >= 40 && lines.markers === 4, `lines and their crow's-foot ends are drawn (${lines.paths} lines)`);
  ok(lines.dashed === 2, 'N:N relationships are dashed');
  ok(lines.one > 0 && lines.zone > 0 && lines.many === lines.paths, 'required lookups end in "one", optional in "zero or one", children in "many"');
  ok(/erDiagram/.test(await p.inputValue('#erdsrc')), 'the Mermaid source is still generated for Copy Mermaid and .mmd');

  // names on lines: hidden until hover by default; Always shows every one
  const shownLabs = () => p.evaluate(() => [...document.querySelectorAll('#erdcv svg g.lab')].filter(g => getComputedStyle(g).display !== 'none').length);
  ok(await shownLabs() === 0, 'relationship names are hidden until you hover a table');
  await p.locator('#erdcv svg g.node').first().hover({ position: { x: 10, y: 8 } }); await p.waitForTimeout(200);
  const hov = await p.evaluate(() => ({ hot: document.querySelectorAll('#erdcv svg path.rl.hot').length, focus: document.querySelector('#erdcv svg').classList.contains('focus') }));
  ok(hov.focus && hov.hot > 0 && await shownLabs() === hov.hot, 'hovering a table highlights its lines and names, and dims the rest');
  await p.mouse.move(5, 5); await p.waitForTimeout(150);
  await p.click('[data-ek="lbl"][data-ev="all"]'); await p.waitForTimeout(400);
  ok(await shownLabs() === lines.paths, 'Names: always shows every relationship name');

  // dragging a table moves only its own lines, and the position is kept
  const before = await p.evaluate(() => [...document.querySelectorAll('#erdcv svg path.rl')].map(x => x.getAttribute('d')));
  const g2 = p.locator('#erdcv svg g.node').nth(3); const b2 = await g2.boundingBox();
  await p.mouse.move(b2.x + b2.width / 2, b2.y + 8); await p.mouse.down(); await p.mouse.move(b2.x + b2.width / 2 + 120, b2.y + 70, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(200);
  const after = await p.evaluate(() => [...document.querySelectorAll('#erdcv svg path.rl')].map(x => x.getAttribute('d')));
  const changed = after.filter((d, i) => d !== before[i]).length;
  ok(changed > 0 && changed < 12, `dragging a table re-routes only its own lines (${changed} of ${after.length})`);

  // exports
  const dl = async sel => { const [d] = await Promise.all([p.waitForEvent('download'), p.click(sel)]); return fs.readFileSync(await d.path(), 'utf8'); };
  await p.click('[data-ez="0"]'); await p.waitForTimeout(300);
  const svg = await dl('.tb [data-ea="svg"]');
  ok(/<marker id="erdm-many-e"/.test(svg) && /class="node"/.test(svg) && /<g class="lab"/.test(svg), 'the SVG export carries the boxes, line ends and (with Names: always) the names');
  ok(!/class="[^"]*\bfocus\b/.test(svg) && !/\bhot\b/.test(svg), 'nothing is left dimmed or highlighted in the export');
  ok(!/eyebtn/.test(svg), 'the eye icons are left out of the export');
  const dio = await dl('.tb [data-ea="drawio"]');
  ok((dio.match(/vertex="1" parent="1"/g) || []).length === 20 && /edge="1"/.test(dio), 'draw.io export still has every table and its relationships');

  // Direction: top to bottom makes a portrait layout, left to right a landscape one
  const aspect = () => p.evaluate(() => { const v = document.querySelector('#erdcv svg').getAttribute('viewBox').split(' ').map(Number); return v[2] / v[3]; });
  await p.click('[data-ek="dir"][data-ev="TB"]'); await p.waitForTimeout(3000);
  const tb = await aspect();
  await p.click('[data-ek="dir"][data-ev="LR"]'); await p.waitForTimeout(3000);
  const lr = await aspect();
  ok(tb <= 1.2 && lr >= 0.85, `Direction shapes the layout (top to bottom ${tb.toFixed(2)}, left to right ${lr.toFixed(2)} wide per tall)`);

  // a large model draws in seconds, not minutes
  await p.setInputFiles('#file', model(300, 'erd300.xlsx')); await p.waitForTimeout(800);
  if (await p.locator('.dlgbox').count()) await p.click('.dlgbox [data-d="0"]');
  await p.waitForTimeout(3500); await p.keyboard.press('Escape');
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(600);
  await p.click('[data-eq=none]'); await p.waitForTimeout(300); await p.fill('#erdq', 'pe_t'); await p.waitForTimeout(300);
  const t0 = Date.now(); await p.click('[data-eq=shown]');
  await p.waitForFunction(() => document.querySelectorAll('#erdcv svg g.node').length >= 300, null, { timeout: 60000 });
  const took = Date.now() - t0;
  ok(took < 12000, `300 tables and 930 relationships draw in ${(took / 1000).toFixed(1)} s (under 12 s)`);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
