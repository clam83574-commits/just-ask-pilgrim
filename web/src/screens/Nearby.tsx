import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
import { ArrowLeftRight, Crosshair, Footprints, Navigation, Phone, Clock } from 'lucide-react';
import { type Place, type Rates } from '../lib/api';
import { useApi, useLocation, useLocalStorage } from '../lib/hooks';
import { fmtDistance, walkMinutes } from '../lib/format';
import { haptic, openLink, walkTo } from '../lib/tg';
import { CATEGORY_META, CategoryIcon, Empty, Sheet, Skel, useApp } from '../components/ui';

const CHIP_ORDER = ['toilet', 'gate', 'food', 'exchange', 'wheelchair', 'medical', 'pharmacy', 'luggage', 'transport', 'toilet_accessible', 'prayer_disabled', 'elevator', 'escalator', 'children', 'landmark'];
const CUISINES: { key: string; label: string }[] = [
  { key: 'home', label: 'Как дома' },
  { key: 'turkish', label: 'Турецкая' },
  { key: 'indian', label: 'Индийская' },
  { key: 'pakistani', label: 'Пакистанская' },
  { key: 'arab', label: 'Арабская' },
  { key: 'all', label: 'Все' },
];
const CENTER: Record<string, [number, number]> = { makkah: [39.826206, 21.422487], madinah: [39.611198, 24.467221] };

