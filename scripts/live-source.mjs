import { getCACertificates, setDefaultCACertificates } from 'node:tls';

// Keep verification enabled and also trust the operating system's CA store.
setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')]);
import { createLiveResolver } from './live-resolver.mjs';
import { createScheduleResolver } from './schedule-source.mjs';
export { createLiveResolver };

export function createLiveHandler() {
  const resolve = createLiveResolver();
  const resolveSchedule = createScheduleResolver();
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1'), schedule = url.pathname === '/weathercas/data/schedule.json';
    if (!schedule && url.pathname !== '/weathercas/data/live.json') return next();
    if (schedule && url.search) { res.writeHead(404); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    try {
      const body = JSON.stringify(schedule ? await resolveSchedule() : await resolve());
      res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(503, headers); res.end(JSON.stringify({ error: '番組表を確認できませんでした。' })); }
  };
}
