export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  APP_NAME: string;
  WEBAPP_URL: string;
  LLM_MODEL: string;
  STT_MODEL: string;
  TTS_MODEL: string;
  TTS_VOICE: string;
  BOT_TOKEN: string;
  BOT_USERNAME?: string;
  OPENROUTER_API_KEY: string;
  INGEST_SECRET: string;
  BOT_WEBHOOK_SECRET?: string;
  /** "1" — пропускать проверку initData (только локальная разработка). */
  DEV_AUTH?: string;
}

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  allows_write_to_pm?: boolean;
}

export type City = 'makkah' | 'madinah';

export type AppEnv = { Bindings: Env; Variables: { user: TgUser } };

export const CITIES: Record<City, { name: string; lat: number; lon: number; tz: string }> = {
  makkah: { name: 'Мекка', lat: 21.422487, lon: 39.826206, tz: 'Asia/Riyadh' },
  madinah: { name: 'Медина', lat: 24.467221, lon: 39.611198, tz: 'Asia/Riyadh' },
};

export const nowIso = () => new Date().toISOString();

export function asCity(value: string | undefined | null): City {
  return value === 'madinah' ? 'madinah' : 'makkah';
}
