import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8'));
const records = fixture.partition.records;
const count = records.length;

test.beforeEach(async ({ page }, info) => {
  await page.route('**/data/schedule.json', route => route.fulfill({ status: 503, json: {} }));
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Official player fixture</p>' }));
  await page.route('https://www.youtube.com/live_chat**', route => route.fulfill({ contentType: 'text/html', body: '<p>Official chat fixture</p>' }));
  await page.route('**/api/recording', route => route.fulfill({ json: { supported: true, token: 'a'.repeat(64), job: null } }));
  if (info.title === 'collected files load through the real application entry') return;
  // Fixture metadata must not expire just because CI runs on a later date.
  await page.clock.install({ time: new Date(fixture.live.checked_at) });
  await page.route('**/data/broadcasts.json', route => route.fulfill({ json: { schema_version: 1, records: [] } }));
  await page.route('**/data/reference-schedule/index.json', route => route.fulfill({ json: { schema_version: 1, months: {} } }));
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
  await expect(page.locator('.player iframe, .chat-content iframe')).toHaveCount(2);
  await page.getByRole('link', { name: '出演履歴', exact: true }).click();
  await page.getByRole('searchbox', { name: '出演履歴を検索' }).fill('小川千奈');
  await expect(page.locator('#archive .monthly-program')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('小川千奈');
  await page.getByRole('button', { name: '条件をクリア' }).click();
  await page.getByRole('combobox', { name: 'キャスター', exact: true }).selectOption('matsumoto');
  await expect(page.locator('#archive .monthly-program')).toHaveCount(2);
  await page.goBack();
  await expect(page.getByRole('combobox', { name: 'キャスター', exact: true })).toHaveValue('');
  await page.goForward();
  await expect(page.getByRole('combobox', { name: 'キャスター', exact: true })).toHaveValue('matsumoto');
  await page.getByRole('button', { name: '条件をクリア' }).click();
  await expect(page.locator('.stats-description')).toContainText('8枠');
  await expect(page.locator('#statistics').getByRole('button', { name: '確認済みの出演' })).toHaveCount(0);
  await page.getByRole('link', { name: '出演番組表', exact: true }).click();
  await page.getByLabel('番組表の日付', { exact: true }).fill('2026-10-21');
  await expect(page.locator('.schedule-detail .record-row')).toHaveCount(4);
  await page.getByRole('button', { name: '前日', exact: true }).click();
  await expect(page.getByLabel('番組表の日付')).toHaveValue('2026-10-20');
  await page.getByLabel('番組表の日付').fill('2026-01-01');
  await expect(page.locator('.schedule-detail')).toContainText('この日の記録はありません');
  expect(errors).toEqual([]);
});

test('monthly schedule switches months and opens linked replays and specials', async ({ page }) => {
  const date = '2026-11-07';
  const source = `https://minorin.jp/wnl/caster.cgi?FROM=${date}&TO=${date}`;
  await page.route('https://i.ytimg.com/vi/**', route => route.request().url().includes('rxl82HN57z8') ?
    route.abort() : route.fulfill({ path: 'tests/fixtures/weather-map.svg' }));
  await page.route('**/data/broadcasts.json', route => route.fulfill({ json: { schema_version: 1, records: [
    { date_jst: date, slot_start_jst: '05:00', program: 'モーニング', caster_name: '松本真央', forecaster_name: '山口剛央',
      video_id: 'pV86JU3JquE', reference_url: source },
    { date_jst: date, slot_start_jst: null, program: '特別番組・気候変動', caster_name: null, forecaster_name: null,
      video_id: 'rxl82HN57z8', reference_url: source },
  ] } }));
  await page.goto('./#schedule');
  await expect(page.getByRole('heading', { name: '月別の出演番組表' })).toBeVisible();
  await page.getByLabel('表示月').selectOption('2026-11');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: date + 'の日別詳細' }) });
  await expect(row.getByRole('cell').first()).toContainText('松本真央');
  await expect(row.getByRole('cell').last().locator('.monthly-program')).toHaveAttribute('title', '特別番組・気候変動');
  const link = row.getByRole('link', { name: /モーニングをYouTubeで見る/ });
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=pV86JU3JquE');
  await expect(link).toHaveAttribute('target', '_blank');
  const thumbnail = link.locator('img');
  await thumbnail.scrollIntoViewIfNeeded();
  await expect(thumbnail).toHaveAttribute('src', 'https://i.ytimg.com/vi/pV86JU3JquE/mqdefault.jpg');
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const specialLink = row.getByRole('link', { name: /特別番組・気候変動をYouTubeで見る/ });
  await specialLink.scrollIntoViewIfNeeded();
  await expect(specialLink.locator('img')).toHaveAttribute('hidden', '');
  await expect(specialLink).toBeVisible();
  await expect(row.getByRole('link', { name: '参考元（みのりん）' })).toHaveCount(0);
  await expect(row.locator('.monthly-program .badge')).toHaveCount(0);
  await page.getByText('2026年11月のキャスター別集計').click();
  await expect(page.locator('.monthly-summary')).toContainText('松本 真央');
  await page.getByRole('combobox', { name: 'キャスター', exact: true }).selectOption('matsumoto');
  const results = page.getByRole('list', { name: '2026年11月の該当番組一覧' });
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(results).toContainText('松本真央');
  await expect(results.getByRole('link', { name: /特別番組・気候変動をYouTubeで見る/ })).toHaveCount(0);
  await expect(page.locator('.monthly-table')).toHaveCount(0);
  await results.getByRole('button', { name: /2026-11-07 モーニングの日別詳細/ }).click();
  await expect(page.getByLabel('番組表の日付')).toHaveValue(date);
  await expect(page.locator('.schedule-detail')).toContainText('特別番組・気候変動');
  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.getByRole('button', { name: '条件をクリア' }).click();
  await expect.poll(() => page.locator('.monthly-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.getByRole('combobox', { name: '番組', exact: true }).selectOption({ label: '特別番組・その他' });
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(results).toContainText('特別番組・気候変動');
});

