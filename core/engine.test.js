import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, evalRule, sanitizeParams, STATUS, allowedDecisions } from './engine.js';
import { RULEBASE } from './rules.js';
import { MACHINES, HISTORY, SCENARIOS } from './demo-data.js';
import { CAUSES, CHECKS, PROFILES, MODELS } from './catalog.js';

const run = (id, extra = {}) => {
  const s = SCENARIOS.find((x) => x.id === id);
  const machine = MACHINES.find((m) => m.id === s.machineId);
  return analyze({ machine, defect: s.defect, params: { ...s.params, ...extra }, history: HISTORY, rulebase: RULEBASE });
};

test('S1: однозначное отклонение → CLEAR, воздушный фильтр', () => {
  const r = run('S1');
  assert.equal(r.status, STATUS.CLEAR);
  assert.equal(r.causes[0].id, 'AIR_FILTER');
  assert.ok(r.trace.firedRules.includes('R-ENG-01'));
});

test('S2: несколько причин → MULTIPLE, затем доп. проверка снимает неопределённость', () => {
  const r = run('S2');
  assert.equal(r.status, STATUS.MULTIPLE);
  assert.ok(r.checks.some((c) => c.id === 'CHK_FOAM'), 'должна быть запрошена проверка на пену');
  const r2 = run('S2', { oilFoaming: true });
  assert.equal(r2.status, STATUS.CLEAR);
  assert.equal(r2.causes[0].id, 'AIR_SUCTION');
});

test('S3: «данных недостаточно» с указанием конкретных замеров', () => {
  const r = run('S3');
  assert.equal(r.status, STATUS.INSUFFICIENT);
  const ids = r.checks.map((c) => c.id);
  assert.ok(ids.includes('CHK_FAULT_CODE'));
  assert.ok(ids.includes('CHK_INSULATION') || ids.includes('CHK_INVERTER_TEMP'));
  const r2 = run('S3', SCENARIOS.find((s) => s.id === 'S3').followUp);
  assert.equal(r2.status, STATUS.CLEAR);
  assert.equal(r2.causes[0].id, 'IGBT');
});

test('S4: критическое состояние → CRITICAL, агент не разрешает эксплуатацию', () => {
  const r = run('S4');
  assert.equal(r.status, STATUS.CRITICAL);
  assert.ok(r.critical.length >= 1);
  assert.ok(!r.allowedDecisions.some((d) => d.id === 'CONTINUE_WITH_MONITORING'));
  const release = r.allowedDecisions.find((d) => d.id === 'RELEASE_BY_RESPONSIBLE');
  assert.equal(release.requiresRole, 'SENIOR_MECHANIC');
  assert.equal(release.requiresComment, true);
});

test('Критичность по одному симптому даже без замеров (принцип предосторожности)', () => {
  const machine = MACHINES.find((m) => m.id === 'T-305');
  const r = analyze({ machine, defect: { symptoms: ['STEERING_PLAY'] }, params: {}, history: [], rulebase: RULEBASE });
  assert.equal(r.status, STATUS.CRITICAL);
});

test('Пустой ввод → INSUFFICIENT, без исключений', () => {
  const r = analyze({ machine: MACHINES[0], defect: { symptoms: [] }, params: {}, history: [], rulebase: RULEBASE });
  assert.equal(r.status, STATUS.INSUFFICIENT);
  assert.equal(r.causes.length, 0);
});

test('Физически невозможные значения исключаются с предупреждением', () => {
  const { clean, warnings } = sanitizeParams({ coolantTemp: 900, tirePressure: 6.5, brakePressure: '' });
  assert.deepEqual(clean, { tirePressure: 6.5 });
  assert.equal(warnings.length, 1);
});

test('Причины тягового привода не предлагаются для машин с механической трансмиссией', () => {
  const machine = MACHINES.find((m) => m.model === 'CAT 785D');
  const r = analyze({ machine, defect: { symptoms: ['PROTECTION_TRIP', 'POWER_LOSS'] }, params: { tractionInverterTemp: 90 }, history: HISTORY, rulebase: RULEBASE });
  assert.ok(!r.causes.some((c) => c.id === 'IGBT' || c.id === 'TRACTION_OVERHEAT'));
});

test('evalRule: PENDING, если есть симптом, но не хватает замера', () => {
  const rule = RULEBASE.rules.find((r) => r.id === 'R-ENG-01');
  const res = evalRule(rule, { symptoms: new Set(['POWER_LOSS']), params: {}, limits: PROFILES.truck136.limits });
  assert.equal(res.state, 'PENDING');
  assert.deepEqual(res.missing, ['intakeRestriction']);
});

test('Трассировка: версия базы правил и использованные данные', () => {
  const r = run('S1');
  assert.equal(r.trace.rulebaseVersion, RULEBASE.version);
  assert.ok(r.trace.paramsUsed.some((p) => p.key === 'intakeRestriction' && p.source === 'MANUAL'));
});

test('Хук ML-модели учитывается в ранжировании', () => {
  const s = SCENARIOS.find((x) => x.id === 'S2');
  const machine = MACHINES.find((m) => m.id === s.machineId);
  const r = analyze({ machine, defect: s.defect, params: s.params, history: HISTORY, rulebase: RULEBASE }, () => ({ VALVE_WEAR: 1.5 }));
  assert.equal(r.causes[0].id, 'VALVE_WEAR');
  assert.equal(r.trace.engine, 'rules+cbr+ml');
});

test('Целостность справочников: все ссылки правил и причин существуют', () => {
  for (const rule of RULEBASE.rules) {
    for (const cid of Object.keys(rule.causes)) assert.ok(CAUSES[cid], `${rule.id}: нет причины ${cid}`);
    for (const c of [...(rule.all ?? []), ...(rule.any ?? [])]) {
      // порог может отсутствовать у класса техники (условие = false), но формат ссылки должен быть верным
      if (c.lim) assert.match(c.lim, /^[a-zA-Z]+\.(warn|crit|min|max|nom)$/);
    }
  }
  for (const c of Object.values(CAUSES)) for (const chk of c.checks) assert.ok(CHECKS[chk], `нет проверки ${chk}`);
  for (const m of MACHINES) assert.ok(MODELS[m.model]);
  assert.equal(new Set(RULEBASE.rules.map((r) => r.id)).size, RULEBASE.rules.length, 'дубли ID правил');
});

test('allowedDecisions: при некритичном неоднозначном статусе продолжение требует комментария', () => {
  const d = allowedDecisions(STATUS.MULTIPLE).find((x) => x.id === 'CONTINUE_WITH_MONITORING');
  assert.equal(d.requiresComment, true);
});
