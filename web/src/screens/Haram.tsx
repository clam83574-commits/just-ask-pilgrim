import { useEffect, useState } from 'react';
import { Bell, BellRing, Clock, Info, Timer } from 'lucide-react';
import { api, type Crowd, type PrayerData, type Zone } from '../lib/api';
import { useApi, useNow } from '../lib/hooks';
import { fmtAgo, fmtTime } from '../lib/format';
import { haptic, requestWriteAccess } from '../lib/tg';
import { CityToggle, Skel, StatusPill, useApp } from '../components/ui';
import zonesData from '../data/madinah_zones.json';

export default function HaramScreen() {
  const { city } = useApp();
  const { data: crowd } = useApi<Crowd>('/api/crowd', { refreshMs: 60000 });
  const { data: prayer } = useApi<PrayerData>(`/api/prayer?city=${city}`);
  const now = useNow(30000);

  return (
    <div className="screen fade-in">
      <div className="stack">
        <div className="page-title">{city === 'makkah' ? 'Масджид аль-Харам' : 'Масджид ан-Набави'}</div>
        <CityToggle />
        {crowd?.fetchedAt && now - Date.parse(crowd.fetchedAt) > 30 * 60000 && (
          <div className="card tight row small" style={{ background: 'var(--mid-soft)', color: 'var(--mid)', boxShadow: 'none' }}>
            <Clock size={16} style={{ flex: 'none' }} />
            <span>Нет свежих данных от ведомства — показано состояние на {fmtTime(crowd.fetchedAt)} ({fmtAgo(crowd.fetchedAt, now)}).</span>
          </div>
        )}
        {!crowd ? (
          <div className="stack">{[1, 2, 3].map((i) => <div key={i} className="card"><Skel h={70} /></div>)}</div>
        ) : city === 'makkah' ? (
          <Makkah zones={crowd.makkah} now={now} />
        ) : (
          <Madinah zones={crowd.madinah} now={now} />
        )}
        {prayer && <QuietWindows prayer={prayer} />}
        <NotifyToggle />
        <div className="card soft row small muted" style={{ alignItems: 'flex-start' }}>
          <Info size={16} style={{ flex: 'none', marginTop: 2 }} />
          <span>
            Данные — официальный статус Главного управления по делам двух святынь. Ведомство обновляет его по мере изменения
            ситуации, поэтому смотрите на время обновления.
          </span>
        </div>
      </div>
    </div>
  );
}

