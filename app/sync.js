// Контролируемая синхронизация с узлом карьера: пакетами, идемпотентно (id записи),
// с контролем целостности (sha256) и экспоненциальной задержкой при ошибках.
// Пока связи нет — всё работает из локальной БД, записи ждут в очереди.

import { all, del, put, log, unseal, getMeta, setMeta, sha256Hex, putMany } from './db.js';

const TOKEN = 'demo-device-token'; // прод: сертификат устройства, выданный MDM
const BATCH = 20;

export async function isOnline() {
  if (await getMeta('forceOffline', false)) return false;
  if (!navigator.onLine) return false;
  try {
    const r = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function syncNow() {
  if (!(await isOnline())) {
    await log('SYNC_SKIPPED_OFFLINE');
    return { ok: false, reason: 'offline' };
  }
  const deviceId = await getMeta('deviceId');
  const queue = (await all('outbox')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    const items = await Promise.all(batch.map(async (q) => ({ id: q.id, type: q.type, createdAt: q.createdAt, hash: q.hash, payload: await unseal(q.sealed) })));
    try {
      const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-token': TOKEN }, body: JSON.stringify({ deviceId, items }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { acks } = await r.json();
      for (const ack of acks) {
        const q = batch.find((b) => b.id === ack.id);
        if (ack.ok) { await del('outbox', ack.id); sent++; }
        else if (q) { await put('outbox', { ...q, attempts: q.attempts + 1, lastError: ack.error }); failed++; }
      }
    } catch (e) {
      for (const q of batch) await put('outbox', { ...q, attempts: q.attempts + 1, lastError: e.message });
      failed += batch.length;
      break;
    }
  }
  await updateRules();
  await setMeta('lastSync', new Date().toISOString());
  await log('SYNC_DONE', { sent, failed });
  return { ok: failed === 0, sent, failed };
}

/** Обновление базы правил только с узла карьера, с проверкой целостности; старая версия сохраняется для отката. */
async function updateRules() {
  try {
    const r = await fetch('/api/rules', { headers: { 'x-device-token': TOKEN } });
    if (!r.ok) return;
    const pkg = await r.json();
    const sha = await sha256Hex(JSON.stringify(pkg.rulebase));
    if (sha && sha !== pkg.sha256) { await log('RULES_REJECTED', { reason: 'sha256 mismatch' }); return; }
    const current = await getMeta('rulebase');
    if (current?.version !== pkg.rulebase.version) {
      if (current) await setMeta('rulebasePrevious', current);
      await setMeta('rulebase', pkg.rulebase);
      await log('RULES_UPDATED', { from: current?.version ?? null, to: pkg.rulebase.version });
    }
    const ref = await fetch('/api/reference', { headers: { 'x-device-token': TOKEN } });
    if (ref.ok) {
      const { machines, history } = await ref.json();
      await putMany('machines', machines);
      await putMany('history', history);
    }
  } catch (e) {
    await log('RULES_UPDATE_FAILED', { error: e.message });
  }
}

let timer;
/** Фоновая попытка синхронизации с экспоненциальной задержкой (30 с → 10 мин). */
export function startAutoSync(onChange) {
  let delay = 30_000;
  const tick = async () => {
    const res = await syncNow().catch(() => ({ ok: false }));
    delay = res.ok ? 30_000 : Math.min(delay * 2, 600_000);
    onChange?.();
    timer = setTimeout(tick, delay);
  };
  clearTimeout(timer);
  timer = setTimeout(tick, 5_000);
  window.addEventListener('online', () => { clearTimeout(timer); tick(); });
}
