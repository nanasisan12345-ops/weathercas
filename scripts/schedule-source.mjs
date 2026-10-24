import catalog from '../config/casters.json' with { type: 'json' };

export const SCHEDULE_SOURCE = 'https://site.weathernews.jp/site/live/json/timetable.json';
const DAY = 86400000, JST = 9 * 3600000;
function pointOnDay(time, hour, minute) {
  const d = new Date(time + JST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 9, minute);
}
export function parseCurrentSchedule(payload, time = Date.now()) {
  if (!Array.isArray(payload) || !payload.length || payload.length > 100 || !Number.isFinite(time)) throw new Error('Invalid schedule');
  const names = new Map();
  for (const caster of catalog.casters) for (const alias of [caster.id, ...caster.aliases]) {
    if (names.has(alias)) throw new Error('Duplicate caster alias'); names.set(alias, caster);
  }
  const records = new Map(), checked = new Date(time).toISOString(), minuteNow = Math.floor(time / 60000) * 60000;
  let cursor, anchor;
  for (const item of payload) {
    if (!item || typeof item.hour !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.hour) || typeof item.title !== 'string'
      || !item.title.trim() || item.title.trim().length > 200 || typeof item.caster !== 'string' || !/^[a-z0-9_-]{0,64}$/.test(item.caster)) throw new Error('Invalid schedule row');
    const [h, m] = item.hour.split(':').map(Number);
    let point = pointOnDay(cursor ?? minuteNow, h, m);
    if (cursor === undefined) {
      if (point > minuteNow) point -= DAY;
      if (minuteNow - point > 6 * 3600000) throw new Error('Ambiguous schedule date'); anchor = point;
    } else if (point < cursor) point += DAY;
    if (point - anchor > 2 * DAY) throw new Error('Invalid schedule horizon'); cursor = point;
    const caster = names.get(item.caster), date = new Date(point + JST).toISOString().slice(0, 10), id = `${date}T${item.hour}`;
    const row = { id, date_jst: date, slot_start_jst: item.hour, program: item.title.trim(), date_basis: 'rolling_schedule', role: 'presenter',
      planned: { caster_id: caster?.id || null, caster_name: caster?.name || null, raw_caster_id: item.caster || null,
        source_url: SCHEDULE_SOURCE, source_type: 'official_schedule', source_checked_at: checked },
      confirmed: null, status: caster ? 'scheduled' : 'unverified', youtube_video_id: null, changes: [] };
    if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify(row)) throw new Error('Conflicting schedule rows');
    records.set(id, row);
  }
  return { schema_version: 1, checked_at: checked, records: [...records.values()] };
}
async function getJSON(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Schedule source HTTP ${response.status}`);
  const text = await response.text(); if (text.length > 2000000) throw new Error('Schedule response too large');
  return JSON.parse(text);
}
export function createScheduleResolver({ fetchJSON = getJSON, now = Date.now, cacheMilliseconds = 60000 } = {}) {
  let cached, expires = 0, pending;
  return async () => {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const raw = await fetchJSON(SCHEDULE_SOURCE), data = parseCurrentSchedule(raw, now());
      cached = data; expires = now() + cacheMilliseconds; return data;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
