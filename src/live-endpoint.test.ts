import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadLive } from './data';

const fixture = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('live metadata endpoint', () => {
  it('uses the deployed endpoint without relying on the Pages snapshot', async () => {
    const url = 'https://weathercas-live.example.workers.dev/live.json';
    vi.stubEnv('VITE_LIVE_ENDPOINT', url);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture.live)));
    vi.stubGlobal('fetch', fetch);
    expect((await loadLive()).video?.id).toBe(fixture.live.video.id);
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ cache: 'no-store' }));
  });
  it('keeps the local JSON endpoint when no remote endpoint is configured', async () => {
    vi.stubEnv('VITE_LIVE_ENDPOINT', '');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture.live))); vi.stubGlobal('fetch', fetch);
    await loadLive(); expect(fetch.mock.calls[0][0]).toMatch(/\/data\/live.json$/);
  });
  it('does not fall back to an old broadcast when the live endpoint fails', async () => {
    vi.stubEnv('VITE_LIVE_ENDPOINT', 'https://weathercas-live.example.workers.dev/live.json');
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch);
    await expect(loadLive()).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed remote metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"video":{"id":"not a video"}}')));
    await expect(loadLive()).rejects.toThrow('データ形式');
  });
});
