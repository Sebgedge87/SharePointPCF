// Takes the user guide's screenshots on the import-test workbook and records where to draw the red boxes.
// node shots.js <page.html> <workbook.xlsx> <outdir>   →  <outdir>/<name>.png + boxes.json
const B = process.env.NODE_MODULES;
const fs = require('fs'), path = require('path'); const { chromium } = require(B + '/playwright');
const [page_, wbk, out, wbk2] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const SCALE = 1.25, boxes = {};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: SCALE, acceptDownloads: true })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const loc = t => typeof t === 'string' ? p.locator(t).first() : t;
  // name: file; targets: what to box, in click order; clip: a selector (or box) to crop to, padded
  async function snap(name, targets, clip) {
    await p.waitForTimeout(350);
    const tb = [];
    for (const t of targets) { const bb = await loc(t).boundingBox(); if (!bb) throw new Error(`${name}: no box for ${t}`); tb.push(bb); }
    let c = null;
    if (clip) {
      let cb = typeof clip === 'string' ? await loc(clip).boundingBox() : clip.sel ? await loc(clip.sel).boundingBox() : clip; if (clip.maxH) cb = { ...cb, height: Math.min(cb.height, clip.maxH) }; const pad = 16;
      let x0 = cb.x - pad, y0 = cb.y - pad, x1 = cb.x + cb.width + pad, y1 = cb.y + cb.height + pad;
      tb.forEach(t => { x0 = Math.min(x0, t.x - pad); y0 = Math.min(y0, t.y - pad); x1 = Math.max(x1, t.x + t.width + pad); y1 = Math.max(y1, t.y + t.height + pad); });
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1440, x1); y1 = Math.min(860, y1);
      c = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    await p.screenshot({ path: path.join(out, name + '.png'), clip: c || undefined });
    const ox = c ? c.x : 0, oy = c ? c.y : 0;
    boxes[name] = tb.map(t => [t.x - ox, t.y - oy, t.width, t.height].map(v => Math.round(v * SCALE)));
  }
  const nav = async v => { await p.click(`#nav .navitem[data-view="${v}"]`); await p.waitForTimeout(600); };
  const table = async n => { if (!await p.locator(`#nav .navitem:has-text("${n}")`).count()) await p.click('#nav [data-grp="Import test"]'); await p.click(`#nav .navitem:has-text("${n}")`); await p.waitForTimeout(600); };
  const row = ln => p.locator(`#gridwrap tbody tr:has(td[data-col="Logical Name"] .mono:text-is("${ln}"))`);

  await p.goto('file://' + page_); await p.waitForTimeout(1500);
  await snap('01-open', ['[data-ov="open"]', '[data-ov="blank"]'], { x: 0, y: 0, width: 1440, height: 520 });
  await p.setInputFiles('#file', wbk); await p.waitForTimeout(1800); await p.keyboard.press('Escape'); await p.waitForTimeout(2600);
  await snap('00-header', ['#btnWb', '#btnChanges', '#btnCheck', '#btnExport', '#btnBuild', '#btnHelp'], { x: 0, y: 0, width: 1440, height: 60 });
  await snap('02-overview', ['#main [data-ov] >> nth=0', 'button:has-text("Open all checks")', '#main [data-ov="solution"]', '#main [data-ov="dv"]']);
  await p.click('#btnWb'); await snap('03-workbooks', ['#btnWb', '.menu [data-wb="__ver"]', '.menu [data-wb="__files"]'], { x: 760, y: 0, width: 680, height: 380 }); await p.keyboard.press('Escape'); await p.mouse.click(700, 500);
  await nav('__issues'); await snap('04-checks', ['[data-isev="error"]', '[data-isev="warn"]', '[data-isev="info"]', '[data-act="iss-csv"]'], { x: 330, y: 70, width: 1110, height: 420 });
  await nav('__erd'); await p.click('[data-eq=all]'); await p.waitForTimeout(3500);
  await p.click('.tb [data-ea="expmenu"]'); await p.waitForTimeout(300);
  await snap('05-erd', ['#erdq', '[data-eq="all"]', '[data-ek="attrs"][data-ev="keys"]', '#erdopts summary', '.tb [data-ea="expmenu"]', '#erdmenu [data-ea="drawio"]']);
  await p.click('#erdcount');
  await table('Test Task');
  await snap('06-table', ['#q', '[data-act="addrow"]', '[data-act="cols"]', '[data-filter="Attribute Type"]', '[data-act="details"]']);
  await row('formus_duedate').locator('td[data-col="Required Level"]').dblclick(); await p.waitForTimeout(300);
  await snap('07-edit', ['td.editing'], { x: 340, y: 420, width: 1100, height: 330 }); await p.keyboard.press('Escape');
  await row('formus_projectid').locator('td[data-col="Display Name"]').click(); await p.waitForTimeout(600);
  await snap('08-keys', ['#detail [data-setkey="pk"]', '#detail [data-setkey="pn"]', '#detail .fld[data-fcol="Description"] [data-fedit]'], { sel: '#detail', maxH: 330 });
  await p.click('#detail [data-dclose]'); await p.waitForTimeout(200);
  await p.click('[data-act="addrow"]'); await p.waitForSelector('.solbox');
  await p.fill('.solbox [data-k="Display Name"]', 'Actual hours'); await p.fill('.solbox [data-k="Attribute Type"]', 'Decimal'); await p.locator('.solbox [data-k="Attribute Type"]').blur();
  await snap('09-addfield', ['.solbox [data-k="kind"]', '.solbox [data-k="Display Name"]', '.solbox [data-k="Attribute Type"]', '.solbox [data-add="go"]'], '.solbox');
  await p.click('.solbox [data-add="go"]'); await p.waitForTimeout(500); await p.click('#detail [data-dclose]').catch(() => {});
  await row('formus_priority').locator('td[data-col="Description"]').dblclick(); await p.waitForTimeout(200);
  await p.keyboard.press('Control+A'); await p.keyboard.type('1 = highest, 5 = lowest'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.click('#btnChanges'); await p.waitForTimeout(400);
  await snap('10-changes', ['#btnChanges', '#changes [data-arm]', '#changes [data-crev]', '#changes [data-act="revert-all"]'], { sel: '#changes', maxH: 230 });
  await p.click('[data-cclose]');
  await p.click('#btnExport'); await p.waitForTimeout(300);
  await snap('11-export', ['#btnExport', '.menu [data-x="xlsx-orig"]', '.menu [data-x="ro-copy"]', '.menu [data-x="solution"]'], '.menu');
  await p.click('.menu [data-x="xlsx-orig"]'); await p.waitForSelector('.namebox');
  await snap('12-filename', ['.namebox input', '.namebox [data-n="1"]'], '.namebox');
  await p.click('.namebox [data-n="0"]');
  await p.setInputFiles('#file', wbk2); await p.waitForSelector('.dlgbox');
  await snap('13-loadversion', ['.dlgbox [data-d="1"]', '.dlgbox [data-d="0"]'], '.dlgbox');
  await p.click('.dlgbox [data-d="1"]'); await p.waitForTimeout(1500); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('#btnCheck'); await p.waitForTimeout(300);
  await snap('14-check', ['#btnCheck', '.menu [data-ck="dv"]', '.menu [data-ck="tmpl"]'], '.menu');
  await p.click('.menu [data-ck="tmpl"]'); await p.waitForTimeout(500);
  await snap('15-template', ['[data-act="tmpl-dl"]', '[data-act="tmpl-use"]', '[data-act="tmpl-reset"]'], { sel: '#tmplpanel', maxH: 330 });
  await p.click('[data-tclose]'); await p.click('#btnCheck'); await p.click('.menu [data-ck="dv"]'); await p.waitForTimeout(500);
  await p.fill('#dvorg', 'https://yourorg.crm11.dynamics.com'); await p.locator('#dvorg').dispatchEvent('input'); await p.waitForTimeout(500);
  await snap('16-dataverse', ['#dvorg', '#dvlinks a, #dvlinks button', '[data-dv="pick"]'], { sel: '#dvpanel', maxH: 420 });
  await p.click('[data-dvclose]');
  await p.click('#btnBuild'); await p.waitForSelector('.solbox');
  await p.fill('.solbox [data-k="solName"]', 'FORMUS_ImportTest'); await p.fill('.solbox [data-k="solDisplay"]', 'FORMUS import test'); await p.fill('.solbox [data-k="optPrefix"]', '75047'); await p.waitForTimeout(600);
  await snap('17-solution', ['.solbox [data-k="pubName"]', '.solbox [data-k="prefix"]', '.solbox [data-k="optPrefix"]', '#solsum', '.solbox [data-sol="go"]'], '.solbox');
  fs.writeFileSync(path.join(out, 'boxes.json'), JSON.stringify(boxes, null, 1));
  console.log('shots', Object.keys(boxes).length, 'errors', errs);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
