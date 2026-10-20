import http from 'node:http';
import { readFile, stat, mkdir, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLiveHandler } from './live-source.mjs';
import { createRecordingHandler } from './recording-api.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), site = path.join(root, 'site');
const base = '/weathercas/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const liveHandler = createLiveHandler();
const recordingHandler = createRecordingHandler(root);
const server = http.createServer((req, res) => recordingHandler(req, res, () => liveHandler(req, res, async () => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') { res.writeHead(302, { Location: base }); res.end(); return; }
  if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end(); return; }
  let relative;
  try { relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html'; }
  catch { res.writeHead(400); res.end(); return; }
  const target = path.resolve(site, relative);
  if (!target.startsWith(site + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    if (!(await stat(target)).isFile()) { res.writeHead(404); res.end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(); }
})));
const selectedPort = Number(process.env.WEATHERCAS_PORT || 5180);
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(selectedPort, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${selectedPort}${base}`;
console.log(`WeatherCas local preview: ${url}`);
console.log('Press Ctrl+C to stop. Browser data is stored under Data.');
if (!process.argv.includes('--no-browser')) {
  const data = path.join(root, 'Data'), profile = path.join(data, 'browser');
  const preferences = path.join(profile, 'Default', 'Preferences');
  await mkdir(path.dirname(preferences), { recursive: true });
  await mkdir(path.join(data, 'downloads'), { recursive: true });
  try { await access(preferences); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(preferences, JSON.stringify({ download: { default_directory: path.join(data, 'downloads'), prompt_for_download: false } }), { flag: 'wx' });
  }
  const candidates = ['ProgramFiles(x86)', 'ProgramFiles'].map(key => process.env[key]).filter(Boolean)
    .map(folder => path.join(folder, 'Microsoft/Edge/Application/msedge.exe'));
  for (const executable of candidates) {
    try { await access(executable); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const browser = spawn(executable, [`--user-data-dir=${profile}`, `--disk-cache-dir=${path.join(data, 'cache/browser')}`, '--no-first-run', '--no-default-browser-check', `--app=${url}`], { stdio: 'ignore', windowsHide: true });
    browser.on('error', error => console.error(`Browser launch failed: ${error.code}`));
    break;
  }
}
async function shutdown() { await recordingHandler.dispose(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
