import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultWeatherLayout, loadWeather, moveWeatherCard, parseWeatherLayout, weatherDataSchema, weatherPanels } from './weather-data';
const payload = JSON.parse(readFileSync('tests/fixtures/weather-cards.json', 'utf8')).forecast;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('weather cards', () => {
  it('has 32 unique choices and preserves empty, reordered and wide layouts', () => {
    expect(weatherPanels).toHaveLength(32); expect(new Set(weatherPanels.map(x => x.id)).size).toBe(32);
    expect(parseWeatherLayout(null)).toEqual(defaultWeatherLayout());
    expect(parseWeatherLayout(JSON.stringify({ version: 1, cards: [] }))).toEqual([]);
    const cards = [{ id: 'radar', wide: true }, { id: 'today', wide: false }];
    expect(parseWeatherLayout(JSON.stringify({ version: 1, cards }))).toEqual(cards);
    expect(moveWeatherCard(cards, 'radar', 'today').map(x => x.id)).toEqual(['today', 'radar']);
    expect(moveWeatherCard(cards, 'unknown', 'today')).toEqual(cards);
  });
  it('rejects invalid versions and corrupt storage and removes duplicate or unknown cards', () => {
    for (const text of ['null', '{', '{}', '{"version":2,"cards":[]}']) expect(() => parseWeatherLayout(text)).toThrow();
    expect(parseWeatherLayout(JSON.stringify({ version: 1, cards: [{ id: 'today', wide: 'yes' }, { id: 'today', wide: true }, null, { id: 'secret' }] }))).toEqual([{ id: 'today', wide: false }]);
  });
  it('validates response formats and rejects untrusted images', () => {
    expect(weatherDataSchema.safeParse(payload).success).toBe(true);
    expect(weatherDataSchema.safeParse({ ...payload, images: [{ src: 'https://evil.example/image.png', label: 'fake' }] }).success).toBe(false);
    expect(weatherDataSchema.safeParse({ caption: 'missing timestamp' }).success).toBe(false);
  });
  it('uses only the configured Worker weather path, or the local data path', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload)))); vi.stubGlobal('fetch', fetch);
    vi.stubEnv('VITE_LIVE_ENDPOINT', 'https://example.workers.dev/live.json'); await loadWeather('forecast');
    expect(fetch.mock.calls[0][0]).toBe('https://example.workers.dev/weather/forecast.json');
    vi.stubEnv('VITE_LIVE_ENDPOINT', ''); await loadWeather('forecast');
    expect(fetch.mock.calls[1][0]).toMatch(/\/data\/weather\/forecast.json$/);
  });
  it('reports malformed and failed weather responses without substituting an old result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(loadWeather('forecast')).rejects.toThrow('取得できません');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(loadWeather('forecast')).rejects.toThrow('形式');
  });
});
