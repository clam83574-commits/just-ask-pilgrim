import type { City, Env } from './env';
import { CITIES } from './env';
import { distanceM, getOsmPlaces } from './external';

/** Категории мест. source: official — карта ведомства (D1), osm — OpenStreetMap. */
export const PLACE_CATEGORIES: Record<string, { label: string; source: 'official' | 'osm' }> = {
  toilet: { label: 'Туалеты', source: 'official' },
  toilet_accessible: { label: 'Туалеты для людей с инвалидностью', source: 'official' },
  gate: { label: 'Ворота', source: 'official' },
  wheelchair: { label: 'Коляски и электрокары', source: 'official' },
  luggage: { label: 'Камеры хранения', source: 'official' },
  medical: { label: 'Медпункты', source: 'official' },
  transport: { label: 'Автобусы и такси', source: 'official' },
  prayer_disabled: { label: 'Места для намаза людей с инвалидностью', source: 'official' },
  elevator: { label: 'Лифты', source: 'official' },
  escalator: { label: 'Эскалаторы', source: 'official' },
  children: { label: 'Детский центр', source: 'official' },
  landmark: { label: 'Святыни и ориентиры', source: 'official' },
  food: { label: 'Еда', source: 'osm' },
  exchange: { label: 'Обменники', source: 'osm' },
  pharmacy: { label: 'Аптеки', source: 'osm' },
};

export interface NearbyItem {
  id: string;
  category: string;
  name: string;
  nameAr?: string | null;
  lat: number;
  lon: number;
  distance: number;
  venue?: string | null;
  floor?: string | null;
  isClosed?: boolean;
  cuisine?: string[];
  homeFood?: boolean;
  openingHours?: string;
  phone?: string;
  source?: string;
  gateNo?: string;
}

export async function nearbyPlaces(
  env: Env,
  opts: { city: City; category: string; lat?: number; lon?: number; cuisine?: string; homeFood?: boolean; limit?: number },
): Promise<NearbyItem[]> {
  const origin = opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : CITIES[opts.city];
  const cat = PLACE_CATEGORIES[opts.category];
  let items: NearbyItem[] = [];
  // официальных туалетов ещё нет (приходят со сборщиком) — подставляем OpenStreetMap
  let useOsm = cat?.source === 'osm';
  if (opts.category === 'toilet') {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM pois WHERE city = ? AND category = ?').bind(opts.city, 'toilet').first<any>();
    if (!n?.n) useOsm = true;
  }
  if (!useOsm) {
    const rows = (
      await env.DB.prepare('SELECT * FROM pois WHERE city = ? AND category = ?').bind(opts.city, opts.category).all<any>()
    ).results;
    items = rows.map((r) => {
      const extra = JSON.parse(r.extra || '{}');
      return {
        id: r.id,
        category: r.category,
        name: r.name || (r.category === 'gate' && extra.gate_no ? `Ворота ${extra.gate_no}` : PLACE_CATEGORIES[r.category]?.label ?? r.category),
        nameAr: r.name_ar,
        lat: r.lat,
        lon: r.lon,
        distance: distanceM(origin.lat, origin.lon, r.lat, r.lon),
        venue: extra.venue_name ?? null,
        floor: extra.floor_name ?? null,
        isClosed: !!r.is_closed,
        source: r.source as string,
        gateNo: String(extra.gate_no ?? ''),
      };
    });
    // узлы навигационного графа с типом gate — в основном служебные переходы; оставляем только нумерованные ворота
    if (opts.category === 'gate') items = items.filter((it: any) => it.source !== 'haramain-map' || /^\d+$/.test(it.gateNo));
  } else {
    const all = await getOsmPlaces(env, opts.city).catch(() => []);
    items = all
      .filter((p) => p.category === opts.category)
      .filter((p) => (opts.homeFood ? p.homeFood : true))
      .filter((p) => (opts.cuisine ? p.cuisine.includes(opts.cuisine.toLowerCase()) || p.name.toLowerCase().includes(opts.cuisine.toLowerCase()) : true))
      .map((p) => ({
        id: p.id,
        category: p.category,
        name: p.name,
        nameAr: p.nameAr,
        lat: p.lat,
        lon: p.lon,
        distance: distanceM(origin.lat, origin.lon, p.lat, p.lon),
        cuisine: p.cuisine,
        homeFood: p.homeFood,
        openingHours: p.tags.opening_hours,
        phone: p.tags.phone,
      }));
  }
  // одинаковые ворота на разных этажах — оставляем ближайшую точку
  if (opts.category === 'gate') {
    const seen = new Map<string, NearbyItem>();
    for (const it of items) {
      const prev = seen.get(it.name);
      if (!prev || it.distance < prev.distance) seen.set(it.name, it);
    }
    items = [...seen.values()];
  }
  items.sort((a, b) => a.distance - b.distance);
  return items.slice(0, opts.limit ?? 50);
}

/** Сводка для карты: сколько точек в каждой категории. */
export async function placeCounts(env: Env, city: City) {
  const rows = (await env.DB.prepare('SELECT category, COUNT(*) AS n FROM pois WHERE city = ? GROUP BY category').bind(city).all<any>()).results;
  const counts: Record<string, number> = Object.fromEntries(rows.map((r) => [r.category, r.n]));
  const osm = await getOsmPlaces(env, city).catch(() => []);
  for (const p of osm) counts[p.category] = (counts[p.category] ?? 0) + 1;
  return Object.entries(PLACE_CATEGORIES).map(([key, v]) => ({ key, label: v.label, count: counts[key] ?? 0 }));
}
