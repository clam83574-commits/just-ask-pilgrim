import type { City, Env, TgUser } from './env';
import { CITIES } from './env';
import { crowdSummary, getCrowd } from './crowd';
import { getPrayer } from './prayer';
import { cuisineRu, distanceM, getOsmPlaces, getRates, getWeather } from './external';
import { nearbyPlaces, PLACE_CATEGORIES } from './places';
import { userGroupContext } from './groups';

const OR_BASE = 'https://openrouter.ai/api/v1';

function orHeaders(env: Env) {
  return {
    authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    'content-type': 'application/json',
    'HTTP-Referer': env.WEBAPP_URL,
    'X-Title': env.APP_NAME,
  };
}

export async function chatCompletion(env: Env, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: orHeaders(env),
    // Gemini 3.x — «думающая» модель: минимальные рассуждения дают ответ за ~3 с и не съедают лимит токенов
    body: JSON.stringify({
      model: env.LLM_MODEL,
      reasoning: { effort: 'minimal', exclude: true },
      ...body,
      max_tokens: Math.max(Number(body.max_tokens ?? 0), 1200),
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.choices) throw new Error(`LLM ${res.status}: ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
  return data;
}

// ---------------- Речь ----------------

export async function transcribe(env: Env, audioBase64: string, format: string, language?: string): Promise<{ text: string; language?: string }> {
  const res = await fetch(`${OR_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: orHeaders(env),
    body: JSON.stringify({
      model: env.STT_MODEL,
      input_audio: { data: audioBase64, format },
      ...(language ? { language } : {}),
    }),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`STT ${res.status}: ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
  return { text: (data?.text ?? '').trim(), language: data?.language };
}

export async function synthesize(env: Env, text: string, voice?: string): Promise<Response> {
  const res = await fetch(`${OR_BASE}/audio/speech`, {
    method: 'POST',
    headers: orHeaders(env),
    body: JSON.stringify({ model: env.TTS_MODEL, input: text.slice(0, 4000), voice: voice || env.TTS_VOICE, response_format: 'mp3' }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS ${res.status}: ${err.slice(0, 300)}`);
  }
  return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') ?? 'audio/mpeg', 'cache-control': 'no-store' } });
}

// ---------------- Переводчик ----------------

export const LANGUAGES: Record<string, string> = {
  ru: 'русский', kk: 'казахский', uz: 'узбекский', ky: 'кыргызский', tg: 'таджикский', az: 'азербайджанский', tr: 'турецкий',
  ar: 'арабский', en: 'английский', ur: 'урду', hi: 'хинди', bn: 'бенгальский', id: 'индонезийский', ms: 'малайский',
  fa: 'персидский', fr: 'французский', ps: 'пушту', sw: 'суахили', ha: 'хауса', am: 'амхарский', tl: 'филиппинский',
};

export async function translate(env: Env, text: string, target: string, source?: string) {
  const data = await chatCompletion(env, {
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Ты синхронный переводчик для паломников в Мекке и Медине. Переводи живо и естественно, как сказал бы носитель; ' +
          'сохраняй вежливость, числа, названия мест (ворота, отели) и имена. Для арабского используй понятный разговорный ' +
          'стиль Хиджаза без огласовок. Ответь строго JSON: {"source_lang":"<ISO-639-1 исходного>","translation":"<перевод>",' +
          '"transliteration":"<латиницей/кириллицей, если целевой язык не на кириллице/латинице, иначе пусто>"}',
      },
      {
        role: 'user',
        content: `Целевой язык: ${LANGUAGES[target] ?? target} (${target}).${source ? ` Исходный язык: ${LANGUAGES[source] ?? source}.` : ''}\nТекст:\n${text}`,
      },
    ],
  });
  const raw = data.choices[0].message.content ?? '{}';
  const parsed = safeJson(raw);
  return {
    translation: String(parsed.translation ?? raw).trim(),
    sourceLang: parsed.source_lang ?? source ?? null,
    transliteration: parsed.transliteration || null,
  };
}

