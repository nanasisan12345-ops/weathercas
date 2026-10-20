import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
const records = fixture.partition.records;
const count = records.length;

test.beforeEach(async ({ page }, info) => {
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Official player fixture</p>' }));
  await page.route('https://www.youtube.com/live_chat**', route => route.fulfill({ contentType: 'text/html', body: '<p>Official chat fixture</p>' }));
  await page.route('**/api/recording', route => route.fulfill({ json: { supported: true, token: 'a'.repeat(64), job: null } }));
  if (info.title === 'collected files load through the real application entry') return;
  for (const [name, value] of Object.entries({ 'index.json': fixture.index, 'status.json': fixture.status,
    'live.json': fixture.live, '2026/10.json': fixture.partition })) {
    await page.route(`**/data/${name}`, route => route.fulfill({ json: value }));
  }
});

test('collected files load through the real application entry', async ({ page }) => {
  const index = JSON.parse(readFileSync('public/data/index.json', 'utf8'));
  await page.goto('./');
  await expect(page.locator('.results-heading')).toContainText(`${index.count}件の記録`);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '今日の出演予定' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow, noarchive');
});

test('fixture-backed search, filters, navigation, and statistics', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('.results-heading')).toContainText(`${count}件の記録`);
  await expect(page.locator('.stats-overview')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '取得状況とデータの出典' })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(2);
  await page.getByRole('link', { name: '出演履歴', exact: true }).click();
  await page.getByRole('searchbox', { name: '出演履歴を検索' }).fill('小川千奈');
  await expect(page.locator('#archive .record-row')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('小川千奈');
  await page.getByRole('button', { name: '条件をクリア' }).click();
  await page.getByRole('combobox', { name: 'キャスター', exact: true }).selectOption('matsumoto');
  await expect(page.locator('#archive .record-row')).toHaveCount(2);
  await page.goBack();
  await expect(page.getByRole('combobox', { name: 'キャスター', exact: true })).toHaveValue('');
  await page.goForward();
  await expect(page.getByRole('combobox', { name: 'キャスター', exact: true })).toHaveValue('matsumoto');
  await page.getByRole('button', { name: '条件をクリア' }).click();
  await page.locator('.segmented').getByRole('button', { name: '掲載予定', exact: true }).click();
  await expect(page.locator('.stats-description')).toContainText('8枠');
  await page.getByRole('link', { name: '出演番組表', exact: true }).click();
  await page.getByLabel('番組表の日付', { exact: true }).fill('2026-10-21');
  await expect(page.locator('.schedule-detail .record-row')).toHaveCount(4);
  await page.getByRole('button', { name: '前日', exact: true }).click();
  await expect(page.getByLabel('番組表の日付')).toHaveValue('2026-10-20');
  await page.getByLabel('番組表の日付').fill('2026-01-01');
  await expect(page.locator('.schedule-detail')).toContainText('この日の記録はありません');
  expect(errors).toEqual([]);
});

test('corrupt response and ended live fall back safely', async ({ page }) => {
  await page.route('**/data/index.json', route => route.fulfill({ json: { broken: true } }));
  await page.route('**/data/live.json', route => route.fulfill({ json: {
    schema_version: 1, checked_at: new Date().toISOString(), state: 'offline', video: null,
    embed_allowed: false, verification: 'official_listing', archives: [],
  } }));
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('データ形式を確認できません');
  await expect(page.locator('.player')).toContainText('配信中の動画は確認されていません');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '公式配信を見る', exact: false })).toBeVisible();
});

test('video and matching official chat are displayed automatically on page load', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Official player fixture</p>' }));
  await page.route('https://www.youtube.com/live_chat**', route => route.fulfill({ contentType: 'text/html', body: '<p>Official chat fixture</p>' }));
  await page.goto('./');
  await expect(page.locator('iframe')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '公式チャットを表示' })).toHaveCount(0);
  await expect(page.locator('nav[aria-label="メインナビゲーション"] a')).toHaveText(['ホーム', 'ライブ視聴', '天気・台風', '出演番組表', '出演履歴', '出演統計']);
  await expect(page.getByRole('link', { name: '録画する', exact: true })).toHaveCount(0);
  await expect(page.locator('.player iframe')).toHaveAttribute('src', /autoplay=1&mute=1/);
  await expect(page.locator('iframe[title="YouTube公式ライブチャット"]')).toHaveAttribute('src', /v=LbMd2BvWHHU&embed_domain=127.0.0.1$/);
  const player = await page.locator('.player').boundingBox(), capture = await page.locator('#capture').boundingBox();
  expect(capture!.y).toBeGreaterThanOrEqual(player!.y + player!.height);
  await expect(page.getByRole('link', { name: '公式チャットでコメントを書く', exact: false })).toHaveAttribute('href', /v=LbMd2BvWHHU&is_popout=1$/);
});

