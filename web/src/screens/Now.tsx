import { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight, CloudSun, Coins, DoorOpen, Languages, Mic, RefreshCw, Sparkles, Thermometer, Toilet, UtensilsCrossed, Users,
} from 'lucide-react';
import { api, type NextPlan, type PrayerData, type Weather, type Zone, type GroupEvent } from '../lib/api';
import { useApi, useLocation, useNow } from '../lib/hooks';
import { fmtAgo, fmtDateLong, fmtDuration, fmtTime, greeting } from '../lib/format';
import { tgUser } from '../lib/tg';
import { CityToggle, Skel, StatusPill, useApp } from '../components/ui';
import { KaabaIcon } from '../components/KaabaIcon';

interface NowData {
  prayer: PrayerData;
  weather: Weather | null;
  crowd: Zone[];
  crowdFetchedAt: string | null;
  group: { id: number; name: string } | null;
  nextEvent: GroupEvent | null;
}

export default function NowScreen() {
  const { city, go } = useApp();
  const { loc } = useLocation();
  const { data, loading } = useApi<NowData>(`/api/now?city=${city}`, { refreshMs: 60000 });
  const now = useNow(15000);
  const name = tgUser()?.first_name;

  return (
    <div className="screen fade-in">
      <div className="stack">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="muted small">{fmtDateLong()}{data?.prayer.hijri ? ` · ${data.prayer.hijri}` : ''}</div>
            <div className="page-title mt4">{greeting()}{name ? `, ${name}` : ''}</div>
          </div>
        </div>
        <CityToggle />

        <NextCard lat={loc?.lat} lon={loc?.lon} />

        {/* Намаз */}
        {data ? <PrayerCard prayer={data.prayer} now={now} /> : <div className="card"><Skel h={80} /></div>}

        {/* Погода + загруженность */}
        <div className="row" style={{ alignItems: 'stretch' }}>
          <div className="card tight grow" onClick={() => go('haram')} style={{ flexBasis: 0 }}>
            <div className="row between">
              <span className="muted small">Харам</span>
              <KaabaIcon size={18} />
            </div>
            {data ? <CrowdMini zones={data.crowd} fetchedAt={data.crowdFetchedAt} now={now} city={city} /> : <Skel h={44} />}
          </div>
          <div className="card tight grow" style={{ flexBasis: 0 }}>
            <div className="row between">
              <span className="muted small">Погода</span>
              <CloudSun size={18} />
            </div>
            {data?.weather ? (
              <>
                <div className="mt8" style={{ fontSize: 26, fontWeight: 750 }}>{Math.round(data.weather.temp)}°</div>
                <div className="small muted">ощущается {Math.round(data.weather.feels)}°</div>
                {data.weather.advice && (
                  <div className="tiny mt4" style={{ color: 'var(--high)' }}>
                    <Thermometer size={11} style={{ verticalAlign: -1 }} /> {data.weather.advice}
                  </div>
                )}
              </>
            ) : loading ? <Skel h={44} /> : <div className="small muted mt8">нет данных</div>}
          </div>
        </div>

        {/* Ближайшее событие группы */}
        {data?.nextEvent && (
          <div className="card tight row" onClick={() => go('group')}>
            <div className="list-ico" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}><Users size={20} /></div>
            <div className="grow">
              <div className="small muted">{data.group?.name}</div>
              <div className="bold ellipsis">{data.nextEvent.title}</div>
              <div className="small">
                {fmtTime(data.nextEvent.starts_at)} · через {fmtDuration((Date.parse(data.nextEvent.starts_at) - now) / 60000)}
                {data.nextEvent.place_name ? ` · ${data.nextEvent.place_name}` : ''}
              </div>
            </div>
            <ChevronRight size={18} className="faint" />
          </div>
        )}

        <div className="section-title">Быстро</div>
        <div className="quick-grid">
          <Quick icon={<Toilet size={22} />} color="#2f7de1" label="Туалет рядом" onClick={() => go('nearby', { category: 'toilet' })} />
          <Quick icon={<DoorOpen size={22} />} color="#b48a35" label="Ворота" onClick={() => go('nearby', { category: 'gate' })} />
          <Quick icon={<UtensilsCrossed size={22} />} color="#e0662b" label="Еда как дома" onClick={() => go('nearby', { category: 'food', homeFood: true })} />
          <Quick icon={<Mic size={22} />} color="#0b5d4b" label="Позвонить ассистенту" onClick={() => go('assistant', { call: true })} />
          <Quick icon={<Languages size={22} />} color="#8a63d2" label="Переводчик" onClick={() => go('translate')} />
          <Quick icon={<Coins size={22} />} color="#17915f" label="Обмен валюты" onClick={() => go('nearby', { category: 'exchange' })} />
        </div>
      </div>
    </div>
  );
}

function Quick({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <button className="quick" onClick={onClick}>
      <span className="q-ico" style={{ background: `${color}1f`, color }}>{icon}</span>
      {label}
    </button>
  );
}

