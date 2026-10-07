// ТОРО-Ассистент — прототип Android-клиента (PWA) в стиле SCADA-панели.
// 5 экранов по п. 5.6 ТЗ: 1) карточка машины 2) дефект и параметры 3) результат анализа
// 4) дополнительные проверки 5) решение специалиста и статус синхронизации.
// + обзор парка, служебная панель, режим обучения.

import { analyze, STATUS } from '/core/engine.js';
import { RULEBASE } from '/core/rules.js';
import { PARAMS, SYMPTOMS, MODELS, PROFILES, CAUSES, ELECTRIC_DRIVE } from '/core/catalog.js';
import { MACHINES, HISTORY, SCENARIOS } from '/core/demo-data.js';
import { search as kbSearch, docsForCause } from '/core/knowledge.js';
import { neuralRanker } from '/core/nn.js';
import { NN_MODEL } from '/core/model/nn-model.js';
import * as db from './db.js';
import { syncNow, startAutoSync, isOnline } from './sync.js';
import { esc, gauge, mimic, legend, systemStates, silhouette, stepper, hint, startTour, endTour, TOURS, paramState } from './ui.js';

const USERS = [
  { id: 'mech-1042', title: 'Механик ОТК (таб. 1042)', role: 'MECHANIC' },
  { id: 'smech-0311', title: 'Старший механик (таб. 0311)', role: 'SENIOR_MECHANIC' },
];
const STATUS_UI = {
  CLEAR: { cls: 'ok', label: 'Однозначная причина', icon: '1' },
  MULTIPLE: { cls: 'warn', label: 'Несколько вероятных причин', icon: '≈' },
  INSUFFICIENT: { cls: 'info', label: 'Данных недостаточно', icon: '?' },
  CRITICAL: { cls: 'crit', label: 'Критическое состояние', icon: '!' },
};
const SYMPTOM_GROUPS = [
  ['ДВС и охлаждение', ['POWER_LOSS', 'BLACK_SMOKE', 'OVERHEAT_ENGINE', 'COOLANT_LEAK']],
  ['Гидросистема', ['HYDRAULIC_LEAK', 'OVERHEAT_HYDRAULIC', 'SLOW_WORK_EQUIPMENT', 'JERKS_COMBINED', 'BOOM_DRIFT']],
  ['Ходовая, тормоза, рулевое', ['BRAKE_WEAK', 'TIRE_PRESSURE_LOW', 'STEERING_PLAY']],
  ['Электрика и конструкция', ['PROTECTION_TRIP', 'CRACK']],
];
const MANUAL_DEFAULT = ['hydraulicOilTemp', 'intakeRestriction', 'brakePressure', 'externalLeak', 'faultCode'];

const $app = document.getElementById('app');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const pct = (p) => `${Math.round(p * 100)}%`;
const limitsOf = (m) => PROFILES[MODELS[m.model]].limits;
const toured = new Set();
let currentScreen = 'home';

