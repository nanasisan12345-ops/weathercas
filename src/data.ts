import { z } from 'zod';

const text = z.string().min(1).max(500);
const id = z.string().regex(/^[a-z0-9_-]{1,64}$/);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const videoId = z.string().regex(/^[a-zA-Z0-9_-]{11}$/);
export const officialUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password &&
    ['weathernews.jp', 'site.weathernews.jp', 'www.youtube.com', 'youtu.be',
      'developers.google.com', 'www.googleapis.com'].includes(url.hostname);
});
const evidence = z.object({
  caster_id: id, caster_name: text, source_url: officialUrl, source_checked_at: timestamp,
});
const plan = z.object({
  caster_id: id.nullable(), caster_name: text.nullable(), raw_caster_id: id.nullable(),
  source_url: officialUrl, source_type: z.literal('official_schedule'), source_checked_at: timestamp,
});
export const recordSchema = z.object({
  id: text, date_jst: date, slot_start_jst: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  program: text, date_basis: z.literal('rolling_schedule'), role: z.literal('presenter'),
  planned: plan, confirmed: evidence.nullable(), status: z.enum(['scheduled', 'confirmed', 'unverified']),
  youtube_video_id: videoId.nullable(),
  changes: z.array(z.object({ changed_at: timestamp, previous_program: text, previous_plan: plan })).max(5000),
}).refine(row => row.id === `${row.date_jst}T${row.slot_start_jst}` &&
  (row.status === 'confirmed' ? row.confirmed !== null : row.confirmed === null) &&
  (row.status !== 'scheduled' || (row.planned.caster_id !== null && row.planned.caster_name !== null)),
  'Inconsistent record');
export type Appearance = z.infer<typeof recordSchema>;
export const partitionSchema = z.object({ schema_version: z.literal(1), records: z.array(recordSchema).max(10000) });
export const indexSchema = z.object({
  schema_version: z.literal(1), months: z.array(z.string().regex(/^\d{4}\/(?:0[1-9]|1[0-2])$/)).max(1200),
  casters: z.array(z.object({ id, name: text, aliases: z.array(id) })).max(500),
  count: z.number().int().nonnegative(), earliest_date: date.nullable(), latest_date: date.nullable(),
});
export type DataIndex = z.infer<typeof indexSchema>;
export const statusSchema = z.object({
  schema_version: z.literal(1), generated_at: timestamp, healthy: z.boolean(), interval_hours: z.number(), note: text,
  sources: z.array(z.object({
    id, label: text, url: officialUrl, checked_at: timestamp, last_success_at: timestamp.nullable(),
    last_failure_at: timestamp.nullable(), count: z.number().int().nonnegative(),
    status: z.enum(['ok', 'failed', 'unconfigured']), message: text,
  })).max(20),
  quality: z.object({ scheduled: z.number(), confirmed: z.number(), unverified: z.number(), changes: z.number() }),
});
export type CollectionStatus = z.infer<typeof statusSchema>;
const videoSchema = z.object({ id: videoId, title: text, source_url: officialUrl, published_at: timestamp });
export const liveSchema = z.object({
  schema_version: z.literal(1), checked_at: timestamp, state: z.enum(['listed', 'live', 'offline', 'failed']),
  video: videoSchema.nullable(), embed_allowed: z.boolean(),
  verification: z.enum(['official_listing', 'youtube_api', 'unverified']),
  archives: z.array(videoSchema).max(100), archives_checked_at: timestamp.nullable().optional(),
}).refine(value => !['listed', 'live'].includes(value.state) || value.video !== null);
export type LiveData = z.infer<typeof liveSchema>;
export type Dataset = { index: DataIndex; records: Appearance[]; status: CollectionStatus };

