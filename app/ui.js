// SCADA-компоненты интерфейса: стрелочные индикаторы, мнемосхема систем машины,
// сигнальные лампы, шаги процесса, режим обучения (пошаговый тур с подсветкой).

import { PARAMS, CAUSES } from '/core/catalog.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Состояние параметра относительно порогов ----------
const HIGH_BAD = new Set(['coolantTemp', 'hydraulicOilTemp', 'intakeRestriction', 'tractionInverterTemp', 'pumpPressureDelta']);
const CRIT_BELOW_MIN = new Set(['brakePressure']); // нарушение минимума сразу критично
const RANGE = {
  coolantTemp: [0, 130], hydraulicOilTemp: [0, 120], intakeRestriction: [0, 10], tractionInverterTemp: [0, 120],
  pumpPressureDelta: [0, 30], tirePressure: [0, 9], brakePressure: [0, 20], insulationResistance: [0, 5],
  fuelRate: [0, 400], ambientTemp: [-50, 30],
};

export function paramState(k, v, lim) {
  if (v === undefined || v === null || v === '' || typeof v !== 'number' || !lim) return 'idle';
  if (HIGH_BAD.has(k)) {
    const crit = lim.crit ?? lim.max;
    if (crit !== undefined && v > crit) return 'crit';
    if (lim.warn !== undefined && v > lim.warn) return 'warn';
    return 'ok';
  }
  if (lim.crit !== undefined && v < lim.crit) return 'crit';
  if (lim.min !== undefined && v < lim.min) return CRIT_BELOW_MIN.has(k) ? 'crit' : 'warn';
  return 'ok';
}

function gaugeRange(k, lim) {
  if (RANGE[k]) return RANGE[k];
  if (lim?.nom) return [0, Math.ceil(lim.nom * 1.4)];
  return [0, 100];
}

const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

/** Стрелочный индикатор: дуга с зонами норма/предупреждение/авария и стрелкой. */
export function gauge(k, v, lim, { size = 'md' } = {}) {
  const p = PARAMS[k];
  const [lo, hi] = gaugeRange(k, lim);
  const A0 = Math.PI * 0.8;
  const A1 = Math.PI * 2.2;
  const ang = (x) => A0 + (A1 - A0) * Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  const zones = [];
  if (lim) {
    if (HIGH_BAD.has(k)) {
      const warn = lim.warn ?? lim.max;
      const crit = lim.crit ?? lim.max;
      zones.push(['ok', lo, warn ?? hi]);
      if (warn !== undefined && crit !== undefined && crit > warn) zones.push(['warn', warn, crit]);
      if (crit !== undefined) zones.push(['crit', crit, hi]);
    } else {
      const crit = CRIT_BELOW_MIN.has(k) ? lim.min : lim.crit;
      if (crit !== undefined) zones.push(['crit', lo, crit]);
      if (lim.min !== undefined && crit !== lim.min) zones.push(['warn', crit ?? lo, lim.min]);
      zones.push(['ok', lim.min ?? lo, hi]);
    }
  } else zones.push(['idle', lo, hi]);
  const st = paramState(k, v, lim);
  const has = typeof v === 'number';
  const [nx, ny] = polar(60, 60, 40, has ? ang(v) : A0);
  return `<figure class="gauge ${size} st-${st}" data-gauge="${k}">
    <svg viewBox="0 0 120 92" aria-hidden="true">
      <path d="${arc(60, 60, 46, A0, A1)}" class="g-track"/>
      ${zones.map(([z, a, b]) => `<path d="${arc(60, 60, 46, ang(a), ang(b))}" class="g-zone z-${z}"/>`).join('')}
      ${has ? `<line x1="60" y1="60" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="g-needle"/>` : ''}
      <circle cx="60" cy="60" r="4" class="g-hub"/>
      <text x="60" y="84" class="g-val">${has ? v : typeof v === 'string' ? esc(v) : '—'}</text>
    </svg>
    <figcaption><span class="lamp l-${st}"></span>${esc(p?.label ?? k)}<small>${esc(p?.unit ?? '')}</small></figcaption>
  </figure>`;
}

