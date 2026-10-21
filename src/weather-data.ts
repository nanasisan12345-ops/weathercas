import { z } from 'zod';
export type WeatherPanel = { id: string; title: string; group: string; description: string; page: string; source?: string; image?: string; pick?: number };
const page = (path = '') => `https://weathernews.jp/${path}`;
export const weatherPanels: WeatherPanel[] = [
  { id: 'today', title: '全国の天気予報', group: '天気予報', description: '今日の全国予報図', image: 'https://site.weathernews.jp/site/forecast/image/map/JAPAN.today.png', page: page() },
  { id: 'tomorrow', title: '全国の明日の天気', group: '天気予報', description: '明日の全国予報図', source: 'forecast', pick: 1, page: page() },
  { id: 'dayafter', title: '全国の明後日の天気', group: '天気予報', description: '明後日の全国予報図', source: 'forecast', pick: 2, page: page() },
  { id: 'weekly', title: '全国の週間予報', group: '天気予報', description: '予報日を選んで全国の天気を確認', source: 'forecast', page: page() },
  ...[['hokkaido', '北海道'], ['tohoku', '東北'], ['kanto', '関東'], ['chubu', '中部'], ['kinki', '近畿'], ['chugoku', '中国'], ['shikoku', '四国'], ['kyushu', '九州'], ['okinawa', '沖縄']].map(([area, name]) => ({
    id: `forecast${area}`, title: `${name}の天気`, group: '天気予報', description: '地方ごとの予報図・日付切替', source: `forecast${area}`, page: page(`onebox/tenki/${area}/`),
  })),
  { id: 'typhoon', title: '台風情報', group: '雨雲・気象', description: '日本広域の台風進路予想図', image: 'https://gvs.weathernews.jp/s/typhoon/img/data/multi_onebox.png', page: page('onebox/typhoon/') },
  ...[['radar', '雨雲レーダー', '全国の最新の実況雨雲', 'onebox/radar/'], ['chart', '実況天気図', '気圧配置や前線の実況図', 'onebox/chart/'], ['satellite', '気象衛星の雲画像', '日本付近の最新掲載画像', 'onebox/satellite/']].map(([id, title, description, path]) => ({ id, title, description, group: '雨雲・気象', source: id, page: page(path) })),
  ...[['earthquake', '地震情報', '最新の掲載地震の震度分布と直近5件', 'quake/'], ['tsunami', '津波情報', '公式の掲載図・発表日時を表示', 'tsunami/'], ['warnings', '警報・注意報', '発表のある市区町村を地域名で検索', 'onebox/warn/']].map(([id, title, description, path]) => ({ id, title, description, group: '防災情報', source: id, page: page(path) })),
  ...[['uv', '紫外線予報', '全国主要都市のUVインデックス', 's/uv/'], ['laundry', 'お洗濯情報', '全国主要都市のお洗濯予報', 's/laundry/'], ['dry', '乾燥指数', '全国主要都市の乾燥予報', 'dry/'], ['cold', '風邪予防指数', '全国主要都市の公式指数', 'cold/'], ['heat', '熱中症予報', '全国主要都市の公式予報', 'heatstroke/'], ['pain', '天気痛予報', '全国主要都市の気圧変化の指数', 'pain/']].map(([id, title, description, path]) => ({ id, title, description, group: '生活・健康', source: id, page: page(path) })),
  ...[['temperature', '今日の最高気温', '最高気温の高い地点'], ['minimum', '今日の最低気温', '最低気温の低い地点'], ['rain', '今日の1時間雨量', '1時間降水量の日最大値'], ['wind', '現在の風速', '10分間平均風速の大きい地点'], ['snow', '今日の1時間降雪量', '1時間降雪量の日最大値'], ['humidity', '今日の最低湿度', '日最低湿度の低い地点']].map(([id, title, description]) => ({ id, title, description: `${description}・上位10地点`, group: '観測ランキング', source: id, page: page('onebox/amedas/') })),
];
export const LAYOUT_KEY = 'weathercas.weather-layout.v1';
const ids = new Set(weatherPanels.map(p => p.id));
export type WeatherLayout = { id: string; wide: boolean }[];
export const defaultWeatherLayout = (): WeatherLayout => [{ id: 'today', wide: false }, { id: 'typhoon', wide: false }];
export function parseWeatherLayout(text: string | null): WeatherLayout {
  if (text === null) return defaultWeatherLayout();
  const stored = JSON.parse(text);
  if (stored?.version !== 1 || !Array.isArray(stored.cards) || stored.cards.length > weatherPanels.length) throw new Error('保存した配置を読み込めませんでした。');
  const seen = new Set<string>();
  return stored.cards.filter((x: unknown): x is WeatherLayout[number] => {
    if (!x || typeof x !== 'object' || !('id' in x) || typeof x.id !== 'string' || !ids.has(x.id) || seen.has(x.id)) return false;
    seen.add(x.id); return true;
  }).map((x: WeatherLayout[number]) => ({ id: x.id, wide: x.wide === true }));
}
export function moveWeatherCard(cards: WeatherLayout, from: string, to: string): WeatherLayout {
  const a = cards.findIndex(x => x.id === from), b = cards.findIndex(x => x.id === to);
  if (a < 0 || b < 0 || a === b) return cards;
  const next = [...cards]; next.splice(b, 0, next.splice(a, 1)[0]); return next;
}
const imageURL = z.url().refine(s => {
  const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['site.weathernews.jp', 'gvs.weathernews.jp', 'memgvs-cdn.weathernews.jp', 'mws.cdn.weathernews.jp'].includes(u.hostname);
});
export const weatherDataSchema = z.object({ checked_at: z.iso.datetime(), caption: z.string().max(500),
  images: z.array(z.object({ src: imageURL, label: z.string().max(500) })).max(20).optional(),
  rows: z.array(z.object({ name: z.string().max(500), value: z.string().max(1500), detail: z.string().max(500).optional() })).max(5000).optional(),
  notice: z.string().max(500).optional(), radar: z.string().regex(/^https:\/\/tile\.weathernews\.jp\/3\/tile\/rad_anl\/[\d/]+\/[\d-]+_Tiles_\d+$/).optional(),
}).refine(x => x.images?.length || x.rows || x.radar);
export type WeatherData = z.infer<typeof weatherDataSchema>;
export async function loadWeather(source: string): Promise<WeatherData> {
  const endpoint = import.meta.env.VITE_LIVE_ENDPOINT as string | undefined;
  const url = endpoint ? endpoint.replace('/live.json', `/weather/${source}.json`) : `${import.meta.env.BASE_URL}data/weather/${source}.json`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('天気情報を取得できませんでした。');
  const data = weatherDataSchema.safeParse(await response.json());
  if (!data.success) throw new Error('天気情報の形式を確認できませんでした。');
  return data.data;
}