test('the monthly table shows reference-only history without a video or source link', async ({ page }) => {
  await page.route('**/data/reference-schedule/index.json', route => route.fulfill({ json: { schema_version: 1, months: { '2021-12': 1 } } }));
  await page.route('**/data/reference-schedule/2021-12.json', route => route.fulfill({ json: { schema_version: 1, records: [
    { date_jst: '2021-12-01', slot_start_jst: '05:00', casters: ['角田奈緒子'], forecasters: [] },
  ] } }));
  await page.goto('./#schedule');
  await page.getByLabel('表示月').selectOption('2021-12');
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: '2021-12-01の日別詳細' }) });
  await expect(row.getByRole('cell').first()).toContainText('角田奈緒子');
  await expect(row.getByRole('link')).toHaveCount(0);
  await expect(page.locator('.stats-description')).toContainText('2021年12月');
  await expect(page.locator('.stats-description')).toContainText('1枠');
  await expect(page.locator('.stats-description')).toContainText('2021/12/01');
  await page.getByRole('combobox', { name: 'キャスター', exact: true }).selectOption({ label: '角田奈緒子' });
  const results = page.getByRole('list', { name: '2021年12月の該当番組一覧' });
  await expect(results).toContainText('角田奈緒子');
  await results.getByRole('button', { name: /2021-12-01 モーニングの日別詳細/ }).click();
  await expect(page.locator('.schedule-detail')).toContainText('参考番組表');
  await page.getByRole('button', { name: '条件をクリア' }).click();
  await page.getByLabel('表示月').selectOption('2026-10');
  await expect(page.locator('.stats-description')).toContainText('2026年10月');
  await expect(page.locator('.stats-description')).toContainText('8枠');
});

test('historical month uses the reference thumbnail for unlinked slots and prefers a verified replay', async ({ page }) => {
  const date = '2026-10-20';
  await page.route('https://i.ytimg.com/vi/**', route => route.fulfill({ path: 'tests/fixtures/weather-map.svg' }));
  await page.route('**/data/reference-schedule/index.json', route => route.fulfill({ json: { schema_version: 1, months: { '2026-10': 2 } } }));
  await page.route('**/data/reference-schedule/2026-10.json', route => route.fulfill({ json: { schema_version: 1, records: [
    { date_jst: date, slot_start_jst: '05:00', casters: ['小川千奈'], forecasters: [], video_id: '5aHJV4-v48k' },
    { date_jst: date, slot_start_jst: '08:00', casters: ['松本真央'], forecasters: [], video_id: 'LwVRVGkwWVI' },
  ] } }));
  await page.route('**/data/broadcasts.json', route => route.fulfill({ json: { schema_version: 1, records: [
    { date_jst: date, slot_start_jst: '05:00', program: 'モーニング', caster_name: '小川千奈', forecaster_name: null,
      video_id: 'pV86JU3JquE', reference_url: null },
  ] } }));
  await page.goto(`./#schedule?date=${date}`);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: date + 'の日別詳細' }) });
  const morning = row.getByRole('link', { name: /モーニングをYouTubeで見る/ });
  const sunshine = row.getByRole('link', { name: /サンシャインをYouTubeで見る.*参考番組表/ });
  await expect(morning).toHaveAttribute('href', 'https://www.youtube.com/watch?v=pV86JU3JquE');
  await expect(sunshine).toHaveAttribute('href', 'https://www.youtube.com/watch?v=LwVRVGkwWVI');
  const thumbnail = sunshine.locator('img');
  await thumbnail.scrollIntoViewIfNeeded();
  await expect(thumbnail).toHaveAttribute('src', 'https://i.ytimg.com/vi/LwVRVGkwWVI/mqdefault.jpg');
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(row.getByText('参考元（みのりん）')).toHaveCount(0);
});

