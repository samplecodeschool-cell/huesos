// Локальный узел карьера (edge-сервер в сети pLTE). Без внешних зависимостей и без интернета.
// Функции: раздача PWA, приём пакетов синхронизации (идемпотентно), раздача подписанной базы
// правил, журнал событий, выгрузка сообщений для интеграции с SAP ТОРО (заглушка-адаптер).
//
// Запуск: node server/server.js  →  http://localhost:8080

import http from 'node:http';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULEBASE } from '../core/rules.js';
import { HISTORY, MACHINES } from '../core/demo-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'server', 'data');
const PORT = Number(process.env.PORT ?? 8080);
// Демо-секрет. В промышленной версии — сертификаты устройств (MDM) и подпись ГОСТ Р 34.10-2012.
const SIGNING_KEY = process.env.RULES_SIGNING_KEY ?? 'demo-signing-key-change-me';
const DEVICE_TOKENS = new Set((process.env.DEVICE_TOKENS ?? 'demo-device-token').split(','));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const STATIC_ROOTS = { '/core/': path.join(ROOT, 'core'), '/': path.join(ROOT, 'app') };

const storeFile = () => path.join(DATA_DIR, 'store.json');
const journalFile = () => path.join(DATA_DIR, 'journal.jsonl');
const sapOutboxFile = () => path.join(DATA_DIR, 'sap-outbox.jsonl');

async function loadStore() {
  if (!existsSync(storeFile())) return { items: {} };
  return JSON.parse(await readFile(storeFile(), 'utf8'));
}

let writeChain = Promise.resolve(); // сериализация записи: один процесс, без гонок
const serialize = (fn) => (writeChain = writeChain.then(fn, fn));

export function signRulebase(rulebase, key = SIGNING_KEY) {
  const body = JSON.stringify(rulebase);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const signature = createHmac('sha256', key).update(sha256).digest('hex');
  return { rulebase, sha256, signature, alg: 'HMAC-SHA256 (демо; прод — ГОСТ Р 34.10-2012)' };
}

/** Сообщение для SAP ТОРО (вид М2) из подтверждённого решения специалиста. */
export function toSapMessage(item) {
  const d = item.payload;
  return {
    externalId: item.id,
    messageType: 'M2',
    equipment: d.machineId,
    detectedAt: d.defectCreatedAt ?? item.createdAt,
    symptoms: d.symptoms,
    causeGroup: d.selectedCause ?? null,
    decision: d.decision,
    decidedBy: d.user,
    comment: d.comment ?? '',
    assistant: { status: d.analysisStatus, rulebaseVersion: d.rulebaseVersion, topCauses: d.topCauses },
  };
}

export async function handleSync(body) {
  if (!body || !Array.isArray(body.items) || typeof body.deviceId !== 'string') {
    return [400, { error: 'Ожидается {deviceId, items[]}' }];
  }
  return serialize(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const store = await loadStore();
    const acks = [];
    for (const item of body.items) {
      if (!item?.id || !item.type) { acks.push({ id: item?.id ?? null, ok: false, error: 'нет id/type' }); continue; }
      const hash = createHash('sha256').update(JSON.stringify(item.payload ?? null)).digest('hex');
      if (item.hash && item.hash !== hash) { acks.push({ id: item.id, ok: false, error: 'контрольная сумма не совпала' }); continue; }
      if (store.items[item.id]) { acks.push({ id: item.id, ok: true, duplicate: true }); continue; }
      store.items[item.id] = { ...item, hash, deviceId: body.deviceId, receivedAt: new Date().toISOString() };
      await appendFile(journalFile(), JSON.stringify({ ts: new Date().toISOString(), event: 'SYNC_RECEIVED', deviceId: body.deviceId, itemId: item.id, type: item.type }) + '\n');
      if (item.type === 'DECISION') await appendFile(sapOutboxFile(), JSON.stringify(toSapMessage(item)) + '\n');
      acks.push({ id: item.id, ok: true });
    }
    await writeFile(storeFile(), JSON.stringify(store, null, 1));
    return [200, { acks, serverTime: new Date().toISOString(), rulebaseVersion: RULEBASE.version }];
  });
}

function authorized(req) {
  const token = String(req.headers['x-device-token'] ?? '');
  for (const t of DEVICE_TOKENS) {
    if (t.length === token.length && timingSafeEqual(Buffer.from(t), Buffer.from(token))) return true;
  }
  return false;
}

async function readJson(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('слишком большой пакет'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

async function serveStatic(req, res, urlPath) {
  const prefix = Object.keys(STATIC_ROOTS).find((p) => urlPath.startsWith(p));
  const base = STATIC_ROOTS[prefix];
  const rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://local');
    try {
      if (pathname === '/api/health') return send(res, 200, { ok: true, rulebaseVersion: RULEBASE.version, time: new Date().toISOString() });
      if (pathname.startsWith('/api/')) {
        if (!authorized(req)) return send(res, 401, { error: 'устройство не авторизовано' });
        if (pathname === '/api/rules' && req.method === 'GET') return send(res, 200, signRulebase(RULEBASE));
        if (pathname === '/api/reference' && req.method === 'GET') return send(res, 200, { machines: MACHINES, history: HISTORY });
        if (pathname === '/api/sync' && req.method === 'POST') {
          const [code, body] = await handleSync(await readJson(req));
          return send(res, code, body);
        }
        return send(res, 404, { error: 'unknown endpoint' });
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, pathname);
    } catch (e) {
      send(res, e.status ?? 500, { error: e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => console.log(`ТОРО-Ассистент edge-узел: http://localhost:${PORT}`));
}
