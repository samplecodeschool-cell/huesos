// Диагностическое ядро «ТОРО-Ассистент». Чистые функции, без сети и без зависимостей:
// одинаково работает в браузере (PWA на Android), в Node (тесты) и переносится в Kotlin 1:1.
//
// Конвейер: валидация параметров → правила «если → то» → похожие случаи →
// ранжирование причин → оценка достаточности данных → критичность → рекомендация + трассировка.

import { PROFILES, MODELS, PARAMS, CAUSES, CHECKS, TYPICAL, ELECTRIC_DRIVE, ELECTRIC_CAUSES, PHYSICAL_RANGES, SYMPTOMS } from './catalog.js';

export const STATUS = {
  CLEAR: 'CLEAR',               // однозначная причина
  MULTIPLE: 'MULTIPLE',         // несколько вероятных причин
  INSUFFICIENT: 'INSUFFICIENT', // данных недостаточно
  CRITICAL: 'CRITICAL',         // потенциально опасное состояние
};

export const CONFIG = {
  pendingFactor: 0.2,   // вклад правила, у которого не хватает замера (симптом есть, параметра нет)
  caseFactor: 0.3,      // вклад похожего исторического случая
  typicalBonus: 0.1,    // априорный бонус «типовой неисправности» модели
  softmaxK: 2,          // «резкость» ранжирования
  minEvidence: 0.6,     // минимальная сила подтверждённых правил, иначе — «данных недостаточно»
  clearProb: 0.6,       // порог однозначности
  clearMargin: 0.25,    // отрыв лидера от второй причины
  minCaseSim: 0.4,
  serviceWindowH: 150,  // если до планового ТО меньше — предложить совместить ремонт с ТО
};

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Отбрасывает пустые и физически невозможные значения, возвращает предупреждения. */
export function sanitizeParams(params = {}) {
  const clean = {};
  const warnings = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    const range = PHYSICAL_RANGES[k];
    if (range && (typeof v !== 'number' || Number.isNaN(v) || v < range[0] || v > range[1])) {
      warnings.push(`Значение «${PARAMS[k]?.label ?? k}» = ${v} вне физического диапазона — исключено, требуется повторный замер`);
      continue;
    }
    clean[k] = v;
  }
  return { clean, warnings };
}

/** Результат условия: true / false / null (нет данных). */
function evalCond(cond, ctx) {
  if (cond.sym) return ctx.symptoms.has(cond.sym);
  const v = ctx.params[cond.p];
  if (v === undefined) return null;
  const ref = cond.lim !== undefined ? get(ctx.limits, cond.lim) : cond.value;
  if (cond.lim !== undefined && ref === undefined) return false; // порог не задан для класса техники
  switch (cond.op) {
    case '>': return v > ref;
    case '>=': return v >= ref;
    case '<': return v < ref;
    case '<=': return v <= ref;
    case '==': return v === ref;
    case 'present': return true;
    case 'startsWith': return String(v).toUpperCase().startsWith(String(ref).toUpperCase());
    default: throw new Error(`Неизвестный оператор ${cond.op}`);
  }
}

/** FIRED — сработало, PENDING — есть положительный признак, но не хватает замера, иначе null. */
export function evalRule(rule, ctx) {
  const all = (rule.all ?? []).map((c) => [c, evalCond(c, ctx)]);
  const any = (rule.any ?? []).map((c) => [c, evalCond(c, ctx)]);
  if (all.some(([, r]) => r === false)) return null;
  const anyOk = any.length === 0 || any.some(([, r]) => r === true);
  const anyUnknown = any.length > 0 && !anyOk && any.some(([, r]) => r === null);
  if (any.length > 0 && !anyOk && !anyUnknown) return null;
  const unknown = [...all, ...(anyOk ? [] : any)].filter(([, r]) => r === null).map(([c]) => c.p);
  if (unknown.length === 0 && anyOk) return { state: 'FIRED', missing: [] };
  const hasPositive = [...all, ...any].some(([c, r]) => r === true && c.sym);
  return hasPositive ? { state: 'PENDING', missing: [...new Set(unknown)] } : null;
}

function causeApplicable(causeId, model) {
  return !ELECTRIC_CAUSES.has(causeId) || ELECTRIC_DRIVE.has(model);
}

/** Сходство случаев: симптомы (Жаккар), та же модель, та же машина. */
export function caseSimilarity(history, defect, machine) {
  const a = new Set(defect.symptoms);
  const b = new Set(history.symptoms);
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size || 1;
  return 0.6 * (inter / union) + 0.25 * (history.model === machine.model ? 1 : 0) + 0.15 * (history.machineId === machine.id ? 1 : 0);
}

export function findSimilarCases(history, defect, machine, k = 3) {
  return history
    .map((h) => ({ ...h, sim: +caseSimilarity(h, defect, machine).toFixed(2) }))
    .filter((h) => h.sim >= CONFIG.minCaseSim && h.symptoms.some((s) => defect.symptoms.includes(s)))
    .sort((x, y) => y.sim - x.sim)
    .slice(0, k);
}

