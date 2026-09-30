import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, City, Env, TgUser } from './env';
import { asCity, nowIso } from './env';
import { escapeHtml, openAppButton, sendMessage, tg, verifyInitData } from './telegram';
import { getCrowd, normalizePrayerZones, normalizeTawafSai, upsertZones, crowdSummary, STATUS_LABEL } from './crowd';
import { getPrayer } from './prayer';
import { getOsmPlaces, getRates, getWeather } from './external';
import { nearbyPlaces, placeCounts } from './places';
import { assistant, LANGUAGES, synthesize, transcribe, translate, whatNext } from './ai';
import {
  addEvent, announce, createGroup, deleteEvent, getGroup, getMyGroups, HttpError, joinGroup, leaveGroup, updateGroup, upsertUser,
} from './groups';

const app = new Hono<AppEnv>();

app.use('/api/*', cors({ origin: (o) => o ?? '*', allowHeaders: ['content-type', 'x-telegram-init-data', 'x-ingest-secret'], maxAge: 86400 }));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  console.error(err);
  return c.json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' }, 500);
});

app.get('/', (c) => c.text(`${c.env.APP_NAME} API`));
app.get('/api/config', (c) => c.json({ appName: c.env.APP_NAME, botUsername: c.env.BOT_USERNAME ?? null, languages: LANGUAGES }));

// ---------------- Приём данных от сборщика ----------------

app.post('/api/ingest', async (c) => {
  if (!c.env.INGEST_SECRET || c.req.header('x-ingest-secret') !== c.env.INGEST_SECRET) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json<any>();
  const report: Record<string, unknown> = {};
  const logs: D1PreparedStatement[] = [];

  const rows = [
    ...(Array.isArray(body.tawafSai) ? normalizeTawafSai(body.tawafSai) : []),
    ...(Array.isArray(body.prayerZones) ? normalizePrayerZones(body.prayerZones) : []),
  ];
  if (rows.length) {
    const { changed, previous } = await upsertZones(c.env, rows);
    report.zones = rows.length;
    report.changed = changed.length;
    c.executionCtx.waitUntil(crowdAlerts(c.env, changed, previous));
  }
  for (const src of ['tawafSai', 'prayerZones']) {
    if (body[`${src}Error`]) logs.push(c.env.DB.prepare('INSERT INTO ingest_log VALUES (?,?,?,?)').bind(nowIso(), src, 0, String(body[`${src}Error`]).slice(0, 500)));
    else if (body[src]) logs.push(c.env.DB.prepare('INSERT INTO ingest_log VALUES (?,?,?,?)').bind(nowIso(), src, 1, null));
  }

  // Точки карты: полная замена по (город, источник)
  if (body.pois?.items?.length && body.pois.city && body.pois.source) {
    const { city, source, items } = body.pois;
    const now = nowIso();
    const stmts: D1PreparedStatement[] = [c.env.DB.prepare('DELETE FROM pois WHERE city = ? AND source = ?').bind(city, source)];
    for (const p of items) {
      stmts.push(
        c.env.DB.prepare(
          'INSERT OR REPLACE INTO pois (id, city, category, name, name_ar, lat, lon, venue, floor, is_closed, extra, source, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(p.id, city, p.category, p.name ?? null, p.name_ar ?? null, p.lat, p.lon, p.venue ?? null, p.floor ?? null, p.is_closed ? 1 : 0,
          JSON.stringify(p.extra ?? {}), source, now),
      );
    }
    for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
    report.pois = items.length;
  }
  if (logs.length) await c.env.DB.batch(logs);
  return c.json({ ok: true, ...report });
});

// ---------------- Бот ----------------

app.post('/bot/webhook', async (c) => {
  if (c.env.BOT_WEBHOOK_SECRET && c.req.header('x-telegram-bot-api-secret-token') !== c.env.BOT_WEBHOOK_SECRET) return c.text('forbidden', 403);
  const update = await c.req.json<any>();
  c.executionCtx.waitUntil(handleUpdate(c.env, update).catch((e) => console.error('bot', e)));
  return c.text('ok');
});

