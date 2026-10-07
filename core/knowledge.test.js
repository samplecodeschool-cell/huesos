import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, docsForCause, DOCS } from './knowledge.js';
import { CAUSES } from './catalog.js';

test('поиск находит регламент по разговорному запросу', () => {
  assert.equal(search('пена в баке гидравлики')[0].id, 'KB-07');
  assert.equal(search('течь рукава высокого давления')[0].id, 'KB-05');
  assert.equal(search('давление в шине упало')[0].id, 'KB-10');
});

test('пустой/бессмысленный запрос не ломает поиск', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('zzzz qqqq'), []);
});

test('у каждой причины есть хотя бы один документ-обоснование', () => {
  for (const id of Object.keys(CAUSES)) assert.ok(docsForCause(id).length > 0, `нет документа для ${id}`);
  for (const d of DOCS) for (const c of d.causes) assert.ok(CAUSES[c], `${d.id}: неизвестная причина ${c}`);
});
