import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToSymptoms, decisionToM2Update, buildHandoffUrl, parseHandoff, safeReturnUrl, buildReturnUrl } from './mtoro.js';

test('текст механика превращается в симптомы', () => {
  assert.deepEqual(textToSymptoms('Течь РВД на подъёме кузова'), ['HYDRAULIC_LEAK']);
  assert.deepEqual(textToSymptoms('Не тянет на подъёме, чёрный дым').sort(), ['BLACK_SMOKE', 'POWER_LOSS']);
  assert.deepEqual(textToSymptoms('Слабые тормоза на спуске'), ['BRAKE_WEAK']);
  assert.deepEqual(textToSymptoms('Медленно поднимается стрела'), ['SLOW_WORK_EQUIPMENT']);
  assert.deepEqual(textToSymptoms('Сработала защита, отказ хода'), ['PROTECTION_TRIP']);
  assert.deepEqual(textToSymptoms('Осмотр без замечаний'), []);
});

test('решение специалиста → дополнение М2 (критичное = приоритет 1 и остановка)', () => {
  const u = decisionToM2Update({ m2: { qmnum: '10004711' }, analysisStatus: 'CRITICAL', decision: 'STOP_AND_CALL', selectedCause: 'BRAKE_SEALS', topCauses: ['BRAKE_SEALS'], rulebaseVersion: '0.3.0', user: 'mech-1' });
  assert.equal(u.qmnum, '10004711');
  assert.equal(u.priority, 1);
  assert.equal(u.breakdown, true);
  assert.match(u.longText, /КРИТИЧЕСКОЕ/);
  assert.ok(u.causeCode.code);
  const ok = decisionToM2Update({ analysisStatus: 'CLEAR', decision: 'REPAIR_ON_SITE', selectedCause: 'AIR_FILTER', user: 'm' });
  assert.equal(ok.priority, 3);
  assert.equal(ok.breakdown, false);
});

test('передача по ссылке туда и обратно', () => {
  const url = buildHandoffUrl('/', { qmnum: '1', equnr: 'T-305', qmtxt: 'Слабые тормоза', author: 'Иванов' }, '/mtoro/');
  const parsed = parseHandoff(url.split('#/import?')[1]);
  assert.equal(parsed.m2.equnr, 'T-305');
  assert.equal(parsed.m2.qmtxt, 'Слабые тормоза');
  assert.equal(parsed.ret, '/mtoro/');
  assert.match(buildReturnUrl('/mtoro/', { qmnum: '1', analysisStatus: 'CRITICAL', decision: 'STOP_AND_CALL', causeTitle: 'x' }), /^\/mtoro\/\?qmnum=1&status=CRITICAL/);
});

test('ссылка возврата: только относительный адрес этого сервера', () => {
  assert.equal(safeReturnUrl('https://evil.example/'), null);
  assert.equal(safeReturnUrl('//evil.example/'), null);
  assert.equal(safeReturnUrl('javascript:alert(1)'), null);
  assert.equal(safeReturnUrl('/mtoro/'), '/mtoro/');
});