function NextCard({ lat, lon }: { lat?: number; lon?: number }) {
  const { city, go } = useApp();
  const [plan, setPlan] = useState<NextPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showAlt, setShowAlt] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setErr(null);
      try {
        setPlan(await api.post<NextPlan>('/api/next', { city, lat, lon, refresh }));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [city, lat, lon],
  );

  useEffect(() => {
    load();
  }, [load]);

  const act = () => {
    const a = plan?.action;
    if (!a) return;
    if (a.type === 'crowd') go('haram');
    else if (a.type === 'map') go('nearby', { category: a.category || 'gate' });
    else if (a.type === 'group') go('group');
    else if (a.type === 'assistant') go('assistant', { prompt: plan?.title });
  };

  return (
    <div className="hero">
      <div className="hero-pattern" />
      <div className="row between" style={{ position: 'relative' }}>
        <div className="row" style={{ gap: 6 }}>
          <Sparkles size={16} color="#f1d58a" />
          <span className="small bold" style={{ color: '#f1d58a', letterSpacing: '0.04em' }}>ЧТО ДАЛЬШЕ?</span>
        </div>
        <button className="icon-btn" style={{ background: 'rgba(255,255,255,.12)', border: 0, width: 34, height: 34, color: '#fff' }} onClick={() => load(true)} aria-label="Обновить">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div style={{ position: 'relative' }} className="mt8">
        {loading && !plan ? (
          <div className="stack" style={{ gap: 8 }}>
            <Skel h={22} w="80%" />
            <Skel h={14} />
            <Skel h={14} w="70%" />
          </div>
        ) : err && !plan ? (
          <div className="small">Не удалось составить план: {err}</div>
        ) : plan ? (
          <>
            <div style={{ fontSize: 20, fontWeight: 750, lineHeight: 1.25 }}>{plan.title}</div>
            <div className="mt8" style={{ opacity: 0.9, lineHeight: 1.45 }}>{plan.text}</div>
            <div className="row mt12 wrap">
              {plan.action && plan.action.type !== 'none' && (
                <button className="btn sm" style={{ background: '#f1d58a', color: '#3a2c07' }} onClick={act}>{plan.action.label}</button>
              )}
              {!!plan.alternatives?.length && (
                <button className="btn sm light" onClick={() => setShowAlt((v) => !v)}>{showAlt ? 'Скрыть' : 'Другие варианты'}</button>
              )}
            </div>
            {showAlt && (
              <div className="stack mt12" style={{ gap: 8 }}>
                {plan.alternatives!.map((a, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,.1)', borderRadius: 14, padding: '10px 12px' }}>
                    <div className="bold small">{a.title}</div>
                    <div className="small" style={{ opacity: 0.85 }}>{a.text}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function PrayerCard({ prayer, now }: { prayer: PrayerData; now: number }) {
  const left = Math.max(0, (Date.parse(prayer.next.time) - now) / 60000);
  const list = prayer.today;
  return (
    <div className="card">
      <div className="row between">
        <div>
          <div className="muted small">Следующий намаз</div>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 24, fontWeight: 750 }}>{prayer.next.name}</span>
            <span className="bold" style={{ color: 'var(--accent)' }}>{fmtTime(prayer.next.time)}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted small">через</div>
          <div className="countdown bold" style={{ fontSize: 18 }}>{fmtDuration(left)}</div>
        </div>
      </div>
      <div className="row between mt12" style={{ gap: 4 }}>
        {list.map((p) => {
          const isNext = p.key === prayer.next.key && Date.parse(p.time) === Date.parse(prayer.next.time);
          const past = Date.parse(p.time) < now;
          return (
            <div key={p.key} className="center" style={{ flex: 1, padding: '8px 0', borderRadius: 12, background: isNext ? 'var(--accent-soft)' : undefined }}>
              <div className="tiny" style={{ color: isNext ? 'var(--accent)' : 'var(--muted)', fontWeight: 600 }}>{p.name}</div>
              <div className="small bold" style={{ opacity: past && !isNext ? 0.45 : 1 }}>{fmtTime(p.time)}</div>
            </div>
          );
        })}
      </div>
      <div className="tiny faint mt8">Время по календарю Умм аль-Кура. Икама в Харамах ~через 10–25 мин после азана.</div>
    </div>
  );
}

function CrowdMini({ zones, fetchedAt, now, city }: { zones: Zone[]; fetchedAt: string | null; now: number; city: string }) {
  if (!zones.length) return <div className="small muted mt8">Загружаем данные…</div>;
  if (city === 'madinah') {
    const high = zones.filter((z) => z.status === 3).length;
    const mid = zones.filter((z) => z.status === 2).length;
    const status = high >= 4 ? 3 : high || mid >= 3 ? 2 : 1;
    return (
      <>
        <div className="mt8"><StatusPill status={status} /></div>
        <div className="tiny muted mt8">{high ? `${high} зон многолюдно` : 'зоны свободны'} · {fmtAgo(fetchedAt, now)}</div>
      </>
    );
  }
  const sahn = zones.find((z) => z.key === 'tawaf:1') ?? zones[0];
  const best = zones.filter((z) => z.kind === 'tawaf' && z.status > 0 && z.status < 4).sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999))[0];
  return (
    <>
      <div className="mt8"><StatusPill status={sahn.status} label={`Сахн: ${sahn.statusLabel}`} /></div>
      <div className="tiny muted mt8">
        {best?.minutes ? `Таваф от ~${best.minutes} мин` : ''}{best?.minutes ? ' · ' : ''}{fmtAgo(sahn.sourceUpdatedAt, now)}
      </div>
    </>
  );
}