// ---------- Инициализация ----------
async function init() {
  if (!(await db.getMeta('seeded'))) {
    await db.putMany('machines', MACHINES);
    await db.putMany('history', HISTORY);
    await db.setMeta('rulebase', RULEBASE);
    await db.setMeta('deviceId', `dev-${db.uuid().slice(0, 8)}`);
    await db.setMeta('user', USERS[0].id);
    await db.setMeta('seeded', true);
    await db.log('DEVICE_INITIALIZED', { rulebaseVersion: RULEBASE.version });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  startAutoSync(() => refreshStatusBar());
  window.addEventListener('hashchange', route);
  await route();
  if (!(await db.getMeta('welcomed'))) showWelcome();
}

const currentUser = async () => {
  const id = await db.getMeta('user');
  return USERS.find((u) => u.id === id) ?? USERS[0];
};
const rulebase = async () => (await db.getMeta('rulebase')) ?? RULEBASE;
const training = () => db.getMeta('training', false);

function showWelcome() {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-card">
    <div class="brand big"><span class="logo">ТА</span><b>ТОРО-Ассистент</b></div>
    <p>Помощник механика при диагностике самоходной техники. Подсказывает, <b>что проверить</b> и <b>что делать дальше</b>. Работает без интернета. Окончательное решение всегда за специалистом.</p>
    <button class="btn primary big" id="wTrain">🎓 Начать с обучением</button>
    <button class="btn ghost" id="wSkip">Я уже знаком, пропустить</button></div>`;
  document.body.appendChild(m);
  const close = async (train) => {
    m.remove();
    await db.setMeta('welcomed', true);
    await db.setMeta('training', train);
    await db.log(train ? 'TRAINING_ON' : 'TRAINING_SKIPPED');
    await route();
  };
  m.querySelector('#wTrain').onclick = () => close(true);
  m.querySelector('#wSkip').onclick = () => close(false);
}

async function refreshStatusBar() {
  const el = document.getElementById('netstate');
  if (!el) return;
  const online = await isOnline();
  const queue = (await db.all('outbox')).length;
  el.className = `net ${online ? 'online' : 'offline'}`;
  el.innerHTML = `<i class="lamp ${online ? 'l-ok' : 'l-idle'}"></i>${online ? 'pLTE' : 'Офлайн'}<small>${queue ? ` · ${queue} в очереди` : ''}</small>`;
}

async function layout(screen, title, body, { back } = {}) {
  currentScreen = screen;
  endTour();
  const tr = await training();
  document.body.classList.toggle('training', tr);
  $app.innerHTML = `
    <header class="top">
      ${back ? `<a class="back" href="${back}" aria-label="Назад">‹</a>` : '<span class="logo">ТА</span>'}
      <h1>${esc(title)}</h1>
      <button id="trainToggle" class="icon-btn ${tr ? 'on' : ''}" title="Режим обучения" aria-label="Режим обучения">🎓</button>
      <a href="#/sync" id="netstate" class="net">…</a>
    </header>
    <main>${body}</main>`;
  document.getElementById('trainToggle').onclick = async () => {
    const on = !(await training());
    await db.setMeta('training', on);
    await db.log(on ? 'TRAINING_ON' : 'TRAINING_OFF');
    toured.clear();
    await route();
  };
  if (tr) {
    $app.querySelectorAll('details.hint').forEach((d) => (d.open = true));
    if (!toured.has(screen) && TOURS[screen]) {
      toured.add(screen);
      setTimeout(() => startTour(TOURS[screen], { onDisable: async () => { await db.setMeta('training', false); await route(); } }), 150);
    }
  }
  refreshStatusBar();
  window.scrollTo(0, 0);
}

// ---------- Маршрутизация ----------
async function route() {
  const [, screen, id] = (location.hash || '#/').split('/');
  try {
    if (!screen) return await screenHome();
    if (screen === 'machine') return await screenMachine(id);
    if (screen === 'defect') return await screenDefect(id);
    if (screen === 'analysis') return await screenAnalysis(id);
    if (screen === 'checks') return await screenChecks(id);
    if (screen === 'decision') return await screenDecision(id);
    if (screen === 'sync') return await screenSync();
    if (screen === 'kb') return await screenKb(id);
    location.hash = '#/';
  } catch (e) {
    await layout('error', 'Ошибка', `<div class="panel crit">${esc(e.message)}</div><a class="btn" href="#/">На главную</a>`);
    console.error(e);
  }
}

// ---------- Сигналы (аварийно-предупредительная сигнализация) ----------
// Приоритет 1 — критично, 2 — требует действия, 3 — к сведению. Новые сигналы мигают до квитирования.
const NN = neuralRanker(NN_MODEL);
const FLEET_COLS = [
  ['coolantTemp', 'ОЖ', '°C'], ['hydraulicPressure', 'Гидр.', 'МПа'], ['tirePressure', 'Шины', 'бар'],
];

async function collectAlarms(machines, defects, analyses) {
  const alarms = [];
  for (const m of machines) {
    const lim = limitsOf(m);
    for (const [k, v] of Object.entries(telemetryFor(m.id))) {
      const st = paramState(k, v, lim[k]);
      if (st === 'warn' || st === 'crit') {
        alarms.push({ key: `tele:${m.id}:${k}`, level: st, prio: st === 'crit' ? 1 : 2, machineId: m.id,
          text: `${PARAMS[k].label}: ${v} ${PARAMS[k].unit}`, sub: 'Отклонение по данным диспетчерской системы', href: `#/machine/${m.id}` });
      }
    }
    const toTO = m.nextServiceAt - m.engineHours;
    if (toTO <= 150) {
      alarms.push({ key: `to:${m.id}:${m.nextServiceAt}`, level: 'info', prio: 3, machineId: m.id,
        text: `До ${m.serviceType}: ${toTO} м·ч`, sub: 'Совместить устранение дефектов с плановым ТО', href: `#/machine/${m.id}` });
    }
  }
  for (const d of defects.filter((x) => x.status !== 'DECIDED')) {
    const a = analyses.find((x) => x.id === d.analyses.at(-1));
    const r = a?.result;
    const top = r?.causes[0]?.title;
    const base = { machineId: d.machineId, since: d.createdAt };
    if (!r) alarms.push({ ...base, key: `def:${d.id}:new`, level: 'info', prio: 3, text: 'Дефект зарегистрирован, анализ не выполнен', sub: d.symptoms.map((s) => SYMPTOMS[s]).join(', '), href: `#/defect/${d.id}` });
    else if (r.status === 'CRITICAL') alarms.push({ ...base, key: `def:${d.id}:crit`, level: 'crit', prio: 1, text: 'Эксплуатация запрещена до решения ответственного лица', sub: r.critical.map((c) => c.reason).join('; '), href: `#/decision/${d.id}` });
    else if (r.status === 'INSUFFICIENT') alarms.push({ ...base, key: `def:${d.id}:insuf`, level: 'warn', prio: 2, text: `Нужны замеры: ${r.checks.length}`, sub: r.checks.map((c) => c.title).slice(0, 2).join('; '), href: `#/checks/${d.id}` });
    else if (r.status === 'MULTIPLE') alarms.push({ ...base, key: `def:${d.id}:multi`, level: 'warn', prio: 2, text: 'Несколько причин — выполнить проверки', sub: r.causes.slice(0, 2).map((c) => `${c.title} ${pct(c.prob)}`).join(' / '), href: `#/checks/${d.id}` });
    else alarms.push({ ...base, key: `def:${d.id}:clear`, level: 'info', prio: 3, text: `Ожидает решения: ${top}`, sub: 'Причина установлена', href: `#/decision/${d.id}` });
  }
  const acks = await db.getMeta('acks', {});
  for (const al of alarms) al.ackAt = acks[al.key] ?? null;
  return alarms.sort((a, b) => a.prio - b.prio || (a.ackAt ? 1 : 0) - (b.ackAt ? 1 : 0));
}

const worstLevel = (list) => (list.some((a) => a.level === 'crit') ? 'crit' : list.some((a) => a.level === 'warn') ? 'warn' : list.some((a) => a.level === 'info') ? 'info' : 'ok');

