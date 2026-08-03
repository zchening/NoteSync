const { chromium } = require('playwright');
(async () => {
  console.log('launching...');
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  console.log('launched');
  const p = await b.newPage();
  await p.setContent('<div id="x">hi</div>');
  console.log('eval=', await p.evaluate(() => document.getElementById('x').textContent));
  await b.close();
  console.log('OK');
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