export default function NearbyScreen() {
  const { city, params } = useApp();
  const { loc, request, asking } = useLocation();
  const [category, setCategory] = useState(params.category ?? 'toilet');
  const [cuisine, setCuisine] = useState(params.homeFood ? 'home' : 'all');
  const [selected, setSelected] = useState<Place | null>(null);
  const { data: cats } = useApi<{ categories: { key: string; label: string; count: number }[] }>(`/api/places/categories?city=${city}`);

  const query = new URLSearchParams({ city, category, limit: '80' });
  if (loc) {
    query.set('lat', String(loc.lat));
    query.set('lon', String(loc.lon));
  }
  if (category === 'food' && cuisine === 'home') query.set('homeFood', '1');
  else if (category === 'food' && cuisine !== 'all') query.set('cuisine', cuisine === 'arab' ? 'arab' : cuisine);
  const { data, loading } = useApi<{ items: Place[] }>(`/api/places?${query}`);
  const items = data?.items ?? [];

  const counts = useMemo(() => Object.fromEntries((cats?.categories ?? []).map((c) => [c.key, c.count])), [cats]);
  const chips = CHIP_ORDER.filter((k) => counts[k] === undefined || counts[k] > 0);

  return (
    <div className="screen flush fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="map-wrap">
        <PlacesMap items={items} center={loc ? [loc.lon, loc.lat] : CENTER[city]} me={loc} onSelect={setSelected} category={category} />
        <div className="map-top">
          <div className="chips">
            {chips.map((k) => (
              <button key={k} className={`chip ${category === k ? 'on' : ''}`} onClick={() => { haptic.select(); setCategory(k); }}>
                <CategoryIcon category={k} size={16} />
                {CATEGORY_META[k]?.short ?? k}
              </button>
            ))}
          </div>
        </div>
        <button className="icon-btn map-fab" onClick={() => request()} aria-label="Моё местоположение">
          <Crosshair size={20} className={asking ? 'spin' : ''} />
        </button>
      </div>

      <div style={{ padding: '14px 16px calc(var(--tabbar-h) + var(--safe-b) + 20px)' }} className="stack">
        {category === 'food' && (
          <div className="chips">
            {CUISINES.map((c) => (
              <button key={c.key} className={`chip ${cuisine === c.key ? 'on' : ''}`} onClick={() => { haptic.select(); setCuisine(c.key); }}>{c.label}</button>
            ))}
          </div>
        )}
        {category === 'exchange' && <Converter />}
        <div className="row between">
          <div className="card-title">{CATEGORY_META[category]?.label}</div>
          <span className="small muted">{loc ? 'от вас' : 'от Харама'}</span>
        </div>
        {loading && !items.length ? (
          <div className="card stack">{[1, 2, 3].map((i) => <Skel key={i} h={44} />)}</div>
        ) : !items.length ? (
          <div className="card">
            <Empty
              icon={<CategoryIcon category={category} size={26} />}
              title="Пока нет точек"
              text={['toilet', 'wheelchair', 'medical', 'luggage', 'transport'].includes(category)
                ? 'Точки официальной карты загружаются с сервера ведомства — скоро появятся.'
                : 'В этом районе ничего не нашлось.'}
            />
          </div>
        ) : (
          <div className="card" style={{ padding: '4px 16px' }}>
            <div className="list">
              {items.slice(0, 40).map((p) => <PlaceRow key={p.id} p={p} onClick={() => setSelected(p)} />)}
            </div>
          </div>
        )}
      </div>
      <PlaceSheet place={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function PlaceRow({ p, onClick }: { p: Place; onClick: () => void }) {
  const meta = CATEGORY_META[p.category];
  return (
    <button className="list-item" onClick={onClick} style={{ width: '100%', textAlign: 'left' }}>
      <div className="list-ico" style={{ background: `${meta?.color ?? '#0b5d4b'}1f`, color: meta?.color }}>
        <CategoryIcon category={p.category} />
      </div>
      <div className="grow">
        <div className="bold ellipsis" style={{ textDecoration: p.isClosed ? 'line-through' : undefined }}>{p.name}</div>
        <div className="small muted ellipsis">
          {p.isClosed ? 'закрыто · ' : ''}
          {p.homeFood ? '🏠 как дома · ' : ''}
          {p.cuisine?.length ? p.cuisine.slice(0, 2).join(', ') : p.floor ? `этаж ${p.floor}` : meta?.label}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="bold small">{fmtDistance(p.distance)}</div>
        <div className="tiny muted">{walkMinutes(p.distance)} мин</div>
      </div>
    </button>
  );
}

function PlaceSheet({ place, onClose }: { place: Place | null; onClose: () => void }) {
  if (!place) return null;
  const meta = CATEGORY_META[place.category];
  return (
    <Sheet open={!!place} onClose={onClose}>
      <div className="row">
        <div className="list-ico" style={{ width: 48, height: 48, background: `${meta?.color}1f`, color: meta?.color }}>
          <CategoryIcon category={place.category} size={24} />
        </div>
        <div className="grow">
          <div className="card-title">{place.name}</div>
          {place.nameAr && <div className="muted" dir="rtl" style={{ textAlign: 'left' }}>{place.nameAr}</div>}
        </div>
      </div>
      <div className="row mt16" style={{ gap: 18 }}>
        <div className="row small" style={{ gap: 6 }}><Footprints size={16} className="muted" /> {fmtDistance(place.distance)} · ~{walkMinutes(place.distance)} мин пешком</div>
      </div>
      <div className="stack mt12" style={{ gap: 8 }}>
        {place.isClosed && <div className="pill s3">Сейчас закрыто</div>}
        {place.floor && <div className="small"><span className="muted">Этаж:</span> {place.floor}{place.venue ? ` · ${place.venue}` : ''}</div>}
        {place.cuisine?.length ? <div className="small"><span className="muted">Кухня:</span> {place.cuisine.join(', ')}</div> : null}
        {place.openingHours && <div className="small row" style={{ gap: 6 }}><Clock size={14} className="muted" /> {place.openingHours}</div>}
      </div>
      <div className="row mt16">
        <button className="btn grow" onClick={() => walkTo(place.lat, place.lon)}><Navigation size={18} /> Маршрут</button>
        {place.phone && (
          <button className="btn ghost" onClick={() => openLink(`tel:${place.phone}`)}><Phone size={18} /></button>
        )}
        {place.category === 'food' && (
          <button className="btn ghost" onClick={() => openLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=&center=${place.lat},${place.lon}`)}>
            Отзывы
          </button>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- Карта ---------------- */

function PlacesMap({ items, center, me, onSelect, category }: {
  items: Place[]; center: [number, number]; me: { lat: number; lon: number } | null; onSelect: (p: Place) => void; category: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    const map = new maplibregl.Map({
      container: ref.current,
      style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`,
      center,
      zoom: 15.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'places', type: 'circle', source: 'places',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 9],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': ['case', ['get', 'closed'], 0.4, 1],
        },
      });
      map.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 16, 'circle-color': '#2f7de1', 'circle-opacity': 0.18 } });
      map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#2f7de1', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
      map.on('click', 'places', (e: maplibregl.MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        const p = itemsRef.current.find((x) => x.id === id);
        if (p) { haptic.tap(); onSelect(p); }
      });
      map.on('mouseenter', 'places', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'places', () => (map.getCanvas().style.cursor = ''));
      setReady(true);
    });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const color = CATEGORY_META[category]?.color ?? '#0b5d4b';
    (map.getSource('places') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: items.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, color, closed: !!p.isClosed },
      })),
    });
    if (items.length) {
      const b = new maplibregl.LngLatBounds();
      items.slice(0, 12).forEach((p) => b.extend([p.lon, p.lat]));
      if (me) b.extend([me.lon, me.lat]);
      map.fitBounds(b, { padding: { top: 70, bottom: 30, left: 30, right: 30 }, maxZoom: 17, duration: 600 });
    }
  }, [items, ready, category, me]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('me') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: me ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [me.lon, me.lat] }, properties: {} }] : [],
    });
  }, [me, ready]);

  useEffect(() => {
    if (!items.length) mapRef.current?.flyTo({ center, zoom: 15.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);

  return <div ref={ref} style={{ position: 'absolute', inset: 0 }} />;
}

/* ---------------- Конвертер валют ---------------- */

const CURRENCIES = ['KZT', 'UZS', 'KGS', 'TJS', 'RUB', 'USD', 'EUR', 'AZN', 'TRY'];
const SYMBOL: Record<string, string> = { KZT: '₸', UZS: 'сум', KGS: 'сом', TJS: 'смн', RUB: '₽', USD: '$', EUR: '€', AZN: '₼', TRY: '₺', SAR: '﷼' };

function Converter() {
  const { data } = useApi<Rates>('/api/rates');
  const [cur, setCur] = useLocalStorage('fx-cur', 'KZT');
  const [amount, setAmount] = useState('100');
  const [toSar, setToSar] = useState(false);
  const rate = data?.perSar[cur];
  const n = parseFloat(amount.replace(',', '.')) || 0;
  const result = !rate ? null : toSar ? n / rate : n * rate;
  return (
    <div className="card">
      <div className="row between">
        <div className="bold">Конвертер</div>
        <select className="lang-btn" value={cur} onChange={(e) => setCur(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="row mt12">
        <input className="input grow" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="bold" style={{ minWidth: 38 }}>{toSar ? cur : 'SAR'}</span>
        <button className="icon-btn" onClick={() => { haptic.tap(); setToSar((v) => !v); }} aria-label="Поменять"><ArrowLeftRight size={18} /></button>
      </div>
      <div className="mt12" style={{ fontSize: 26, fontWeight: 750 }}>
        {result == null ? '…' : `${result.toLocaleString('ru-RU', { maximumFractionDigits: result < 10 ? 2 : 0 })} ${toSar ? 'SAR' : SYMBOL[cur] ?? cur}`}
      </div>
      {rate && (
        <div className="small muted mt4">1 SAR = {rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} {cur} · межбанковский курс, в обменнике на 1–3% хуже</div>
      )}
    </div>
  );
}
