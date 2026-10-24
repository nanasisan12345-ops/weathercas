import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { currentScheduleRows, partitionSchema, scheduleSchema } from './data';
const original = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
const saved = partitionSchema.parse(original.partition).records;
const fixture = JSON.parse(readFileSync('tests/fixtures/current-schedule.json', 'utf8'));
const now = Date.parse(fixture.now);
const current = scheduleSchema.parse({ schema_version: 1, checked_at: new Date(now).toISOString(), records: fixture.expected });
describe('current schedule separate from saved history', () => {
  it('adds current plans without changing the archived records', () => {
    const before = JSON.stringify(saved), combined = currentScheduleRows(saved, current, now);
    expect(combined.some(x => x.id === '2026-10-23T11:00' && x.planned.caster_id === 'tanabe')).toBe(true);
    expect(JSON.stringify(saved)).toBe(before); expect(currentScheduleRows(saved, null, now)).toBe(saved);
  });
  it('rejects expired or future check times and preserves actual appearance evidence', () => {
    expect(currentScheduleRows(saved, current, now + 11 * 60000)).toBe(saved);
    expect(currentScheduleRows(saved, current, now - 2 * 60000)).toBe(saved);
    const row = current.records[0];
    const confirmed = { ...row, status: 'confirmed' as const, confirmed: { caster_id: 'tanabe', caster_name: '田辺 真南葉', source_url: row.planned.source_url, source_checked_at: current.checked_at } };
    expect(currentScheduleRows([confirmed], current, now)[0].confirmed).toEqual(confirmed.confirmed);
  });
});