/**
 * Главная функция анализа.
 * @param {object} input { machine, defect: {symptoms[], comment}, params, history[], rulebase }
 * @param {object} [mlRanker] необязательный модуль ML (ONNX и т.п.): (features) => {causeId: prob}
 */
export function analyze({ machine, defect, params, history = [], rulebase }, mlRanker = null) {
  const cls = MODELS[machine.model];
  if (!cls) throw new Error(`Неизвестная модель техники: ${machine.model}`);
  const limits = PROFILES[cls].limits;
  const { clean, warnings } = sanitizeParams(params);
  const ctx = { symptoms: new Set(defect.symptoms ?? []), params: clean, limits };

  const score = {};      // итоговые баллы
  const confirmed = {};  // баллы только от полностью сработавших правил
  const evidence = {};   // объяснение по каждой причине
  const fired = [];
  const pending = [];
  const critical = [];
  const add = (cid, w, why) => {
    score[cid] = (score[cid] ?? 0) + w;
    (evidence[cid] ??= []).push(why);
  };

  for (const rule of rulebase.rules) {
    const causes = Object.entries(rule.causes).filter(([cid]) => causeApplicable(cid, machine.model));
    if (causes.length === 0) continue;
    const res = evalRule(rule, ctx);
    if (!res) continue;
    if (res.state === 'FIRED') {
      fired.push(rule.id);
      if (rule.critical) critical.push({ ruleId: rule.id, reason: rule.critical });
      for (const [cid, w] of causes) {
        add(cid, w, `Правило ${rule.id}: ${rule.title}`);
        confirmed[cid] = (confirmed[cid] ?? 0) + w;
      }
    } else {
      pending.push({ ruleId: rule.id, title: rule.title, missing: res.missing });
      for (const [cid, w] of causes) add(cid, w * CONFIG.pendingFactor, `Правило ${rule.id} (ожидает замер: ${res.missing.map((m) => PARAMS[m]?.label ?? m).join(', ')})`);
    }
  }

  const similar = findSimilarCases(history, defect, machine).filter((h) => causeApplicable(h.cause, machine.model));
  for (const h of similar) add(h.cause, CONFIG.caseFactor * h.sim, `Похожий случай ${h.id} (${h.date}, ${h.machineId}, сходство ${h.sim})`);

  for (const cid of Object.keys(score)) {
    if ((TYPICAL[machine.model] ?? []).includes(cid)) add(cid, CONFIG.typicalBonus, 'Типовая неисправность для модели');
  }

  if (mlRanker) {
    const ml = mlRanker({ machine, defect, params: clean }) ?? {};
    const raw = mlRanker.lastRaw ?? ml;
    for (const [cid, p] of Object.entries(ml)) if (CAUSES[cid] && causeApplicable(cid, machine.model)) add(cid, p, `Нейросеть${mlRanker.meta ? ` v${mlRanker.meta.version}` : ''}: ${((raw[cid] ?? p) * 100).toFixed(0)}%`);
  }

  // Ранжирование (softmax по баллам)
  const ids = Object.keys(score);
  const exps = ids.map((id) => Math.exp(CONFIG.softmaxK * score[id]));
  const z = exps.reduce((s, x) => s + x, 0) || 1;
  const causes = ids
    .map((id, i) => ({ id, title: CAUSES[id].title, system: CAUSES[id].system, prob: exps[i] / z, score: +score[id].toFixed(2), confirmed: +(confirmed[id] ?? 0).toFixed(2), evidence: evidence[id] }))
    .sort((a, b) => b.prob - a.prob);

  const strength = Math.max(0, ...Object.values(confirmed));
  const p1 = causes[0]?.prob ?? 0;
  const p2 = causes[1]?.prob ?? 0;

  let status;
  if (critical.length) status = STATUS.CRITICAL;
  else if (causes.length === 0 || strength < CONFIG.minEvidence) status = STATUS.INSUFFICIENT;
  else if (p1 >= CONFIG.clearProb && p1 - p2 >= CONFIG.clearMargin) status = STATUS.CLEAR;
  else status = STATUS.MULTIPLE;

  const checks = rankChecks({ causes, pending, params: clean, status });
  const serviceHint = machine.nextServiceAt && machine.nextServiceAt - machine.engineHours <= CONFIG.serviceWindowH
    ? `До планового ${machine.serviceType ?? 'ТО'} осталось ${machine.nextServiceAt - machine.engineHours} м·ч — рассмотреть совмещение ремонта с ТО`
    : null;

  return {
    status,
    causes: causes.map((c) => ({ ...c, prob: +c.prob.toFixed(3) })),
    checks,
    critical,
    recommendation: buildRecommendation(status, causes, checks, critical),
    allowedDecisions: allowedDecisions(status),
    serviceHint,
    warnings,
    trace: {
      rulebaseVersion: rulebase.version,
      firedRules: fired,
      pendingRules: pending,
      similarCases: similar.map(({ id, date, machineId, cause, sim, downtimeH }) => ({ id, date, machineId, cause, sim, downtimeH })),
      paramsUsed: Object.entries(clean).map(([k, v]) => ({ key: k, label: PARAMS[k]?.label ?? k, value: v, unit: PARAMS[k]?.unit ?? '', source: PARAMS[k]?.source ?? 'MANUAL' })),
      symptoms: [...ctx.symptoms].map((s) => SYMPTOMS[s] ?? s),
      evidenceStrength: +strength.toFixed(2),
      engine: 'rules+cbr' + (mlRanker ? '+ml' : ''),
      ml: mlRanker?.meta ? { ...mlRanker.meta, inferenceMs: +(mlRanker.lastMs ?? 0).toFixed(2), top: Object.entries(mlRanker.lastRaw ?? {}).slice(0, 3) } : null,
    },
  };
}