function Makkah({ zones, now }: { zones: Zone[]; now: number }) {
  const [kind, setKind] = useState<'tawaf' | 'sai'>('tawaf');
  const list = zones.filter((z) => z.kind === kind);
  const open = list.filter((z) => z.status > 0 && z.status < 4);
  const best = [...open].sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999) || a.status - b.status)[0];
  return (
    <>
      <div className="seg">
        <button className={kind === 'tawaf' ? 'on' : ''} onClick={() => { haptic.select(); setKind('tawaf'); }}>Таваф · Матаф</button>
        <button className={kind === 'sai' ? 'on' : ''} onClick={() => { haptic.select(); setKind('sai'); }}>Саъй · Масаа</button>
      </div>
      {best && (
        <div className="hero" style={{ padding: 16 }}>
          <div className="hero-pattern" />
          <div style={{ position: 'relative' }}>
            <div className="small" style={{ color: '#f1d58a', fontWeight: 700, letterSpacing: '.04em' }}>ЛУЧШИЙ ВЫБОР СЕЙЧАС</div>
            <div className="mt4" style={{ fontSize: 20, fontWeight: 750 }}>{best.name}</div>
            <div className="mt4" style={{ opacity: 0.9 }}>
              {best.statusLabel}
              {best.minutes ? ` · ${kind === 'tawaf' ? 'таваф' : 'саъй'} ~${best.minutes} мин` : ''}
            </div>
            {best.gates.length > 0 && (
              <div className="row wrap mt8" style={{ gap: 6 }}>
                <span className="small" style={{ opacity: 0.8 }}>Ворота:</span>
                {best.gates.map((g) => (
                  <span key={g} className="gate" style={best.closedGates.includes(g) ? { background: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.5)', textDecoration: 'line-through' } : { background: 'rgba(241,213,138,.2)', color: '#f1d58a' }}>{g}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {list.map((z) => <ZoneCard key={z.key} z={z} now={now} />)}
    </>
  );
}

function ZoneCard({ z, now }: { z: Zone; now: number }) {
  const closed = z.status === 4;
  const max = z.range.crowded ?? 120;
  const pct = z.minutes ? Math.min(100, (z.minutes / max) * 100) : 0;
  return (
    <div className="card" style={{ opacity: closed ? 0.72 : 1 }}>
      <div className="row between">
        <div className="card-title">{z.name}</div>
        <StatusPill status={z.status} label={z.statusLabel} />
      </div>
      {!closed && z.minutes ? (
        <>
          <div className="row mt12" style={{ gap: 6, alignItems: 'baseline' }}>
            <Timer size={16} className="muted" style={{ alignSelf: 'center' }} />
            <span style={{ fontSize: 22, fontWeight: 750 }}>{Math.max(5, z.minutes - 5)}–{z.minutes + 5}</span>
            <span className="muted small">мин на {z.kind === 'sai' ? 'саъй' : 'таваф'}</span>
          </div>
          <div className="progress mt8"><div className={`bar-s${z.status}`} style={{ width: `${pct}%` }} /></div>
          {z.range.light && (
            <div className="row between tiny faint mt4">
              <span>свободно ~{z.range.light}</span><span>средне ~{z.range.average}</span><span>толпа ~{z.range.crowded}</span>
            </div>
          )}
        </>
      ) : closed ? (
        <div className="small muted mt8">Сейчас закрыто для посетителей</div>
      ) : null}
      {z.gates.length > 0 && (
        <div className="row wrap mt12" style={{ gap: 6 }}>
          <span className="small muted">Ворота:</span>
          {z.gates.map((g) => <span key={g} className={`gate ${z.closedGates.includes(g) ? 'closed' : ''}`}>{g}</span>)}
        </div>
      )}
      <div className="row tiny faint mt12" style={{ gap: 4 }}>
        <Clock size={12} /> статус обновлён {fmtAgo(z.sourceUpdatedAt ?? z.fetchedAt, now)}
      </div>
    </div>
  );
}

const ZONE_COLORS: Record<number, string> = { 1: 'rgba(23,145,95,.55)', 2: 'rgba(214,160,20,.6)', 3: 'rgba(209,67,63,.6)' };

function Madinah({ zones, now }: { zones: Zone[]; now: number }) {
  const { width, height, polygons } = zonesData as { width: number; height: number; polygons: number[][] };
  const count = (s: number) => zones.filter((z) => z.status === s).length;
  return (
    <>
      <div className="card" style={{ padding: 10 }}>
        <div className="madinah-map">
          <img src="/med-map.webp" alt="Схема Масджид ан-Набави" />
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            {polygons.map((p, i) => {
              if (!p.length) return null;
              const status = zones[i]?.status ?? 0;
              const pts = [];
              for (let k = 0; k < p.length; k += 2) pts.push(`${p[k]},${p[k + 1]}`);
              return <polygon key={i} points={pts.join(' ')} fill={ZONE_COLORS[status] ?? 'rgba(150,150,150,.35)'} stroke="#26343f" strokeWidth={6} />;
            })}
          </svg>
          <img src="/med-map-above.webp" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        </div>
        <div className="row wrap mt12 small" style={{ padding: '0 6px', gap: 6 }}>
          <StatusPill status={1} label={`свободно · ${count(1)}`} />
          <StatusPill status={2} label={`средне · ${count(2)}`} />
          <StatusPill status={3} label={`многолюдно · ${count(3)}`} />
        </div>
        <div className="tiny faint mt8" style={{ padding: '0 6px' }}>Молельные зоны мечети Пророка ﷺ, обновлено {fmtAgo(zones[0]?.fetchedAt, now)}</div>
      </div>
    </>
  );
}

function QuietWindows({ prayer }: { prayer: PrayerData }) {
  if (!prayer.quietWindows.length) return null;
  const labels = ['', 'спокойнее', 'средне', 'пик'];
  return (
    <>
      <div className="section-title">Когда спокойнее сегодня</div>
      <div className="card">
        <div className="list">
          {prayer.quietWindows.map((w, i) => (
            <div key={i} className="list-item">
              <div className="grow">
                <div className="bold small">{w.label}</div>
                <div className="small muted">{fmtTime(w.from)} – {fmtTime(w.to)}</div>
              </div>
              <StatusPill status={w.level} label={labels[w.level]} />
            </div>
          ))}
        </div>
        <div className="tiny faint mt8">Прогноз по времени намазов и типичной посещаемости Харама.</div>
      </div>
    </>
  );
}

function NotifyToggle() {
  const { toast } = useApp();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    api.post<{ me: { notify_crowd: number } | null }>('/api/me', {}).then((r) => setOn(!!r.me?.notify_crowd)).catch(() => {});
  }, []);
  const enabled = !!on;
  const toggle = async () => {
    const next = !enabled;
    if (next) {
      const granted = await requestWriteAccess();
      if (!granted) {
        toast('Разрешите боту писать вам, чтобы получать уведомления');
      }
    }
    await api.post('/api/me', { notifyCrowd: next, canMessage: next });
    setOn(next);
    haptic.ok();
    toast(next ? 'Сообщу, когда у Каабы станет свободнее' : 'Уведомления выключены');
  };
  return (
    <button className="card tight row" onClick={toggle} style={{ textAlign: 'left' }}>
      <div className="list-ico">{enabled ? <BellRing size={20} /> : <Bell size={20} />}</div>
      <div className="grow">
        <div className="bold">Сообщить, когда станет свободно</div>
        <div className="small muted">Бот напишет, когда сахн у Каабы освободится</div>
      </div>
      <div style={{ width: 46, height: 28, borderRadius: 14, background: enabled ? 'var(--accent)' : 'var(--bg-2)', position: 'relative', transition: '.2s' }}>
        <div style={{ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 22, height: 22, borderRadius: 11, background: '#fff', transition: '.2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
      </div>
    </button>
  );
}