// ---------- Обзор: всё для отслеживания на одном экране ----------
async function screenHome() {
  const machines = await db.all('machines');
  const defects = await db.all('defects');
  const analyses = await db.all('analyses');
  const alarms = await collectAlarms(machines, defects, analyses);
  const user = await currentUser();
  const rb = await rulebase();
  const queue = (await db.all('outbox')).length;
  const online = await isOnline();
  const lastSync = await db.getMeta('lastSync');
  const byMachine = Object.fromEntries(machines.map((m) => [m.id, alarms.filter((a) => a.machineId === m.id)]));
  const crit = machines.filter((m) => worstLevel(byMachine[m.id]) === 'crit').length;
  const attention = machines.filter((m) => worstLevel(byMachine[m.id]) === 'warn').length;
  const waiting = defects.filter((d) => d.status !== 'DECIDED').length;
  const unack = alarms.filter((a) => a.level !== 'info' && !a.ackAt).length;

  await layout('home', 'Обзор', `
    <section class="status-strip" data-tour="status">
      <div class="${online ? '' : 'st-warn'}"><small>Связь</small><b>${online ? 'pLTE, есть' : 'Офлайн'}</b></div>
      <div class="${queue ? 'st-warn' : ''}"><small>Очередь</small><b>${queue} зап.</b></div>
      <div><small>Синхронизация</small><b>${fmtDate(lastSync)}</b></div>
      <div><small>Правила</small><b>v${esc(rb.version)}</b></div>
      <div class="${NN ? '' : 'st-warn'}"><small>Нейросеть</small><b>${NN ? `v${esc(NN.meta.version)}` : 'отключена'}</b></div>
      <div><small>Пользователь</small><b>${esc(user.title)}</b></div>
    </section>

    <section class="kpis" data-tour="kpi">
      <div class="kpi"><b>${machines.length}</b><span>машин</span></div>
      <div class="kpi ${crit ? 'st-crit' : ''}"><b>${crit}</b><span>критично</span></div>
      <div class="kpi ${attention ? 'st-warn' : ''}"><b>${attention}</b><span>требуют внимания</span></div>
      <div class="kpi"><b>${waiting}</b><span>ждут решения</span></div>
    </section>

    <h2>Активные сигналы · ${alarms.length}${unack ? ` · не квитировано ${unack}` : ''} ${hint('Сверху — самое важное. Мигающая полоса — новый сигнал: нажмите «Квитировать», чтобы подтвердить, что вы его видели. Нажмите на текст сигнала, чтобы перейти к машине или дефекту.')}</h2>
    <section class="alarms" data-tour="alarms">${alarms.map((a) => `
      <div class="alarm ${a.level} ${!a.ackAt && a.level !== 'info' ? 'unack' : ''}">
        <span class="sev"></span>
        <a class="body" href="${a.href}"><b>${esc(a.machineId)}</b>${esc(a.text)}<small>${esc(a.sub ?? '')}${a.since ? ` · ${fmtDate(a.since)}` : ''}</small></a>
        ${a.level === 'info' ? '' : a.ackAt ? `<span class="acked">квит. ${fmtDate(a.ackAt)}</span>` : `<button class="ack" data-ack="${esc(a.key)}">Квитировать</button>`}
      </div>`).join('') || '<div class="empty">Активных сигналов нет. Все машины в норме.</div>'}
    </section>

    <h2>Состояние парка ${hint('Значения в норме — обычным шрифтом. Цветом выделено только то, что вышло за порог. «—» — параметр не контролируется для этой техники.')}</h2>
    <section class="fleet" data-tour="fleet">
      ${machines.map((m) => {
        const lim = limitsOf(m);
        const tele = telemetryFor(m.id);
        const lvl = worstLevel(byMachine[m.id]);
        const toTO = m.nextServiceAt - m.engineHours;
        const open = defects.filter((d) => d.machineId === m.id && d.status !== 'DECIDED');
        const defLvl = worstLevel(byMachine[m.id].filter((a) => a.key.startsWith('def:')));
        return `<a class="frow" href="#/machine/${m.id}">
          <i class="lamp l-${lvl === 'info' ? 'ok' : lvl} ${lvl === 'crit' && byMachine[m.id].some((a) => a.level === 'crit' && !a.ackAt) ? 'blink' : ''}"></i>
          <span class="id"><b>${esc(m.id)}</b><small>${esc(m.model)}</small></span>
          <div class="vals">
            ${fleetCols(m, lim, tele)}
            <span class="val ${toTO <= 150 ? 'st-info' : ''}">${toTO}<small>до ТО, м·ч</small></span>
            <span class="val ${open.length ? `st-${defLvl === 'ok' ? 'info' : defLvl}` : 'na'}">${open.length || '—'}<small>дефекты</small></span>
          </div></a>`;
      }).join('')}
    </section>

    <a class="btn" href="#/kb" data-tour="kb">Справочник по технической документации</a>

    <details class="demo"><summary>Демо-сценарии и настройки</summary>
      <section class="scen" data-tour="scen">${SCENARIOS.map((s) => `
        <button class="scen-btn" data-scen="${s.id}"><b>${s.id}</b><span>${esc(s.title)}</span><small>${esc(s.note)}</small></button>`).join('')}
      </section>
      <label class="lbl">Пользователь устройства ${hint('В промышленной версии — вход по служебной карте/ПИН. Допуск машины в критическом состоянии — только у старшего механика.')}</label>
      <select id="user" class="big">${USERS.map((u) => `<option value="${u.id}" ${u.id === user.id ? 'selected' : ''}>${esc(u.title)}</option>`).join('')}</select>
      <a class="btn ghost" href="#/sync">Связь, журнал событий, версии</a>
    </details>`);
  document.getElementById('user').onchange = async (e) => {
    await db.setMeta('user', e.target.value);
    await db.log('USER_SWITCHED', { to: e.target.value });
    route();
  };
  $app.querySelectorAll('[data-scen]').forEach((b) => (b.onclick = () => startScenario(b.dataset.scen)));
  $app.querySelectorAll('[data-ack]').forEach((b) => (b.onclick = async () => {
    const acks = await db.getMeta('acks', {});
    acks[b.dataset.ack] = new Date().toISOString();
    await db.setMeta('acks', acks);
    await db.log('ALARM_ACKNOWLEDGED', { key: b.dataset.ack });
    route();
  }));
}

