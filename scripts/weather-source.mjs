// Fixed public sources only: neither callers nor upstream responses may choose fetch destinations.
const SITE = 'https://site.weathernews.jp';
export const weatherSources = Object.freeze({
  forecast: 'https://weathernews.jp/comment/map_area/japan.json',
  ...Object.fromEntries(['hokkaido', 'tohoku', 'kanto', 'chubu', 'kinki', 'chugoku', 'shikoku', 'kyushu', 'okinawa']
    .map(area => [`forecast${area}`, `https://weathernews.jp/comment/map_area/${area}.json`])),
  chart: 'https://weathernews.jp/onebox/chart/api/chart/fctList',
  satellite: 'https://memgvs-cdn.weathernews.jp/s/satellite/cloud/JAPAN/index.json',
  radar: 'https://tile.weathernews.jp/3/json/airadar_3600.json',
  earthquake: 'https://mws.cdn.weathernews.jp/s/quake/json/quake.json',
  tsunami: 'https://mws.cdn.weathernews.jp/s/tsunami_v2/json/image.json',
  warnings: `${SITE}/app/warning_v3/allcity.json`,
  uv: 'https://api.weathernews.jp/uv/json/JAPAN.json',
  dry: `${SITE}/app/dryness-index/JAPAN.json`,
  cold: `${SITE}/app/cold-index/JAPAN.json`,
  heat: `${SITE}/app/wbgt-index/JAPAN.json`,
  laundry: `${SITE}/site/washing/json/map/JAPAN.json`,
  pain: `${SITE}/pain/json/map/JAPAN.json`,
  ...Object.fromEntries(Object.entries({ temperature: 'AIR_TEMP_1DAY_MAX', minimum: 'AIR_TEMP_1DAY_MIN',
    rain: 'RAIN_AMNT_1HOUR_TOTAL_1DAY_MAX', wind: 'WIND_VEL_10MIN_MEAN', snow: 'SNOW_AMNT_1HOUR_TOTAL_1DAY_MAX',
    humidity: 'AIR_HUM_1DAY_MIN' }).map(([id, element]) => [id, `${SITE}/info/data/obs/rank/${element}/latest_top10.json`])),
});
const list = value => { if (!Array.isArray(value) || value.length > 5000) throw new Error('Invalid weather list'); return value; };
const str = value => { if (typeof value !== 'string' || value.length > 500) throw new Error('Invalid weather text'); return value; };
const number = value => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid weather number'); return value; };
const dateFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const date = seconds => dateFormat.format(new Date(number(seconds) * 1000));
function image(src, label) {
  const url = new URL(str(src));
  if (url.protocol !== 'https:' || !['site.weathernews.jp', 'gvs.weathernews.jp', 'mws.cdn.weathernews.jp', 'memgvs-cdn.weathernews.jp'].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error('Invalid weather image');
  return { src: url.href, label: str(label) };
}
const labels = {
  dry: ['', 'しっとり', 'やや乾燥', '乾燥', 'カラカラ', '超カラカラ'],
  cold: ['', '安心', 'やや注意', '注意', '警戒'],
  heat: ['ほぼ安全', 'やや注意', '注意', '警戒', '厳重警戒', '危険'],
};
const alarmNames = { rain: '大雨', flood: '氾濫', wind: '強風', wave: '波浪', thunder: '雷', fog: '濃霧',
  snow: '大雪', windsnow: '風雪', dry: '乾燥', frost: '霜', cold: '低温', snowslide: 'なだれ',
  meltsnow: '融雪', sticksnow: '着雪', stickice: '着氷', tide: '高潮', landslide: '土砂災害', other: 'その他' };
function alarm(code) {
  const [kind, type] = str(code).split('_');
  const severity = { warn: '注意報', alrm: '警報', urgt: '危険警報', exal: '特別警報' }[kind];
  return alarmNames[type] && severity
    ? `${severity}：${kind !== 'warn' && type === 'wind' ? '暴風' : kind !== 'warn' && type === 'windsnow' ? '暴風雪' : alarmNames[type]}`
    : 'その他の情報（公式で確認）';
}
export function normalizeWeather(id, raw) {
  if (id.startsWith('forecast') && Object.hasOwn(weatherSources, id)) return { caption: '予報日を選んで表示', images: list(raw.fcst).map(x => image(x.mapsrc, `${number(x.date)}日（${str(x.day)}）`)) };
  if (id === 'chart') {
    const obs = list(raw.data).find(x => x.forecastType === 'obs');
    if (!obs || !/^WNIONEBOX_anl\/[0-9/]+\/A_[\d-]+\.webp$/.test(obs.pc)) throw new Error('Missing observed chart');
    return { caption: `${date(obs.tm)}の実況天気図`, images: [image(`https://gvs.weathernews.jp/onebox/chart/img/${obs.pc}`, '実況天気図')] };
  }
  if (id === 'satellite') {
    const latest = list(raw.url_list).toSorted((a, b) => number(b.tm) - number(a.tm))[0];
    return { caption: `${date(latest.tm)}の衛星雲画像`, images: [image(latest.imgsrc, '日本付近の雲画像')] };
  }
  if (id === 'radar') {
    const latest = list(raw.tile).filter(x => x.isForecast === false && !x.isPremium).toSorted((a, b) => number(b.tm) - number(a.tm))[0];
    if (!latest || !/^https:\/\/tile\.weathernews\.jp\/3\/tile\/rad_anl\/[\d/]+\/[\d-]+_Tiles_\d+$/.test(latest.d)) throw new Error('Invalid radar tile');
    return { caption: `${date(latest.tm)}の雨雲（実況）`, radar: latest.d };
  }
  if (id === 'earthquake') {
    const items = list(raw); if (!items.length) throw new Error('No earthquake data');
    const x = items[0];
    return { caption: `最新の掲載地震：${str(x.atime)}`, images: [image(x.imgsrc, '最新の地震の震度分布')],
      rows: items.slice(0, 5).map(q => ({ name: str(q.spot), value: `${str(q.maxclass)} / M${str(q.spotmag)}`, detail: str(q.atime) })) };
  }
  if (id === 'tsunami') return { caption: `画像の発表日時：${date(raw.atime)}`, images: [image(raw.imgsrc, '公式の津波情報図')],
    notice: raw.publish === 'false' ? '公式の掲載情報は発表終了となっています。現在の発表状況は公式ページで確認してください。' : '最新の警報・注意報は公式ページも確認してください。' };
  if (id === 'warnings') return { caption: '発表のある市区町村。地域名で絞り込めます。',
    rows: list(raw).filter(x => list(x.alarms).length > 0).map(x => ({ name: str(x.cityname), value: list(x.alarms).map(alarm).join('・'), detail: str(x.datestr) })) };
  if (id === 'uv') return { caption: `${date(raw.dailytm[0]).split(' ')[0]}の紫外線予報（全国主要都市）`, rows: list(raw.data).map(x => {
    const v = number(x.daily[0]); if (v < 0) return { name: str(x.city), value: 'データなし' };
    return { name: str(x.city), value: `${v === 0 ? 'なし' : v <= 2 ? '弱い' : v <= 5 ? 'やや強い' : v <= 7 ? '強い' : v <= 10 ? '非常に強い' : '極端に強い'}（${v}）` };
  }) };
  if (Object.hasOwn(labels, id)) {
    const x = list(raw)[0], key = { dry: 'dry', cold: 'cold', heat: 'wbgt' }[id];
    return { caption: `${date(number(x.day) / 1000)}対象（全国主要都市）`, rows: list(x.points).map(p => ({ name: str(p.name), value: labels[id][number(p[key])] || 'データなし' })) };
  }
  if (id === 'laundry') {
    const x = list(raw)[0];
    return { caption: str(x.show_date), rows: list(x.points).map(p => ({ name: str(p.name),
      value: ({ 10: '速乾', 20: 'OK', 30: '心配', 40: 'NG', 50: '寒くてNG' })[number(p.LX)] || 'データなし' })) };
  }
  if (id === 'pain') return { caption: `${str(raw.mrf_attr.day_str[0])}対象（全国主要都市）`,
    rows: list(raw.mrf).map(p => ({ name: str(p.name), value: ['安心', 'やや注意', '注意', '警戒'][number(p.pain[0])] || 'データなし' })) };
  if (['temperature', 'minimum', 'rain', 'wind', 'snow', 'humidity'].includes(id)) {
    const stamp = str(raw.announced_date).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    const unit = { temperature: '℃', minimum: '℃', rain: 'mm', wind: 'm/s', snow: 'cm', humidity: '%' }[id];
    return { caption: `${date(Date.parse(stamp) / 1000)}発表・上位10地点`, rows: list(raw.rank).map(x => ({
      name: `${str(x.pref)} ${str(x.obsln)}`, value: `${number(x.dataval)} ${unit}`, ...(x.occured_unixtime ? { detail: `${date(x.occured_unixtime)}観測` } : {}),
    })) };
  }
  throw new Error('Unknown weather source');
}
async function getJSON(url) {
  // Workers supports manual redirects; rejecting non-2xx keeps destinations fixed.
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'manual', headers: { Accept: 'application/json' } });
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error(`Weather source HTTP ${response.status}, type ${response.headers.get('content-type')}`);
  const text = await response.text(); if (text.length > 1500000) throw new Error('Weather response too large');
  return JSON.parse(text);
}
export function createWeatherResolver({ fetchJSON = getJSON, now = Date.now, cacheMilliseconds = 60000 } = {}) {
  const entries = new Map(), pending = new Map();
  return async id => {
    if (!Object.hasOwn(weatherSources, id)) throw new Error('Unknown weather source');
    const hit = entries.get(id); if (hit && now() - hit.time < cacheMilliseconds) return hit.data;
    if (pending.has(id)) return pending.get(id);
    const work = (async () => {
      const content = normalizeWeather(id, await fetchJSON(weatherSources[id]));
      const data = { checked_at: new Date(now()).toISOString(), ...content };
      entries.set(id, { time: now(), data }); return data;
    })();
    pending.set(id, work);
    try { return await work; } finally { pending.delete(id); }
  };
}
export function createWeatherHandler() {
  const resolve = createWeatherResolver();
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1'), match = /^\/weathercas\/data\/weather\/([a-z]+)\.json$/.exec(url.pathname);
    if (!match) return next();
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (!Object.hasOwn(weatherSources, match[1]) || url.search) { res.writeHead(404, headers); res.end('{}'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end('{}'); return; }
    try { const body = JSON.stringify(await resolve(match[1])); res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body); }
    catch { res.writeHead(503, headers); res.end(JSON.stringify({ error: '天気情報を取得できませんでした。' })); }
  };
}