// ---------- Мнемосхема систем ----------
export const SYSTEMS = [
  { id: 'ДВС', x: 10, y: 10, label: 'ДВС' },
  { id: 'Система охлаждения', x: 10, y: 70, label: 'Охлаждение' },
  { id: 'Тяговый привод', x: 130, y: 10, label: 'Тяговый привод' },
  { id: 'Электрооборудование', x: 130, y: 70, label: 'Электрооборуд.' },
  { id: 'КГШ', x: 250, y: 10, label: 'Ходовая / КГШ' },
  { id: 'Тормозная система', x: 250, y: 70, label: 'Тормоза' },
  { id: 'Гидросистема', x: 10, y: 130, label: 'Гидросистема' },
  { id: 'Рулевое управление', x: 130, y: 130, label: 'Рулевое' },
  { id: 'Металлоконструкции', x: 250, y: 130, label: 'Металлоконстр.' },
];
const PARAM_SYSTEM = {
  coolantTemp: 'Система охлаждения', hydraulicOilTemp: 'Гидросистема', hydraulicPressure: 'Гидросистема', pumpPressureDelta: 'Гидросистема',
  tirePressure: 'КГШ', brakePressure: 'Тормозная система', intakeRestriction: 'ДВС', fuelRate: 'ДВС',
  insulationResistance: 'Электрооборудование', tractionInverterTemp: 'Тяговый привод',
};
const LINKS = [['ДВС', 'Тяговый привод'], ['Тяговый привод', 'КГШ'], ['ДВС', 'Система охлаждения'], ['Система охлаждения', 'Гидросистема'], ['Гидросистема', 'Рулевое управление'], ['Электрооборудование', 'Тяговый привод'], ['Тормозная система', 'КГШ'], ['Рулевое управление', 'Металлоконструкции']];
const RANK = { idle: 0, ok: 1, sus: 2, warn: 3, crit: 4 };
const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);

/** Состояние систем: по параметрам и (если есть) по результату анализа. */
export function systemStates(params, limits, result) {
  const st = Object.fromEntries(SYSTEMS.map((s) => [s.id, 'idle']));
  for (const [k, v] of Object.entries(params ?? {})) {
    const sys = PARAM_SYSTEM[k];
    if (sys) st[sys] = worse(st[sys], paramState(k, v, limits[k]));
  }
  if (result) {
    result.causes.forEach((c, i) => {
      const sys = CAUSES[c.id].system;
      if (!(sys in st)) return;
      if (i === 0) st[sys] = worse(st[sys], result.status === 'CRITICAL' ? 'crit' : result.status === 'CLEAR' ? 'warn' : 'sus');
      else if (c.prob >= 0.15) st[sys] = worse(st[sys], 'sus');
    });
  }
  return st;
}

export function mimic(states, { electric = true } = {}) {
  const center = (id) => { const s = SYSTEMS.find((x) => x.id === id); return [s.x + 50, s.y + 22]; };
  return `<svg class="mimic" viewBox="0 0 360 180" role="img" aria-label="Мнемосхема систем машины">
    ${LINKS.map(([a, b]) => {
      const [x1, y1] = center(a); const [x2, y2] = center(b);
      const hot = RANK[states[a]] >= 3 || RANK[states[b]] >= 3;
      return `<path d="M${x1},${y1} L${x2},${y2}" class="m-link ${hot ? 'hot' : ''}"/>`;
    }).join('')}
    ${SYSTEMS.map((s) => `<g class="m-node m-${states[s.id]}" data-sys="${esc(s.id)}">
      <rect x="${s.x}" y="${s.y}" width="100" height="44" rx="6"/>
      <circle cx="${s.x + 12}" cy="${s.y + 12}" r="4" class="m-lamp"/>
      <text x="${s.x + 50}" y="${s.y + 28}">${esc(s.id === 'Тяговый привод' && !electric ? 'Трансмиссия' : s.label)}</text>
    </g>`).join('')}
  </svg>`;
}

export const legend = () => `<div class="legend">
  <span><i class="lamp l-ok"></i>норма</span><span><i class="lamp l-sus"></i>под подозрением</span>
  <span><i class="lamp l-warn"></i>отклонение</span><span><i class="lamp l-crit"></i>авария</span><span><i class="lamp l-idle"></i>нет данных</span></div>`;

/** Силуэт машины по классу (для заголовка карточки). */
export function silhouette(cls) {
  const body = {
    truck136: '<path d="M8 40 h70 l14 -18 h22 v18 h6 v10 H8z"/><path d="M14 22 h52 l10 18 H14z" opacity=".55"/>',
    truck90: '<path d="M8 40 h70 l14 -18 h22 v18 h6 v10 H8z"/><path d="M14 24 h50 l8 16 H14z" opacity=".55"/>',
    loader: '<path d="M30 40 h70 v-14 h-22 l-6 -10 h-20 v24z"/><path d="M4 44 l10 -14 h14 l-6 14z" opacity=".7"/>',
    excavator: '<path d="M30 42 h60 v-14 h-60z"/><path d="M70 28 l20 -20 l18 6 l-4 22" fill="none" stroke="currentColor" stroke-width="5"/><path d="M20 48 h80 v6 H20z"/>',
  }[cls] ?? '';
  const wheels = cls === 'excavator' ? '' : '<circle cx="28" cy="52" r="9"/><circle cx="96" cy="52" r="9"/>';
  return `<svg class="sil" viewBox="0 0 124 64" aria-hidden="true">${body}${wheels}</svg>`;
}

