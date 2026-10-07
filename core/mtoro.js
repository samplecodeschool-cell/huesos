// Интеграция с «Мобильным ТОРО»: общий контракт обмена (используют клиент, сервер и эмулятор).
//
// Ассистент не дублирует «Мобильное ТОРО»: дефект регистрируется там (сообщение вида М2),
// ассистент получает его, помогает с диагностикой и возвращает результат в то же сообщение.
// Поля названы по сообщению ТОиР SAP (QMNUM, EQUNR, QMTXT…) — для согласования с владельцами системы.
// Каталожные коды причин ниже — ДЕМОНСТРАЦИОННЫЕ, заменяются кодами каталога предприятия.

import { SYMPTOMS, CAUSES } from './catalog.js';

/** Сообщение М2 в формате обмена. */
export const M2_FIELDS = {
  qmnum: 'Номер сообщения (QMNUM)',
  qmart: 'Вид сообщения (QMART) = M2',
  equnr: 'Единица оборудования (EQUNR) — бортовой номер',
  qmtxt: 'Краткий текст (QMTXT)',
  longText: 'Длинный текст сообщения',
  author: 'Кто зарегистрировал',
  createdAt: 'Дата и время обнаружения (AUSVN)',
  photos: 'Количество приложенных фото',
};

// ---------- Текст дефекта → симптомы ассистента ----------
// Механик пишет в «Мобильном ТОРО» своими словами; ассистент предлагает симптомы, механик подтверждает.
const SYMPTOM_PATTERNS = [
  ['HYDRAULIC_LEAK', /(теч|утеч|подтек|потек)\S*.*(гидр|рвд|рукав|масл)|(гидр|рвд|рукав)\S*.*(теч|утеч|подтек)/i],
  ['COOLANT_LEAK', /(теч|утеч|подтек)\S*.*(ож\b|антифриз|охлажд|патруб)|(ож\b|антифриз|патруб)\S*.*(теч|утеч)/i],
  ['BLACK_SMOKE', /дым/i],
  ['POWER_LOSS', /не тян|мощност|тяг[аиу]\b|слаб.*разгон/i],
  ['OVERHEAT_ENGINE', /перегр\S*.*(двс|двигат|мотор|ож\b)|(двс|двигат|ож\b)\S*.*перегр|температур\S* ож/i],
  ['OVERHEAT_HYDRAULIC', /перегр\S*.*гидр|гидр\S*.*перегр|горяч\S* масл/i],
  ['SLOW_WORK_EQUIPMENT', /медленн|вяло|долго поднима|слабо поднима/i],
  ['JERKS_COMBINED', /рыв|дёрг|дерг/i],
  ['BOOM_DRIFT', /опуска\S*.*(сам|под нагруз)|самопроизвол|сползает стрел/i],
  ['BRAKE_WEAK', /тормоз/i],
  ['TIRE_PRESSURE_LOW', /шин|колес|кгш|подкач|прокол/i],
  ['PROTECTION_TRIP', /защит|отказ хода|не едет|ошибк\S* (инверт|привод)|аварийн\S* останов/i],
  ['STEERING_PLAY', /рул/i],
  ['CRACK', /трещин|излом|надрыв метал/i],
];

export function textToSymptoms(text = '') {
  return SYMPTOM_PATTERNS.filter(([, re]) => re.test(text)).map(([id]) => id).filter((id) => SYMPTOMS[id]);
}

// ---------- Результат ассистента → дополнение сообщения М2 ----------
/** Демонстрационный каталог причин (URGRP/URCOD). */
export const CAUSE_CODES = Object.fromEntries(Object.keys(CAUSES).map((id, i) => [id, { group: 'TA-DEMO', code: `R${String(i + 1).padStart(2, '0')}` }]));

const DECISION_TEXT = {
  STOP_AND_CALL: 'Машина остановлена, вызван старший механик',
  REPAIR_ON_SITE: 'Устранение на месте (ММО/ПАРМ)',
  SEND_TO_WORKSHOP: 'Направлена в ремонтную зону',
  CONTINUE_WITH_MONITORING: 'Продолжение работы с контролем параметров',
  RELEASE_BY_RESPONSIBLE: 'Допуск к работе ответственным лицом',
};

