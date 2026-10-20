import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { aggregate, filterRecords, fresh, jstDate, livePresentation, liveSchema,
  officialUrl, parseRoute, partitionSchema, routeHash, shiftDate } from './data';

const fixture = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
const partition = partitionSchema.parse(fixture.partition);
const live = liveSchema.parse(fixture.live);

describe('data safety and time', () => {
  it('validates real collected data and rejects injection', () => {
    expect(partition.records.length).toBeGreaterThan(0);
    expect(officialUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(officialUrl.safeParse('https://weathernews.jp.evil.com/').success).toBe(false);
    const row = structuredClone(partition.records[0]);
    row.planned.source_url = 'https://example.com';
    expect(partitionSchema.safeParse({ schema_version: 1, records: [row] }).success).toBe(false);
  });
  it('uses JST at UTC midnight boundary and crosses the year', () => {
    expect(jstDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('expires live flags and disables embeds on stale or failed collection', () => {
    const now = Date.parse(live.checked_at);
    expect(livePresentation({ ...live, state: 'live', verification: 'youtube_api' }, now).tone).toBe('live');
    expect(livePresentation({ ...live, state: 'live', verification: 'youtube_api' }, now + 16 * 60000).tone).toBe('neutral');
    expect(livePresentation(live, now + 5 * 3600000).embed).toBe(false);
    expect(livePresentation({ ...live, state: 'failed' }, now).embed).toBe(false);
    expect(fresh(live.checked_at, now - 3600000)).toBe(false);
  });
});
describe('search, route, and separated statistics', () => {
  it('roundtrips Japanese filters and ignores invalid date input', () => {
    const route = { ...parseRoute('#archive', '2026-10-20'), q: '小川 千奈', year: '2026', caster: 'ogawa' };
    expect(parseRoute(routeHash(route))).toEqual(route);
    expect(parseRoute('#schedule?date=2026-02-30', '2026-10-20').date).toBe('2026-10-20');
  });
  it('searches names without spaces and matches year and month', () => {
    const route = { ...parseRoute('#archive'), q: '小川千奈', year: '2026', month: '2026-10' };
    expect(filterRecords(partition.records, route).every(r => r.planned.caster_id === 'ogawa')).toBe(true);
    expect(filterRecords(partition.records, { ...route, year: '2025' })).toHaveLength(0);
    expect(filterRecords(partition.records, { ...route, q: '存在しない名前' })).toHaveLength(0);
  });
  it('does not turn old plans into actual appearances', () => {
    expect(aggregate(partition.records, 'confirmed').total).toBe(0);
    const plan = aggregate(partition.records, 'scheduled');
    expect(plan.total).toBe(partition.records.filter(r => r.status === 'scheduled').length);
    expect(plan.weekday.reduce((sum, [, n]) => sum + n, 0)).toBe(plan.total);
  });
});