function fleetCols(m, lim, tele) {
  return FLEET_COLS.map(([k, l, u]) => {
    const cap = `<small>${l}, ${u}</small>`;
    if (!lim[k]) return `<span class="val na">—${cap}</span>`;
    const v = tele[k];
    if (v === undefined) return `<span class="val na">н/д${cap}</span>`;
    const st = paramState(k, v, lim[k]);
    return `<span class="val ${st === 'warn' || st === 'crit' ? `st-${st}` : ''}">${v}${cap}</span>`;
  }).join('');
}

async function startScenario(id) {
  const s = SCENARIOS.find((x) => x.id === id);
  const defect = await createDefect(s.machineId, { symptoms: s.defect.symptoms, comment: s.defect.comment, params: s.params, scenarioId: s.id });
  location.hash = `#/defect/${defect.id}`;
}

function telemetryFor(machineId) {
  // Имитация кэша последних данных диспетчерской системы (только автоматические параметры).
  const s = SCENARIOS.find((x) => x.machineId === machineId);
  return Object.fromEntries(Object.entries(s?.params ?? {}).filter(([k]) => PARAMS[k]?.source === 'WENCO'));
}

async function createDefect(machineId, { symptoms = [], comment = '', params, scenarioId = null } = {}) {
  const defect = {
    id: db.uuid(), machineId, symptoms, comment, scenarioId,
    params: params ?? telemetryFor(machineId),
    createdAt: new Date().toISOString(), status: 'OPEN', analyses: [],
  };
  await db.put('defects', defect);
  await db.log('DEFECT_CREATED', { defectId: defect.id, machineId, scenarioId });
  return defect;
}

const machineHead = (m) => `<section class="mhead">${silhouette(MODELS[m.model])}<div><b>${esc(m.id)}</b><span>${esc(m.model)}</span><small>${esc(m.location)}</small></div></section>`;

