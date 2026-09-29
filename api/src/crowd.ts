import type { City, Env } from './env';
import { nowIso } from './env';

/** Русские названия и порядок зон (id — как в API ведомства). */
export const MAKKAH_ZONES: Record<string, { kind: 'tawaf' | 'sai'; name: string; order: number }> = {
  'tawaf:1': { kind: 'tawaf', name: 'Сахн — у Каабы', order: 1 },
  'tawaf:2': { kind: 'tawaf', name: 'Матаф, цокольный этаж', order: 2 },
  'tawaf:3': { kind: 'tawaf', name: 'Матаф, 1-й этаж', order: 3 },
  'tawaf:5': { kind: 'tawaf', name: 'Матаф, крыша', order: 4 },
  'sai:7': { kind: 'sai', name: 'Масаа, цокольный этаж', order: 5 },
  'sai:8': { kind: 'sai', name: 'Масаа, 1-й этаж', order: 6 },
  'sai:10': { kind: 'sai', name: 'Масаа, 2-й этаж', order: 7 },
  'sai:12': { kind: 'sai', name: 'Масаа, крыша', order: 8 },
};

export const STATUS_LABEL: Record<number, string> = {
  0: 'нет данных',
  1: 'свободно',
  2: 'средне',
  3: 'многолюдно',
  4: 'закрыто',
};

const toInt = (v: unknown): number | null => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};

const parseGates = (raw: unknown): number[] =>
  String(raw ?? '')
    .split(/[^0-9]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));

interface ZoneRow {
  city: City;
  zone_key: string;
  kind: string;
  source_id: number | null;
  name_ar: string | null;
  status: number;
  minutes: number | null;
  light_min: number | null;
  avg_min: number | null;
  crowded_min: number | null;
  gates: string | null;
  source_updated_at: string | null;
}

export function normalizeTawafSai(items: any[]): ZoneRow[] {
  return items.map((it) => {
    const id = toInt(it.id);
    const kind = String(it.location_type) === '2' ? 'sai' : 'tawaf';
    const gates = parseGates(it.door_no);
    return {
      city: 'makkah',
      zone_key: `${kind}:${id}`,
      kind,
      source_id: id,
      name_ar: (it.location_name ?? '').trim() || null,
      status: toInt(it.status) ?? 0,
      minutes: toInt(it.time_expect),
      light_min: toInt(it.light_time),
      avg_min: toInt(it.average_time),
      crowded_min: toInt(it.crowded_time),
      gates: gates.length ? JSON.stringify(gates) : null,
      source_updated_at: it.updated_at ?? null,
    };
  });
}

export function normalizePrayerZones(items: any[]): ZoneRow[] {
  return items.map((it, index) => ({
    city: 'madinah',
    zone_key: `prayer:${index}`,
    kind: 'prayer',
    source_id: toInt(it.id),
    name_ar: null,
    status: toInt(it.status) ?? 0,
    minutes: null,
    light_min: null,
    avg_min: null,
    crowded_min: null,
    gates: null,
    source_updated_at: null,
  }));
}