async function handleUpdate(env: Env, update: any) {
  const msg = update.message;
  if (!msg?.from || msg.chat?.type !== 'private') return;
  const user: TgUser = msg.from;
  await upsertUser(env, user, { canMessage: true });
  const text: string = msg.text ?? '';
  const [cmd, payload] = text.split(/\s+/, 2);
  if (cmd === '/start' && payload?.startsWith('g_')) {
    try {
      const g = await joinGroup(env, user, payload.slice(2));
      await tg(env, 'sendMessage', {
        chat_id: user.id,
        parse_mode: 'HTML',
        text: `Ас-саляму алейкум, ${escapeHtml(user.first_name ?? '')}!\n\nВы в группе <b>${escapeHtml(g.name)}</b>. Сюда будут приходить напоминания о встречах и объявления руководителя.`,
        reply_markup: openAppButton(env, 'Открыть расписание группы', `g_${g.code}`),
      });
    } catch (e) {
      await sendMessage(env, user.id, 'Не нашёл группу по этой ссылке. Попросите у руководителя новый QR-код.');
    }
    return;
  }
  if (cmd === '/start' || cmd === '/help') {
    await tg(env, 'sendMessage', {
      chat_id: user.id,
      parse_mode: 'HTML',
      text:
        `Ас-саляму алейкум, ${escapeHtml(user.first_name ?? '')}! Я <b>${escapeHtml(env.APP_NAME)}</b> — помощник паломника в Мекке и Медине.\n\n` +
        '🕋 Загруженность Матафа и Масаа — официальные данные\n🧭 Туалеты, ворота, коляски, еда рядом\n🎙 Голосовой ассистент и переводчик\n👥 Расписание вашей группы и напоминания\n\nНажмите кнопку ниже 👇',
      reply_markup: openAppButton(env, `Открыть ${env.APP_NAME}`),
    });
    return;
  }
  // Любой другой текст — отвечает ассистент прямо в чате
  if (text) {
    await tg(env, 'sendChatAction', { chat_id: user.id, action: 'typing' });
    const u = await env.DB.prepare('SELECT city FROM users WHERE id = ?').bind(user.id).first<any>();
    const res = await assistant(env, { user, city: asCity(u?.city) }, [{ role: 'user', content: text.slice(0, 2000) }]);
    await tg(env, 'sendMessage', { chat_id: user.id, text: res.text || '…', reply_markup: openAppButton(env, `Открыть ${env.APP_NAME}`) });
  }
}

// ---------------- Авторизация Mini App ----------------

app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (path === '/api/ingest' || path === '/api/config') return next();
  const initData = c.req.header('x-telegram-init-data') ?? '';
  let user = await verifyInitData(initData, c.env.BOT_TOKEN);
  if (!user && c.env.DEV_AUTH === '1') user = { id: 1, first_name: 'Тест', username: 'dev' };
  if (!user) return c.json({ error: 'Откройте приложение из Telegram' }, 401);
  c.set('user', user);
  return next();
});

const q = (c: any) => {
  const lat = parseFloat(c.req.query('lat') ?? '');
  const lon = parseFloat(c.req.query('lon') ?? '');
  return { city: asCity(c.req.query('city')), lat: Number.isFinite(lat) ? lat : undefined, lon: Number.isFinite(lon) ? lon : undefined };
};

app.post('/api/me', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<any>().catch(() => ({}));
  await upsertUser(c.env, user, { city: body.city ? asCity(body.city) : undefined, canMessage: !!body.canMessage });
  if (typeof body.notifyCrowd === 'boolean') {
    await c.env.DB.prepare('UPDATE users SET notify_crowd = ? WHERE id = ?').bind(body.notifyCrowd ? 1 : 0, user.id).run();
  }
  const me = await c.env.DB.prepare('SELECT id, first_name, city, can_message, notify_crowd FROM users WHERE id = ?').bind(user.id).first();
  const groups = await getMyGroups(c.env, user.id);
  return c.json({ me, groups });
});

app.get('/api/crowd', async (c) => c.json(await getCrowd(c.env)));

app.get('/api/crowd/history', async (c) => {
  const hours = Math.min(Number(c.req.query('hours') ?? 24), 24 * 14);
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = (
    await c.env.DB.prepare('SELECT city, zone_key, status, minutes, fetched_at FROM crowd_history WHERE fetched_at >= ? ORDER BY fetched_at').bind(since).all()
  ).results;
  return c.json({ since, rows });
});

app.get('/api/prayer', (c) => c.json(getPrayer(q(c).city)));
app.get('/api/weather', async (c) => c.json(await getWeather(c.env, q(c).city)));
app.get('/api/rates', async (c) => c.json(await getRates(c.env)));

