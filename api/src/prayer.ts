import { CalculationMethod, Coordinates, PrayerTimes } from 'adhan';
import type { City } from './env';
import { CITIES } from './env';

export const PRAYER_NAMES: Record<string, string> = {
  fajr: 'Фаджр',
  sunrise: 'Восход',
  dhuhr: 'Зухр',
  asr: 'Аср',
  maghrib: 'Магриб',
  isha: 'Иша',
};

/** Интервал от азана до икамы в Харамах, мин (ориентировочно). */
const IQAMA_OFFSET: Record<string, number> = { fajr: 25, dhuhr: 20, asr: 20, maghrib: 10, isha: 20 };

export interface PrayerInfo {
  key: string;
  name: string;
  time: string; // ISO
  iqama?: string;
}

/** Дата «сегодня» по времени Эр-Рияда (UTC+3, без перехода на летнее время). */
function riyadhDate(offsetDays = 0): Date {
  const now = new Date(Date.now() + 3 * 3600_000 + offsetDays * 86400_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

function timesFor(city: City, offsetDays = 0): PrayerInfo[] {
  const c = CITIES[city];
  const date = riyadhDate(offsetDays);
  // adhan берёт год/месяц/день из локальных полей даты; Worker работает в UTC — поэтому передаём полдень UTC.
  const pt = new PrayerTimes(new Coordinates(c.lat, c.lon), date, CalculationMethod.UmmAlQura());
  return (['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((k) => {
    const t = pt[k] as Date;
    const iq = IQAMA_OFFSET[k];
    return {
      key: k,
      name: PRAYER_NAMES[k],
      time: t.toISOString(),
      ...(iq ? { iqama: new Date(t.getTime() + iq * 60000).toISOString() } : {}),
    };
  });
}

export function getPrayer(city: City) {
  const today = timesFor(city, 0);
  const tomorrow = timesFor(city, 1);
  const now = Date.now();
  const upcoming = [...today, ...tomorrow].filter((p) => p.key !== 'sunrise');
  const next = upcoming.find((p) => Date.parse(p.time) > now) ?? upcoming[0];
  const current = [...upcoming].reverse().find((p) => Date.parse(p.time) <= now) ?? null;
  return {
    city,
    method: 'Umm al-Qura',
    today,
    next: { ...next, minutesLeft: Math.round((Date.parse(next.time) - now) / 60000) },
    current,
    hijri: hijriDate(),
    quietWindows: quietWindows(today, tomorrow),
  };
}

/** Дата по хиджре (умм аль-кура) через Intl. */
export function hijriDate(): string {
  try {
    return new Intl.DateTimeFormat('ru-RU-u-ca-islamic-umalqura', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh',
    }).format(new Date());
  } catch {
    return '';
  }
}

/**
 * Эвристический прогноз загруженности Харама по окнам дня.
 * Пики: за 30 мин до азана — 30 мин после икамы, особенно Магриб и Иша.
 * Спокойнее: позднее утро и дневная жара, глубокая ночь.
 */
export function quietWindows(today: PrayerInfo[], tomorrow: PrayerInfo[]) {
  const t = (arr: PrayerInfo[], k: string) => Date.parse(arr.find((p) => p.key === k)!.time);
  const windows = [
    { label: 'После восхода — до Зухра', from: t(today, 'sunrise') + 60 * 60000, to: t(today, 'dhuhr') - 40 * 60000, level: 1 },
    { label: 'После Зухра — до Асра', from: t(today, 'dhuhr') + 45 * 60000, to: t(today, 'asr') - 40 * 60000, level: 1 },
    { label: 'После Асра — до Магриба', from: t(today, 'asr') + 40 * 60000, to: t(today, 'maghrib') - 45 * 60000, level: 2 },
    { label: 'Между Магрибом и Иша', from: t(today, 'maghrib') + 30 * 60000, to: t(today, 'isha') - 20 * 60000, level: 3 },
    { label: 'После Иша', from: t(today, 'isha') + 45 * 60000, to: t(today, 'isha') + 3 * 3600000, level: 3 },
    { label: 'Глубокая ночь — до Фаджра', from: t(today, 'isha') + 3 * 3600000, to: t(tomorrow, 'fajr') - 60 * 60000, level: 2 },
  ];
  const now = Date.now();
  return windows
    .filter((w) => w.to > now && w.to > w.from)
    .map((w) => ({ label: w.label, from: new Date(Math.max(w.from, now)).toISOString(), to: new Date(w.to).toISOString(), level: w.level }));
}
