import type { City, Env } from './env';
import { CITIES } from './env';

async function cached<T>(env: Env, key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const hit = await env.CACHE.get(key, 'json');
  if (hit) return hit as T;
  const value = await load();
  await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSec });
  return value;
}

// ---------------- Погода ----------------

const WMO: Record<number, string> = {
  0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'пасмурно', 45: 'туман', 48: 'туман',
  51: 'морось', 53: 'морось', 55: 'морось', 61: 'дождь', 63: 'дождь', 65: 'сильный дождь', 80: 'ливень', 81: 'ливень',
  82: 'сильный ливень', 95: 'гроза', 96: 'гроза с градом', 99: 'гроза с градом',
};

export async function getWeather(env: Env, city: City) {
  return cached(env, `weather:${city}`, 20 * 60, async () => {
    const c = CITIES[city];
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,uv_index' +
      '&hourly=temperature_2m,apparent_temperature,uv_index&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset' +
      '&timezone=Asia%2FRiyadh&forecast_days=2';
    const d: any = await (await fetch(url)).json();
    const cur = d.current ?? {};
    const nowHour = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 13);
    const startIdx = Math.max(0, (d.hourly?.time ?? []).findIndex((t: string) => t.startsWith(nowHour)));
    const hourly = (d.hourly?.time ?? []).slice(startIdx, startIdx + 12).map((t: string, i: number) => ({
      time: t,
      temp: d.hourly.temperature_2m[startIdx + i],
      feels: d.hourly.apparent_temperature[startIdx + i],
      uv: d.hourly.uv_index[startIdx + i],
    }));
    const feels = cur.apparent_temperature;
    return {
      city,
      temp: cur.temperature_2m,
      feels,
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      uv: cur.uv_index,
      condition: WMO[cur.weather_code] ?? '',
      max: d.daily?.temperature_2m_max?.[0],
      min: d.daily?.temperature_2m_min?.[0],
      hourly,
      advice: feels >= 42 ? 'Сильная жара: выходите до 10:00 или после Асра' : feels >= 36 ? 'Жарко: держитесь в тени' : null,
      updatedAt: new Date().toISOString(),
    };
  });
}

// ---------------- Места из OpenStreetMap ----------------

export interface Place {
  id: string;
  category: 'food' | 'exchange' | 'pharmacy';
  name: string;
  nameAr?: string;
  lat: number;
  lon: number;
  cuisine: string[];
  homeFood: boolean;
  tags: { opening_hours?: string; phone?: string; website?: string; brand?: string };
}

const HOME_CUISINES = ['uzbek', 'kazakh', 'kyrgyz', 'tajik', 'azerbaijani', 'turkish', 'turkmen', 'tatar', 'russian', 'central_asian', 'uyghur'];
const HOME_NAME_RE = /(uzbek|samarkand|tashkent|bukhara|khiva|andijan|plov|pilaf|kazakh|almaty|astana|kyrgyz|bishkek|tajik|dushanbe|azerbaij|baku|turk|istanbul|anatol|kebab house|uyghur|lagman|manti|узбек|казах|самарканд|ташкент|плов|лагман|турец)/i;
const CUISINE_RU: Record<string, string> = {
  uzbek: 'узбекская', kazakh: 'казахская', kyrgyz: 'кыргызская', tajik: 'таджикская', azerbaijani: 'азербайджанская',
  turkish: 'турецкая', indian: 'индийская', pakistani: 'пакистанская', bangladeshi: 'бенгальская', bengali: 'бенгальская',
  arab: 'арабская', arabic: 'арабская', saudi: 'саудовская', lebanese: 'ливанская', yemeni: 'йеменская', egyptian: 'египетская',
  syrian: 'сирийская', indonesian: 'индонезийская', malaysian: 'малайзийская', chinese: 'китайская', burger: 'бургеры',
  pizza: 'пицца', chicken: 'курица', coffee_shop: 'кофейня', sandwich: 'сэндвичи', shawarma: 'шаурма', seafood: 'морепродукты',
  kebab: 'кебаб', grill: 'гриль', regional: 'местная', international: 'интернациональная', uyghur: 'уйгурская',
};

export const cuisineRu = (c: string) => CUISINE_RU[c] ?? c;

export async function getOsmPlaces(env: Env, city: City): Promise<Place[]> {
  return cached(env, `osm:${city}:v2`, 24 * 3600, async () => {
    const c = CITIES[city];
    // 7 км — чтобы захватить Азизию, где много узбекских и казахских заведений
    const q = `[out:json][timeout:60];(
      nwr["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:7000,${c.lat},${c.lon});
      nwr["amenity"="bureau_de_change"](around:5000,${c.lat},${c.lon});
      nwr["shop"="money_transfer"](around:5000,${c.lat},${c.lon});
      nwr["amenity"="pharmacy"](around:3000,${c.lat},${c.lon});
    );out center tags;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'pilgrim-miniapp/1.0' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const data: any = await res.json();
    const out: Place[] = [];
    for (const el of data.elements ?? []) {
      const t = el.tags ?? {};
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;
      const amenity = t.amenity ?? t.shop;
      const category = amenity === 'pharmacy' ? 'pharmacy' : amenity === 'bureau_de_change' || amenity === 'money_transfer' ? 'exchange' : 'food';
      const name = t['name:en'] || t['name:ru'] || t.name || t.brand || '';
      if (!name && category === 'food') continue;
      const cuisine = String(t.cuisine ?? '').split(/[;,]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      const homeFood = category === 'food' && (cuisine.some((x) => HOME_CUISINES.includes(x)) || HOME_NAME_RE.test(`${t.name ?? ''} ${t['name:en'] ?? ''}`));
      out.push({
        id: `osm:${el.type}:${el.id}`,
        category,
        name: name || (category === 'exchange' ? 'Обменный пункт' : 'Аптека'),
        nameAr: t['name:ar'] || (/[؀-ۿ]/.test(t.name ?? '') ? t.name : undefined),
        lat, lon, cuisine, homeFood,
        tags: { opening_hours: t.opening_hours, phone: t.phone || t['contact:phone'], website: t.website, brand: t.brand },
      });
    }
    return out;
  });
}

// ---------------- Курсы валют ----------------

export async function getRates(env: Env) {
  return cached(env, 'rates:SAR', 6 * 3600, async () => {
    const d: any = await (await fetch('https://open.er-api.com/v6/latest/SAR')).json();
    if (d.result !== 'success') throw new Error('rates unavailable');
    const pick = ['USD', 'EUR', 'KZT', 'UZS', 'KGS', 'TJS', 'RUB', 'AZN', 'TRY', 'AED', 'GBP'];
    const perSar: Record<string, number> = {};
    for (const k of pick) if (d.rates?.[k]) perSar[k] = d.rates[k];
    return { base: 'SAR', perSar, updatedAt: d.time_last_update_utc as string, source: 'open.er-api.com (межбанковский курс)' };
  });
}

// ---------------- Расстояние ----------------

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
