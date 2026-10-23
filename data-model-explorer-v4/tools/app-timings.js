// Times the main actions on a large model and records a CPU profile.
// NODE_MODULES=... node perf.js <page.html> <outdir> [tables] [fields per table]
const B = process.env.NODE_MODULES; const fs = require('fs'), path = require('path');
const XLSX = require(B + '/xlsx'); const { chromium } = require(B + '/playwright');
const [page_, out, NT = 300, NF = 40] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });

function bigModel(N, F) {
  const wb = XLSX.utils.book_new(), name = i => 'pf_t' + String(i).padStart(3, '0'), areas = ['Sales', 'Service', 'Finance', 'HR', 'Projects', 'Assets', 'Contracts', 'Portal', 'Reference', 'Integration'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', 'Area', 'Table Name', 'Out of the box/custom table?', 'Purpose'], ...Array.from({ length: N }, (_, i) => ['', areas[i % 10], 'Table ' + i, 'Custom', 'Purpose of table ' + i])]), 'Table Dictionary');
  const H = ['Logical Name', 'Schema Name', 'Display Name', 'Attribute Type', 'Description', 'Custom Attribute', 'Type', 'Required Level', 'Additional data', 'Add to RAF Form?', 'Comment', 'Relationship Type', 'Relationship Name', 'Cascade Delete'];
  const types = ['Text', 'Choice', 'Whole Number', 'DateTime', 'Two options', 'Currency', 'Decimal', 'Multiline Text'];
  for (let i = 0; i < N; i++) {
    const n = name(i), rows = [[n + 'id', n + 'Id', 'Id', 'Uniqueidentifier', 'Primary key', 'True', 'Simple', 'SystemRequired', '', '', '', '', '', ''],
      ['pf_name', 'pf_Name', 'Name', 'Text', 'Primary name', 'True', 'Simple', 'ApplicationRequired', 'Format: Text\nMax length: 200', '', '', '', '', '']];
    for (let k = 0; k < 3; k++) rows.push(['pf_link' + k + 'id', 'pf_Link' + k + 'Id', 'Link ' + k, 'Lookup', 'Link to another table', 'True', 'Simple', 'None', 'Targets:\n' + name((i * 7 + k * 13 + 1) % N), '', '', 'N:1', '', 'Remove Link']);
    for (let f = rows.length; f < F; f++) {
      const t = types[f % types.length];
      rows.push(['pf_f' + f, 'pf_F' + f, 'Field ' + f + ' of ' + i, t, 'Description of field ' + f + ' on table ' + i + ', long enough to wrap onto a second line in the grid', 'True', 'Simple', f % 5 ? 'None' : 'Recommended',
        t === 'Choice' ? 'Options:\n750470000: One\n750470001: Two\n750470002: Three' : t === 'Text' ? 'Format: Text\nMax length: 100' : '', '', '', '', '', '']);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Entity', 'Table ' + i], ['Plural Display Name', 'Tables ' + i], ['Description', 'Table number ' + i], ['Schema Name', n], ['Logical Name', n], ['Object Type Code', 10000 + i],
      ['Is Custom Entity', 'True'], ['Ownership Type', 'UserOwned'], ['Audit Tracking', 'False'], ['Primary Name Column', 'pf_name'], ['Primary Key', n + 'id'], [], H, ...rows]), ('Table ' + i + ' (' + n + ')').slice(0, 31));
  }
  const f = path.join(out, `big_${N}x${F}.xlsx`); XLSX.writeFile(wb, f); return f;
}

