// Обучение локальной нейросети ранжирования причин.
// Запуск: node tools/train-nn.js  →  core/model/nn-model.js
//
// ВНИМАНИЕ: в MVP обучающая выборка СИНТЕТИЧЕСКАЯ — сгенерирована из шаблонов «причина → признаки»
// (CAUSE_TEMPLATES ниже). Это демонстрирует конвейер «данные → обучение → версия → устройство»,
// но не реальную точность. В пилоте генератор заменяется выгрузкой подтверждённых случаев
// (сообщения М2/М5 + параметры + решение специалиста из журнала ассистента).

import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PROFILES, MODELS, CAUSES, TYPICAL, ELECTRIC_DRIVE, ELECTRIC_CAUSES } from '../core/catalog.js';
import { featurize, forward, FEATURE_NAMES, CAUSE_KEYS, NUM_PARAMS, softmax } from '../core/nn.js';

// ---------- Детерминированный ГПСЧ ----------
let seed = 20261007;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const uni = (a, b) => a + (b - a) * rnd();

// ---------- Шаблоны «причина → наблюдаемые признаки» (экспертные, синтетические) ----------
// sym: вероятность симптома; p: характер параметра (normal|high|highish|low|critlow); b: вероятность true; code: префикс кода.
const CAUSE_TEMPLATES = {
  AIR_FILTER: { sym: { POWER_LOSS: 0.8, BLACK_SMOKE: 0.6 }, p: { intakeRestriction: 'high' } },
  INJECTORS: { sym: { BLACK_SMOKE: 0.85, POWER_LOSS: 0.5 }, p: { intakeRestriction: 'normal' }, code: ['ENG', 0.4] },
  COOLING_CLOGGED: { sym: { OVERHEAT_ENGINE: 0.75, OVERHEAT_HYDRAULIC: 0.25 }, p: { coolantTemp: 'high', hydraulicOilTemp: 'highish' }, b: { externalLeak: 0.05 } },
  COOLANT_LOSS: { sym: { COOLANT_LEAK: 0.7, OVERHEAT_ENGINE: 0.5 }, p: { coolantTemp: 'high' }, b: { externalLeak: 0.85 } },
  RVD_LEAK: { sym: { HYDRAULIC_LEAK: 0.9 }, p: { hydraulicPressure: 'low' }, b: { externalLeak: 0.9 } },
  PUMP_WEAR: { sym: { SLOW_WORK_EQUIPMENT: 0.85, JERKS_COMBINED: 0.3, OVERHEAT_HYDRAULIC: 0.3 }, p: { pumpPressureDelta: 'high', hydraulicPressure: 'low', hydraulicOilTemp: 'highish' }, b: { oilFoaming: 0.05 } },
  AIR_SUCTION: { sym: { SLOW_WORK_EQUIPMENT: 0.8, JERKS_COMBINED: 0.5 }, p: { pumpPressureDelta: 'normal' }, b: { oilFoaming: 0.9 } },
  VALVE_WEAR: { sym: { SLOW_WORK_EQUIPMENT: 0.6, BOOM_DRIFT: 0.6 }, p: { hydraulicPressure: 'low', pumpPressureDelta: 'normal' }, b: { oilFoaming: 0.05 } },
  HYD_FILTER: { sym: { JERKS_COMBINED: 0.7, OVERHEAT_HYDRAULIC: 0.6 }, p: { hydraulicOilTemp: 'high' }, b: { oilFoaming: 0.15 } },
  BRAKE_SEALS: { sym: { BRAKE_WEAK: 0.9 }, p: { brakePressure: 'low' }, b: { externalLeak: 0.4 } },
  TIRE_DAMAGE: { sym: { TIRE_PRESSURE_LOW: 0.9 }, p: { tirePressure: 'critlow' } },
  TIRE_VALVE: { sym: { TIRE_PRESSURE_LOW: 0.9 }, p: { tirePressure: 'low' } },
  INSULATION: { sym: { PROTECTION_TRIP: 0.9 }, p: { insulationResistance: 'low', tractionInverterTemp: 'normal' }, code: ['GND', 0.3] },
  IGBT: { sym: { PROTECTION_TRIP: 0.8, POWER_LOSS: 0.4 }, p: { tractionInverterTemp: 'normal' }, code: ['INV', 0.85] },
  TRACTION_OVERHEAT: { sym: { PROTECTION_TRIP: 0.5, POWER_LOSS: 0.7 }, p: { tractionInverterTemp: 'high' }, code: ['TMP', 0.3] },
  SENSOR: { sym: { PROTECTION_TRIP: 0.7 }, p: {}, code: ['SNS', 0.5] },
  STRUCTURE_CRACK: { sym: { CRACK: 0.95 }, p: {} },
  STEERING: { sym: { STEERING_PLAY: 0.95 }, p: {} },
};
const AUTO = new Set(['coolantTemp', 'hydraulicPressure', 'tirePressure']); // приходят из диспетчерской системы