// ---------- Шаги процесса ----------
const STEPS = ['Машина', 'Дефект', 'Анализ', 'Проверки', 'Решение'];
export function stepper(active, done = active - 1) {
  return `<ol class="stepper" data-tour="stepper">${STEPS.map((s, i) => `<li class="${i + 1 === active ? 'on' : i + 1 <= done ? 'done' : ''}"><b>${i + 1}</b><span>${s}</span></li>`).join('')}</ol>`;
}

/** Встроенная подсказка: видна всегда как «?», раскрывается по нажатию; в режиме обучения раскрыта. */
export const hint = (text) => `<details class="hint"><summary aria-label="Подсказка">?</summary><p>${esc(text)}</p></details>`;

// ---------- Режим обучения: пошаговый тур с подсветкой ----------
let tour = null;
export function startTour(steps, { onDisable } = {}) {
  endTour();
  const list = steps.filter((s) => !s.sel || document.querySelector(s.sel));
  if (!list.length) return;
  tour = { list, i: 0, onDisable };
  const ov = document.createElement('div');
  ov.id = 'tour';
  ov.innerHTML = '<div class="t-hole"></div><div class="t-card" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(ov);
  showStep();
  window.addEventListener('resize', showStep);
}

export function endTour() {
  document.getElementById('tour')?.remove();
  window.removeEventListener('resize', showStep);
  tour = null;
}

