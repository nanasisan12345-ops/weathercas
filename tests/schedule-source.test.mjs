import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCurrentSchedule, createScheduleResolver, SCHEDULE_SOURCE } from '../scripts/schedule-source.mjs';
import { createMetadataWorker } from '../worker/live.mjs';
const fixture = JSON.parse(readFileSync('tests/fixtures/current-schedule.json', 'utf8'));
test('observed schedule matches the existing Python collector and never confirms appearances', () => {
  const data = parseCurrentSchedule(fixture.payload, Date.parse(fixture.now));
  const expected = structuredClone(fixture.expected);
  expected.forEach(x => { x.planned.source_checked_at = new Date(x.planned.source_checked_at).toISOString(); });
  assert.deepEqual(data.records, expected);
  assert.equal(data.records.every(x => x.confirmed === null && x.status !== 'confirmed'), true);
});
test('schedule validation rejects ambiguous dates, invalid values and conflicting duplicates', () => {
  const now = Date.parse(fixture.now);
  for (const raw of [null, [], [{ hour: '25:00', title: 'test', caster: '' }], [{ hour: '20:00', title: 'future', caster: '' }],
    [{ hour: '11:00', title: 'A', caster: '' }, { hour: '11:00', title: 'B', caster: '' }]]) assert.throws(() => parseCurrentSchedule(raw, now));
  const unknown = parseCurrentSchedule([{ hour: '11:00', title: 'Official', caster: 'unknown_person' }], now).records[0];
  assert.equal(unknown.status, 'unverified'); assert.equal(unknown.planned.caster_id, null);
});
for (const day of ['2026-10-23', '2026-10-31', '2026-12-31', '2027-02-28', '2030-06-15']) {
  test(`schedule refresh crosses midnight and recovers without stale fallback: ${day}`, async () => {
    let time = Date.parse(`${day}T23:30:00+09:00`), fail = false, calls = 0;
    const payload = [{ hour: '23:00', title: 'Night', caster: '' }, { hour: '00:00', title: 'Next day', caster: '' }];
    const resolve = createScheduleResolver({ now: () => time, fetchJSON: async url => { assert.equal(url, SCHEDULE_SOURCE); calls++; if (fail) throw new Error('offline'); return payload; } });
    const [a, b] = await Promise.all([resolve(), resolve()]); assert.deepEqual(a, b); assert.equal(calls, 1);
    assert.notEqual(a.records[0].date_jst, a.records[1].date_jst);
    time += 60001; fail = true; await assert.rejects(resolve()); fail = false;
    const next = await resolve(); assert.notEqual(next.checked_at, a.checked_at); assert.equal(calls, 3);
  });
}
test('schedule Worker is read-only, enforces the Pages origin and contains failures', async () => {
  const context = { waitUntil() {} }, origin = 'https://nanasisan12345-ops.github.io';
  const req = (path = '/schedule.json', method = 'GET', from = origin) => new Request(`https://example.workers.dev${path}`, { method, headers: { Origin: from } });
  const worker = createMetadataWorker({ resolveSchedule: async () => parseCurrentSchedule(fixture.payload, Date.parse(fixture.now)) });
  const response = await worker.fetch(req(), {}, context); assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await response.json()).records.length, 10);
  assert.equal((await worker.fetch(req('/schedule.json', 'POST'), {}, context)).status, 405);
  assert.equal((await worker.fetch(req('/schedule.json?url=https://evil.example'), {}, context)).status, 404);
  assert.equal((await worker.fetch(req('/schedule.json', 'GET', 'https://evil.example'), {}, context)).status, 403);
  const failed = createMetadataWorker({ resolveSchedule: async () => { throw new Error('offline'); } });
  assert.equal((await failed.fetch(req(), {}, context)).status, 503);
});
