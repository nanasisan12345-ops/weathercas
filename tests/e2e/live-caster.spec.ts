import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(fixture.live.checked_at) });
  await page.route('https://www.youtube-nocookie.com/embed/**', r => r.fulfill({ body: 'Player fixture' }));
  await page.route('https://www.youtube.com/live_chat**', r => r.fulfill({ body: 'Chat fixture' }));
  await page.route('**/data/schedule.json', r => r.fulfill({ status: 503, json: {} }));
  for (const [name, value] of Object.entries({ 'index.json': fixture.index, 'status.json': fixture.status, '2026/10.json': fixture.partition })) await page.route(`**/data/${name}`, r => r.fulfill({ json: value }));
});
test('profile alone below the video follows stream changes and ending without loading social embeds', async ({ page }) => {
  const socialRequests: string[] = [];
  page.on('request', request => { if (/(instagram|twitter|tiktok)\.com|platform\.twitter/.test(request.url())) socialRequests.push(request.url()); });
  let title = '〈ウェザーニュースLiVE・田辺真南葉／有賀哲夫〉', id = fixture.live.video.id, offline = false;
  await page.route('**/data/live.json', r => r.fulfill({ json: { ...fixture.live, checked_at: new Date(Date.parse(fixture.live.checked_at) + 62000).toISOString(),
    state: offline ? 'offline' : 'listed', video: offline ? null : { ...fixture.live.video, title, id } } }));
  await page.clock.fastForward(62000); await page.goto('./#live');
  const section = page.getByRole('region', { name: 'この配信のキャスター', exact: true });
  await expect(section.getByRole('heading', { name: '田辺 真南葉', exact: true })).toBeVisible();
  await expect(section).toContainText('東京都');
  await expect(section.getByRole('link', { name: /^公式プロフィールで詳しく/ })).toHaveAttribute('href', 'https://weathernews.jp/wnl/caster/tanabe.html');
  await expect(section.locator('iframe, .caster-socials')).toHaveCount(0);
  await expect(section).not.toContainText('SNS');
  expect((await section.boundingBox())!.y).toBeGreaterThan((await page.locator('.player').boundingBox())!.y);
  title = '〈ウェザーニュースLiVE・松本真央〉'; id = 'abcdefghijk'; await page.clock.fastForward(30001);
  await expect(section.getByRole('heading', { name: '松本 真央', exact: true })).toBeVisible(); await expect(section).not.toContainText('田辺 真南葉');
  offline = true; await page.clock.fastForward(30001); await expect(section).toContainText('配信が再開したら');
  await expect(section.locator('.live-caster-profile')).toHaveCount(0);
  expect(socialRequests).toEqual([]);
});

test('multiple presenters, unknown names and responsive profile remain usable', async ({ page }) => {
  let title = '松本真央／佐藤剣慎';
  await page.route('**/data/live.json', r => r.fulfill({ json: { ...fixture.live, video: { ...fixture.live.video, title } } }));
  await page.goto('./#live'); const section = page.getByRole('region', { name: 'この配信のキャスター', exact: true });
  await section.getByRole('button', { name: '佐藤 剣慎', exact: true }).click();
  await expect(section.getByRole('heading', { name: '佐藤 剣慎', exact: true })).toBeVisible();
  await section.getByRole('button', { name: '松本 真央', exact: true }).click();
  await expect(section.getByRole('heading', { name: '松本 真央', exact: true })).toBeVisible();
  for (const width of [320, 390, 768, 1440, 3840]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.getByRole('button', { name: 'ダークモード', exact: true }).click(); await section.screenshot({ path: 'Data/verification/live-profile/profile-only-fixture.png' });
  title = 'キャスター未掲載'; await page.clock.fastForward(30001);
  await expect(section).toContainText('キャスターを確認できませんでした');
  await expect(section.locator('.live-caster-profile')).toHaveCount(0);
});