// ---------------- Ассистент с инструментами ----------------

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_crowd',
      description: 'Текущая загруженность: для Мекки — уровни Матафа и Масаа (таваф/саъй, минуты, ворота), для Медины — 13 молельных зон Масджид ан-Набави. Официальные данные ведомства.',
      parameters: { type: 'object', properties: { city: { type: 'string', enum: ['makkah', 'madinah'] } }, required: ['city'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_prayer_times',
      description: 'Время намазов на сегодня, ближайший намаз, дата по хиджре и прогноз спокойных окон для посещения Харама.',
      parameters: { type: 'object', properties: { city: { type: 'string', enum: ['makkah', 'madinah'] } }, required: ['city'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Погода сейчас и на 12 часов: температура, ощущается, УФ, влажность.',
      parameters: { type: 'object', properties: { city: { type: 'string', enum: ['makkah', 'madinah'] } }, required: ['city'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_nearby',
      description:
        'Ближайшие места к пользователю. Категории: ' + Object.entries(PLACE_CATEGORIES).map(([k, v]) => `${k} (${v.label})`).join(', ') +
        '. Для еды можно указать кухню (uzbek, kazakh, turkish, indian, pakistani, bangladeshi, arab ...) или home_food=true (кухня Центральной Азии и Турции).',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: Object.keys(PLACE_CATEGORIES) },
          cuisine: { type: 'string' },
          home_food: { type: 'boolean' },
          limit: { type: 'number' },
        },
        required: ['category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_group_schedule',
      description: 'Группа паломника: ближайшие события (автобус, встреча, экскурсия), места встреч, отель, последние объявления руководителя.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'convert_currency',
      description: 'Перевод сумм между саудовским риялом и другими валютами (USD, EUR, KZT, UZS, KGS, TJS, RUB, AZN, TRY). Межбанковский курс.',
      parameters: {
        type: 'object',
        properties: { amount: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } },
        required: ['amount', 'from', 'to'],
      },
    },
  },
];

export interface AssistantCtx {
  user: TgUser;
  city: City;
  lat?: number;
  lon?: number;
  voice?: boolean;
}

async function runTool(env: Env, ctx: AssistantCtx, name: string, args: any): Promise<unknown> {
  const city: City = args?.city === 'madinah' ? 'madinah' : args?.city === 'makkah' ? 'makkah' : ctx.city;
  switch (name) {
    case 'get_crowd': {
      const crowd = await getCrowd(env);
      return { city, summary: crowdSummary(crowd, city), fetchedAt: crowd.fetchedAt };
    }
    case 'get_prayer_times':
      return getPrayer(city);
    case 'get_weather': {
      const w = await getWeather(env, city);
      return { ...w, hourly: w.hourly.slice(0, 8) };
    }
    case 'find_nearby': {
      const items = await nearbyPlaces(env, {
        city: ctx.city,
        category: args.category,
        lat: ctx.lat,
        lon: ctx.lon,
        cuisine: args.cuisine,
        homeFood: args.home_food,
        limit: Math.min(Number(args.limit) || 5, 8),
      });
      return {
        userLocationKnown: ctx.lat != null,
        items: items.map((p) => ({
          name: p.name, floor: p.floor, venue: p.venue, distance_m: p.distance, closed: p.isClosed,
          cuisine: p.cuisine?.map(cuisineRu), lat: p.lat, lon: p.lon,
        })),
      };
    }
    case 'get_group_schedule':
      return userGroupContext(env, ctx.user.id);
    case 'convert_currency': {
      const r = await getRates(env);
      const from = String(args.from).toUpperCase();
      const to = String(args.to).toUpperCase();
      const inSar = from === 'SAR' ? args.amount : args.amount / (r.perSar[from] ?? NaN);
      const result = to === 'SAR' ? inSar : inSar * (r.perSar[to] ?? NaN);
      return { amount: args.amount, from, to, result: Math.round(result * 100) / 100, note: 'Межбанковский курс; в обменнике курс хуже на 1–3%.' };
    }
    default:
      return { error: 'unknown tool' };
  }
}

/** Живой контекст прямо в промпте — чтобы на типичные вопросы отвечать без вызова инструментов (быстрее для звонка). */
async function liveContext(env: Env, city: City): Promise<string> {
  const [crowd, weather] = await Promise.all([getCrowd(env).catch(() => null), getWeather(env, city).catch(() => null)]);
  const p = getPrayer(city);
  const lines = [
    `Намазы сегодня (${CITIES[city].name}): ${p.today.map((x) => `${x.name} ${fmtRiyadh(x.time)}`).join(', ')}. Следующий: ${p.next.name} через ${p.next.minutesLeft} мин. Хиджра: ${p.hijri}.`,
    crowd ? `Загруженность (${CITIES[city].name}):\n${crowdSummary(crowd, city)}` : '',
    weather ? `Погода: ${Math.round(weather.temp)}°, ощущается ${Math.round(weather.feels)}°, УФ ${weather.uv}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

const fmtRiyadh = (iso: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date(iso));

function systemPrompt(env: Env, ctx: AssistantCtx, live = ''): string {
  const now = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date());
  return [
    `Ты — ${env.APP_NAME}, заботливый помощник паломника в Мекке и Медине (Умра и Хадж). Пользователи — в основном из Казахстана, Узбекистана, Кыргызстана, Таджикистана, России.`,
    `Сейчас ${now} (время Мекки). Пользователь в городе: ${CITIES[ctx.city].name}. Имя: ${ctx.user.first_name ?? 'паломник'}.`,
    ctx.lat != null ? `Геопозиция пользователя известна: ${ctx.lat.toFixed(5)}, ${ctx.lon!.toFixed(5)}.` : 'Геопозиция неизвестна — расстояния считаются от Харама.',
    'Правила:',
    '- Отвечай на языке пользователя (по умолчанию русский). Обращайся тепло и уважительно.',
    '- Факты о загруженности, намазах, погоде, местах, группе и валюте бери ТОЛЬКО из инструментов. Ничего не выдумывай: если данных нет — так и скажи.',
    '- Давай конкретику: какие ворота, какой этаж, сколько минут, что сделать прямо сейчас. Учитывай время до следующего намаза и расписание группы.',
    '- Загруженность — официальный статус ведомства; упоминай, если он обновлялся давно.',
    '- Фикх и обряды: отвечай кратко по общепринятому (у большинства пользователей ханафитский мазхаб), в спорных вопросах советуй уточнить у руководителя группы или имама. Не выноси фетв.',
    '- При угрозе здоровью — сразу номер 911 (единая экстренная служба) или 997 (скорая).',
    '- Не используй markdown-разметку (звёздочки, решётки). Для списков — строки, начинающиеся с «• ».',
    live ? `
Актуальные данные (используй их, инструменты вызывай только если нужно больше):
${live}` : '',
    ctx.voice
      ? '- Это голосовой разговор: отвечай коротко, 1–3 предложения, без списков, markdown, эмодзи и ссылок. Числа пиши словами, если так естественнее.'
      : '- Это чат: отвечай компактно, можно короткие списки. Без длинных вступлений.',
  ].join('\n');
}

export async function assistant(env: Env, ctx: AssistantCtx, history: { role: 'user' | 'assistant'; content: string }[]) {
  const live = await liveContext(env, ctx.city).catch(() => '');
  const messages: any[] = [{ role: 'system', content: systemPrompt(env, ctx, live) }, ...history.slice(-12)];
  const used: string[] = [];
  for (let step = 0; step < 4; step++) {
    const data = await chatCompletion(env, { messages, tools: TOOLS, temperature: 0.4, max_tokens: ctx.voice ? 300 : 800 });
    const msg = data.choices[0].message;
    if (msg.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      const results = await Promise.all(
        msg.tool_calls.map(async (tc: any) => {
          used.push(tc.function.name);
          let result: unknown;
          try {
            result = await runTool(env, ctx, tc.function.name, safeJson(tc.function.arguments || '{}'));
          } catch (e) {
            result = { error: String(e) };
          }
          return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 12000) };
        }),
      );
      messages.push(...results);
      continue;
    }
    return { text: (msg.content ?? '').trim(), tools: used };
  }
  return { text: 'Извините, не получилось собрать ответ. Попробуйте переформулировать вопрос.', tools: used };
}

// ---------------- «Что дальше?» ----------------

export async function whatNext(env: Env, ctx: AssistantCtx) {
  const [crowd, weather, group] = await Promise.all([
    getCrowd(env),
    getWeather(env, ctx.city).catch(() => null),
    userGroupContext(env, ctx.user.id),
  ]);
  const prayer = getPrayer(ctx.city);
  const now = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date());
  const distToHaram = ctx.lat != null ? distanceM(ctx.lat, ctx.lon!, CITIES[ctx.city].lat, CITIES[ctx.city].lon) : null;
  const context = {
    now,
    city: CITIES[ctx.city].name,
    distance_to_haram_m: distToHaram,
    next_prayer: { name: prayer.next.name, minutes_left: prayer.next.minutesLeft },
    quiet_windows_forecast: prayer.quietWindows.slice(0, 3),
    crowd: crowdSummary(crowd, ctx.city),
    weather: weather ? { temp: weather.temp, feels: weather.feels, uv: weather.uv, advice: weather.advice } : null,
    group,
  };
  let data: any;
  try {
    data = await chatCompletion(env, {
    temperature: 0.5,
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Ты планируешь ближайшие 2–3 часа паломника. На основе контекста предложи ОДНО главное действие прямо сейчас и 1–2 запасных. ' +
          'Учитывай: время до намаза (на таваф нужно столько минут, сколько указано в загруженности, плюс дорога), ближайшие события группы ' +
          '(не опоздать!), жару, загруженность и ворота. Будь конкретным: какие ворота, какой этаж, сколько минут. Пиши по-русски, тепло и кратко. ' +
          'Ответ строго JSON: {"title":"<до 60 символов>","text":"<2–3 предложения с конкретикой и почему>",' +
          '"action":{"type":"crowd|map|group|assistant|none","label":"<текст кнопки до 20 символов>","category":"<категория места, если type=map>"},' +
          '"alternatives":[{"title":"...","text":"<1 предложение>"}],"urgency":"normal|soon|now"}',
      },
      { role: 'user', content: JSON.stringify(context) },
    ],
    });
  } catch (e) {
    console.error('whatNext LLM failed', e);
    return { ...fallbackPlan(context, crowd, ctx.city), generatedAt: new Date().toISOString(), fallback: true, context: { nextPrayer: context.next_prayer } };
  }
  const parsed = safeJson(data.choices[0].message.content ?? '{}');
  if (!parsed.title) return { ...fallbackPlan(context, crowd, ctx.city), generatedAt: new Date().toISOString(), fallback: true };
  return { ...parsed, generatedAt: new Date().toISOString(), context: { nextPrayer: context.next_prayer } };
}

/** План без ИИ: правила по времени до намаза, событиям группы и загруженности. */
function fallbackPlan(context: any, crowd: Awaited<ReturnType<typeof getCrowd>>, city: City) {
  const left: number = context.next_prayer.minutes_left;
  const prayerName: string = context.next_prayer.name;
  const gen = ({ Фаджр: 'Фаджра', Зухр: 'Зухра', Аср: 'Асра', Магриб: 'Магриба', Иша: 'Иша' } as Record<string, string>)[prayerName] ?? prayerName;
  const dat = ({ Фаджр: 'Фаджру', Зухр: 'Зухру', Аср: 'Асру', Магриб: 'Магрибу', Иша: 'Иша' } as Record<string, string>)[prayerName] ?? prayerName;
  const ev = context.group?.upcomingEvents?.[0];
  if (ev && ev.minutes_left <= 45) {
    return {
      title: `Скоро: ${ev.title}`,
      text: `Через ${ev.minutes_left} мин${ev.place_name ? ` — ${ev.place_name}` : ''}. Выходите заранее, чтобы не опоздать.`,
      action: { type: 'group', label: 'Расписание' },
      urgency: ev.minutes_left <= 15 ? 'now' : 'soon',
      alternatives: [],
    };
  }
  if (city === 'makkah') {
    const open = crowd.makkah.filter((z) => z.kind === 'tawaf' && z.status > 0 && z.status < 4 && z.minutes);
    const best = open.sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999))[0];
    if (best && best.minutes! + 20 < left) {
      return {
        title: `Успеете таваф до ${gen}`,
        text: `До ${gen} ${left} мин. ${best.name}: ${best.statusLabel}, таваф ~${best.minutes} мин${best.gates.length ? `, заходите через ворота ${best.gates.slice(0, 3).join(', ')}` : ''}.`,
        action: { type: 'crowd', label: 'Загруженность' },
        urgency: 'normal',
        alternatives: [{ title: 'Отдохнуть и прийти к намазу', text: `Выйдите за 30–40 минут до ${gen}, чтобы найти место.` }],
      };
    }
  }
  if (left <= 45) {
    return {
      title: `Готовьтесь к ${dat}`,
      text: `До азана ${left} мин. Совершите омовение и идите в мечеть заранее — ближе к намазу вход и площадки заполняются.`,
      action: { type: 'map', label: 'Ворота рядом', category: 'gate' },
      urgency: left <= 20 ? 'now' : 'soon',
      alternatives: [],
    };
  }
  return {
    title: 'Свободное время',
    text: `До ${gen} ${left} мин. Хорошее время поесть, отдохнуть в отеле или совершить дополнительный таваф.`,
    action: { type: 'map', label: 'Еда рядом', category: 'food' },
    urgency: 'normal',
    alternatives: [{ title: 'Таваф', text: 'Посмотрите загруженность — выберите самый свободный уровень Матафа.' }],
  };
}

export function safeJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
    return {};
  }
}