function sampleValue(key, kind, lim) {
  const high = ['coolantTemp', 'hydraulicOilTemp', 'intakeRestriction', 'tractionInverterTemp', 'pumpPressureDelta'].includes(key);
  if (high) {
    const warn = lim.warn ?? lim.max * 0.8;
    const top = lim.crit ?? lim.max;
    if (kind === 'high') return uni(top * 0.97, top * 1.15);
    if (kind === 'highish') return uni(warn * 0.95, top);
    return uni(warn * 0.55, warn * 0.95);
  }
  const min = lim.min;
  const crit = lim.crit ?? min * 0.75;
  const nom = lim.nom ?? min * 1.6;
  if (kind === 'critlow') return uni(crit * 0.6, crit * 0.98);
  if (kind === 'low') return uni(crit * 1.02, min * 0.99);
  return uni(min * 1.02, nom * 1.08);
}

function sample(causeId) {
  const t = CAUSE_TEMPLATES[causeId];
  let models = Object.keys(MODELS).filter((m) => (TYPICAL[m] ?? []).includes(causeId));
  if (!models.length || rnd() < 0.3) models = Object.keys(MODELS);
  models = models.filter((m) => !ELECTRIC_CAUSES.has(causeId) || ELECTRIC_DRIVE.has(m));
  const model = pick(models);
  const lim = PROFILES[MODELS[model]].limits;
  const symptoms = Object.entries(t.sym).filter(([, p]) => rnd() < p).map(([s]) => s);
  if (!symptoms.length) symptoms.push(Object.keys(t.sym)[0]);
  if (rnd() < 0.08) symptoms.push(pick(Object.keys(CAUSE_TEMPLATES.AIR_FILTER.sym))); // шум: лишний симптом
  const params = {};
  for (const k of NUM_PARAMS) {
    if (!lim[k]) continue;
    const kind = t.p[k];
    const measured = AUTO.has(k) ? rnd() < 0.9 : kind ? rnd() < 0.55 : rnd() < 0.15;
    if (!measured) continue;
    params[k] = +(sampleValue(k, kind ?? 'normal', lim[k]) * (1 + 0.03 * gauss())).toFixed(2);
  }
  for (const [k, p] of Object.entries(t.b ?? {})) if (rnd() < 0.55) params[k] = rnd() < p;
  if (t.code && rnd() < 0.6) params.faultCode = rnd() < t.code[1] ? `${t.code[0]}-${100 + Math.floor(rnd() * 800)}` : '';
  if (params.faultCode === '') delete params.faultCode;
  return { machine: { model }, defect: { symptoms }, params, y: CAUSE_KEYS.indexOf(causeId) };
}

// ---------- Обучение MLP (обратное распространение, Adam) ----------
function init(sizes) {
  return sizes.slice(1).map((n, i) => {
    const m = sizes[i];
    const s = Math.sqrt(2 / m);
    return { W: Array.from({ length: n }, () => Array.from({ length: m }, () => gauss() * s)), b: new Array(n).fill(0) };
  });
}

