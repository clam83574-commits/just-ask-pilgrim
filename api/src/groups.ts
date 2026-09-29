import type { Env, TgUser } from './env';
import { nowIso } from './env';
import { escapeHtml, sendMessage } from './telegram';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function upsertUser(env: Env, u: TgUser, patch: { canMessage?: boolean; city?: string } = {}) {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username, lang, city, can_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE(?, 'makkah'), ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username,
       city = COALESCE(?, users.city), can_message = MAX(users.can_message, excluded.can_message), updated_at = excluded.updated_at`,
  )
    .bind(u.id, u.first_name ?? null, u.username ?? null, u.language_code ?? 'ru', patch.city ?? null,
      patch.canMessage || u.allows_write_to_pm ? 1 : 0, now, now, patch.city ?? null)
    .run();
}

export async function getMyGroups(env: Env, userId: number) {
  return (
    await env.DB.prepare(
      `SELECT g.*, m.role, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS members
       FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY m.joined_at DESC`,
    ).bind(userId).all<any>()
  ).results;
}

export async function membership(env: Env, groupId: number, userId: number): Promise<string | null> {
  const r = await env.DB.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).first<any>();
  return r?.role ?? null;
}

export async function createGroup(env: Env, user: TgUser, body: any) {
  const name = String(body.name ?? '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Укажите название группы');
  const now = nowIso();
  let code = newCode();
  for (let i = 0; i < 5; i++) {
    const exists = await env.DB.prepare('SELECT 1 FROM groups WHERE code = ?').bind(code).first();
    if (!exists) break;
    code = newCode();
  }
  const res = await env.DB.prepare(
    'INSERT INTO groups (code, name, company, hotel_name, hotel_lat, hotel_lon, owner_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).bind(code, name, body.company ?? null, body.hotelName ?? null, body.hotelLat ?? null, body.hotelLon ?? null, user.id, now).run();
  const groupId = res.meta.last_row_id;
  await env.DB.prepare('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?,?,?)').bind(groupId, user.id, 'admin', now).run();
  return getGroup(env, groupId, user.id);
}

export async function updateGroup(env: Env, user: TgUser, groupId: number, body: any) {
  await requireAdmin(env, groupId, user.id);
  await env.DB.prepare(
    `UPDATE groups SET name = COALESCE(?, name), company = ?, hotel_name = ?, hotel_lat = ?, hotel_lon = ? WHERE id = ?`,
  ).bind(body.name ?? null, body.company ?? null, body.hotelName ?? null, body.hotelLat ?? null, body.hotelLon ?? null, groupId).run();
  return getGroup(env, groupId, user.id);
}

export async function joinGroup(env: Env, user: TgUser, code: string) {
  const g = await env.DB.prepare('SELECT * FROM groups WHERE code = ?').bind(code.trim().toUpperCase()).first<any>();
  if (!g) throw new HttpError(404, 'Группа с таким кодом не найдена');
  await env.DB.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?,?,?,?)').bind(g.id, user.id, 'member', nowIso()).run();
  return getGroup(env, g.id, user.id);
}

export async function leaveGroup(env: Env, user: TgUser, groupId: number) {
  await env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, user.id).run();
  return { ok: true };
}

export async function getGroup(env: Env, groupId: number, userId: number) {
  const role = await membership(env, groupId, userId);
  if (!role) throw new HttpError(403, 'Вы не состоите в этой группе');
  const g = await env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<any>();
  const since = new Date(Date.now() - 3 * 3600000).toISOString();
  const [events, announcements, members] = await Promise.all([
    env.DB.prepare('SELECT * FROM events WHERE group_id = ? AND starts_at >= ? ORDER BY starts_at LIMIT 50').bind(groupId, since).all<any>(),
    env.DB.prepare('SELECT * FROM announcements WHERE group_id = ? ORDER BY created_at DESC LIMIT 20').bind(groupId).all<any>(),
    env.DB.prepare(
      `SELECT u.id, u.first_name, u.username, m.role FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.role, u.first_name`,
    ).bind(groupId).all<any>(),
  ]);
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    company: g.company,
    hotel: g.hotel_name ? { name: g.hotel_name, lat: g.hotel_lat, lon: g.hotel_lon } : null,
    role,
    events: events.results,
    announcements: announcements.results,
    members: role === 'admin' ? members.results : undefined,
    membersCount: members.results.length,
  };
}

async function requireAdmin(env: Env, groupId: number, userId: number) {
  if ((await membership(env, groupId, userId)) !== 'admin') throw new HttpError(403, 'Только для руководителя группы');
}

export async function addEvent(env: Env, user: TgUser, groupId: number, body: any) {
  await requireAdmin(env, groupId, user.id);
  const title = String(body.title ?? '').trim().slice(0, 120);
  const startsAt = new Date(body.startsAt);
  if (!title || isNaN(startsAt.getTime())) throw new HttpError(400, 'Нужны название и время события');
  await env.DB.prepare(
    'INSERT INTO events (group_id, title, type, starts_at, place_name, lat, lon, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).bind(groupId, title, body.type ?? 'meeting', startsAt.toISOString(), body.placeName ?? null, body.lat ?? null, body.lon ?? null,
    body.note ?? null, user.id, nowIso()).run();
  if (body.notify) {
    const when = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(startsAt);
    await broadcast(env, groupId, `🗓 <b>Новое событие:</b> ${escapeHtml(title)}\n${when}${body.placeName ? ` · ${escapeHtml(body.placeName)}` : ''}`);
  }
  return getGroup(env, groupId, user.id);
}

export async function deleteEvent(env: Env, user: TgUser, groupId: number, eventId: number) {
  await requireAdmin(env, groupId, user.id);
  await env.DB.prepare('DELETE FROM events WHERE id = ? AND group_id = ?').bind(eventId, groupId).run();
  return getGroup(env, groupId, user.id);
}

export async function announce(env: Env, user: TgUser, groupId: number, text: string) {
  await requireAdmin(env, groupId, user.id);
  const clean = String(text ?? '').trim().slice(0, 1500);
  if (!clean) throw new HttpError(400, 'Пустое объявление');
  await env.DB.prepare('INSERT INTO announcements (group_id, text, created_by, created_at) VALUES (?,?,?,?)').bind(groupId, clean, user.id, nowIso()).run();
  const g = await env.DB.prepare('SELECT name FROM groups WHERE id = ?').bind(groupId).first<any>();
  const delivered = await broadcast(env, groupId, `📣 <b>${escapeHtml(g?.name ?? 'Группа')}</b>\n\n${escapeHtml(clean)}`);
  return { ...(await getGroup(env, groupId, user.id)), delivered };
}

export async function broadcast(env: Env, groupId: number, html: string): Promise<{ sent: number; failed: number }> {
  const members = (
    await env.DB.prepare('SELECT user_id FROM group_members WHERE group_id = ?').bind(groupId).all<any>()
  ).results;
  let sent = 0;
  let failed = 0;
  for (const m of members) {
    (await sendMessage(env, m.user_id, html)) ? sent++ : failed++;
  }
  return { sent, failed };
}

/** Контекст группы для ИИ и «Что дальше?». */
export async function userGroupContext(env: Env, userId: number) {
  const groups = await getMyGroups(env, userId);
  if (!groups.length) return { inGroup: false };
  const g = groups[0];
  const now = new Date().toISOString();
  const events = (
    await env.DB.prepare('SELECT title, type, starts_at, place_name, lat, lon, note FROM events WHERE group_id = ? AND starts_at >= ? ORDER BY starts_at LIMIT 5').bind(g.id, now).all<any>()
  ).results.map((e) => ({ ...e, minutes_left: Math.round((Date.parse(e.starts_at) - Date.now()) / 60000) }));
  const ann = (
    await env.DB.prepare('SELECT text, created_at FROM announcements WHERE group_id = ? ORDER BY created_at DESC LIMIT 3').bind(g.id).all<any>()
  ).results;
  return {
    inGroup: true,
    group: g.name,
    company: g.company,
    hotel: g.hotel_name ? { name: g.hotel_name, lat: g.hotel_lat, lon: g.hotel_lon } : null,
    upcomingEvents: events,
    lastAnnouncements: ann,
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
