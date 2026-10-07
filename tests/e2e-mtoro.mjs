// E2E интеграции с «Мобильным ТОРО» (эмулятор): два канала.
//  A) через узел карьера: М2 создано в «Мобильном ТОРО» → входящие ассистента → анализ → решение → результат в М2;
//  B) на телефоне по ссылке: «Мобильное ТОРО» → ассистент → решение → возврат с результатом.
// Запуск: npm start (в другом окне), затем node tests/e2e-mtoro.mjs [папка_для_скриншотов]
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.argv[2] ?? null;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const shot = async (n) => { if (OUT) { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); } };
const check = (cond, msg) => { if (!cond) errors.push(msg); console.log(cond ? '✓' : '✗', msg); };

// Первый запуск ассистента (справочник машин в локальной БД)
await p.goto(`${BASE}/`);
await p.waitForSelector('.modal');
await p.click('#wSkip');
await p.waitForSelector('.fleet');

// ---------- A. Через узел карьера ----------
await p.goto(`${BASE}/mtoro/`);
await p.waitForSelector('#eq option', { state: 'attached' });
await p.selectOption('#eq', 'T-305');
await p.fill('#t', 'Слабые тормоза на спуске');
await p.fill('#l', 'Увеличенный тормозной путь, водитель жалуется с начала смены');
await p.click('#f button');
await p.waitForSelector('.msg');
const qmnumA = (await p.textContent('.msg .mono')).match(/№(\d+)/)[1];
await shot('m10-mtoro-created');

await p.goto(`${BASE}/#/sync`);
await p.waitForSelector('#sync');
await p.click('#sync');
await p.waitForTimeout(800);
await p.goto(`${BASE}/#/`);
await p.waitForSelector('.fleet');
await p.waitForTimeout(300);
check(await p.$(`a[href="#/take/${qmnumA}"]`) !== null, `A: М2 №${qmnumA} появилось в сигналах ассистента`);
await shot('m20-assistant-inbox');
await p.click(`a[href="#/take/${qmnumA}"]`);
await p.waitForSelector('.src-m2');
check(await p.$('[data-sym="BRAKE_WEAK"].on') !== null, 'A: симптом «тормоза» предложен по тексту М2');
await shot('m30-defect-from-m2');
await p.fill('input[data-p="brakePressure"]', '10.8');
await p.click('#run');
await p.waitForSelector('.banner');
check((await p.textContent('.banner small')).includes('Критическое'), 'A: анализ — критическое состояние');
await p.click('a[href^="#/decision/"]');
await p.waitForSelector('[data-dec="STOP_AND_CALL"]');
await p.click('[data-dec="STOP_AND_CALL"]');
await p.waitForSelector('.panel.ok');
await p.waitForTimeout(1200);
await shot('m40-decision-m2');
const msgA = await (await p.request.get(`${BASE}/mtoro/api/messages/${qmnumA}`)).json();
check(msgA.status === 'STOPPED' && msgA.priority === 1, `A: М2 №${qmnumA} дополнено: остановка, приоритет 1`);
await p.goto(`${BASE}/mtoro/`);
await p.waitForSelector('.res');
await shot('m50-mtoro-result');

// ---------- B. Ссылкой на телефоне ----------
await p.fill('#t', 'Не тянет на подъёме, чёрный дым');
await p.selectOption('#eq', 'T-117');
await p.click('#f button');
await p.waitForFunction(() => document.querySelectorAll('.msg a.btn').length > 0);
await p.click('.msg a.btn');
await p.waitForSelector('.src-m2');
check(await p.$('[data-sym="POWER_LOSS"].on') !== null && await p.$('[data-sym="BLACK_SMOKE"].on') !== null, 'B: симптомы из текста М2 по ссылке');
await p.fill('input[data-p="intakeRestriction"]', '7.4');
await p.click('#run');
await p.waitForSelector('.banner');
await p.click('a[href^="#/decision/"]');
await p.waitForSelector('[data-dec="REPAIR_ON_SITE"]');
await p.click('[data-dec="REPAIR_ON_SITE"]');
await p.waitForSelector('a[href^="/mtoro/?"]');
await p.click('a[href^="/mtoro/?"]');
await p.waitForSelector('.toast');
check((await p.textContent('.toast')).includes('Получен результат'), 'B: «Мобильное ТОРО» получило результат по ссылке возврата');
await shot('m60-mtoro-return');

console.log('ERRORS:', errors.length ? errors : 'none');
await b.close();
if (errors.length) process.exit(1);
