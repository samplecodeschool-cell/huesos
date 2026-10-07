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
