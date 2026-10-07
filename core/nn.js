// Локальная нейросеть ранжирования причин (модуль 3 по п. 5.4 ТЗ).
// Многослойный перцептрон: признаки дефекта → вероятности групп неисправностей.
// Вывод выполняется на устройстве без сети: несколько тысяч умножений, < 1 мс.
// Промышленная версия: та же архитектура экспортируется в ONNX и исполняется
// ONNX Runtime Mobile на Android (см. docs/neural-network.md).

import { PROFILES, MODELS, SYMPTOMS, CAUSES, ELECTRIC_DRIVE } from './catalog.js';

export const SYMPTOM_KEYS = Object.keys(SYMPTOMS);
export const CAUSE_KEYS = Object.keys(CAUSES);
export const CLASS_KEYS = Object.keys(PROFILES);
export const NUM_PARAMS = ['coolantTemp', 'hydraulicOilTemp', 'hydraulicPressure', 'tirePressure', 'brakePressure',
  'intakeRestriction', 'insulationResistance', 'tractionInverterTemp', 'pumpPressureDelta'];
export const BOOL_PARAMS = ['oilFoaming', 'externalLeak'];
const HIGH_BAD = new Set(['coolantTemp', 'hydraulicOilTemp', 'intakeRestriction', 'tractionInverterTemp', 'pumpPressureDelta']);

/**
 * Нормированное «отклонение в сторону плохого»: 0 — на границе нормы, >0 — хуже нормы, <0 — запас.
 * Нормировка по порогам модели делает признаки сопоставимыми для разных марок техники.
 */
export function deviation(key, v, lim) {
  if (!lim || typeof v !== 'number') return null;
  if (HIGH_BAD.has(key)) {
    const ref = lim.warn ?? lim.max;
    const top = lim.crit ?? lim.max ?? ref * 1.2;
    const scale = Math.max(top - ref, ref * 0.1) || 1;
    return Math.max(-3, Math.min(3, (v - ref) / scale));
  }
  const ref = lim.min;
  const bottom = lim.crit ?? ref * 0.8;
  const scale = Math.max(ref - bottom, ref * 0.1) || 1;
  return Math.max(-3, Math.min(3, (ref - v) / scale));
}

/** Вектор признаков (фиксированная длина, см. FEATURE_NAMES). Отсутствующий замер = 0 + маска 0. */
export function featurize({ machine, defect, params }) {
  const cls = MODELS[machine.model];
  const lim = PROFILES[cls].limits;
  const sym = new Set(defect.symptoms ?? []);
  const x = [];
  for (const s of SYMPTOM_KEYS) x.push(sym.has(s) ? 1 : 0);
  for (const k of NUM_PARAMS) {
    const d = deviation(k, params[k], lim[k]);
    x.push(d === null ? 0 : d, d === null ? 0 : 1);
  }
  for (const k of BOOL_PARAMS) x.push(params[k] === true ? 1 : params[k] === false ? -1 : 0, params[k] === undefined ? 0 : 1);
  const code = params.faultCode ? String(params.faultCode).toUpperCase() : '';
  x.push(code.startsWith('INV') ? 1 : 0, code ? 1 : 0);
  for (const c of CLASS_KEYS) x.push(c === cls ? 1 : 0);
  x.push(ELECTRIC_DRIVE.has(machine.model) ? 1 : 0);
  return x;
}

export const FEATURE_NAMES = [
  ...SYMPTOM_KEYS.map((s) => `sym:${s}`),
  ...NUM_PARAMS.flatMap((k) => [`dev:${k}`, `has:${k}`]),
  ...BOOL_PARAMS.flatMap((k) => [`val:${k}`, `has:${k}`]),
  'code:INV', 'has:faultCode', ...CLASS_KEYS.map((c) => `cls:${c}`), 'electric',
];

// ---------- Вывод ----------
const relu = (v) => (v > 0 ? v : 0);

export function forward(model, x) {
  let h = x;
  model.layers.forEach((L, i) => {
    const out = new Array(L.b.length);
    for (let j = 0; j < L.b.length; j++) {
      let s = L.b[j];
      const row = L.W[j];
      for (let k = 0; k < h.length; k++) s += row[k] * h[k];
      out[j] = i < model.layers.length - 1 ? relu(s) : s;
    }
    h = out;
  });
  return softmax(h);
}

export function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** Проверка совместимости модели с текущими справочниками (иначе модель не используется). */
export function compatible(model) {
  return model?.format === 'toro-mlp-1'
    && JSON.stringify(model.inputs) === JSON.stringify(FEATURE_NAMES)
    && JSON.stringify(model.outputs) === JSON.stringify(CAUSE_KEYS);
}

/**
 * Адаптер к хуку mlRanker диагностического ядра. Вклад нейросети ограничен весом `weight`:
 * она может переставить приоритеты гипотез, но не снимает требование данных и не отменяет
 * критичность — эти решения принимают только проверяемые правила.
 */
export function neuralRanker(model, { weight = 0.6, minProb = 0.05 } = {}) {
  if (!compatible(model)) return null;
  const fn = (input) => {
    const t0 = (globalThis.performance ?? Date).now();
    const p = forward(model, featurize(input));
    fn.lastMs = (globalThis.performance ?? Date).now() - t0;
    fn.lastRaw = Object.fromEntries(CAUSE_KEYS.map((c, i) => [c, p[i]]).filter(([, v]) => v >= minProb).sort((a, b) => b[1] - a[1]));
    return Object.fromEntries(Object.entries(fn.lastRaw).map(([c, v]) => [c, v * weight]));
  };
  fn.meta = { name: model.name, version: model.version, trainedOn: model.trainedOn, metrics: model.metrics, params: model.paramCount };
  return fn;
}