test('caster photographs load from official sources and fail to a neutral placeholder', async ({ page }) => {
  await page.goto('./');
  const photo = page.locator('.today-card img[alt*="松本 真央"]').first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.route('**/wnl/caster/images/caster/matsumoto.webp*', route => route.abort());
  await page.reload();
  await expect(page.locator('.today-card [aria-label="松本 真央の写真を表示できません"]')).toBeVisible();
});

test('responsive layout at mobile, small PC, desktop and high DPI', async ({ page }) => {
  for (const width of [320, 390, 768, 1280, 1920, 3840]) {
    await page.setViewportSize({ width, height: width > 1920 ? 2160 : 900 });
    await page.goto('./');
    await expect(page.locator('.results-heading')).toContainText(`${count}件の記録`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width}`).toBe(true);
    await expect(page.getByRole('heading', { name: '今日の出演予定' })).toBeVisible();
    await page.locator('.brand-content img').evaluate((img: HTMLImageElement) => img.decode());
    await expect(page.getByText('YOUR DAILY WEATHERCASTER COMPANION')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '時刻メモ', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `Data/verification/ui-${width}.png`, fullPage: false });
    await page.getByRole('link', { name: 'ライブ視聴', exact: true }).click();
    await page.locator('#capture').scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '録画開始', exact: true })).toBeInViewport();
  }
});

test('theme switching persists, follows the initial system preference, and remains usable without storage', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  const toggle = page.getByRole('button', { name: 'ダークモード', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.card').first()).toHaveCSS('background-color', 'rgb(25, 42, 59)');
  await toggle.click();
  expect(await page.evaluate(() => localStorage.getItem('weathercas.theme'))).toBe('light');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  for (const width of [320, 390, 1280, 3840]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `Data/verification/dark-${width}.png` });
  }
  await page.addInitScript(() => Object.defineProperty(Storage.prototype, 'setItem', { value: () => { throw new DOMException('Disabled', 'SecurityError'); } }));
  await page.reload();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('social icons beside names point to the officially listed accounts', async ({ page }) => {
  await page.goto('./');
  const row = page.locator('.today-card .record-row').filter({ hasText: '松本 真央' }).first();
  await expect(row.locator('.person-line')).toBeVisible();
  for (const [network, href] of Object.entries({ X: 'https://x.com/mao_matsumoto03', Instagram: 'https://www.instagram.com/mao__matsumoto/', TikTok: 'https://www.tiktok.com/@maoweathernews' })) {
    const link = row.getByRole('link', { name: `松本 真央の${network}（新しいタブ）`, exact: true });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(page.locator('.photo-placeholder[aria-label="出演者未確認"]').first().locator('..').locator('.caster-socials')).toHaveCount(0);
});

test('video and chat switch together when the official listing changes', async ({ page }) => {
  await page.clock.install();
  let switched = false;
  await page.route('**/data/live.json', route => route.fulfill({ json: switched ? { ...fixture.live, checked_at: new Date().toISOString(), video: { ...fixture.live.video, id: 'U-NLyctHkvs' } } : fixture.live }));
  await page.goto('./');
  await expect(page.locator('.player iframe')).toHaveAttribute('src', /LbMd2BvWHHU/);
  switched = true;
  await page.clock.fastForward(61000);
  await expect(page.locator('.player iframe')).toHaveAttribute('src', /U-NLyctHkvs/);
  await expect(page.getByTitle('YouTube公式ライブチャット')).toHaveAttribute('src', /v=U-NLyctHkvs/);
});

test('official forecast and typhoon images load and have useful error links', async ({ page }) => {
  await page.goto('./#weather');
  await expect(page.getByRole('heading', { name: '全国の天気・台風情報' })).toBeInViewport();
  const maps = page.locator('.weather-map img');
  await expect(maps).toHaveCount(2);
  for (const img of await maps.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await page.getByRole('button', { name: 'ダークモード', exact: true }).click();
  await page.locator('#weather').screenshot({ path: 'Data/verification/weather-panels.png' });
  await page.route('**/site/forecast/image/map/JAPAN.today.png*', route => route.abort());
  await page.reload();
  await expect(page.getByRole('link', { name: '公式の全国の天気予報を開く', exact: true })).toHaveAttribute('href', 'https://weathernews.jp/');
  await expect(page.locator('.weather-panel').first()).toContainText('画像を読み込めませんでした');
});

test.describe('Windows high DPI', () => {
  test.use({ deviceScaleFactor: 2 });
  test('text and social controls fit at 200 percent scale', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.results-heading')).toContainText(`${count}件の記録`);
    await page.locator('.today-card').scrollIntoViewIfNeeded();
    await expect(page.locator('.caster-socials').first()).toBeVisible();
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.today-card').screenshot({ path: 'Data/verification/casters-200dpi.png' });
  });
});