async function getJSON<T>(path: string, schema: z.ZodType<T>, endpoint?: string): Promise<T> {
  const response = await fetch(endpoint || `${import.meta.env.BASE_URL}data/${path}`, {
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('データを読み込めませんでした。時間をおいて再読み込みしてください。');
  const result = schema.safeParse(await response.json());
  if (!result.success) throw new Error('データ形式を確認できません。安全のため表示を停止しています。');
  return result.data;
}

export async function loadDataset(): Promise<Dataset> {
  const [index, status] = await Promise.all([getJSON('index.json', indexSchema), getJSON('status.json', statusSchema)]);
  const records: Appearance[] = [];
  for (let i = 0; i < index.months.length; i += 4) {
    const batch = index.months.slice(i, i + 4);
    const parts = await Promise.all(batch.map(month => getJSON(`${month}.json`, partitionSchema)));
    parts.forEach((part, j) => {
      if (part.records.some(row => row.date_jst.slice(0, 7).replace('-', '/') !== batch[j])) {
        throw new Error('データの日付を確認できません。');
      }
      records.push(...part.records);
    });
  }
  if (new Set(records.map(row => row.id)).size !== records.length || records.length !== index.count) {
    throw new Error('更新中のデータを検出しました。しばらくしてから再読み込みしてください。');
  }
  return { index, status, records: records.sort((a, b) => a.id.localeCompare(b.id)) };
}
export const loadLive = () => getJSON('live.json', liveSchema, import.meta.env.VITE_LIVE_ENDPOINT);

export function jstDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function shiftDate(value: string, days: number): string {
  const now = new Date(`${value}T12:00:00+09:00`);
  now.setTime(now.getTime() + days * 86400000);
  return jstDate(now);
}
export function showTime(value: string | null | undefined): string {
  return value ? `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))} JST` : '未取得';
}
export function fresh(value: string, now = Date.now(), minutes = 240): boolean {
  const age = now - Date.parse(value);
  return Number.isFinite(age) && age >= -60000 && age <= minutes * 60000;
}
export function livePresentation(live: LiveData | null, now = Date.now()) {
  if (!live || live.state === 'failed') return { label: '配信状況を確認できません', tone: 'neutral', embed: false };
  if (!fresh(live.checked_at, now)) return { label: '配信情報の確認期限が過ぎています', tone: 'neutral', embed: false };
  if (live.state === 'offline') return { label: '配信中の動画は確認されていません', tone: 'neutral', embed: false };
  const verified = live.state === 'live' && live.verification === 'youtube_api' && fresh(live.checked_at, now, 15);
  return { label: verified ? 'LIVE確認済み（取得時点）' : '公式掲載の配信（現在LIVEは未確認）',
    tone: verified ? 'live' : 'neutral', embed: live.embed_allowed && live.video !== null };
}

export type Route = { view: string; date: string; q: string; caster: string; program: string;
  month: string; year: string; status: string; stats: 'confirmed' | 'scheduled' };
export function parseRoute(hash: string, today = jstDate()): Route {
  const [view, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const short = (name: string) => (params.get(name) || '').slice(0, 200);
  const day = date.safeParse(params.get('date'));
  return { view: ['home', 'live', 'schedule', 'weather', 'archive', 'statistics', 'capture', 'privacy', 'main-content'].includes(view) ? view : 'home',
    date: day.success ? day.data : today, q: short('q'), caster: short('caster'), program: short('program'),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(short('month')) ? short('month') : '',
    year: /^\d{4}$/.test(short('year')) ? short('year') : '',
    status: ['scheduled', 'confirmed', 'unverified'].includes(short('status')) ? short('status') : '',
    stats: params.get('stats') === 'scheduled' ? 'scheduled' : 'confirmed' };
}
export function routeHash(route: Route): string {
  const query = new URLSearchParams();
  Object.entries(route).forEach(([key, value]) => { if (key !== 'view' && value) query.set(key, value); });
  return `#${route.view}?${query}`;
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s/g, '');
export function filterRecords(rows: Appearance[], route: Route, casters: DataIndex['casters'] = []): Appearance[] {
  return rows.filter(row => {
    const person = row.confirmed || row.planned;
    const aliases = casters.find(c => c.id === person.caster_id)?.aliases.join(' ') || '';
    return (!route.month || row.date_jst.startsWith(route.month)) && (!route.year || row.date_jst.startsWith(route.year)) &&
      (!route.status || row.status === route.status) && (!route.caster || person.caster_id === route.caster) &&
      (!route.program || row.program === route.program) &&
      (!route.q || normalize(`${row.date_jst} ${row.program} ${person.caster_name || ''} ${person.caster_id || ''} ${aliases}`).includes(normalize(route.q)));
  });
}
export function aggregate(rows: Appearance[], mode: 'confirmed' | 'scheduled') {
  const chosen = rows.filter(row => row.status === mode);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'].map(label => [label, 0] as [string, number]);
  const caster = new Map<string, number>(), program = new Map<string, number>(), month = new Map<string, number>(), year = new Map<string, number>();
  for (const row of chosen) {
    const name = (mode === 'confirmed' ? row.confirmed : row.planned)?.caster_name;
    if (!name) continue;
    caster.set(name, (caster.get(name) || 0) + 1);
    program.set(row.program, (program.get(row.program) || 0) + 1);
    month.set(row.date_jst.slice(0, 7), (month.get(row.date_jst.slice(0, 7)) || 0) + 1);
    year.set(row.date_jst.slice(0, 4), (year.get(row.date_jst.slice(0, 4)) || 0) + 1);
    weekday[new Date(`${row.date_jst}T12:00:00+09:00`).getUTCDay()][1]++;
  }
  return { total: chosen.length, caster: [...caster].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')),
    program: [...program], year: [...year].sort(), month: [...month].sort(), weekday: [...weekday.slice(1), weekday[0]] };
}