(async () => {
  const wbk = bigModel(+NT, +NF); console.log('workbook', wbk, (fs.statSync(wbk).size / 1e6).toFixed(1) + ' MB');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const cdp = await ctx.newCDPSession(p); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const T = {}; const t0 = () => Date.now();
  const until = async (fn, arg, ms = 120000) => { await p.waitForFunction(fn, arg, { timeout: ms, polling: 25 }); };
  const quiet = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
  const time = async (label, act) => { const s = t0(); await act(); await quiet(); T[label] = t0() - s; console.log(label.padEnd(34), T[label] + ' ms'); };

  await cdp.send('Profiler.start');
  await time('page load (empty template)', async () => { await p.goto('file://' + page_); await until(() => document.querySelectorAll('#nav .navitem').length > 0); });
  await time('open workbook → Overview', async () => { await p.setInputFiles('#file', wbk); await until(() => document.querySelectorAll('#nav [data-grp]').length >= 10 && /big_/.test(document.querySelector('#main')?.textContent || '')); });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const areas = ['Sales', 'Service', 'Finance', 'HR', 'Projects', 'Assets', 'Contracts', 'Portal', 'Reference', 'Integration'];
  await time('expand an area in the sidebar', async () => { await p.click('#nav [data-grp="Sales"]'); await until(() => [...document.querySelectorAll('#nav .navitem')].some(x => x.textContent.includes('pf_t150'))); });
  await time('open a table page', async () => { await p.click('#nav .navitem:has-text("pf_t150")'); await until(() => /Table 150/.test(document.querySelector('#main h1, #main .vhead')?.textContent || '')); });
  await time('open another table page', async () => { await p.click('#nav .navitem:has-text("pf_t160")'); await until(() => /Table 160/.test(document.querySelector('#main h1, #main .vhead')?.textContent || '')); });
  await time('edit a cell (Enter to done)', async () => {
    const c = p.locator('#gridwrap tbody tr:nth-child(10) td[data-col="Description"]'); await c.dblclick(); await p.keyboard.press('Control+A'); await p.keyboard.type('x');
    const s = t0(); await p.keyboard.press('Enter'); await quiet(); T['  of which Enter → repaint'] = t0() - s;
  });
  console.log('  of which Enter → repaint'.padEnd(34), T['  of which Enter → repaint'] + ' ms');
  await time('open All fields', async () => { await p.click('#nav .navitem[data-view="__all"]'); await until(() => /rows/.test(document.querySelector('#count')?.textContent || '')); });
  await time('search All fields (type "field 3")', async () => { await p.click('#q'); await p.keyboard.type('field 3', { delay: 30 }); await p.waitForTimeout(400); });
  await p.fill('#q', ''); await p.waitForTimeout(400);
  await time('open Checks', async () => { await p.click('#nav .navitem[data-view="__issues"]'); await until(() => document.querySelector('#isswrap')); });
  await time('open Overview', async () => { await p.click('#nav .navitem[data-view="__overview"]'); await until(() => document.querySelector('[data-ov]')); });
  await time('open ERD (prompt)', async () => { await p.click('#nav .navitem[data-view="__erd"]'); await until(() => document.querySelector('#erdcv')); });
  await time('ERD: draw one area (30 tables)', async () => { await p.fill('#erdq', 'pf_t0'); await p.click('[data-eq=shown]'); await until(() => document.querySelector('#erdcv svg g.node')); });
  await time('Changes panel', async () => { await p.click('#btnChanges'); await until(() => document.querySelector('#changes')); });
  const { profile } = await cdp.send('Profiler.stop');
  fs.writeFileSync(path.join(out, 'profile.cpuprofile'), JSON.stringify(profile));
  // self time per function
  const self = {}, byId = new Map(profile.nodes.map(n => [n.id, n])); const dt = profile.timeDeltas; let i = 0;
  for (const id of profile.samples) { const n = byId.get(id), cf = n.callFrame; const k = (cf.functionName || '(anon)') + ' ' + (cf.url ? path.basename(cf.url).slice(0, 20) : '') + ':' + cf.lineNumber; self[k] = (self[k] || 0) + (dt[i++] || 0) / 1000; }
  console.log('\nTop self time (ms):'); Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log(String(Math.round(v)).padStart(7), k));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(T, null, 1));
  console.log('errors', errs);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