function train(data, sizes, { epochs = 40, lr = 0.005, batch = 64, l2 = 1e-4 } = {}) {
  const layers = init(sizes);
  const mom = layers.map((L) => ({ mW: L.W.map((r) => r.map(() => 0)), vW: L.W.map((r) => r.map(() => 0)), mb: L.b.map(() => 0), vb: L.b.map(() => 0) }));
  let step = 0;
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = data.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [data[i], data[j]] = [data[j], data[i]]; }
    let loss = 0;
    for (let s = 0; s < data.length; s += batch) {
      const chunk = data.slice(s, s + batch);
      const gW = layers.map((L) => L.W.map((r) => r.map(() => 0)));
      const gb = layers.map((L) => L.b.map(() => 0));
      for (const { x, y } of chunk) {
        const acts = [x];
        const pre = [];
        let h = x;
        layers.forEach((L, li) => {
          const z = L.b.map((b, j) => b + L.W[j].reduce((a, w, k) => a + w * h[k], 0));
          pre.push(z);
          h = li < layers.length - 1 ? z.map((v) => (v > 0 ? v : 0)) : z;
          acts.push(h);
        });
        const p = softmax(h);
        loss += -Math.log(p[y] + 1e-12);
        let delta = p.map((v, j) => v - (j === y ? 1 : 0));
        for (let li = layers.length - 1; li >= 0; li--) {
          const a = acts[li];
          for (let j = 0; j < delta.length; j++) {
            gb[li][j] += delta[j];
            for (let k = 0; k < a.length; k++) gW[li][j][k] += delta[j] * a[k];
          }
          if (li > 0) {
            const prev = new Array(a.length).fill(0);
            for (let j = 0; j < delta.length; j++) for (let k = 0; k < a.length; k++) prev[k] += layers[li].W[j][k] * delta[j];
            delta = prev.map((v, k) => (pre[li - 1][k] > 0 ? v : 0));
          }
        }
      }
      step++;
      const b1 = 0.9, b2 = 0.999, eps = 1e-8, n = chunk.length;
      layers.forEach((L, li) => {
        const M = mom[li];
        for (let j = 0; j < L.b.length; j++) {
          for (let k = 0; k < L.W[j].length; k++) {
            const g = gW[li][j][k] / n + l2 * L.W[j][k];
            M.mW[j][k] = b1 * M.mW[j][k] + (1 - b1) * g;
            M.vW[j][k] = b2 * M.vW[j][k] + (1 - b2) * g * g;
            L.W[j][k] -= lr * (M.mW[j][k] / (1 - b1 ** step)) / (Math.sqrt(M.vW[j][k] / (1 - b2 ** step)) + eps);
          }
          const g = gb[li][j] / n;
          M.mb[j] = b1 * M.mb[j] + (1 - b1) * g;
          M.vb[j] = b2 * M.vb[j] + (1 - b2) * g * g;
          L.b[j] -= lr * (M.mb[j] / (1 - b1 ** step)) / (Math.sqrt(M.vb[j] / (1 - b2 ** step)) + eps);
        }
      });
    }
    if (ep % 10 === 9 || ep === epochs - 1) console.log(`эпоха ${ep + 1}: loss ${(loss / data.length).toFixed(4)}`);
  }
  return layers;
}

function evaluate(model, data) {
  let top1 = 0, top3 = 0;
  for (const { x, y } of data) {
    const p = forward(model, x);
    const order = p.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
    if (order[0] === y) top1++;
    if (order.slice(0, 3).includes(y)) top3++;
  }
  return { top1: +(top1 / data.length).toFixed(3), top3: +(top3 / data.length).toFixed(3), n: data.length };
}

// ---------- Основной сценарий ----------
const PER_CAUSE = 450;
const all = [];
for (const c of CAUSE_KEYS) for (let i = 0; i < PER_CAUSE; i++) {
  const s = sample(c);
  all.push({ x: featurize(s), y: s.y });
}
for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
const cut = Math.floor(all.length * 0.8);
const trainSet = all.slice(0, cut);
const testSet = all.slice(cut);
const sizes = [FEATURE_NAMES.length, 32, 16, CAUSE_KEYS.length];
console.log(`Выборка: ${all.length} синтетических случаев, признаков ${FEATURE_NAMES.length}, классов ${CAUSE_KEYS.length}`);
const layers = train(trainSet, sizes);
const round = (v) => Math.round(v * 1e5) / 1e5;
const model = {
  format: 'toro-mlp-1',
  name: 'Ранжирование причин (MLP)',
  version: '0.1.0-synthetic',
  trainedAt: new Date().toISOString().slice(0, 10),
  trainedOn: `синтетическая выборка ${all.length} случаев (шаблоны «причина → признаки»)`,
  architecture: sizes.join('-') + ' ReLU, softmax',
  paramCount: sizes.slice(1).reduce((s, n, i) => s + n * sizes[i] + n, 0),
  inputs: FEATURE_NAMES,
  outputs: CAUSE_KEYS,
  layers: layers.map((L) => ({ W: L.W.map((r) => r.map(round)), b: L.b.map(round) })),
};
model.metrics = { holdout: evaluate(model, testSet), note: 'на синтетических данных; реальная точность — после обучения на истории М2/М5' };
model.sha256 = createHash('sha256').update(JSON.stringify(model.layers)).digest('hex');
console.log('Отложенная выборка:', model.metrics.holdout, `параметров: ${model.paramCount}`);

await mkdir(new URL('../core/model/', import.meta.url), { recursive: true });
await writeFile(new URL('../core/model/nn-model.js', import.meta.url),
  `// Сгенерировано tools/train-nn.js — не редактировать вручную.\n// ${model.name} v${model.version}, ${model.architecture}, ${model.paramCount} параметров.\nexport const NN_MODEL = ${JSON.stringify(model)};\n`);
console.log('Сохранено: core/model/nn-model.js');