/**
 * Что ассистент дописывает в сообщение М2 после решения специалиста.
 * priority: 1 — очень высокий … 4 — низкий; breakdown — признак остановки оборудования (MSAUS).
 */
export function decisionToM2Update(payload) {
  const cause = payload.selectedCause ? CAUSES[payload.selectedCause] : null;
  const critical = payload.analysisStatus === 'CRITICAL';
  const stop = critical || payload.decision === 'STOP_AND_CALL' || payload.decision === 'SEND_TO_WORKSHOP';
  const lines = [
    `[ТОРО-Ассистент] Статус анализа: ${({ CLEAR: 'однозначная причина', MULTIPLE: 'несколько причин', INSUFFICIENT: 'данных недостаточно', CRITICAL: 'КРИТИЧЕСКОЕ СОСТОЯНИЕ' })[payload.analysisStatus] ?? payload.analysisStatus}`,
    `Причина (подтверждена специалистом): ${cause ? cause.title : 'не установлена'}`,
    `Решение: ${DECISION_TEXT[payload.decision] ?? payload.decision}`,
    payload.comment ? `Комментарий: ${payload.comment}` : null,
    `Гипотезы ассистента: ${(payload.topCauses ?? []).map((c) => CAUSES[c]?.title ?? c).join('; ') || '—'}`,
    `Версия базы правил: ${payload.rulebaseVersion}; решение принял: ${payload.user}`,
  ].filter(Boolean);
  return {
    qmnum: payload.m2?.qmnum ?? null,
    causeCode: payload.selectedCause ? CAUSE_CODES[payload.selectedCause] : null,
    causeTitle: cause?.title ?? null,
    action: cause ? `${cause.action} (${cause.place})` : null,
    priority: critical ? 1 : stop ? 2 : 3,
    breakdown: stop,
    decision: payload.decision,
    decisionText: DECISION_TEXT[payload.decision] ?? payload.decision,
    analysisStatus: payload.analysisStatus,
    longText: lines.join('\n'),
    decidedBy: payload.user,
    decidedAt: payload.decidedAt ?? new Date().toISOString(),
  };
}

// ---------- Передача дефекта между приложениями на телефоне (работает без сети) ----------
// «Мобильное ТОРО» открывает ассистент ссылкой, ассистент возвращает результат по ссылке ret.
// На Android это Intent / deep link между приложениями; в прототипе — URL.

export function buildHandoffUrl(base, m2, ret) {
  const q = new URLSearchParams({ qmnum: m2.qmnum ?? '', eq: m2.equnr, text: m2.qmtxt ?? '', long: m2.longText ?? '', author: m2.author ?? '', at: m2.createdAt ?? '' });
  if (ret) q.set('ret', ret);
  return `${base}#/import?${q}`;
}

export function parseHandoff(query) {
  const q = new URLSearchParams(query);
  const equnr = q.get('eq');
  if (!equnr) return null;
  return {
    m2: { qmnum: q.get('qmnum') || null, equnr, qmtxt: q.get('text') ?? '', longText: q.get('long') ?? '', author: q.get('author') ?? '', createdAt: q.get('at') || null },
    ret: safeReturnUrl(q.get('ret')),
  };
}

/** Возврат разрешён только на относительный адрес того же сервера (защита от подмены ссылки). */
export function safeReturnUrl(ret) {
  if (!ret || !ret.startsWith('/') || ret.startsWith('//')) return null;
  return ret;
}

export function buildReturnUrl(ret, update) {
  const sep = ret.includes('?') ? '&' : '?';
  const q = new URLSearchParams({ qmnum: update.qmnum ?? '', status: update.analysisStatus, decision: update.decision, cause: update.causeTitle ?? '' });
  return `${ret}${sep}${q}`;
}