app.get('/api/places', async (c) => {
  const { city, lat, lon } = q(c);
  const items = await nearbyPlaces(c.env, {
    city,
    category: c.req.query('category') ?? 'toilet',
    lat,
    lon,
    cuisine: c.req.query('cuisine') || undefined,
    homeFood: c.req.query('homeFood') === '1',
    limit: Math.min(Number(c.req.query('limit') ?? 60), 200),
  });
  return c.json({ items });
});
app.get('/api/places/categories', async (c) => c.json({ categories: await placeCounts(c.env, q(c).city) }));

app.get('/api/now', async (c) => {
  const { city } = q(c);
  const user = c.get('user');
  const [crowd, weather, groups] = await Promise.all([getCrowd(c.env), getWeather(c.env, city).catch(() => null), getMyGroups(c.env, user.id)]);
  let nextEvent = null;
  if (groups[0]) {
    nextEvent = await c.env.DB.prepare('SELECT * FROM events WHERE group_id = ? AND starts_at >= ? ORDER BY starts_at LIMIT 1').bind(groups[0].id, nowIso()).first();
  }
  return c.json({ prayer: getPrayer(city), weather, crowd: city === 'makkah' ? crowd.makkah : crowd.madinah, crowdFetchedAt: crowd.fetchedAt, group: groups[0] ?? null, nextEvent });
});

// ---------------- ИИ ----------------

async function rateLimit(env: Env, userId: number, bucket: string, perMinute: number) {
  const key = `rl:${bucket}:${userId}:${Math.floor(Date.now() / 60000)}`;
  const n = Number((await env.CACHE.get(key)) ?? 0);
  if (n >= perMinute) throw new HttpError(429, 'Слишком много запросов, подождите минуту');
  await env.CACHE.put(key, String(n + 1), { expirationTtl: 120 });
}

app.post('/api/next', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<any>().catch(() => ({}));
  const city: City = asCity(body.city);
  const cacheKey = `next:${user.id}:${city}`;
  if (!body.refresh) {
    const hit = await c.env.CACHE.get(cacheKey, 'json');
    if (hit) return c.json(hit);
  }
  await rateLimit(c.env, user.id, 'next', 6);
  const res = await whatNext(c.env, { user, city, lat: body.lat, lon: body.lon });
  await c.env.CACHE.put(cacheKey, JSON.stringify(res), { expirationTtl: 300 });
  return c.json(res);
});

app.post('/api/assistant', async (c) => {
  const user = c.get('user');
  await rateLimit(c.env, user.id, 'chat', 20);
  const body = await c.req.json<any>();
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!history.length) throw new HttpError(400, 'Пустое сообщение');
  const res = await assistant(c.env, { user, city: asCity(body.city), lat: body.lat, lon: body.lon, voice: !!body.voice }, history);
  return c.json(res);
});

app.post('/api/stt', async (c) => {
  const user = c.get('user');
  await rateLimit(c.env, user.id, 'stt', 30);
  const body = await c.req.json<any>();
  if (!body.audio) throw new HttpError(400, 'Нет аудио');
  return c.json(await transcribe(c.env, body.audio, body.format ?? 'webm', body.language || undefined));
});

app.post('/api/tts', async (c) => {
  const user = c.get('user');
  await rateLimit(c.env, user.id, 'tts', 40);
  const body = await c.req.json<any>();
  if (!body.text) throw new HttpError(400, 'Нет текста');
  return synthesize(c.env, String(body.text), body.voice);
});

app.post('/api/translate', async (c) => {
  const user = c.get('user');
  await rateLimit(c.env, user.id, 'tr', 30);
  const body = await c.req.json<any>();
  if (!body.text || !body.target) throw new HttpError(400, 'Нужны текст и язык');
  return c.json(await translate(c.env, String(body.text).slice(0, 2000), body.target, body.source || undefined));
});

// ---------------- Группы ----------------

