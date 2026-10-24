import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const archived = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
const snapshot = JSON.parse(readFileSync('tests/fixtures/current-schedule.json', 'utf8'));
const start = Date.parse(snapshot.now);
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(start) });
  await page.route('https://www.youtube-nocookie.com/embed/**', r => r.fulfill({ body: 'Player fixture' }));
  await page.route('https://www.youtube.com/live_chat**', r => r.fulfill({ body: 'Chat fixture' }));
  for (const [name, data] of Object.entries({ 'index.json': archived.index, 'status.json': archived.status, '2026/10.json': archived.partition, 'live.json': { ...archived.live, checked_at: new Date(start).toISOString() } }))
    await page.route(`**/data/${name}`, r => r.fulfill({ json: data }));
});
test('fresh current schedule clears the saved-data warning while keeping archive statistics', async ({ page }) => {
  await page.route('**/data/schedule.json', r => r.fulfill({ json: { schema_version: 1, checked_at: new Date(start).toISOString(), records: snapshot.expected } }));
  await page.goto('./'); await expect(page.locator('.collection-summary')).toContainText('番組表確認済み');
  await expect(page.locator('.collection-warning')).toHaveCount(0);
  await expect(page.locator('.today-card')).toContainText('田辺 真南葉');
  await expect(page.locator('.results-heading')).toContainText(`${archived.partition.records.length}件の記録`);
});
test('a failed current lookup keeps an accurate warning and automatically recovers in five cycles', async ({ page }) => {
  let fail = true, clock = start;
  await page.route('**/data/schedule.json', r => fail ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: { schema_version: 1, checked_at: new Date(clock).toISOString(), records: snapshot.expected } }));
  await page.goto('./'); await expect(page.locator('.collection-warning')).toContainText('4時間以上前');
  for (let i = 0; i < 5; i++) {
    fail = false; clock += 300001; await page.clock.fastForward(300001); await expect(page.locator('.collection-summary')).toContainText('番組表確認済み');
    fail = true; clock += 300001; await page.clock.fastForward(300001); await expect(page.locator('.collection-warning')).toContainText('4時間以上前');
  }
  fail = false; await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.collection-summary')).toContainText('番組表確認済み');
});
