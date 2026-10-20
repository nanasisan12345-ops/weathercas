import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
const id = 'a15be8ef-e6b6-4a31-87fb-0123456789ab';
const sample = { id, video_id: 'LbMd2BvWHHU', title: 'Official live', state: 'preparing', message: '配信の元画質と音声を確認しています…', error: null, warning: null, width: 1920, height: 1080, fps: 30, seconds: 0, bytes: 0, filename: 'weathercas-test.mp4' };

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Player title overlay</p>' }));
  await page.route('https://www.youtube.com/live_chat**', route => route.fulfill({ contentType: 'text/html', body: '<p>Chat fixture</p>' }));
  for (const [name, value] of Object.entries({ 'index.json': fixture.index, 'status.json': fixture.status, 'live.json': fixture.live, '2026/10.json': fixture.partition })) {
    await page.route(`**/data/${name}`, route => route.fulfill({ json: value }));
  }
});

test('direct recorder starts, stops and offers the MP4 without requesting screen sharing', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: () => { throw new Error('Screen sharing must never be used'); } }));
  let job: typeof sample | null = null;
  await page.route('**/api/recording', route => route.fulfill({ json: { supported: true, token: 'a'.repeat(64), job } }));
  await page.route('**/api/recording/start', async route => {
    expect(route.request().postDataJSON()).toEqual({ video_id: sample.video_id });
    expect(route.request().headers()['x-weathercas-token']).toBe('a'.repeat(64));
    job = { ...sample, state: 'recording', seconds: 5, bytes: 1000000, message: '配信の映像と音声を再圧縮せず録画中です。' };
    await route.fulfill({ status: 202, json: { job } });
  });
  await page.route('**/api/recording/stop', async route => { job = { ...sample, state: 'completed', seconds: .4, bytes: 10000, message: '録画を停止しました。' }; await route.fulfill({ status: 202, json: { job } }); });
  await page.route(`**/api/recording/${id}/file*`, route => route.fulfill({ path: 'tests/fixtures/recorder.mp4', contentType: 'video/mp4', headers: { 'Content-Disposition': `${route.request().url().includes('download=1') ? 'attachment' : 'inline'}; filename="weathercas-test.mp4"` } }));
  await page.goto('./#capture');
  await page.getByRole('button', { name: '録画開始', exact: true }).click();
  await expect(page.locator('.capture-message')).toContainText('再圧縮せず録画中');
  await expect(page.locator('.capture-quality')).toContainText('1920×1080・30fps');
  await page.locator('.player').hover();
  await page.getByRole('button', { name: '録画停止', exact: true }).click();
  const preview = page.getByLabel('録画した動画のプレビュー');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(1920);
  // Browser downloads bypass page.route; file bytes are verified against the real HTTP API.
  const save = page.getByRole('link', { name: 'MP4をPCに保存' });
  await expect(save).toHaveAttribute('href', `/weathercas/api/recording/${id}/file?download=1`);
  await expect(save).toHaveAttribute('download', 'weathercas-test.mp4');
});

test('static hosting clearly explains that direct recording needs the local app', async ({ page }) => {
  await page.route('**/api/recording', route => route.fulfill({ status: 404 }));
  await page.goto('./#capture');
  await expect(page.locator('#capture')).toContainText('run.batでサイトを起動してください');
  await expect(page.getByRole('button', { name: '録画開始', exact: true })).toBeDisabled();
});

test('preparing a recording can be cancelled and request errors remain visible', async ({ page }) => {
  let job: typeof sample | null = null;
  await page.route('**/api/recording', route => route.fulfill({ json: { supported: true, token: 'a'.repeat(64), job } }));
  await page.route('**/api/recording/start', async route => { job = { ...sample }; await route.fulfill({ status: 202, json: { job } }); });
  await page.route('**/api/recording/stop', async route => { job = { ...sample, state: 'cancelled', message: '録画の準備を中止しました。' }; await route.fulfill({ status: 202, json: { job } }); });
  await page.goto('./#capture'); await page.getByRole('button', { name: '録画開始', exact: true }).click();
  await page.getByRole('button', { name: '準備を中止', exact: true }).click();
  await expect(page.locator('.capture-message')).toContainText('中止しました');
  await page.route('**/api/recording/start', route => route.fulfill({ status: 409, json: { error: 'すでに録画中です。' } }));
  await page.getByRole('button', { name: '録画開始', exact: true }).click();
  await expect(page.locator('.capture-error')).toContainText('すでに録画中');
  await page.clock.install(); await page.clock.fastForward(2500);
  await expect(page.locator('.capture-error')).toContainText('すでに録画中');
});
