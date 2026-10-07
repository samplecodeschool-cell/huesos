// Адаптер «Мобильного ТОРО». Ассистент работает с одним интерфейсом, реализация выбирается настройкой:
//   MTORO_MODE=emulator (по умолчанию) — встроенный эмулятор для демонстрации (данные в DATA_DIR/mtoro.json);
//   MTORO_MODE=rest — REST-шлюз корпоративной интеграционной шины / сервера «Форсайт. Мобильная платформа»:
//       MTORO_URL, MTORO_TOKEN; контракт — docs/integration-mobile-toro.md.
//
// Интерфейс: listOpen() → M2[]; get(qmnum); create(m2); appendAssistantResult(qmnum, update).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function createMobileToroAdapter({ mode = process.env.MTORO_MODE ?? 'emulator', dataDir, url = process.env.MTORO_URL, token = process.env.MTORO_TOKEN } = {}) {
  if (mode === 'rest') return restAdapter(url, token);
  return emulatorAdapter(dataDir);
}

// ---------- Эмулятор ----------
function emulatorAdapter(dataDir) {
  const file = () => path.join(dataDir(), 'mtoro.json');
  let chain = Promise.resolve();
  const locked = (fn) => (chain = chain.then(fn, fn));
  const load = async () => (existsSync(file()) ? JSON.parse(await readFile(file(), 'utf8')) : { seq: 10004700, messages: [] });
  const save = async (db) => { await mkdir(dataDir(), { recursive: true }); await writeFile(file(), JSON.stringify(db, null, 1)); };

  return {
    mode: 'emulator',
    async list() { return (await load()).messages; },
    async listOpen() { return (await load()).messages.filter((m) => !m.assistant); },
    async get(qmnum) { return (await load()).messages.find((m) => m.qmnum === qmnum) ?? null; },
    create: (m2) => locked(async () => {
      if (!m2?.equnr || !m2?.qmtxt) throw Object.assign(new Error('Нужны equnr и qmtxt'), { status: 400 });
      const db = await load();
      db.seq += 1;
      const msg = {
        qmnum: String(db.seq), qmart: 'M2', equnr: String(m2.equnr), qmtxt: String(m2.qmtxt).slice(0, 120),
        longText: String(m2.longText ?? '').slice(0, 4000), author: String(m2.author ?? 'Механик ОТК'),
        createdAt: new Date().toISOString(), photos: Number(m2.photos ?? 0), status: 'OPEN', assistant: null,
      };
      db.messages.unshift(msg);
      await save(db);
      return msg;
    }),
    appendAssistantResult: (qmnum, update) => locked(async () => {
      const db = await load();
      const msg = db.messages.find((m) => m.qmnum === qmnum);
      if (!msg) throw Object.assign(new Error(`Сообщение М2 ${qmnum} не найдено`), { status: 404 });
      msg.assistant = update;
      msg.status = update.breakdown ? 'STOPPED' : 'ANALYZED';
      msg.priority = update.priority;
      await save(db);
      return msg;
    }),
  };
}

// ---------- REST-шлюз к реальной системе ----------
function restAdapter(base, token) {
  if (!base) throw new Error('MTORO_MODE=rest требует MTORO_URL');
  const call = async (p, init = {}) => {
    const r = await fetch(`${base.replace(/\/$/, '')}${p}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw Object.assign(new Error(`Мобильное ТОРО: HTTP ${r.status} на ${p}`), { status: 502 });
    return r.json();
  };
  return {
    mode: 'rest',
    list: () => call('/messages'),
    listOpen: async () => (await call('/messages')).filter((m) => !m.assistant),
    get: (qmnum) => call(`/messages/${encodeURIComponent(qmnum)}`),
    create: (m2) => call('/messages', { method: 'POST', body: JSON.stringify(m2) }),
    appendAssistantResult: (qmnum, update) => call(`/messages/${encodeURIComponent(qmnum)}/assistant`, { method: 'POST', body: JSON.stringify(update) }),
  };
}
