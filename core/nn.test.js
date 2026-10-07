import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featurize, forward, neuralRanker, compatible, FEATURE_NAMES, CAUSE_KEYS, deviation } from './nn.js';
import { NN_MODEL } from './model/nn-model.js';
import { analyze, STATUS } from './engine.js';
import { RULEBASE } from './rules.js';
import { MACHINES, HISTORY, SCENARIOS } from './demo-data.js';
import { PROFILES } from './catalog.js';

const nn = neuralRanker(NN_MODEL);
const run = (s, params, ranker = nn) => analyze({ machine: MACHINES.find((m) => m.id === s.machineId), defect: s.defect, params, history: HISTORY, rulebase: RULEBASE }, ranker);

test('модель совместима со справочниками и выдаёт распределение вероятностей', () => {
  assert.ok(compatible(NN_MODEL));
  const x = featurize({ machine: MACHINES[0], defect: { symptoms: ['POWER_LOSS'] }, params: {} });
  assert.equal(x.length, FEATURE_NAMES.length);
  const p = forward(NN_MODEL, x);
  assert.equal(p.length, CAUSE_KEYS.length);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('несовместимая модель не подключается', () => {
  assert.equal(neuralRanker({ ...NN_MODEL, outputs: ['X'] }), null);
});

test('нормированное отклонение: >0 хуже нормы, <0 запас', () => {
  const lim = PROFILES.truck136.limits;
  assert.ok(deviation('coolantTemp', 104, lim.coolantTemp) > 0);
  assert.ok(deviation('coolantTemp', 80, lim.coolantTemp) < 0);
  assert.ok(deviation('brakePressure', 10, lim.brakePressure) > 0);
  assert.equal(deviation('brakePressure', undefined, lim.brakePressure), null);
});

test('с нейросетью все 4 сценария ТЗ дают те же статусы', () => {
  const expected = { S1: STATUS.CLEAR, S2: STATUS.MULTIPLE, S3: STATUS.INSUFFICIENT, S4: STATUS.CRITICAL };
  for (const [id, st] of Object.entries(expected)) {
    const s = SCENARIOS.find((x) => x.id === id);
    const r = run(s, s.params);
    assert.equal(r.status, st, id);
    assert.equal(r.trace.engine, 'rules+cbr+ml');
    assert.equal(r.trace.ml.version, NN_MODEL.version);
  }
});

test('безопасность: даже «уверенная» нейросеть не снимает критичность и требование данных', () => {
  const evil = () => ({ SENSOR: 50 }); // нейросеть «уверена» в безобидной причине
  const s4 = SCENARIOS.find((x) => x.id === 'S4');
  assert.equal(run(s4, s4.params, evil).status, STATUS.CRITICAL);
  const s3 = SCENARIOS.find((x) => x.id === 'S3');
  assert.equal(run(s3, s3.params, evil).status, STATUS.INSUFFICIENT);
});

test('модель сохранена с контрольной суммой и метриками', () => {
  assert.match(NN_MODEL.sha256, /^[0-9a-f]{64}$/);
  assert.ok(NN_MODEL.metrics.holdout.top3 > 0.9);
});
