import { createServer } from 'vite';
import { mkdir, access, readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const data = path.join(root, 'Data');
await mkdir(path.join(data, 'logs'), { recursive: true });
await mkdir(path.join(data, 'downloads'), { recursive: true });
const profile = path.join(data, 'browser');
const preferencesPath = path.join(profile, 'Default', 'Preferences');
await mkdir(path.dirname(preferencesPath), { recursive: true });
try { JSON.parse(await readFile(preferencesPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Browser preferences cannot be read. Close the WeatherCas browser and try again.');
    process.exit(1);
  }
  const preferences = { download: { default_directory: path.join(data, 'downloads'), prompt_for_download: false } };
  await writeFile(preferencesPath, JSON.stringify(preferences), { flag: 'wx' });
}

const server = await createServer({ root, server: { host: '127.0.0.1', port: 5173 } });
await server.listen();
server.printUrls();
const url = server.resolvedUrls.local[0];
await appendFile(path.join(data, 'logs', 'launcher.log'), `${new Date().toISOString()} started ${url}\n`);
console.log('WeatherCas: browser state and downloads are saved under Data.');
console.log('Close this console or press Ctrl+C to stop the local server.');
if (!process.argv.includes('--no-browser')) {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  let executable;
  for (const candidate of candidates) {
    try { await access(candidate); executable = candidate; break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (executable) {
    const browser = spawn(executable, [`--user-data-dir=${profile}`, `--disk-cache-dir=${path.join(data, 'cache/browser')}`,
      '--no-first-run', '--no-default-browser-check', `--app=${url}`], { stdio: 'ignore', windowsHide: true });
    browser.on('error', error => console.error(`Browser launch failed (${error.code}). Open the Local URL above.`));
  } else console.log('Edge was not found. Open the Local URL above in your preferred browser.');
}
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
process.on('SIGTERM', async () => { await server.close(); process.exit(0); });
