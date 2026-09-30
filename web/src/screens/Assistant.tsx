import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Phone, PhoneOff, Square, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { cleanText, Recorder, releaseMic, speak, stopSpeaking, transcribe, unlockAudio } from '../lib/audio';
import { useLocation, useLocalStorage } from '../lib/hooks';
import { haptic, setBackButton } from '../lib/tg';
import { useApp } from '../components/ui';

interface Msg { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'Где сейчас свободнее для тавафа?',
  'Успею сделать таваф до Магриба?',
  'Где ближайший туалет?',
  'Хочу поесть плов — куда пойти?',
  'Сколько будет 50 000 тенге в риялах?',
  'Когда наш автобус?',
];

export default function AssistantScreen() {
  const { city, params } = useApp();
  const { loc } = useLocation();
  const [messages, setMessages] = useLocalStorage<Msg[]>('chat', []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [call, setCall] = useState(!!params.call);
  const recRef = useRef<Recorder | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const ask = useCallback(
    async (content: string, history: Msg[], voice = false): Promise<string> => {
      const next = [...history, { role: 'user' as const, content }];
      setMessages(next);
      setBusy(true);
      try {
        const res = await api.post<{ text: string }>('/api/assistant', { messages: next, city, lat: loc?.lat, lon: loc?.lon, voice });
        const answer = res.text || 'Не получилось ответить, попробуйте ещё раз.';
        setMessages([...next, { role: 'assistant', content: answer }]);
        return answer;
      } catch (e) {
        const err = (e as Error).message;
        setMessages([...next, { role: 'assistant', content: `⚠️ ${err}` }]);
        return err;
      } finally {
        setBusy(false);
      }
    },
    [city, loc, setMessages],
  );

  useEffect(() => {
    if (params.prompt) ask(params.prompt, messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    haptic.tap();
    setText('');
    ask(t, messages);
  };

  const toggleRecord = async () => {
    unlockAudio();
    if (recording) {
      recRef.current?.stop();
      return;
    }
    haptic.tap();
    const rec = new Recorder();
    recRef.current = rec;
    setRecording(true);
    try {
      const audio = await rec.start({ maxMs: 40000 });
      setRecording(false);
      if (!audio) return;
      setBusy(true);
      const said = await transcribe(audio);
      setBusy(false);
      if (said) ask(said, messages);
    } catch {
      setRecording(false);
      setBusy(false);
    } finally {
      releaseMic();
    }
  };

  return (
    <div className="screen fade-in" style={{ paddingBottom: 'calc(var(--tabbar-h) + var(--safe-b) + 84px)' }}>
      <div className="row between">
        <div className="page-title">Спросить</div>
        <div className="row">
          {messages.length > 0 && (
            <button className="btn sm plain" onClick={() => setMessages([])}>Очистить</button>
          )}
          <button className="btn sm" onClick={() => { unlockAudio(); haptic.tap(); setCall(true); }}>
            <Phone size={16} /> Звонок
          </button>
        </div>
      </div>

      {!messages.length ? (
        <div className="stack mt16">
          <div className="hero">
            <div className="hero-pattern" />
            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 19, fontWeight: 750 }}>Спросите что угодно</div>
              <div className="mt8" style={{ opacity: 0.9 }}>
                Я знаю загруженность Харама, время намазов, погоду, где туалеты и еда, расписание вашей группы. Можно голосом — нажмите «Звонок» и говорите как с человеком.
              </div>
              <button className="btn mt12" style={{ background: '#f1d58a', color: '#3a2c07' }} onClick={() => { unlockAudio(); setCall(true); }}>
                <Phone size={18} /> Позвонить ассистенту
              </button>
            </div>
          </div>
          <div className="section-title">Например</div>
          <div className="stack" style={{ gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="card tight" style={{ textAlign: 'left' }} onClick={() => ask(s, messages)}>{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat mt16">
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role === 'user' ? 'me' : 'bot'}`}>
              {m.role === 'assistant' ? cleanText(m.content) : m.content}
              {m.role === 'assistant' && (
                <button className="tiny muted" style={{ display: 'block', marginTop: 6 }} onClick={() => { unlockAudio(); speak(m.content); }}>
                  <Volume2 size={13} style={{ verticalAlign: -2 }} /> озвучить
                </button>
              )}
            </div>
          ))}
          {busy && <div className="bubble bot typing"><span /><span /><span /></div>}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="composer">
        <button className={`round ${recording ? 'accent' : 'soft'}`} onClick={toggleRecord} aria-label="Голос" style={recording ? { background: '#e5484d', color: '#fff' } : undefined}>
          {recording ? <Square size={18} /> : <Mic size={20} />}
        </button>
        <textarea
          rows={1}
          placeholder={recording ? 'Говорите…' : 'Ваш вопрос'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="round accent" onClick={send} disabled={!text.trim() || busy} aria-label="Отправить">
          <ArrowUp size={20} />
        </button>
      </div>

      {call && <CallMode onClose={() => setCall(false)} ask={ask} getHistory={() => messages} />}
    </div>
  );
}

/* ---------------- Режим звонка ---------------- */

type CallState = 'listening' | 'thinking' | 'speaking' | 'paused';

function CallMode({ onClose, ask, getHistory }: {
  onClose: () => void;
  ask: (content: string, history: Msg[], voice: boolean) => Promise<string>;
  getHistory: () => Msg[];
}) {
  const [state, setState] = useState<CallState>('listening');
  const [caption, setCaption] = useState('Говорите, я слушаю…');
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const active = useRef(true);
  const mutedRef = useRef(false);
  const recRef = useRef<Recorder | null>(null);
  const historyRef = useRef<Msg[]>(getHistory());

  const end = useCallback(() => {
    active.current = false;
    recRef.current?.cancel();
    stopSpeaking();
    releaseMic();
    onClose();
  }, [onClose]);

  useEffect(() => setBackButton(end), [end]);

  useEffect(() => {
    active.current = true;
    const loop = async () => {
      let greeted = false;
      while (active.current) {
        if (mutedRef.current) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        if (!greeted && !historyRef.current.length) {
          greeted = true;
          setState('speaking');
          const hello = 'Ас-саляму алейкум! Я на связи. Спрашивайте — например, где сейчас свободнее для тавафа.';
          setCaption(hello);
          await speak(hello);
          if (!active.current) break;
        }
        setState('listening');
        setCaption('Говорите, я слушаю…');
        const rec = new Recorder();
        recRef.current = rec;
        let audio;
        try {
          audio = await rec.start({ vad: true, silenceMs: 1000, noSpeechMs: 12000, maxMs: 30000, onLevel: setLevel });
        } catch {
          setCaption('Нет доступа к микрофону. Разрешите его в настройках Telegram.');
          setState('paused');
          return;
        }
        setLevel(0);
        if (!active.current) break;
        if (!audio) continue;
        setState('thinking');
        setCaption('Думаю…');
        haptic.soft();
        let said = '';
        try {
          said = await transcribe(audio);
        } catch {
          setCaption('Не расслышал, повторите, пожалуйста.');
          await new Promise((r) => setTimeout(r, 900));
          continue;
        }
        if (!said || !active.current) continue;
        setCaption(`«${said}»`);
        const answer = await ask(said, historyRef.current, true);
        historyRef.current = [...historyRef.current, { role: 'user', content: said }, { role: 'assistant', content: answer }];
        if (!active.current) break;
        setState('speaking');
        setCaption(cleanText(answer));
        await speak(answer);
      }
    };
    loop();
    return () => {
      active.current = false;
      recRef.current?.cancel();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interrupt = () => {
    if (state === 'speaking') {
      haptic.tap();
      stopSpeaking();
    }
  };

  const toggleMute = () => {
    haptic.tap();
    const m = !muted;
    setMuted(m);
    mutedRef.current = m;
    if (m) {
      recRef.current?.cancel();
      setState('paused');
      setCaption('Микрофон выключен');
    }
  };

  const labels: Record<CallState, string> = { listening: 'Слушаю', thinking: 'Думаю', speaking: 'Отвечаю', paused: 'Пауза' };
  const scale = state === 'listening' ? 1 + level * 0.35 : state === 'speaking' ? 1.04 : 1;

  return (
    <div className="call" onClick={interrupt}>
      <div className="hero-pattern" />
      <div className="small bold" style={{ color: '#f1d58a', letterSpacing: '.08em', position: 'relative' }}>{labels[state].toUpperCase()}</div>
      <div className="orb-wrap">
        <div className={`orb ${state === 'thinking' ? 'thinking' : ''}`} style={{ transform: `scale(${scale})` }} />
      </div>
      <div className="call-caption" style={{ position: 'relative' }}>{caption}</div>
      {state === 'speaking' && <div className="tiny mt8" style={{ opacity: 0.7 }}>Нажмите на экран, чтобы перебить</div>}
      <div className="call-actions" style={{ position: 'relative' }}>
        <button className="call-btn mute" onClick={(e) => { e.stopPropagation(); toggleMute(); }} aria-label="Микрофон">
          {muted ? <MicOff size={26} color="#fff" /> : <Mic size={26} color="#fff" />}
        </button>
        <button className="call-btn end" onClick={(e) => { e.stopPropagation(); end(); }} aria-label="Завершить">
          <PhoneOff size={26} color="#fff" />
        </button>
      </div>
    </div>
  );
}
