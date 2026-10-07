import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';

let server, base, dir;
const H = { 'content-type': 'application/json', 'x-device-token': 'demo-device-token' };

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'toro-'));
  process.env.DATA_DIR = dir;
  const { createServer } = await import('./server.js');
  server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

const decision = (id) => ({
  id, type: 'DECISION', createdAt: '2026-10-07T10:00:00Z',
  payload: { machineId: 'T-305', symptoms: ['BRAKE_WEAK'], decision: 'STOP_AND_CALL', user: 'mech-01', analysisStatus: 'CRITICAL', rulebaseVersion: '0.3.0-demo', topCauses: ['BRAKE_SEALS'] },
});

test('без токена устройства API недоступно', async () => {
  const r = await fetch(`${base}/api/rules`);
  assert.equal(r.status, 401);
});

test('база правил отдаётся с хешем и подписью', async () => {
  const r = await (await fetch(`${base}/api/rules`, { headers: H })).json();
  const sha = createHash('sha256').update(JSON.stringify(r.rulebase)).digest('hex');
  assert.equal(r.sha256, sha);
  assert.equal(r.signature, createHmac('sha256', 'demo-signing-key-change-me').update(sha).digest('hex'));
});

test('синхронизация идемпотентна и формирует сообщение для SAP ТОРО', async () => {
  const body = JSON.stringify({ deviceId: 'dev-1', items: [decision('d-1')] });
  const r1 = await (await fetch(`${base}/api/sync`, { method: 'POST', headers: H, body })).json();
  assert.deepEqual(r1.acks, [{ id: 'd-1', ok: true }]);
  const r2 = await (await fetch(`${base}/api/sync`, { method: 'POST', headers: H, body })).json();
  assert.equal(r2.acks[0].duplicate, true);
  const lines = (await readFile(path.join(dir, 'sap-outbox.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1, 'дубль не должен попасть в SAP повторно');
  assert.equal(JSON.parse(lines[0]).messageType, 'M2');
});

test('повреждённый пакет (хеш не совпал) отклоняется', async () => {
  const item = { ...decision('d-2'), hash: 'deadbeef' };
  const r = await (await fetch(`${base}/api/sync`, { method: 'POST', headers: H, body: JSON.stringify({ deviceId: 'dev-1', items: [item] }) })).json();
  assert.equal(r.acks[0].ok, false);
});

test('выход за пределы каталога статики запрещён', async () => {
  const r = await fetch(`${base}/core/..%2F..%2Fpackage.json`);
  assert.notEqual(r.status, 200);
});

// ---------- Интеграция с «Мобильным ТОРО» ----------
const post = (url, body, headers = H) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());

test('М2 из «Мобильного ТОРО» → входящие ассистента → решение → результат в М2', async () => {
  const m2 = await post(`${base}/mtoro/api/messages`, { equnr: 'T-305', qmtxt: 'Слабые тормоза на спуске', author: 'Механик ОТК' }, { 'content-type': 'application/json' });
  assert.equal(m2.qmart, 'M2');
  assert.equal(m2.status, 'OPEN');

  const inbox = await (await fetch(`${base}/api/inbox`, { headers: H })).json();
  const item = inbox.messages.find((x) => x.m2.qmnum === m2.qmnum);
  assert.ok(item, 'сообщение должно появиться во входящих');
  assert.deepEqual(item.suggestedSymptoms, ['BRAKE_WEAK']);

  const decision = { id: 'd-m2-1', type: 'DECISION', createdAt: '2026-10-07T10:00:00Z',
    payload: { machineId: 'T-305', symptoms: ['BRAKE_WEAK'], decision: 'STOP_AND_CALL', selectedCause: 'BRAKE_SEALS', user: 'mech-1042', analysisStatus: 'CRITICAL', rulebaseVersion: '0.3.0-demo', topCauses: ['BRAKE_SEALS'], m2: { qmnum: m2.qmnum } } };
  const r = await post(`${base}/api/sync`, { deviceId: 'dev-1', items: [decision] });
  assert.equal(r.acks[0].m2, 'updated');

  const updated = await (await fetch(`${base}/mtoro/api/messages/${m2.qmnum}`)).json();
  assert.equal(updated.status, 'STOPPED');
  assert.equal(updated.priority, 1);
  assert.match(updated.assistant.longText, /КРИТИЧЕСКОЕ/);
  const inbox2 = await (await fetch(`${base}/api/inbox`, { headers: H })).json();
  assert.ok(!inbox2.messages.some((x) => x.m2.qmnum === m2.qmnum), 'обработанное М2 уходит из входящих');
});

test('входящие М2 требуют токен устройства; эмулятор проверяет обязательные поля', async () => {
  assert.equal((await fetch(`${base}/api/inbox`)).status, 401);
  const r = await fetch(`${base}/mtoro/api/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"equnr":"T-1"}' });
  assert.equal(r.status, 400);
});

test('REST-адаптер работает по тому же контракту (проверка на эмуляторе)', async () => {
  const { createMobileToroAdapter } = await import('./mtoro-adapter.js');
  const rest = createMobileToroAdapter({ mode: 'rest', url: `${base}/mtoro/api` });
  const m = await rest.create({ equnr: 'E-02', qmtxt: 'Медленно поднимается стрела' });
  assert.ok((await rest.listOpen()).some((x) => x.qmnum === m.qmnum));
  const res = await rest.appendAssistantResult(m.qmnum, { priority: 3, breakdown: false, longText: 'ok' });
  assert.equal(res.status, 'ANALYZED');
});