function showStep() {
  if (!tour) return;
  const { list, i } = tour;
  const st = list[i];
  const ov = document.getElementById('tour');
  const hole = ov.querySelector('.t-hole');
  const card = ov.querySelector('.t-card');
  const el = st.sel && document.querySelector(st.sel);
  if (el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    Object.assign(hole.style, { display: 'block', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    const below = r.bottom + 220 < window.innerHeight;
    Object.assign(card.style, below ? { top: `${r.bottom + 14}px`, bottom: '' } : { top: '', bottom: `${window.innerHeight - r.top + 14}px` });
  } else {
    hole.style.display = 'none';
    Object.assign(card.style, { top: '30%', bottom: '' });
  }
  card.innerHTML = `<small>Обучение · ${i + 1} из ${list.length}</small><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p>
    <div class="t-nav">
      <button class="btn ghost" data-t="off">Выключить обучение</button>
      <span>${i > 0 ? '<button class="btn ghost" data-t="prev">Назад</button>' : ''}
      <button class="btn primary" data-t="next">${i + 1 < list.length ? 'Далее' : 'Понятно'}</button></span>
    </div>`;
  card.querySelector('[data-t="next"]').onclick = () => { if (tour.i + 1 < tour.list.length) { tour.i++; showStep(); } else endTour(); };
  card.querySelector('[data-t="prev"]')?.addEventListener('click', () => { tour.i--; showStep(); });
  card.querySelector('[data-t="off"]').onclick = () => { const cb = tour.onDisable; endTour(); cb?.(); };
}

/** Тексты тура по экранам. */
export const TOURS = {
  home: [
    { title: 'Добро пожаловать в ТОРО-Ассистент', text: 'Это помощник механика: он подсказывает, что проверить и что делать дальше при обнаружении неисправности. Решение всегда принимаете вы. Всё работает без интернета.' },
    { sel: '#netstate', title: 'Индикатор связи', text: 'Зелёный — есть связь с узлом карьера по pLTE. Серый «Офлайн» — работаем локально, все данные сохраняются на телефоне и уйдут автоматически, когда появится сеть. Число — сколько записей ждут отправки.' },
    { sel: '[data-tour="kpi"]', title: 'Сводка по парку', text: 'Сколько машин в работе, сколько с открытыми дефектами и сколько в аварийном состоянии. Цвет лампы — как на диспетчерском щите.' },
    { sel: '[data-tour="fleet"]', title: 'Плитки машин', text: 'Нажмите на плитку, чтобы открыть карточку машины. Лампа в углу показывает состояние: зелёная — норма, жёлтая — есть открытый дефект, красная — критично.' },
    { sel: '[data-tour="scen"]', title: 'Учебные сценарии', text: 'Готовые ситуации для тренировки: однозначная причина, несколько причин, нехватка данных, критическое состояние. Попробуйте S1 — это самый простой.' },
    { sel: '[data-tour="kb"]', title: 'Справочник', text: 'Поиск по регламентам и инструкциям своими словами, без интернета. Те же документы ассистент показывает как обоснование под каждой причиной.' },
    { sel: '#trainToggle', title: 'Режим обучения', text: 'Кнопка включает и выключает эти подсказки. На каждом экране тур свой. Значок «?» рядом с элементами — короткая справка, работает всегда.' },
  ],
  machine: [
    { sel: '[data-tour="stepper"]', title: 'Шаги работы', text: 'Работа с дефектом идёт в 5 шагов: машина → дефект → анализ → проверки → решение. Текущий шаг подсвечен.' },
    { sel: '[data-tour="passport"]', title: 'Паспорт машины', text: 'Наработка, пробег и сколько осталось до планового ТО. Если ТО скоро — ассистент предложит совместить ремонт с ним, чтобы не ставить машину дважды.' },
    { sel: '[data-tour="mimic"]', title: 'Мнемосхема', text: 'Схема основных систем машины. Цвет блока — состояние по последним параметрам: зелёный — норма, жёлтый — отклонение, красный — авария, серый — нет данных.' },
    { sel: '[data-tour="gauges"]', title: 'Приборы', text: 'Последние значения из диспетчерской системы. Цветная дуга — зоны норма/предупреждение/авария по регламенту для этой модели.' },
    { sel: '#newDefect', title: 'Зарегистрировать дефект', text: 'Нажмите, когда обнаружили неисправность при ЕТО или по жалобе водителя. Параметры подтянутся автоматически.' },
    { sel: '[data-tour="history"]', title: 'История', text: 'Прошлые отказы этой машины. Ассистент сам ищет похожие случаи — по этой и по другим машинам той же модели.' },
  ],
  defect: [
    { sel: '[data-tour="symptoms"]', title: 'Что обнаружено', text: 'Отметьте один или несколько признаков. Кнопки крупные — можно нажимать в перчатках. Симптомы сгруппированы по системам.' },
    { sel: '[data-tour="params"]', title: 'Фактические параметры', text: 'Метка «авто» — значение пришло из диспетчерской системы, «замер» — вводите вручную. Пустые поля оставляйте пустыми: ассистент сам скажет, какой замер действительно нужен.' },
    { sel: '[data-tour="live"]', title: 'Живая мнемосхема', text: 'Пока вы вводите значения, схема сразу подсвечивает системы с отклонениями.' },
    { sel: '#run', title: 'Анализ', text: 'Анализ выполняется прямо на телефоне за доли секунды, без сети.' },
  ],
  analysis: [
    { sel: '.banner', title: 'Вердикт', text: 'Четыре варианта: «Однозначная причина» (зелёный), «Несколько причин» (жёлтый), «Данных недостаточно» (синий), «Критическое состояние» (красный — машину остановить, решение только за ответственным лицом).' },
    { sel: '[data-tour="mimic"]', title: 'Где искать', text: 'На схеме подсвечены системы, в которых вероятнее всего причина. Пунктир — «под подозрением».' },
    { sel: '[data-tour="causes"]', title: 'Возможные причины', text: 'Причины с вероятностью. Нажмите на причину — увидите, какие правила и похожие случаи её подтверждают, и что обычно делать.' },
    { sel: '[data-tour="trace"]', title: 'Почему так решено', text: 'Полная прозрачность: какие параметры, правила и случаи использованы, версия базы правил. Это можно показать старшему механику или надёжнику.' },
    { sel: '[data-tour="next"]', title: 'Дальше', text: 'Если причин несколько или данных мало — переходите к проверкам. Если всё ясно — к решению.' },
  ],
  checks: [
    { sel: '[data-tour="checklist"]', title: 'Что проверить', text: 'Проверки отсортированы: сначала самые быстрые и полезные для выбора между причинами. Время и место (ММО/ПАРМ) указаны.' },
    { sel: '#rerun', title: 'Пересчитать', text: 'Введите результаты и нажмите «Пересчитать». Ассистент обновит вывод — обычно одной-двух проверок достаточно.' },
  ],
  decision: [
    { sel: '[data-tour="decide"]', title: 'Ваше решение', text: 'Выберите подтверждённую причину и действие. При критическом состоянии допуск к работе может дать только старший механик и обязательно с комментарием.' },
    { sel: '[data-tour="sync"]', title: 'Синхронизация', text: 'Решение сразу сохраняется на телефоне в зашифрованном виде. Когда появится связь, оно уйдёт на узел карьера и дальше — сообщением в систему ТОРО.' },
  ],
  kb: [
    { sel: '[data-tour="kbsearch"]', title: 'Поиск по документации', text: 'Напишите, что видите, — например «пена в баке». Поиск идёт по локальной копии документов на телефоне.' },
  ],
  sync: [
    { sel: '[data-tour="syncpanel"]', title: 'Служебная панель', text: 'Версия базы правил, очередь отправки и ручная синхронизация. Галочка «Имитировать отсутствие связи» — для тренировки работы в зоне без pLTE.' },
    { sel: '[data-tour="journal"]', title: 'Журнал событий', text: 'Каждое действие фиксируется: кто, когда, что сделал и какая версия правил использовалась. Это требование промышленной безопасности.' },
  ],
};
