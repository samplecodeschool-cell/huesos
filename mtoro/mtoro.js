// Эмулятор «Мобильного ТОРО»: регистрация М2 → передача в ТОРО-Ассистент → отображение результата.
import { buildHandoffUrl } from '/core/mtoro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const STATUS = { OPEN: 'Открыто', ANALYZED: 'Проанализировано', STOPPED: 'Оборудование остановлено' };
const PRIORITY = { 1: 'очень высокий', 2: 'высокий', 3: 'средний', 4: 'низкий' };

async function api(path, init) {
  const r = await fetch(`/mtoro/api${path}`, { headers: { 'content-type': 'application/json' }, ...init });
  if (!r.ok) throw new Error((await r.json()).error ?? r.status);
  return r.json();
}

async function render() {
  const msgs = await api('/messages');
  document.getElementById('list').innerHTML = msgs.map((m) => `
    <section class="panel msg ${m.status}">
      <div class="row"><span class="mono">М2 №${esc(m.qmnum)} · ${esc(m.equnr)}</span><span class="chip ${m.status}">${STATUS[m.status] ?? m.status}</span></div>
      <div><b>${esc(m.qmtxt)}</b>${m.longText ? `<br>${esc(m.longText)}` : ''}</div>
      <small>${esc(m.author)} · ${fmt(m.createdAt)}${m.priority ? ` · приоритет: ${PRIORITY[m.priority]}` : ''}</small>
      ${m.assistant ? `<div class="res"><b>Результат ТОРО-Ассистента</b> (${fmt(m.assistant.decidedAt)})
${esc(m.assistant.longText)}${m.assistant.causeCode ? `\nКод причины: ${esc(m.assistant.causeCode.group)}/${esc(m.assistant.causeCode.code)}` : ''}${m.assistant.action ? `\nТиповое действие: ${esc(m.assistant.action)}` : ''}</div>`
      : `<a class="btn ghost" href="${esc(buildHandoffUrl('/', m, '/mtoro/'))}">Анализ в ТОРО-Ассистенте →</a>`}
    </section>`).join('') || '<p><small>Сообщений пока нет — создайте первое.</small></p>';
}

async function init() {
  const eq = await api('/equipment');
  document.getElementById('eq').innerHTML = eq.map((e) => `<option value="${esc(e.equnr)}">${esc(e.equnr)} · ${esc(e.model)}</option>`).join('');
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    await api('/messages', { method: 'POST', body: JSON.stringify({
      equnr: document.getElementById('eq').value, qmtxt: document.getElementById('t').value,
      longText: document.getElementById('l').value, author: document.getElementById('a').value,
    }) });
    document.getElementById('t').value = '';
    document.getElementById('l').value = '';
    render();
  };
  // Возврат из ассистента по ссылке (на телефоне — переход между приложениями, работает и без сети)
  const q = new URLSearchParams(location.search);
  if (q.get('decision')) {
    document.getElementById('toast').innerHTML = `<section class="panel toast">Получен результат из ТОРО-Ассистента по М2 №${esc(q.get('qmnum'))}: ${esc(q.get('cause') || 'причина не установлена')}. Решение: ${esc(q.get('decision'))}.</section>`;
    history.replaceState(null, '', '/mtoro/');
  }
  render();
  setInterval(render, 5000);
}

init();
