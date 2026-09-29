const TZ = 'Asia/Riyadh';

export const fmtTime = (iso: string | number | Date) =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso));

export const fmtDay = (iso: string | number | Date) =>
  new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(iso));

export const fmtDateLong = (d = new Date()) =>
  new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(d);

export function fmtDuration(minutes: number): string {
  if (minutes < 1) return 'сейчас';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'нет данных';
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1).replace('.', ',')} км`);

/** ~80 м/мин пешком + запас на толпу. */
export const walkMinutes = (m: number) => Math.max(1, Math.round(m / 70));

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Мекканское время для инпутов datetime-local: "YYYY-MM-DDTHH:mm" <-> ISO UTC (UTC+3 круглый год). */
export const meccaLocalToIso = (local: string) => new Date(`${local}:00+03:00`).toISOString();
export const isoToMeccaLocal = (iso: string | number) => new Date(new Date(iso).getTime() + 3 * 3600000).toISOString().slice(0, 16);

export const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TZ }).format(new Date()));
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 17) return 'Добрый день';
  return 'Добрый вечер';
};
