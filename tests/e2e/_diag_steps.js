const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const log = (...a) => { console.log(new Date().toISOString().slice(11,19), ...a); };
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/src="[^"]*html2canvas[^"]*"/, 'src="about:blank"');
(async () => {
  log('launch');
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  log('newPage');
  const p = await b.newPage();
  log('setContent start');
  await p.setContent(HTML, { waitUntil: 'domcontentloaded', timeout: 20000 });
  log('setContent done');
  try {
    await p.waitForFunction(() => typeof window.addStrikeToRange === 'function', { timeout: 15000 });
    log('waitForFunction OK');
  } catch (e) { log('waitForFunction FAIL: ' + e.message); }
  const has = await p.evaluate(() => typeof window.addStrikeToRange);
  log('addStrikeToRange type =', has);
  await b.close();
  log('closed OK');
})().catch(e => { log('ERR', e.message); process.exit(2); });