// ---------- Экран 1: карточка машины ----------
async function screenMachine(id) {
  const m = await db.get('machines', id);
  if (!m) throw new Error('Машина не найдена в локальной БД');
  const history = (await db.all('history')).filter((h) => h.machineId === id).sort((a, b) => b.date.localeCompare(a.date));
  const defects = (await db.all('defects')).filter((d) => d.machineId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const toService = m.nextServiceAt - m.engineHours;
  const tele = telemetryFor(id);
  const lim = limitsOf(m);
  await layout('machine', 'Карточка машины', `
    ${stepper(1, 0)}
    ${machineHead(m)}
    <section class="panel passport" data-tour="passport">
      <div class="cell"><small>Наработка ДВС</small><b>${m.engineHours.toLocaleString('ru-RU')}</b><span>м·ч</span></div>
      ${m.mileage ? `<div class="cell"><small>Пробег</small><b>${m.mileage.toLocaleString('ru-RU')}</b><span>км</span></div>` : ''}
      <div class="cell ${toService <= 150 ? 'st-info' : ''}"><small>До ${esc(m.serviceType)}</small><b>${toService}</b><span>м·ч</span></div>
    </section>
    <section class="panel" data-tour="mimic"><h3>Мнемосхема систем ${hint('Цвет блока — состояние системы по последним параметрам.')}</h3>
      ${mimic(systemStates(tele, lim), { electric: ELECTRIC_DRIVE.has(m.model) })}${legend()}</section>
    <section class="panel" data-tour="gauges"><h3>Приборы <small>кэш диспетчерской системы</small></h3>
      <div class="gauges">${Object.entries(tele).filter(([k]) => k !== 'ambientTemp').map(([k, v]) => gauge(k, v, lim[k])).join('') || '<p class="muted">Нет данных</p>'}</div>
      ${tele.ambientTemp !== undefined ? `<p class="muted">Температура воздуха: ${tele.ambientTemp} °C</p>` : ''}</section>
    <button class="btn primary big" id="newDefect">+ Зарегистрировать дефект</button>
    ${defects.length ? `<h2>Дефекты на устройстве</h2><ul class="list">${defects.map((d) => `<li><a class="row" href="#/${d.status === 'DECIDED' ? 'decision' : d.analyses.length ? 'analysis' : 'defect'}/${d.id}">
      <span>${d.symptoms.map((s) => esc(SYMPTOMS[s])).join(', ') || 'без симптомов'}<br><small>${fmtDate(d.createdAt)}</small></span>
      <span class="badge ${d.status === 'DECIDED' ? 'ok' : 'warn'}">${d.status === 'DECIDED' ? 'решено' : 'открыт'}</span></a></li>`).join('')}</ul>` : ''}
    <h2>История отказов</h2>
    <ul class="list" data-tour="history">${history.map((h) => `<li class="row"><span>${esc(CAUSES[h.cause]?.title)}<br><small>${h.date} · ${h.symptoms.map((s) => esc(SYMPTOMS[s])).join(', ')}</small></span><span class="badge">${h.downtimeH} ч</span></li>`).join('') || '<li class="muted">История пуста</li>'}</ul>`,
  { back: '#/' });
  document.getElementById('newDefect').onclick = async () => {
    const d = await createDefect(id);
    location.hash = `#/defect/${d.id}`;
  };
}

// ---------- Экран 2: карточка дефекта и фактические параметры ----------
async function screenDefect(id) {
  const d = await db.get('defects', id);
  const m = await db.get('machines', d.machineId);
  const lim = limitsOf(m);
  const keys = [...new Set([...Object.keys(PARAMS).filter((k) => PARAMS[k].source === 'WENCO' && k !== 'engineHours' && k !== 'mileage'), ...MANUAL_DEFAULT, ...Object.keys(d.params)])]
    .filter((k) => relevantParam(k, lim));
  await layout('defect', 'Дефект и параметры', `
    ${stepper(2)}
    ${machineHead(m)}
    <h2>Что обнаружено ${hint('Отметьте все замеченные признаки. Можно несколько.')}</h2>
    <section data-tour="symptoms">${SYMPTOM_GROUPS.map(([g, list]) => `<div class="sgroup"><small>${esc(g)}</small><div class="chips">
      ${list.map((k) => `<button class="chip ${d.symptoms.includes(k) ? 'on' : ''}" data-sym="${k}">${esc(SYMPTOMS[k])}</button>`).join('')}</div></div>`).join('')}
    </section>
    <section class="panel" data-tour="live"><h3>Живая мнемосхема</h3><div id="liveMimic"></div></section>
    <h2>Фактические параметры ${hint('«авто» — пришло из диспетчерской системы; «замер» — введите, если измеряли. Не знаете — оставьте пустым.')}</h2>
    <section class="panel params" data-tour="params">${keys.map((k) => paramInput(k, d.params[k], lim)).join('')}</section>
    <label class="lbl">Комментарий ${hint('Можно надиктовать голосом через микрофон на клавиатуре телефона.')}</label>
    <textarea id="comment" class="big" rows="2" placeholder="Например: «не тянет на подъёме»">${esc(d.comment)}</textarea>
    <button class="btn primary big" id="run">▶ Анализировать</button>`,
  { back: `#/machine/${m.id}` });
  const redraw = () => { document.getElementById('liveMimic').innerHTML = mimic(systemStates(readParams(), lim), { electric: ELECTRIC_DRIVE.has(m.model) }); };
  redraw();
  $app.querySelectorAll('[data-sym]').forEach((b) => (b.onclick = () => b.classList.toggle('on')));
  $app.querySelectorAll('input[data-p]').forEach((i) => i.addEventListener('input', () => { markInput(i, lim); redraw(); }));
  $app.querySelectorAll('input[data-p]').forEach((i) => markInput(i, lim));
  document.getElementById('run').onclick = async () => {
    d.symptoms = [...$app.querySelectorAll('[data-sym].on')].map((b) => b.dataset.sym);
    d.params = readParams();
    d.comment = document.getElementById('comment').value;
    await runAnalysis(d);
  };
}

// Параметр показывается, если для класса техники есть пороги или он не привязан к классу (расход, t воздуха, код…).
const LIMITED = new Set(Object.values(PROFILES).flatMap((pr) => Object.keys(pr.limits)));
const relevantParam = (k, lim) => Boolean(lim[k]) || !LIMITED.has(k);

function markInput(i, lim) {
  const k = i.dataset.p;
  const v = i.value === '' ? undefined : Number(i.value.replace(',', '.'));
  i.closest('.prm').dataset.state = PARAMS[k].text ? (i.value ? 'ok' : 'idle') : paramState(k, v, lim[k]);
}

function paramInput(k, v, lim) {
  const p = PARAMS[k];
  const l = lim[k];
  const norm = l ? Object.entries(l).map(([n, x]) => `${{ warn: 'предупр.', crit: 'авария', min: 'мин.', max: 'макс.', nom: 'номинал' }[n] ?? n} ${x}`).join(' · ') : '';
  const src = `<span class="src ${p.source === 'WENCO' ? 'auto' : 'man'}">${p.source === 'WENCO' ? 'авто' : 'замер'}</span>`;
  if (p.bool) {
    return `<div class="prm" data-state="${v === undefined ? 'idle' : 'ok'}"><label><i class="lamp"></i>${esc(p.label)} ${src}</label>
      <div class="seg" data-p="${k}" data-kind="bool">
        <button class="${v === true ? 'on' : ''}" data-v="true">Да</button>
        <button class="${v === false ? 'on' : ''}" data-v="false">Нет</button>
        <button class="${v === undefined ? 'on' : ''}" data-v="">Не проверял</button></div></div>`;
  }
  return `<div class="prm"><label><i class="lamp"></i>${esc(p.label)}${p.unit ? `, ${esc(p.unit)}` : ''} ${src}</label>
    <input class="big" data-p="${k}" ${p.text ? 'type="text" autocapitalize="characters"' : 'type="number" inputmode="decimal" step="0.1"'} value="${esc(v ?? '')}" placeholder="не измерено">
    ${norm ? `<small class="muted">${esc(norm)}</small>` : ''}</div>`;
}

function readParams() {
  const out = {};
  $app.querySelectorAll('input[data-p]').forEach((i) => {
    if (i.value === '') return;
    out[i.dataset.p] = PARAMS[i.dataset.p].text ? i.value.trim() : Number(i.value.replace(',', '.'));
  });
  $app.querySelectorAll('.seg[data-kind="bool"]').forEach((s) => {
    const on = s.querySelector('.on')?.dataset.v;
    if (on === 'true' || on === 'false') out[s.dataset.p] = on === 'true';
  });
  return out;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.seg button');
  if (!b) return;
  b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  const prm = b.closest('.prm');
  if (prm) prm.dataset.state = b.dataset.v === '' ? 'idle' : 'ok';
});

async function runAnalysis(d) {
  const m = await db.get('machines', d.machineId);
  const history = await db.all('history');
  const rb = await rulebase();
  const result = analyze({ machine: m, defect: d, params: d.params, history, rulebase: rb }, NN);
  const a = { id: db.uuid(), defectId: d.id, createdAt: new Date().toISOString(), params: { ...d.params }, symptoms: [...d.symptoms], result };
  await db.put('analyses', a);
  d.analyses.push(a.id);
  await db.put('defects', d);
  await db.log('ANALYSIS_DONE', { defectId: d.id, analysisId: a.id, status: result.status, rulebaseVersion: rb.version, top: result.causes[0]?.id ?? null });
  const target = `#/analysis/${d.id}`;
  if (location.hash === target) await route();
  else location.hash = target;
}