/** Сохраняет текущее состояние и пишет историю только при изменении. Возвращает список изменившихся зон. */
export async function upsertZones(env: Env, rows: ZoneRow[]): Promise<{ changed: ZoneRow[]; previous: Map<string, number> }> {
  const fetchedAt = nowIso();
  const prev = await env.DB.prepare('SELECT city, zone_key, status, minutes, source_updated_at FROM crowd_current').all<any>();
  const prevMap = new Map<string, any>(prev.results.map((r) => [`${r.city}|${r.zone_key}`, r]));
  const previous = new Map<string, number>();
  const changed: ZoneRow[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const p = prevMap.get(`${r.city}|${r.zone_key}`);
    if (p) previous.set(`${r.city}|${r.zone_key}`, p.status);
    const isChanged = !p || p.status !== r.status || p.minutes !== r.minutes || p.source_updated_at !== r.source_updated_at;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO crowd_current (city, zone_key, kind, source_id, name_ar, status, minutes, light_min, avg_min, crowded_min, gates, source_updated_at, fetched_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(city, zone_key) DO UPDATE SET kind=excluded.kind, source_id=excluded.source_id, name_ar=excluded.name_ar,
           status=excluded.status, minutes=excluded.minutes, light_min=excluded.light_min, avg_min=excluded.avg_min,
           crowded_min=excluded.crowded_min, gates=excluded.gates, source_updated_at=excluded.source_updated_at, fetched_at=excluded.fetched_at`,
      ).bind(r.city, r.zone_key, r.kind, r.source_id, r.name_ar, r.status, r.minutes, r.light_min, r.avg_min, r.crowded_min, r.gates, r.source_updated_at, fetchedAt),
    );
    if (isChanged) {
      changed.push(r);
      stmts.push(
        env.DB.prepare('INSERT INTO crowd_history (city, zone_key, status, minutes, source_updated_at, fetched_at) VALUES (?,?,?,?,?,?)').bind(
          r.city, r.zone_key, r.status, r.minutes, r.source_updated_at, fetchedAt,
        ),
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { changed, previous };
}

export interface CrowdZone {
  key: string;
  kind: string;
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

export async function getCrowd(env: Env) {
  const rows = (await env.DB.prepare('SELECT * FROM crowd_current').all<any>()).results;
  const closed = await closedGateNumbers(env);
  const zones: CrowdZone[] = rows.map((r) => {
    const meta = MAKKAH_ZONES[r.zone_key];
    const gates: number[] = r.gates ? JSON.parse(r.gates) : [];
    return {
      key: r.zone_key,
      kind: r.kind,
      name: meta?.name ?? (r.kind === 'prayer' ? `Зона ${Number(r.zone_key.split(':')[1]) + 1}` : r.name_ar ?? r.zone_key),
      status: r.status,
      statusLabel: STATUS_LABEL[r.status] ?? 'нет данных',
      minutes: r.status === 4 ? null : r.minutes,
      range: { light: r.light_min, average: r.avg_min, crowded: r.crowded_min },
      gates,
      closedGates: gates.filter((g) => closed.has(g)),
      sourceUpdatedAt: r.source_updated_at,
      fetchedAt: r.fetched_at,
    };
  });
  const order = (z: CrowdZone) => MAKKAH_ZONES[z.key]?.order ?? Number(z.key.split(':')[1] ?? 0) + 100;
  const makkah = zones.filter((z) => rows.find((r) => r.zone_key === z.key)?.city === 'makkah').sort((a, b) => order(a) - order(b));
  const madinah = zones.filter((z) => rows.find((r) => r.zone_key === z.key)?.city === 'madinah').sort((a, b) => order(a) - order(b));
  const lastFetched = rows.reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), '');
  return { makkah, madinah, fetchedAt: lastFetched || null };
}

async function closedGateNumbers(env: Env): Promise<Set<number>> {
  const res = await env.DB.prepare("SELECT extra FROM pois WHERE category = 'gate' AND is_closed = 1").all<any>();
  const set = new Set<number>();
  for (const r of res.results) {
    const n = parseInt(JSON.parse(r.extra || '{}').gate_no, 10);
    if (Number.isFinite(n)) set.add(n);
  }
  return set;
}

/** Короткая сводка для ИИ и «Что дальше?». */
export function crowdSummary(crowd: Awaited<ReturnType<typeof getCrowd>>, city: City): string {
  const zones = city === 'makkah' ? crowd.makkah : crowd.madinah;
  if (!zones.length) return 'Данных о загруженности пока нет.';
  if (city === 'madinah') {
    const high = zones.filter((z) => z.status === 3).map((z) => z.name);
    const mid = zones.filter((z) => z.status === 2).map((z) => z.name);
    return `Масджид ан-Набави, 13 молельных зон: многолюдно — ${high.join(', ') || 'нигде'}; средне — ${mid.join(', ') || 'нигде'}; остальные свободны.`;
  }
  return zones
    .map((z) => {
      const age = z.sourceUpdatedAt ? Math.round((Date.now() - Date.parse(z.sourceUpdatedAt)) / 60000) : null;
      const t = z.minutes ? `, ${z.kind === 'sai' ? 'саъй' : 'таваф'} ~${z.minutes} мин` : '';
      const g = z.gates.length ? `, ворота ${z.gates.join(', ')}` : '';
      const cg = z.closedGates.length ? ` (закрыты: ${z.closedGates.join(', ')})` : '';
      return `${z.name}: ${z.statusLabel}${t}${g}${cg}${age !== null ? `, статус обновлён ${age} мин назад` : ''}`;
    })
    .join('\n');
}
