// ERD timings on a large model: drawing N tables, dragging a table, hovering, and a CPU profile per draw.
// NODE_MODULES=... node erdperf.js <page.html> <workbook.xlsx> <outdir> [sizes, e.g. 30,80,150,300]
const B = process.env.NODE_MODULES; const fs = require('fs'), path = require('path');
const { chromium } = require(B + '/playwright');
const [page_, wbk, out, sizes = '30,100,200,300'] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await p.goto('file://' + page_); await p.waitForTimeout(1200);
  await p.setInputFiles('#file', wbk); await p.waitForFunction(() => document.querySelectorAll('#nav [data-grp]').length >= 2, null, { timeout: 120000 });
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.click('#nav .navitem[data-view="__erd"]'); await p.waitForTimeout(800);
  const res = [];
  const FILT = { 30: 'pf_t00 pf_t01 pf_t02', 100: 'pf_t0', 200: 'pf_t0 pf_t1', 300: 'pf_t' };
  for (const n of sizes.split(',').map(Number)) {
    await p.click('[data-eq=none]'); await p.waitForTimeout(600);
    await p.fill('#erdq', FILT[n]); await p.waitForTimeout(300);
    await cdp.send('Profiler.start');
    const s = Date.now();
    await p.click('[data-eq=shown]');
    await p.waitForFunction(n => { const s = document.querySelector('#erdcv svg'); return (s && s.querySelectorAll('g.node').length >= Math.min(n, 1)) || document.querySelector('#erdcv .err'); }, n, { timeout: 600000, polling: 50 });
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const draw = Date.now() - s;
    const { profile } = await cdp.send('Profiler.stop');
    const info = await p.innerText('#erdinfo'); const nodes = await p.locator('#erdcv svg g.node').count();
    // drag the first table 300px in 20 steps
    const g = p.locator('#erdcv svg g.node').first(); const bb = await g.boundingBox(); let drag = null;
    if (bb) { const s2 = Date.now(); await p.mouse.move(bb.x + bb.width / 2, bb.y + 10); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2 + 300, bb.y + 60, { steps: 20 }); await p.mouse.up(); await p.evaluate(() => new Promise(r => requestAnimationFrame(r))); drag = (Date.now() - s2); }
    // hover across 10 tables
    const s3 = Date.now(); const all = await p.locator('#erdcv svg g.node').all();
    for (const x of all.slice(0, 10)) { const bx = await x.boundingBox(); if (bx) await p.mouse.move(bx.x + 5, bx.y + 5); } const hover = (Date.now() - s3);
    // self time grouped
    const self = {}, byId = new Map(profile.nodes.map(x => [x.id, x])); let i = 0;
    for (const id of profile.samples) { const cf = byId.get(id).callFrame; const k = (cf.functionName || '(anon)') + (cf.url && !/Data_Model/.test(cf.url) ? '' : ':' + cf.lineNumber); self[k] = (self[k] || 0) + (profile.timeDeltas[i++] || 0) / 1000; }
    const top = Object.entries(self).sort((a, c) => c[1] - a[1]).slice(0, 14).map(([k, v]) => Math.round(v) + 'ms ' + k);
    fs.writeFileSync(path.join(out, `erd_${n}.cpuprofile`), JSON.stringify(profile));
    res.push({ n, draw, nodes, drag, hover, info, top });
    console.log(`\n== ${n} tables: draw ${draw} ms, ${nodes} boxes; drag (20 moves) ${drag} ms; hover x10 ${hover} ms\n   ${info}\n   ` + top.join('\n   '));
  }
  fs.writeFileSync(path.join(out, 'erd.json'), JSON.stringify(res, null, 1));
  console.log('errors', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