app.get('/api/groups', async (c) => c.json({ groups: await getMyGroups(c.env, c.get('user').id) }));
app.post('/api/groups', async (c) => {
  await upsertUser(c.env, c.get('user'));
  return c.json(await createGroup(c.env, c.get('user'), await c.req.json()));
});
app.post('/api/groups/join', async (c) => {
  await upsertUser(c.env, c.get('user'));
  const { code } = await c.req.json<any>();
  return c.json(await joinGroup(c.env, c.get('user'), String(code ?? '')));
});
app.get('/api/groups/:id', async (c) => c.json(await getGroup(c.env, Number(c.req.param('id')), c.get('user').id)));
app.patch('/api/groups/:id', async (c) => c.json(await updateGroup(c.env, c.get('user'), Number(c.req.param('id')), await c.req.json())));
app.post('/api/groups/:id/leave', async (c) => c.json(await leaveGroup(c.env, c.get('user'), Number(c.req.param('id')))));
app.post('/api/groups/:id/events', async (c) => c.json(await addEvent(c.env, c.get('user'), Number(c.req.param('id')), await c.req.json())));
app.delete('/api/groups/:id/events/:eid', async (c) =>
  c.json(await deleteEvent(c.env, c.get('user'), Number(c.req.param('id')), Number(c.req.param('eid')))),
);
app.post('/api/groups/:id/announce', async (c) => {
  const { text } = await c.req.json<any>();
  return c.json(await announce(c.env, c.get('user'), Number(c.req.param('id')), text));
});

// ---------------- Фоновые задачи ----------------

async function sendReminders(env: Env) {
  const now = Date.now();
  const upcoming = (
    await env.DB.prepare('SELECT e.*, g.name AS group_name FROM events e JOIN groups g ON g.id = e.group_id WHERE e.starts_at BETWEEN ? AND ?')
      .bind(new Date(now).toISOString(), new Date(now + 65 * 60000).toISOString())
      .all<any>()
  ).results;
  for (const e of upcoming) {
    const minutes = Math.round((Date.parse(e.starts_at) - now) / 60000);
    const kind = minutes <= 17 ? '15' : minutes <= 62 && minutes >= 45 ? '60' : null;
    if (!kind) continue;
    const already = await env.DB.prepare('SELECT 1 FROM reminders_sent WHERE event_id = ? AND kind = ?').bind(e.id, kind).first();
    if (already) continue;
    await env.DB.prepare('INSERT INTO reminders_sent VALUES (?,?,?)').bind(e.id, kind, nowIso()).run();
    const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date(e.starts_at));
    const members = (await env.DB.prepare('SELECT user_id FROM group_members WHERE group_id = ?').bind(e.group_id).all<any>()).results;
    const text =
      `${kind === '15' ? '⏰ Через 15 минут' : '🕐 Через час'}: <b>${escapeHtml(e.title)}</b> в ${time}` +
      `${e.place_name ? `\n📍 ${escapeHtml(e.place_name)}` : ''}${e.note ? `\n${escapeHtml(e.note)}` : ''}`;
    for (const m of members) await sendMessage(env, m.user_id, text);
  }
}

async function crowdAlerts(env: Env, changed: { city: string; zone_key: string; status: number; minutes: number | null }[], previous: Map<string, number>) {
  const sahn = changed.find((z) => z.city === 'makkah' && z.zone_key === 'tawaf:1');
  if (!sahn || sahn.status !== 1 || (previous.get('makkah|tawaf:1') ?? 0) < 2) return;
  const cutoff = new Date(Date.now() - 3 * 3600000).toISOString();
  const users = (
    await env.DB.prepare('SELECT id FROM users WHERE notify_crowd = 1 AND can_message = 1 AND city = ? AND (last_crowd_alert_at IS NULL OR last_crowd_alert_at < ?)')
      .bind('makkah', cutoff).all<any>()
  ).results;
  const text = `🟢 Сахн у Каабы стал ${STATUS_LABEL[1]}${sahn.minutes ? ` — таваф примерно ${sahn.minutes} мин` : ''}. Хорошее время для тавафа.`;
  for (const u of users) {
    if (await sendMessage(env, u.id, text)) {
      await env.DB.prepare('UPDATE users SET last_crowd_alert_at = ? WHERE id = ?').bind(nowIso(), u.id).run();
    }
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sendReminders(env).catch((e) => console.error('reminders', e)));
    // прогрев мест из OSM: раз в ~12 ч обновляем заранее, чтобы пользователь не ждал Overpass
    ctx.waitUntil(
      (async () => {
        for (const city of ['makkah', 'madinah'] as const) {
          const warmedKey = `osm-warm:${city}`;
          if (await env.CACHE.get(warmedKey)) continue;
          const places = await getOsmPlaces(env, city, true);
          if (places.length) await env.CACHE.put(warmedKey, '1', { expirationTtl: 12 * 3600 });
        }
      })().catch((e) => console.error('osm warm', e)),
    );
  },
};

// для тестов/ИИ
export { crowdSummary };