const lastAnalysis = (d) => db.get('analyses', d.analyses.at(-1));

const banner = (r) => {
  const ui = STATUS_UI[r.status];
  return `<div class="banner ${ui.cls}"><span class="b-icon">${ui.icon}</span><div><small>${ui.label}</small><b>${esc(r.recommendation.headline)}</b><p>${esc(r.recommendation.text)}</p></div></div>`;
};

// ---------- Экран 3: результат анализа ----------
async function screenAnalysis(id) {
  const d = await db.get('defects', id);
  const a = await lastAnalysis(d);
  if (!a) { location.hash = `#/defect/${id}`; return; }
  const m = await db.get('machines', d.machineId);
  const r = a.result;
  await layout('analysis', 'Результат анализа', `
    ${stepper(3)}
    ${banner(r)}
    ${r.serviceHint ? `<div class="panel info">${esc(r.serviceHint)}</div>` : ''}
    ${r.warnings.map((w) => `<div class="panel warn">${esc(w)}</div>`).join('')}
    <section class="panel" data-tour="mimic"><h3>Где искать причину</h3>${mimic(systemStates(a.params, limitsOf(m), r), { electric: ELECTRIC_DRIVE.has(m.model) })}${legend()}</section>
    <h2>Возможные причины ${hint('Нажмите на причину, чтобы увидеть доказательства и типовое действие.')}</h2>
    <section data-tour="causes">${r.causes.slice(0, 5).map((c, i) => `<details class="cause ${i === 0 ? 'lead' : ''}"><summary>
        <span class="ct">${esc(c.title)}<small>${esc(c.system)}</small></span><b>${pct(c.prob)}</b>
        <span class="bar"><i style="width:${pct(c.prob)}"></i></span></summary>
        <ul>${c.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        <p class="act">Действие: <b>${esc(CAUSES[c.id].action)}</b><br>Место: ${esc(CAUSES[c.id].place)} · ориентировочно ${CAUSES[c.id].repairH} ч</p>
        ${docsForCause(c.id).map((k) => `<div class="kbref"><b>${esc(k.title)}</b><small>${esc(k.source)}</small><p>${esc(k.text)}</p></div>`).join('')}
      </details>`).join('') || '<p class="muted">Гипотез пока нет — нужны данные.</p>'}</section>
    <details class="panel trace" data-tour="trace"><summary>Почему так решено (на основании каких данных)</summary>
      <p><b>Симптомы:</b> ${r.trace.symptoms.map(esc).join(', ') || '—'}</p>
      <p><b>Параметры:</b> ${r.trace.paramsUsed.map((p) => `${esc(p.label)} = ${esc(p.value)} ${esc(p.unit)} (${p.source === 'WENCO' ? 'авто' : 'замер'})`).join('; ') || '—'}</p>
      <p><b>Сработавшие правила:</b> ${r.trace.firedRules.join(', ') || '—'}</p>
      <p><b>Ожидают замера:</b> ${r.trace.pendingRules.map((p) => p.ruleId).join(', ') || '—'}</p>
      <p><b>Похожие случаи:</b> ${r.trace.similarCases.map((c) => `${c.id} (${c.machineId}, ${esc(CAUSES[c.cause].title)}, сходство ${c.sim})`).join('; ') || '—'}</p>
      <p><b>База правил:</b> v${esc(r.trace.rulebaseVersion)} · движок ${esc(r.trace.engine)} · сила доказательств ${r.trace.evidenceStrength}</p>
      ${r.trace.ml ? `<p><b>Нейросеть:</b> ${esc(r.trace.ml.name)} v${esc(r.trace.ml.version)} · ${r.trace.ml.params} параметров · вывод ${r.trace.ml.inferenceMs} мс на устройстве ·
        оценка: ${r.trace.ml.top.map(([c, p]) => `${esc(CAUSES[c].title)} ${pct(p)}`).join('; ')}.
        <br><small>Нейросеть влияет только на порядок причин. Статусы «критично» и «данных недостаточно» определяют проверяемые правила.</small></p>` : ''}
      <p><small>Анализ №${d.analyses.length} от ${fmtDate(a.createdAt)}. Выполнен на устройстве, без сети.</small></p>
    </details>
    <div class="actions" data-tour="next">
      ${r.checks.length ? `<a class="btn ${r.status === STATUS.CLEAR ? '' : 'primary'} big" href="#/checks/${d.id}">Доп. проверки (${r.checks.length}) →</a>` : ''}
      <a class="btn ${r.status === STATUS.CLEAR || r.status === STATUS.CRITICAL || !r.checks.length ? 'primary' : ''} big" href="#/decision/${d.id}">К решению →</a>
      <a class="btn ghost" href="#/defect/${d.id}">Изменить данные</a>
    </div>`,
  { back: `#/machine/${d.machineId}` });
}

// ---------- Экран 4: необходимые дополнительные проверки ----------
async function screenChecks(id) {
  const d = await db.get('defects', id);
  const a = await lastAnalysis(d);
  const m = await db.get('machines', d.machineId);
  const lim = limitsOf(m);
  const scen = SCENARIOS.find((s) => s.id === d.scenarioId);
  const total = a.result.checks.reduce((s, c) => s + c.minutes, 0);
  await layout('checks', 'Доп. проверки', `
    ${stepper(4)}
    <div class="panel info">Ассистент просит выполнить ${a.result.checks.length} провер${a.result.checks.length === 1 ? 'ку' : 'ки'} (~${total} мин). Сначала — самые быстрые и полезные.</div>
    <section data-tour="checklist">${a.result.checks.map((c, i) => `<section class="panel check">
      <div class="ck"><span class="num">${i + 1}</span><div><b>${esc(c.title)}</b>
      <small>⏱ ~${c.minutes} мин · 📍 ${esc(c.place)}</small><small class="muted">${c.reasons.map(esc).join('; ')}</small></div></div>
      ${paramInput(c.param, d.params[c.param], lim)}
    </section>`).join('') || '<p class="muted">Дополнительных проверок не требуется.</p>'}</section>
    ${scen?.followUp ? '<button class="btn ghost" id="fill">Демо: подставить результаты замеров</button>' : ''}
    <button class="btn primary big" id="rerun">↻ Пересчитать анализ</button>`,
  { back: `#/analysis/${id}` });
  $app.querySelectorAll('input[data-p]').forEach((i) => { markInput(i, lim); i.addEventListener('input', () => markInput(i, lim)); });
  document.getElementById('fill')?.addEventListener('click', () => {
    for (const [k, v] of Object.entries(scen.followUp)) {
      const inp = $app.querySelector(`input[data-p="${k}"]`);
      if (inp) { inp.value = v; markInput(inp, lim); }
      const seg = $app.querySelector(`.seg[data-p="${k}"]`);
      seg?.querySelector(`button[data-v="${v}"]`)?.click();
    }
  });
  document.getElementById('rerun').onclick = async () => {
    const entered = readParams();
    d.params = { ...d.params, ...entered };
    await db.log('CHECKS_ENTERED', { defectId: d.id, params: Object.keys(entered) });
    await runAnalysis(d);
  };
}

// ---------- Экран 5: итоговое решение специалиста и статус синхронизации ----------
async function screenDecision(id) {
  const d = await db.get('defects', id);
  const a = await lastAnalysis(d);
  const user = await currentUser();
  const r = a.result;
  const decided = d.decision;
  const queue = await db.all('outbox');
  const lastSync = await db.getMeta('lastSync');
  const online = await isOnline();
  const inQueue = decided && queue.some((q) => q.id === decided.outboxId);
  await layout('decision', 'Решение', `
    ${stepper(5, decided ? 5 : 4)}
    ${banner(r)}
    ${decided ? `<section class="panel ok" data-tour="decide"><h3>✓ Решение принято</h3>
        <div class="kv"><span>Решение</span><b>${esc(decided.title)}</b></div>
        <div class="kv"><span>Причина</span><b>${esc(CAUSES[decided.cause]?.title ?? 'не установлена')}</b></div>
        <div class="kv"><span>Кто</span><b>${esc(decided.userTitle)}</b></div>
        <div class="kv"><span>Когда</span><b>${fmtDate(decided.at)}</b></div>
      </section>` : `
      <section data-tour="decide">
      <p class="sub">Ассистент рекомендует — решает специалист. Вы вошли как: <b>${esc(user.title)}</b></p>
      <label class="lbl">Подтверждённая причина</label>
      <select id="cause" class="big"><option value="">— не установлена —</option>${r.causes.slice(0, 5).map((c, i) => `<option value="${c.id}" ${i === 0 && (r.status === STATUS.CLEAR || r.status === STATUS.CRITICAL) ? 'selected' : ''}>${esc(c.title)} (${pct(c.prob)})</option>`).join('')}</select>
      <label class="lbl">Действие</label>
      <div class="decisions">${r.allowedDecisions.map((x) => {
        const blocked = x.requiresRole && x.requiresRole !== user.role;
        return `<button class="btn dec ${x.id === 'STOP_AND_CALL' ? 'danger' : ''}" data-dec="${x.id}" ${blocked ? 'disabled' : ''}>${esc(x.title)}${blocked ? '<small>🔒 только старший механик</small>' : x.requiresComment ? '<small>нужен комментарий</small>' : ''}</button>`;
      }).join('')}</div>
      <label class="lbl">Комментарий / обоснование</label>
      <textarea id="dcomment" class="big" rows="2"></textarea>
      <div id="derr" class="err" role="alert"></div></section>`}
    <section class="panel sync" data-tour="sync">
      <h3>Статус синхронизации</h3>
      <div class="syncflow">
        <div class="sf ${decided ? 'done' : 'idle'}"><i>📱</i><span>Сохранено на устройстве</span><small>${decided ? 'зашифровано' : 'ожидает решения'}</small></div>
        <div class="sf ${decided && !inQueue ? 'done' : online ? 'wait' : 'idle'}"><i>📡</i><span>Узел карьера</span><small>${decided ? (inQueue ? (online ? 'отправка…' : 'ждёт связи') : 'доставлено') : '—'}</small></div>
        <div class="sf ${decided && !inQueue ? 'done' : 'idle'}"><i>🗂</i><span>Сообщение М2 в ТОРО</span><small>${decided && !inQueue ? 'сформировано' : '—'}</small></div>
      </div>
      <div class="kv"><span>Записей в очереди</span><b>${queue.length}</b></div>
      <div class="kv"><span>Последняя синхронизация</span><b>${fmtDate(lastSync)}</b></div>
      <button class="btn" id="syncBtn">↻ Синхронизировать сейчас</button>
    </section>
    ${decided ? '<a class="btn primary big" href="#/">К обзору парка</a>' : ''}`,
  { back: `#/analysis/${id}` });

  $app.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = async () => {
    const opt = r.allowedDecisions.find((x) => x.id === b.dataset.dec);
    const comment = document.getElementById('dcomment').value.trim();
    if (opt.requiresComment && !comment) {
      document.getElementById('derr').textContent = 'Для этого решения обязателен комментарий-обоснование.';
      document.getElementById('dcomment').focus();
      return;
    }
    if (opt.id === 'MORE_CHECKS') { location.hash = `#/checks/${id}`; return; }
    const cause = document.getElementById('cause').value || null;
    const payload = {
      defectId: d.id, machineId: d.machineId, symptoms: d.symptoms, params: d.params, defectCreatedAt: d.createdAt,
      decision: opt.id, selectedCause: cause, comment, user: user.id, role: user.role,
      analysisStatus: r.status, rulebaseVersion: r.trace.rulebaseVersion, topCauses: r.causes.slice(0, 3).map((c) => c.id),
      agreesWithAgent: cause ? cause === r.causes[0]?.id : null,
    };
    const outboxId = await db.enqueue('DECISION', payload);
    d.decision = { id: opt.id, title: opt.title, cause, userTitle: user.title, at: new Date().toISOString(), outboxId };
    d.status = 'DECIDED';
    await db.put('decisions', { id: outboxId, defectId: d.id, sealed: await db.seal(payload) });
    await db.put('defects', d);
    await db.log('DECISION_CONFIRMED', { defectId: d.id, decision: opt.id, status: r.status, agreesWithAgent: payload.agreesWithAgent });
    await screenDecision(id);
    syncNow().finally(() => currentScreen === 'decision' && screenDecision(id));
  }));
  document.getElementById('syncBtn').onclick = async () => { await syncNow(); screenDecision(id); };
}