/** Какие проверки запросить: недостающие замеры для «ожидающих» правил + проверки лидирующих причин. */
export function rankChecks({ causes, pending, params, status }) {
  const value = {};
  const reasons = {};
  const bump = (chkId, v, why) => {
    const chk = CHECKS[chkId];
    if (!chk || params[chk.param] !== undefined) return;
    value[chkId] = (value[chkId] ?? 0) + v;
    (reasons[chkId] ??= new Set()).add(why);
  };
  const byParam = Object.fromEntries(Object.entries(CHECKS).map(([id, c]) => [c.param, id]));
  for (const p of pending) for (const m of p.missing) bump(byParam[m], 0.5, `уточняет правило ${p.ruleId}`);
  for (const c of causes) {
    if (c.prob < 0.1) continue;
    for (const chkId of CAUSES[c.id].checks) bump(chkId, c.prob, `подтверждает/исключает: ${c.title}`);
  }
  const items = Object.keys(value).map((id) => ({
    id, ...CHECKS[id],
    priority: +(value[id] / Math.sqrt(CHECKS[id].minutes)).toFixed(3),
    reasons: [...reasons[id]],
  }));
  items.sort((a, b) => b.priority - a.priority);
  return status === STATUS.CLEAR ? items.slice(0, 1) : items.slice(0, 4);
}

function buildRecommendation(status, causes, checks, critical) {
  const top = causes[0];
  const fmtChecks = checks.map((c, i) => `${i + 1}) ${c.title} (~${c.minutes} мин, ${c.place})`).join('; ');
  switch (status) {
    case STATUS.CRITICAL:
      return {
        headline: 'ОСТАНОВИТЬ МАШИНУ. Эксплуатация запрещена до решения ответственного лица.',
        text: `${critical.map((c) => c.reason).join('. ')}. ИИ-агент не разрешает эксплуатацию — решение принимает механик ОТК / старший механик. ${top ? `Наиболее вероятно: ${top.title}.` : ''}`,
      };
    case STATUS.CLEAR:
      return {
        headline: `${top.title} — ${(top.prob * 100).toFixed(0)}%`,
        text: `Рекомендуемое действие: ${CAUSES[top.id].action}. Место: ${CAUSES[top.id].place}, ориентировочно ${CAUSES[top.id].repairH} ч.${checks[0] ? ` Контрольная проверка: ${checks[0].title}.` : ''}`,
      };
    case STATUS.MULTIPLE:
      return {
        headline: `Лидирует: ${top.title} — ${(top.prob * 100).toFixed(0)}%, но не однозначно`,
        text: `Для разделения гипотез выполните: ${fmtChecks}. После ввода результатов анализ будет пересчитан.`,
      };
    default:
      return {
        headline: 'Данных недостаточно для обоснованной рекомендации',
        text: checks.length ? `Необходимо: ${fmtChecks}.` : 'Опишите симптом подробнее или выберите систему машины.',
      };
  }
}

/** Решения, доступные специалисту. При критическом статусе допуск к работе — только ответственным лицом с обоснованием. */
export function allowedDecisions(status) {
  const base = [
    { id: 'REPAIR_ON_SITE', title: 'Устранить на месте (ММО / ПАРМ)' },
    { id: 'SEND_TO_WORKSHOP', title: 'Направить в ремонтную зону / цех' },
    { id: 'MORE_CHECKS', title: 'Выполнить доп. проверки и повторить анализ' },
  ];
  if (status === STATUS.CRITICAL) {
    return [
      { id: 'STOP_AND_CALL', title: 'Остановить машину, вызвать старшего механика' },
      ...base,
      { id: 'RELEASE_BY_RESPONSIBLE', title: 'Допуск к работе ответственным лицом', requiresRole: 'SENIOR_MECHANIC', requiresComment: true },
    ];
  }
  return [...base, { id: 'CONTINUE_WITH_MONITORING', title: 'Продолжить работу с контролем параметров', requiresComment: status !== STATUS.CLEAR }];
}
