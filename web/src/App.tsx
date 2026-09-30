import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Home, Languages, MapPinned, Users } from 'lucide-react';
import { AppContext, Toast, type NavParams, type Tab } from './components/ui';
import { KaabaIcon } from './components/KaabaIcon';
import { useLocalStorage } from './lib/hooks';
import { api, type City } from './lib/api';
import { haptic, inTelegram, startParam } from './lib/tg';
import NowScreen from './screens/Now';

const HaramScreen = lazy(() => import('./screens/Haram'));
const NearbyScreen = lazy(() => import('./screens/Nearby'));
const AssistantScreen = lazy(() => import('./screens/Assistant'));
const TranslatorScreen = lazy(() => import('./screens/Translator'));
const GroupScreen = lazy(() => import('./screens/Group'));

const TABS: { key: Tab; label: string; icon: (on: boolean) => React.ReactNode }[] = [
  { key: 'now', label: 'Сейчас', icon: () => <Home size={22} /> },
  { key: 'haram', label: 'Харам', icon: () => <KaabaIcon size={22} /> },
  { key: 'nearby', label: 'Рядом', icon: () => <MapPinned size={22} /> },
  { key: 'assistant', label: 'Спросить', icon: () => <Bot size={22} /> },
  { key: 'translate', label: 'Перевод', icon: () => <Languages size={22} /> },
  { key: 'group', label: 'Группа', icon: () => <Users size={22} /> },
];

function OpenInTelegram() {
  return (
    <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 16 }}>
      <div className="hero center" style={{ maxWidth: 380, padding: 28 }}>
        <div className="hero-pattern" />
        <div style={{ position: 'relative' }}>
          <KaabaIcon size={44} stroke="#f1d58a" />
          <div className="mt12" style={{ fontSize: 24, fontWeight: 750 }}>Just Ask</div>
          <div className="mt8" style={{ opacity: 0.9 }}>
            Помощник паломника в Мекке и Медине: загруженность Харама, места рядом, голосовой ассистент и переводчик.
          </div>
          <a className="btn mt16" style={{ background: '#f1d58a', color: '#3a2c07', textDecoration: 'none' }} href="https://t.me/just_ask_ai_bot">
            Открыть в Telegram
          </a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  if (import.meta.env.PROD && !inTelegram) return <OpenInTelegram />;
  return <MainApp />;
}

function MainApp() {
  const [city, setCityState] = useLocalStorage<City>('city', 'makkah');
  const initialTab: Tab = startParam()?.startsWith('g_') ? 'group' : 'now';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [params, setParams] = useState<NavParams>({});
  const [toast, setToast] = useState<string | null>(null);

  const setCity = useCallback(
    (c: City) => {
      haptic.select();
      setCityState(c);
      api.post('/api/me', { city: c }).catch(() => {});
    },
    [setCityState],
  );

  const go = useCallback((t: Tab, p: NavParams = {}) => {
    haptic.tap();
    setParams(p);
    setTab(t);
  }, []);

  useEffect(() => {
    api.post('/api/me', { city }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctx = useMemo(() => ({ city, setCity, tab, params, go, toast: setToast }), [city, setCity, tab, params, go]);

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <Suspense fallback={<div className="screen" />}>
          {tab === 'now' && <NowScreen />}
          {tab === 'haram' && <HaramScreen />}
          {tab === 'nearby' && <NearbyScreen />}
          {tab === 'assistant' && <AssistantScreen />}
          {tab === 'translate' && <TranslatorScreen />}
          {tab === 'group' && <GroupScreen />}
        </Suspense>
        <nav className="tabbar">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => go(t.key)}>
              <span className="tab-ico">{t.icon(tab === t.key)}</span>
              {t.label}
            </button>
          ))}
        </nav>
        {toast && <Toast text={toast} onDone={() => setToast(null)} />}
      </div>
    </AppContext.Provider>
  );
}
