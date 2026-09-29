import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  Accessibility, Baby, Bus, Coins, DoorOpen, Hospital, Landmark, Luggage, MoveVertical, Pill, ShowerHead,
  ArrowUpDown, UtensilsCrossed, Toilet, MapPin,
} from 'lucide-react';
import type { City } from '../lib/api';
import { setBackButton } from '../lib/tg';

/* ---------------- Контекст приложения ---------------- */

export type Tab = 'now' | 'haram' | 'nearby' | 'assistant' | 'translate' | 'group';

export interface NavParams { category?: string; homeFood?: boolean; call?: boolean; prompt?: string }

interface AppCtx {
  city: City;
  setCity: (c: City) => void;
  tab: Tab;
  params: NavParams;
  go: (tab: Tab, params?: NavParams) => void;
  toast: (text: string) => void;
}

export const AppContext = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(AppContext);

/* ---------------- Статусы ---------------- */

export function StatusPill({ status, label }: { status: number; label?: string }) {
  const text = label ?? ['нет данных', 'свободно', 'средне', 'многолюдно', 'закрыто'][status] ?? 'нет данных';
  return (
    <span className={`pill s${status}`}>
      <span className="dot" />
      {text}
    </span>
  );
}

/* ---------------- Нижний лист ---------------- */

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => (open ? setBackButton(onClose) : undefined), [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        {children}
      </div>
    </>
  );
}

export function Skel({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-ico">{icon}</div>
      <div className="bold" style={{ color: 'var(--text)' }}>{title}</div>
      {text && <div className="small mt4">{text}</div>}
      {action && <div className="mt12">{action}</div>}
    </div>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return <div className="toast">{text}</div>;
}

export function useToastState() {
  const [toast, setToast] = useState<string | null>(null);
  return { toast, setToast };
}

/* ---------------- Иконки категорий ---------------- */

export const CATEGORY_META: Record<string, { label: string; short: string; color: string; Icon: typeof Toilet }> = {
  toilet: { label: 'Туалеты', short: 'Туалеты', color: '#2f7de1', Icon: Toilet },
  toilet_accessible: { label: 'Туалеты с доступом', short: 'Доступные WC', color: '#5b6cf0', Icon: Accessibility },
  gate: { label: 'Ворота', short: 'Ворота', color: '#b48a35', Icon: DoorOpen },
  wheelchair: { label: 'Коляски и электрокары', short: 'Коляски', color: '#0f9f8a', Icon: Accessibility },
  luggage: { label: 'Камеры хранения', short: 'Камеры хранения', color: '#8a63d2', Icon: Luggage },
  medical: { label: 'Медпункты', short: 'Медпункты', color: '#d1433f', Icon: Hospital },
  transport: { label: 'Автобусы и такси', short: 'Транспорт', color: '#e07b24', Icon: Bus },
  prayer_disabled: { label: 'Намаз для людей с инвалидностью', short: 'Намаз, доступ', color: '#3b8f5a', Icon: Accessibility },
  elevator: { label: 'Лифты', short: 'Лифты', color: '#64748b', Icon: MoveVertical },
  escalator: { label: 'Эскалаторы', short: 'Эскалаторы', color: '#64748b', Icon: ArrowUpDown },
  children: { label: 'Детский центр', short: 'Дети', color: '#e0559a', Icon: Baby },
  landmark: { label: 'Святыни и ориентиры', short: 'Святыни', color: '#b48a35', Icon: Landmark },
  food: { label: 'Еда', short: 'Еда', color: '#e0662b', Icon: UtensilsCrossed },
  exchange: { label: 'Обменники', short: 'Обменники', color: '#17915f', Icon: Coins },
  pharmacy: { label: 'Аптеки', short: 'Аптеки', color: '#12a0b0', Icon: Pill },
  wudu: { label: 'Омовение', short: 'Омовение', color: '#2f9ad6', Icon: ShowerHead },
};

export function CategoryIcon({ category, size = 20 }: { category: string; size?: number }) {
  const meta = CATEGORY_META[category];
  const Icon = meta?.Icon ?? MapPin;
  return <Icon size={size} />;
}

export function CityToggle() {
  const { city, setCity } = useApp();
  return (
    <div className="seg" style={{ width: 190 }}>
      <button className={city === 'makkah' ? 'on' : ''} onClick={() => setCity('makkah')}>Мекка</button>
      <button className={city === 'madinah' ? 'on' : ''} onClick={() => setCity('madinah')}>Медина</button>
    </div>
  );
}