// ---------- Справочник: офлайн-поиск по документации ----------
async function screenKb(q = '') {
  const query = decodeURIComponent(q ?? '');
  const res = query ? kbSearch(query) : [];
  await layout('kb', 'Справочник', `
    <p class="sub">Поиск по регламентам и инструкциям — работает без связи. Пишите своими словами.</p>
    <form id="kbForm" data-tour="kbsearch"><input class="big" id="kbq" type="search" value="${esc(query)}" placeholder="например: пена в баке гидравлики" autocomplete="off">
      <button class="btn primary">Найти</button></form>
    <div class="chips" style="margin-top:12px">${['течь РВД', 'давление в шине', 'перегрев ОЖ', 'срабатывание защиты', 'тормоза'].map((t) => `<a class="chip" href="#/kb/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
    ${query ? `<h2>Найдено: ${res.length}</h2>` : ''}
    ${res.map((d) => `<section class="panel kbref"><b>${esc(d.title)}</b><small>${esc(d.source)} · релевантность ${d.score}</small><p>${esc(d.text)}</p>
      <small class="muted">Связано с: ${d.causes.map((c) => esc(CAUSES[c].title)).join('; ')}</small></section>`).join('')}
    ${query && !res.length ? '<p class="muted">Ничего не найдено — попробуйте другие слова.</p>' : ''}`,
  { back: '#/' });
  document.getElementById('kbForm').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/kb/${encodeURIComponent(document.getElementById('kbq').value.trim())}`;
  };
}

