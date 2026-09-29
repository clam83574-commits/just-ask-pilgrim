import { initData } from './tg';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-telegram-init-data': initData(),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `Ошибка ${res.status}`);
  }
  return (raw ? res : res.json()) as Promise<T>;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => call<T>('DELETE', path),
  raw: (path: string, body: unknown) => call<Response>('POST', path, body, true),
};

// ---------- Типы ответов ----------

export type City = 'makkah' | 'madinah';

export interface Zone {
  key: string;
  kind: 'tawaf' | 'sai' | 'prayer';
  name: string;
  status: number;
  statusLabel: string;
  minutes: number | null;
  range: { light: number | null; average: number | null; crowded: number | null };
  gates: number[];
  closedGates: number[];
  sourceUpdatedAt: string | null;
  fetchedAt: string;
}

export interface Crowd { makkah: Zone[]; madinah: Zone[]; fetchedAt: string | null }

export interface Prayer {
  key: string;
  name: string;
  time: string;
  iqama?: string;
}

export interface PrayerData {
  city: City;
  today: Prayer[];
  next: Prayer & { minutesLeft: number };
  current: Prayer | null;
  hijri: string;
  quietWindows: { label: string; from: string; to: string; level: number }[];
}

export interface Weather {
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  uv: number;
  condition: string;
  max: number;
  min: number;
  hourly: { time: string; temp: number; feels: number; uv: number }[];
  advice: string | null;
}

export interface Place {
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
}

export interface NextPlan {
  title?: string;
  text?: string;
  action?: { type: string; label: string; category?: string };
  alternatives?: { title: string; text: string }[];
  urgency?: 'normal' | 'soon' | 'now';
  generatedAt: string;
}

export interface GroupEvent {
  id: number;
  title: string;
  type: string;
  starts_at: string;
  place_name: string | null;
  lat: number | null;
  lon: number | null;
  note: string | null;
}

export interface Group {
  id: number;
  code: string;
  name: string;
  company: string | null;
  hotel: { name: string; lat: number | null; lon: number | null } | null;
  role: 'admin' | 'member';
  events: GroupEvent[];
  announcements: { id: number; text: string; created_at: string }[];
  members?: { id: number; first_name: string; username: string; role: string }[];
  membersCount: number;
  delivered?: { sent: number; failed: number };
}

export interface Rates { base: 'SAR'; perSar: Record<string, number>; updatedAt: string; source: string }
