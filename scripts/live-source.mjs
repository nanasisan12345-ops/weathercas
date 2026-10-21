import { getCACertificates, setDefaultCACertificates } from 'node:tls';

// Keep verification enabled and also trust the operating system's CA store.
setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')]);
import { createLiveResolver } from './live-resolver.mjs';
export { createLiveResolver };

export function createLiveHandler() {
  const resolve = createLiveResolver();
  return async (req, res, next) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/weathercas/data/live.json') return next();
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const body = JSON.stringify(await resolve());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