// ---------- Служебная панель: синхронизация, правила, журнал ----------
async function screenSync() {
  const queue = await db.all('outbox');
  const journal = await db.journalTail(40);
  const rb = await rulebase();
  const prev = await db.getMeta('rulebasePrevious');
  const forceOffline = await db.getMeta('forceOffline', false);
  await layout('sync', 'Связь и журнал', `
    <section class="panel" data-tour="syncpanel">
      <div class="kv"><span>Устройство</span><b>${esc(await db.getMeta('deviceId'))}</b></div>
      <div class="kv"><span>База правил</span><b>v${esc(rb.version)} · ${rb.rules.length} правил</b></div>
      ${prev ? `<div class="kv"><span>Предыдущая версия</span><b>v${esc(prev.version)}</b></div>` : ''}
      <div class="kv"><span>В очереди</span><b>${queue.length}</b></div>
      <label class="toggle"><input type="checkbox" id="offline" ${forceOffline ? 'checked' : ''}><span>Имитировать отсутствие связи (зона без pLTE)</span></label>
      <button class="btn primary" id="sync">↻ Синхронизировать</button>
      ${prev ? '<button class="btn ghost" id="rollback">Откатить базу правил</button>' : ''}
      <button class="btn ghost" id="replayTour">🎓 Пройти обучение заново</button>
    </section>
    ${queue.length ? `<h2>Очередь отправки</h2><ul class="list">${queue.map((q) => `<li class="row"><span>${esc(q.type)} · ${fmtDate(q.createdAt)}<br><small>попыток: ${q.attempts}${q.lastError ? ` · ${esc(q.lastError)}` : ''} · ${q.sealed.enc ? '🔒 AES-GCM' : 'без шифрования'}</small></span></li>`).join('')}</ul>` : ''}
    <h2>Журнал событий</h2>
    <ul class="list journal" data-tour="journal">${journal.map((j) => `<li><small>${fmtDate(j.ts)} · ${esc(j.user)}</small><b>${esc(j.event)}</b><small class="muted">${esc(JSON.stringify(j.details))}</small></li>`).join('')}</ul>`,
  { back: '#/' });
  document.getElementById('offline').onchange = async (e) => {
    await db.setMeta('forceOffline', e.target.checked);
    await db.log(e.target.checked ? 'OFFLINE_SIMULATION_ON' : 'OFFLINE_SIMULATION_OFF');
    refreshStatusBar();
  };
  document.getElementById('sync').onclick = async () => { await syncNow(); screenSync(); };
  document.getElementById('replayTour').onclick = async () => {
    await db.setMeta('training', true);
    toured.clear();
    location.hash = '#/';
  };
  document.getElementById('rollback')?.addEventListener('click', async () => {
    await db.setMeta('rulebase', prev);
    await db.setMeta('rulebasePrevious', null);
    await db.log('RULES_ROLLED_BACK', { to: prev.version });
    screenSync();
  });
}

init();