test('program filtering shows date-ordered cards without the old confidence filter', async ({ page }) => {
  await page.goto('./#schedule?date=2026-10-20&status=confirmed');
  await expect(page.getByRole('combobox', { name: '確度' })).toHaveCount(0);
  await page.getByRole('combobox', { name: '番組', exact: true }).selectOption('サンシャイン');
  const results = page.getByRole('list', { name: '2026年10月の該当番組一覧' });
  const expected = records.filter((row: { program: string }) => row.program.includes('サンシャイン'));
  await expect(results.getByRole('listitem')).toHaveCount(expected.length);
  await expect(results.locator('header button time')).toHaveText(expected.map((row: { date_jst: string }) => row.date_jst.slice(5).replace('-', '/')));
  await expect(page.locator('.monthly-table')).toHaveCount(0);
});

test('corrupt response and ended live fall back safely', async ({ page }) => {
  await page.route('**/data/index.json', route => route.fulfill({ json: { broken: true } }));
  await page.route('**/data/live.json', route => route.fulfill({ json: {
    schema_version: 1, checked_at: fixture.live.checked_at, state: 'offline', video: null,
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
  await expect(page.locator('.player iframe, .chat-content iframe')).toHaveCount(2);
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
  await page.locator('.today-card').first().scrollIntoViewIfNeeded();
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
  let switched = false;
  const switchedAt = new Date(Date.parse(fixture.live.checked_at) + 31000).toISOString();
  await page.route('**/data/live.json', route => route.fulfill({ json: switched ? { ...fixture.live, checked_at: switchedAt, video: { ...fixture.live.video, id: 'U-NLyctHkvs' } } : fixture.live }));
  await page.goto('./');
  await expect(page.locator('.player iframe')).toHaveAttribute('src', /LbMd2BvWHHU/);
  switched = true;
  await page.clock.fastForward(31000);
  await expect(page.locator('.player iframe')).toHaveAttribute('src', /U-NLyctHkvs/);
  await expect(page.getByTitle('YouTube公式ライブチャット')).toHaveAttribute('src', /v=U-NLyctHkvs/);
});

test('returning to a visible tab checks the new broadcast immediately', async ({ page }) => {
  let switched = false;
  await page.route('**/data/live.json', route => route.fulfill({ json: switched ? { ...fixture.live, video: { ...fixture.live.video, id: 'U-NLyctHkvs' } } : fixture.live }));
  await page.goto('./#live');
  await expect(page.locator('.player iframe')).toHaveAttribute('src', /LbMd2BvWHHU/);
  switched = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.player iframe')).toHaveAttribute('src', /U-NLyctHkvs/);
  await expect(page.getByTitle('YouTube公式ライブチャット')).toHaveAttribute('src', /v=U-NLyctHkvs/);
});

for (const evening of ['2026-10-20', '2026-10-31', '2026-12-31', '2027-02-28', '2030-06-15']) {
  test(`video and chat recover after an offline night beginning ${evening}`, async ({ page }) => {
    const start = Date.parse(`${evening}T23:00:00+09:00`);
    await page.clock.setSystemTime(start);
    let response = { ...fixture.live, checked_at: new Date(start).toISOString() };
    await page.route('**/data/live.json', route => route.fulfill({ json: response }));
    await page.goto('./#live');
    await expect(page.locator('.player iframe')).toHaveAttribute('src', /LbMd2BvWHHU/);

    response = { ...response, checked_at: new Date(start + 61000).toISOString(), state: 'offline', video: null, embed_allowed: false };
    await page.clock.fastForward(61000);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('.player')).toContainText('配信中の動画は確認されていません');

    // A tab left open overnight must still poll after the old metadata expires.
    await page.clock.fastForward(8 * 3600000);
    await expect(page.locator('.player')).toContainText('配信情報の確認期限が過ぎています');
    const morning = new Date(start + 8 * 3600000 + 122000).toISOString();
    response = { ...fixture.live, checked_at: morning, video: { ...fixture.live.video, id: 'U-NLyctHkvs' } };
    await page.clock.fastForward(61000);
    await expect(page.locator('.player iframe')).toHaveAttribute('src', /U-NLyctHkvs/);
    await expect(page.getByTitle('YouTube公式ライブチャット')).toHaveAttribute('src', /v=U-NLyctHkvs/);
    await page.reload();
    await expect(page.locator('.player iframe')).toHaveAttribute('src', /U-NLyctHkvs/);
  });
}

test('forecast and typhoon cards display images and link to the official site on error', async ({ page }) => {
  await page.route('**/{JAPAN.today,multi_onebox}.png*', route => route.fulfill({ path: 'tests/fixtures/weather-map.svg' }));
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
  await expect(page.getByRole('link', { name: /^公式の全国の天気予報を開く/ })).toHaveAttribute('href', 'https://weathernews.jp/');
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
