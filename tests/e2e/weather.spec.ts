import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('tests/fixtures/weather-cards.json', 'utf8'));
const live = JSON.parse(readFileSync('tests/fixtures/site-data.json', 'utf8')).live;
const key = 'weathercas.weather-layout.v1';
const ids = (page: Page) => page.locator('.weather-panel').evaluateAll(es => es.map(e => e.getAttribute('data-weather-id')));
const check = (page: Page, title: string) => page.getByRole('checkbox', { name: new RegExp(`^${title}`) });
test.beforeEach(async ({ page }) => {
  await page.route('**/data/schedule.json', route => route.fulfill({ status: 503, json: {} }));
  await page.clock.install({ time: new Date(live.checked_at) });
  await page.route('**/data/live.json', r => r.fulfill({ json: live }));
  await page.route('https://www.youtube-nocookie.com/embed/**', r => r.fulfill({ body: '<p>Player fixture</p>' }));
  await page.route('https://www.youtube.com/live_chat**', r => r.fulfill({ body: '<p>Chat fixture</p>' }));
  await page.route('**/data/weather/*.json', r => {
    const id = new URL(r.request().url()).pathname.split('/').pop()!.replace('.json', '');
    return r.fulfill({ json: data[id] });
  });
});
test('selection, buttons, drag, widths, empty layout and reset persist across reload', async ({ page }) => {
  const requested: string[] = []; page.on('request', r => { if (r.url().includes('/data/weather/')) requested.push(r.url()); });
  await page.goto('./#weather'); await expect(page.locator('.weather-panel')).toHaveCount(2); expect(requested).toEqual([]);
  await page.getByRole('button', { name: '表示・配置をカスタマイズ', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(32);
  await check(page, '紫外線予報').check(); await expect(page.locator('[data-weather-id="uv"] .weather-table')).toBeVisible();
  await page.getByRole('button', { name: '紫外線予報を前へ', exact: true }).click();
  expect(await ids(page)).toEqual(['today', 'uv', 'typhoon']);
  await page.getByRole('button', { name: '紫外線予報をドラッグして移動', exact: true }).dragTo(page.locator('[data-weather-id="today"] .panel-heading'));
  expect(await ids(page)).toEqual(['uv', 'today', 'typhoon']);
  await page.getByRole('button', { name: '紫外線予報を横幅いっぱいに表示', exact: true }).click();
  await page.getByRole('button', { name: '全国の天気予報を非表示', exact: true }).click();
  const before = await page.evaluate(key => localStorage.getItem(key), key); expect(JSON.parse(before!).cards).toEqual([{ id: 'uv', wide: true }, { id: 'typhoon', wide: false }]);
  await page.reload(); expect(await ids(page)).toEqual(['uv', 'typhoon']); await expect(page.locator('[data-weather-id="uv"]')).toHaveClass(/weather-wide/);
  await page.getByRole('button', { name: '表示・配置をカスタマイズ', exact: true }).click();
  await check(page, '台風情報').uncheck(); await check(page, '紫外線予報').uncheck(); await page.reload();
  await expect(page.locator('.weather-panel')).toHaveCount(0); await expect(page.getByRole('button', { name: '表示する情報を選ぶ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '表示する情報を選ぶ', exact: true }).click(); await page.getByRole('button', { name: '初期配置に戻す', exact: true }).click();
  expect(await ids(page)).toEqual(['today', 'typhoon']); await page.reload(); expect(await ids(page)).toEqual(['today', 'typhoon']);
});
test('all 32 choices render data, forecast date changes, warnings filter and layout fits', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('./#weather'); await page.getByRole('button', { name: '表示・配置をカスタマイズ', exact: true }).click();
  for (const input of await page.getByRole('checkbox').all()) await input.check();
  await expect(page.locator('.weather-panel')).toHaveCount(32); await expect(page.locator('.weather-loading')).toHaveCount(0);
  await expect(page.locator('.weather-unavailable')).toHaveCount(0);
  const forecast = page.locator('[data-weather-id="weekly"]');
  await forecast.getByRole('combobox').selectOption('2'); await expect(forecast.locator('img')).toHaveAttribute('src', /20261023/);
  const warnings = page.locator('[data-weather-id="warnings"]'); await warnings.getByRole('searchbox').fill('青森市');
  await expect(warnings.locator('tbody tr')).toHaveCount(1); await warnings.getByRole('searchbox').fill('存在しない地域'); await expect(warnings).toContainText('一致する情報はありません');
  for (const width of [320, 390, 768, 1440, 3840]) {
    await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px`).toBe(true);
  }
  await page.getByRole('button', { name: 'ダークモード', exact: true }).click();
  expect(errors).toEqual([]);
});
test('malformed and unavailable storage stays usable and reports persistence limits', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, '{broken'), key); await page.goto('./#weather');
  await expect(page.locator('.weather-save-status')).toContainText('読み込めません'); await expect(page.locator('.weather-panel')).toHaveCount(2);
  await page.evaluate(() => Object.defineProperty(Storage.prototype, 'setItem', { value: () => { throw new DOMException('disabled', 'SecurityError'); } }));
  await page.getByRole('button', { name: '表示・配置をカスタマイズ', exact: true }).click(); await check(page, '紫外線予報').check();
  await expect(page.locator('.weather-save-status')).toContainText('保存が使えない'); await expect(page.locator('[data-weather-id="uv"]')).toBeVisible();
});
test('failed card retries without preventing the other card from loading', async ({ page }) => {
  let failed = true;
  await page.route('**/data/weather/uv.json', r => failed ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: data.uv }));
  await page.goto('./#weather'); await page.getByRole('button', { name: '表示・配置をカスタマイズ', exact: true }).click();
  await check(page, '紫外線予報').check(); await check(page, '今日の最高気温').check();
  const uv = page.locator('[data-weather-id="uv"]'); await expect(uv).toContainText('取得できません');
  await expect(page.locator('[data-weather-id="temperature"] .weather-table')).toBeVisible();
  failed = false; await uv.getByRole('button', { name: '再試行' }).click(); await expect(uv.locator('.weather-table')).toBeVisible();
});
test('visible cards refresh and recover from failures for five update cycles', async ({ page }) => {
  let cycle = 0, fails = false, calls = 0;
  await page.route('**/data/weather/uv.json', r => { calls++; return fails ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: { ...data.uv, caption: `更新 ${cycle}` } }); });
  await page.goto('./#weather'); await page.getByRole('button', { name: '表示・配置をカスタマイズ', exact: true }).click(); await check(page, '紫外線予報').check();
  const uv = page.locator('[data-weather-id="uv"]'); await expect(uv).toContainText('更新 0');
  for (cycle = 1; cycle <= 5; cycle++) {
    fails = true; await page.clock.fastForward(300001); await expect(uv).toContainText('取得できません');
    fails = false; await page.clock.fastForward(300001); await expect(uv).toContainText(`更新 ${cycle}`);
  }
  const count = calls; await check(page, '紫外線予報').uncheck(); await page.clock.fastForward(300001); expect(calls).toBe(count);
});
