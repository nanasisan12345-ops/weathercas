import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { liveCasterProfiles } from './live-caster';
import { liveSchema } from './data';
const live = liveSchema.parse(JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8')).live);
const now = Date.parse(live.checked_at);
const titled = (title: string) => ({ ...live, video: { ...live.video!, title } });
describe('caster identification from the current official title', () => {
  it('matches full names despite spacing, includes both presenters in title order and avoids partial names', () => {
    expect(liveCasterProfiles(titled('〈田辺真南葉／有賀哲夫〉'), now).map(x => x.id)).toEqual(['tanabe']);
    expect(liveCasterProfiles(titled('松本　真央・田辺 真南葉'), now).map(x => x.id)).toEqual(['matsumoto', 'tanabe']);
    expect(liveCasterProfiles(titled('松本さんと田辺さん'), now)).toEqual([]);
    expect(liveCasterProfiles(titled('キャスター未掲載'), now)).toEqual([]);
  });
  it('clears information when the stream ends, fails, expires or its title changes', () => {
    const first = titled('松本真央'); expect(liveCasterProfiles(first, now)[0].id).toBe('matsumoto');
    for (const value of [null, { ...first, state: 'offline' as const }, { ...first, state: 'failed' as const }]) expect(liveCasterProfiles(value, now)).toEqual([]);
    expect(liveCasterProfiles(first, now + 5 * 3600000)).toEqual([]);
    expect(liveCasterProfiles(titled('田辺真南葉'), now).map(x => x.id)).toEqual(['tanabe']);
  });
  it('uses only the official source and factual profile fields', () => {
    const p = liveCasterProfiles(titled('田辺真南葉'), now)[0];
    expect(p.source_url).toBe('https://weathernews.jp/wnl/caster/tanabe.html');
    expect(p.facts.find(x => x.label === '出身地')?.value).toBe('東京都');
  });
});
