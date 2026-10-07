// Сквозной e2e-прогон: 4 сценария ТЗ, офлайн-режим, досинхронизация.
// Запуск: npm start (в другом окне), затем node tests/e2e.mjs [папка_для_скриншотов]
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? null;
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const openScenario = async (id) => {
  // раздел демо свёрнут, а главная может перерисоваться — дожидаемся кнопки и нажимаем её из страницы
  await p.waitForSelector(`[data-scen="${id}"]`, { state: 'attached' });
  await p.waitForTimeout(300);
  await p.evaluate((sid) => { document.querySelector('details.demo').open = true; document.querySelector(`[data-scen="${sid}"]`).click(); }, id);
};
const shot = async (n, full = true) => { await p.waitForTimeout(400); if (OUT) await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full }); };
await p.goto(`${BASE}/`);
await p.waitForSelector('.modal');
await shot('00-welcome', false);
await p.click('#wTrain');
await p.waitForSelector('.t-card');
await shot('01-tour-home', false);
await p.click('[data-t="next"]'); await p.click('[data-t="next"]');
await shot('02-tour-kpi', false);
await p.click('[data-t="off"]');
await p.waitForSelector('.fleet');
await shot('03-home');
for (const id of ['S1','S2','S3','S4']) {
  await p.goto(`${BASE}/#/`);
  await openScenario(id);
  await p.waitForSelector('#run');
  if (id === 'S1') await shot('10-defect-S1');
  await p.click('#run');
  await p.waitForSelector('.banner');
  await shot(`20-analysis-${id}`);
  const st = await p.textContent('.banner small');
  console.log(id, '→', st);
  if (await p.$('a[href^="#/checks/"]') && (id === 'S2' || id === 'S3')) {
    await p.click('a[href^="#/checks/"]');
    await p.waitForSelector('#rerun');
    await p.click('#fill');
    await shot(`30-checks-${id}`);
    await p.click('#rerun');
    await p.waitForSelector('.banner');
    console.log(id, 'after checks →', await p.textContent('.banner small'));
    await shot(`31-analysis2-${id}`);
  }
  await p.click('a[href^="#/decision/"]');
  await p.waitForSelector('[data-tour="decide"]');
  if (id === 'S4') {
    const dis = await p.$eval('[data-dec="RELEASE_BY_RESPONSIBLE"]', (e) => e.disabled);
    console.log('S4 release disabled for mechanic:', dis);
    await shot('40-decision-S4');
    await p.click('[data-dec="STOP_AND_CALL"]');
  } else {
    await p.click('[data-dec="REPAIR_ON_SITE"]');
  }
  await p.waitForSelector('.panel.ok');
  await p.waitForTimeout(800);
  if (id === 'S1') await shot('41-decision-done-S1');
}
await p.click('a[href="#/"]');
await p.waitForSelector('.fleet');
await shot('50-home-after');
const unack = await p.$$eval('.alarm.unack', (els) => els.length);
await p.click('[data-ack]');
await p.waitForFunction((n) => document.querySelectorAll('.alarm.unack').length === n - 1, unack, { timeout: 3000 }).catch(() => {});
const unack2 = await p.$$eval('.alarm.unack', (els) => els.length);
console.log('ack:', unack, '→', unack2);
if (unack2 !== unack - 1) errors.push('квитирование не сработало');
await shot('51-home-acked');
await p.goto(`${BASE}/#/machine/T-305`);
await p.waitForSelector('.mimic');
await shot('60-machine-T305');
await p.goto(`${BASE}/#/sync`);
await p.waitForSelector('[data-tour="journal"]');
await shot('70-sync');
// офлайн: обрыв сети — приложение должно открываться из кэша SW и сохранять решения в очередь
await p.click('#offline');
await ctx.setOffline(true);
await p.goto(`${BASE}/#/`);
await p.waitForSelector('.fleet', { timeout: 5000 }).then(() => console.log('offline reload OK')).catch((e) => console.log('offline reload FAIL', e.message));
await openScenario('S1'); await p.waitForSelector('#run'); await p.click('#run'); await p.waitForSelector('.banner');
await p.click('a[href^="#/decision/"]'); await p.waitForSelector('[data-dec]'); await p.click('[data-dec="REPAIR_ON_SITE"]');
await p.waitForSelector('.panel.ok'); await p.waitForTimeout(500);
await shot('80-offline-decision');
console.log('queue text:', (await p.textContent('#netstate')).trim());
await ctx.setOffline(false);
await p.goto(`${BASE}/#/sync`); await p.waitForSelector('#offline'); await p.click('#offline'); await p.click('#sync'); await p.waitForTimeout(800);
console.log('after resync:', (await p.textContent('#netstate')).trim());
console.log('ERRORS:', errors.length ? errors : 'none');
await b.close();
if (errors.length) process.exit(1);
