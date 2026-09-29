import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bus, CalendarPlus, Camera, Hotel, LogOut, MapPin, Megaphone, Navigation, Plus, QrCode, Share2, Trash2, Users, Utensils, Landmark, CalendarClock,
} from 'lucide-react';
import { api, type Group, type GroupEvent } from '../lib/api';
import { useApi, useLocation, useNow } from '../lib/hooks';
import { fmtAgo, fmtDay, fmtDuration, fmtTime, isoToMeccaLocal, meccaLocalToIso, plural } from '../lib/format';
import { confirmPopup, haptic, requestWriteAccess, scanQr, shareText, startParam, walkTo } from '../lib/tg';
import { Empty, Sheet, Skel, useApp } from '../components/ui';

const EVENT_TYPES: Record<string, { label: string; Icon: typeof Bus }> = {
  meeting: { label: 'Встреча', Icon: Users },
  bus: { label: 'Автобус', Icon: Bus },
  excursion: { label: 'Экскурсия', Icon: Landmark },
  meal: { label: 'Еда', Icon: Utensils },
  other: { label: 'Другое', Icon: CalendarClock },
};

export default function GroupScreen() {
  const { data: mine, reload } = useApi<{ groups: { id: number }[] }>('/api/groups');
  const { data: config } = useApi<{ botUsername: string | null }>('/api/config');
  const [group, setGroup] = useState<Group | null>(null);
  const [joining, setJoining] = useState(false);

  // вход по ссылке t.me/<bot>?startapp=g_CODE
  useEffect(() => {
    const sp = startParam();
    if (sp?.startsWith('g_') && !sessionStorage.getItem(`joined:${sp}`)) {
      sessionStorage.setItem(`joined:${sp}`, '1');
      setJoining(true);
      api.post<Group>('/api/groups/join', { code: sp.slice(2) }).then((g) => { setGroup(g); haptic.ok(); reload(); }).finally(() => setJoining(false));
    }
  }, [reload]);

  useEffect(() => {
    const id = mine?.groups?.[0]?.id;
    if (id && !group) api.get<Group>(`/api/groups/${id}`).then(setGroup).catch(() => {});
  }, [mine, group]);

  if (!mine || joining) return <div className="screen"><div className="stack"><Skel h={32} w="50%" /><div className="card"><Skel h={120} /></div></div></div>;
  if (!group) return <NoGroup onJoined={(g) => { setGroup(g); reload(); }} />;
  return <GroupView group={group} setGroup={setGroup} bot={config?.botUsername ?? null} onLeft={() => { setGroup(null); reload(); }} />;
}

function NoGroup({ onJoined }: { onJoined: (g: Group) => void }) {
  const { toast } = useApp();
  const [code, setCode] = useState('');
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const join = async (c: string) => {
    const clean = c.replace(/.*g_/, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (clean.length < 4) return toast('Введите код группы');
    setBusy(true);
    try {
      const g = await api.post<Group>('/api/groups/join', { code: clean });
      haptic.ok();
      requestWriteAccess();
      onJoined(g);
    } catch (e) {
      haptic.err();
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    const v = await scanQr('Наведите на QR-код группы');
    if (v) join(v);
  };

  return (
    <div className="screen fade-in">
      <div className="stack">
        <div className="page-title">Группа</div>
        <div className="hero">
          <div className="hero-pattern" />
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 19, fontWeight: 750 }}>Присоединитесь к своей группе</div>
            <div className="mt8" style={{ opacity: 0.9 }}>Расписание, места встреч и объявления руководителя. Бот напомнит за час и за 15 минут до автобуса.</div>
            <button className="btn mt12" style={{ background: '#f1d58a', color: '#3a2c07' }} onClick={scan}><Camera size={18} /> Сканировать QR</button>
          </div>
        </div>
        <div className="card">
          <div className="field">
            <label>Или введите код</label>
            <div className="row">
              <input className="input grow" placeholder="Например, K7M2QX" value={code} maxLength={12}
                onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '0.12em', fontWeight: 700 }} />
              <button className="btn" disabled={busy} onClick={() => join(code)}>Войти</button>
            </div>
          </div>
        </div>
        <div className="section-title">Для руководителя</div>
        <button className="card tight row" onClick={() => setCreate(true)} style={{ textAlign: 'left' }}>
          <div className="list-ico"><Plus size={20} /></div>
          <div className="grow">
            <div className="bold">Создать группу</div>
            <div className="small muted">Получите QR-код для паломников и управляйте расписанием</div>
          </div>
        </button>
      </div>
      <CreateGroupSheet open={create} onClose={() => setCreate(false)} onCreated={onJoined} />
    </div>
  );
}

function CreateGroupSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (g: Group) => void }) {
  const { toast } = useApp();
  const { loc, request } = useLocation(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [hotel, setHotel] = useState('');
  const [hotelHere, setHotelHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return toast('Введите название');
    setBusy(true);
    try {
      const g = await api.post<Group>('/api/groups', {
        name, company: company || null, hotelName: hotel || null,
        hotelLat: hotelHere ? loc?.lat : null, hotelLon: hotelHere ? loc?.lon : null,
      });
      haptic.ok();
      requestWriteAccess();
      onCreated(g);
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="card-title">Новая группа</div>
      <div className="stack mt12">
        <div className="field"><label>Название</label><input className="input" placeholder="Умра, октябрь 2026" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Компания</label><input className="input" placeholder="Название хадж-компании" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
        <div className="field"><label>Отель</label><input className="input" placeholder="Название отеля" value={hotel} onChange={(e) => setHotel(e.target.value)} /></div>
        <button className="row small" onClick={async () => { const l = await request(); setHotelHere(!!l); }}>
          <input type="checkbox" readOnly checked={hotelHere} /> Я сейчас в отеле — сохранить его местоположение
        </button>
        <button className="btn block" disabled={busy} onClick={submit}>Создать</button>
      </div>
    </Sheet>
  );
}

function GroupView({ group, setGroup, bot, onLeft }: { group: Group; setGroup: (g: Group) => void; bot: string | null; onLeft: () => void }) {
  const { toast } = useApp();
  const now = useNow(30000);
  const [tab, setTab] = useState<'schedule' | 'news' | 'manage'>('schedule');
  const [qr, setQr] = useState(false);
  const [eventSheet, setEventSheet] = useState(false);
  const isAdmin = group.role === 'admin';
  const link = bot ? `https://t.me/${bot}?start=g_${group.code}` : `Код группы: ${group.code}`;

  const upcoming = group.events.filter((e) => Date.parse(e.starts_at) > now - 30 * 60000);
  const next = upcoming.find((e) => Date.parse(e.starts_at) > now);

  const leave = async () => {
    if (!(await confirmPopup('Выйти из группы?'))) return;
    await api.post(`/api/groups/${group.id}/leave`);
    onLeft();
  };

  return (
    <div className="screen fade-in">
      <div className="stack">
        <div className="row between">
          <div className="grow">
            <div className="muted small">{group.company || 'Группа'} · {group.membersCount} {plural(group.membersCount, 'участник', 'участника', 'участников')}</div>
            <div className="page-title ellipsis">{group.name}</div>
          </div>
          <button className="icon-btn" onClick={() => setQr(true)} aria-label="QR"><QrCode size={20} /></button>
        </div>

        {next && (
          <div className="hero">
            <div className="hero-pattern" />
            <div style={{ position: 'relative' }}>
              <div className="small" style={{ color: '#f1d58a', fontWeight: 700, letterSpacing: '.04em' }}>СЛЕДУЮЩЕЕ</div>
              <div className="mt4" style={{ fontSize: 20, fontWeight: 750 }}>{next.title}</div>
              <div className="mt4" style={{ opacity: 0.9 }}>
                {fmtTime(next.starts_at)} · через <span className="countdown">{fmtDuration((Date.parse(next.starts_at) - now) / 60000)}</span>
              </div>
              {next.place_name && <div className="small mt4" style={{ opacity: 0.85 }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {next.place_name}</div>}
              {next.lat && next.lon && (
                <button className="btn sm mt12" style={{ background: '#f1d58a', color: '#3a2c07' }} onClick={() => walkTo(next.lat!, next.lon!)}>
                  <Navigation size={16} /> Как дойти
                </button>
              )}
            </div>
          </div>
        )}

        {group.hotel && (
          <div className="card tight row">
            <div className="list-ico" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}><Hotel size={20} /></div>
            <div className="grow"><div className="small muted">Отель группы</div><div className="bold">{group.hotel.name}</div></div>
            {group.hotel.lat && <button className="btn sm ghost" onClick={() => walkTo(group.hotel!.lat!, group.hotel!.lon!)}>Маршрут</button>}
          </div>
        )}

        <div className="seg">
          <button className={tab === 'schedule' ? 'on' : ''} onClick={() => setTab('schedule')}>Расписание</button>
          <button className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>Объявления</button>
          {isAdmin && <button className={tab === 'manage' ? 'on' : ''} onClick={() => setTab('manage')}>Управление</button>}
        </div>

        {tab === 'schedule' && (
          <>
            {isAdmin && <button className="btn ghost block" onClick={() => setEventSheet(true)}><CalendarPlus size={18} /> Добавить событие</button>}
            {!upcoming.length ? (
              <div className="card"><Empty icon={<CalendarClock size={26} />} title="Событий пока нет" text={isAdmin ? 'Добавьте первое событие — участники получат напоминания.' : 'Руководитель ещё не добавил расписание.'} /></div>
            ) : (
              <Schedule events={upcoming} now={now} isAdmin={isAdmin} onDelete={async (id) => {
                if (!(await confirmPopup('Удалить событие?'))) return;
                setGroup(await api.del<Group>(`/api/groups/${group.id}/events/${id}`));
              }} />
            )}
          </>
        )}

        {tab === 'news' && (
          !group.announcements.length ? (
            <div className="card"><Empty icon={<Megaphone size={26} />} title="Объявлений нет" /></div>
          ) : (
            <div className="stack">
              {group.announcements.map((a) => (
                <div key={a.id} className="card">
                  <div style={{ whiteSpace: 'pre-wrap' }}>{a.text}</div>
                  <div className="tiny faint mt8">{fmtDay(a.created_at)}, {fmtTime(a.created_at)} · {fmtAgo(a.created_at, now)}</div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'manage' && isAdmin && <Manage group={group} setGroup={setGroup} link={link} onQr={() => setQr(true)} />}

        <button className="btn plain block mt8" onClick={leave}><LogOut size={16} /> Выйти из группы</button>
      </div>

      <Sheet open={qr} onClose={() => setQr(false)}>
        <div className="center">
          <div className="card-title">Вход в группу</div>
          <div className="small muted mt4">Паломник сканирует QR камерой телефона или в Telegram</div>
          <div style={{ background: '#fff', padding: 16, borderRadius: 20, display: 'inline-block', marginTop: 16 }}>
            <QRCodeSVG value={link} size={220} level="M" fgColor="#0b3d31" />
          </div>
          <div className="mt12" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '0.18em' }}>{group.code}</div>
          <button className="btn block mt16" onClick={() => shareText(link, `Присоединяйтесь к группе «${group.name}»`)}><Share2 size={18} /> Поделиться ссылкой</button>
        </div>
      </Sheet>

      <EventSheet open={eventSheet} onClose={() => setEventSheet(false)} group={group} onSaved={(g) => { setGroup(g); toast('Событие добавлено'); }} />
    </div>
  );
}

function Schedule({ events, now, isAdmin, onDelete }: { events: GroupEvent[]; now: number; isAdmin: boolean; onDelete: (id: number) => void }) {
  const byDay = new Map<string, GroupEvent[]>();
  for (const e of events) {
    const d = fmtDay(e.starts_at);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  return (
    <div className="stack">
      {[...byDay.entries()].map(([day, list]) => (
        <div key={day}>
          <div className="section-title" style={{ margin: '4px 4px 8px' }}>{day}</div>
          <div className="card" style={{ padding: '4px 16px' }}>
            <div className="list">
              {list.map((e) => {
                const T = EVENT_TYPES[e.type] ?? EVENT_TYPES.other;
                const past = Date.parse(e.starts_at) < now;
                return (
                  <div key={e.id} className="list-item" style={{ opacity: past ? 0.5 : 1 }}>
                    <div className="center" style={{ width: 50 }}>
                      <div className="bold">{fmtTime(e.starts_at)}</div>
                      <div className="tiny muted">{past ? 'прошло' : fmtDuration((Date.parse(e.starts_at) - now) / 60000)}</div>
                    </div>
                    <div className="list-ico"><T.Icon size={18} /></div>
                    <div className="grow">
                      <div className="bold">{e.title}</div>
                      {e.place_name && <div className="small muted">{e.place_name}</div>}
                      {e.note && <div className="small">{e.note}</div>}
                    </div>
                    {e.lat && e.lon && <button className="icon-btn" onClick={() => walkTo(e.lat!, e.lon!)}><Navigation size={16} /></button>}
                    {isAdmin && <button className="icon-btn" onClick={() => onDelete(e.id)}><Trash2 size={16} /></button>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventSheet({ open, onClose, group, onSaved }: { open: boolean; onClose: () => void; group: Group; onSaved: (g: Group) => void }) {
  const { toast } = useApp();
  const { request } = useLocation(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('bus');
  const [when, setWhen] = useState(() => isoToMeccaLocal(Date.now() + 2 * 3600000).slice(0, 14) + '00');
  const [place, setPlace] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return toast('Введите название');
    setBusy(true);
    try {
      const g = await api.post<Group>(`/api/groups/${group.id}/events`, {
        title, type, startsAt: meccaLocalToIso(when), placeName: place || null, lat: coords?.lat, lon: coords?.lon, note: note || null, notify,
      });
      haptic.ok();
      onSaved(g);
      onClose();
      setTitle(''); setPlace(''); setNote(''); setCoords(null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="card-title">Новое событие</div>
      <div className="stack mt12">
        <div className="chips">
          {Object.entries(EVENT_TYPES).map(([k, v]) => (
            <button key={k} className={`chip ${type === k ? 'on' : ''}`} onClick={() => setType(k)}><v.Icon size={15} /> {v.label}</button>
          ))}
        </div>
        <div className="field"><label>Название</label><input className="input" placeholder="Автобус на зиярат" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label>Время (по Мекке)</label><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        <div className="field">
          <label>Место встречи</label>
          <input className="input" placeholder="Лобби отеля / ворота 79" value={place} onChange={(e) => setPlace(e.target.value)} />
          <button className="btn sm plain" onClick={async () => { const l = await request(); if (l) { setCoords(l); toast('Точка сохранена'); } }}>
            <MapPin size={15} /> {coords ? 'Точка на карте сохранена ✓' : 'Отметить моё местоположение'}
          </button>
        </div>
        <div className="field"><label>Комментарий</label><input className="input" placeholder="Взять ихрам, воду" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="row small" onClick={() => setNotify((v) => !v)}><input type="checkbox" readOnly checked={notify} /> Сразу сообщить участникам</button>
        <button className="btn block" disabled={busy} onClick={save}>Сохранить</button>
      </div>
    </Sheet>
  );
}

function Manage({ group, setGroup, link, onQr }: { group: Group; setGroup: (g: Group) => void; link: string; onQr: () => void }) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const g = await api.post<Group>(`/api/groups/${group.id}/announce`, { text });
      setGroup(g);
      setText('');
      haptic.ok();
      toast(`Отправлено: ${g.delivered?.sent ?? 0}${g.delivered?.failed ? `, не доставлено: ${g.delivered.failed}` : ''}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="card">
        <div className="bold row" style={{ gap: 8 }}><Megaphone size={18} /> Объявление всей группе</div>
        <textarea className="input mt12" placeholder="Сбор в лобби в 20:30, берём ихрамы" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn block mt12" disabled={busy || !text.trim()} onClick={send}>Отправить в Telegram</button>
      </div>
      <div className="card">
        <div className="row between">
          <div>
            <div className="bold">Приглашение</div>
            <div className="small muted">Код {group.code}</div>
          </div>
          <div className="row">
            <button className="btn sm ghost" onClick={onQr}><QrCode size={16} /> QR</button>
            <button className="btn sm ghost" onClick={() => shareText(link, `Присоединяйтесь к группе «${group.name}»`)}><Share2 size={16} /></button>
          </div>
        </div>
      </div>
      {group.members && (
        <div className="card" style={{ padding: '4px 16px' }}>
          <div className="list">
            {group.members.map((m) => (
              <div key={m.id} className="list-item">
                <div className="list-ico">{(m.first_name || '?').slice(0, 1)}</div>
                <div className="grow">
                  <div className="bold">{m.first_name}</div>
                  {m.username && <div className="small muted">@{m.username}</div>}
                </div>
                {m.role === 'admin' && <span className="pill s1">руководитель</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
