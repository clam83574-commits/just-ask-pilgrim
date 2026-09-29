import { useState } from 'react';
import { Maximize2, Mic, Square, Volume2, X, MessageSquareText } from 'lucide-react';
import { api } from '../lib/api';
import { Recorder, releaseMic, speak, transcribe, unlockAudio } from '../lib/audio';
import { useLocalStorage } from '../lib/hooks';
import { haptic } from '../lib/tg';
import { Sheet, useApp } from '../components/ui';

const MY_LANGS: Record<string, string> = { ru: 'Русский', kk: 'Қазақша', uz: 'Oʻzbekcha', ky: 'Кыргызча', tg: 'Тоҷикӣ', az: 'Azərbaycan', tr: 'Türkçe' };
const THEIR_LANGS: Record<string, string> = {
  ar: 'العربية', en: 'English', ur: 'اردو', hi: 'हिन्दी', bn: 'বাংলা', id: 'Indonesia', ms: 'Melayu', fa: 'فارسی',
  tr: 'Türkçe', fr: 'Français', ps: 'پښتو', sw: 'Kiswahili', ha: 'Hausa', am: 'አማርኛ', tl: 'Filipino', ru: 'Русский',
};
const PHRASES = [
  'Где ближайший туалет?', 'Сколько это стоит?', 'Можно дешевле?', 'Отвезите меня в отель', 'Где ворота короля Фахда?',
  'Мне нужен врач', 'Я потерялся, помогите', 'Где можно взять коляску?', 'Спасибо, да вознаградит вас Аллах',
  'Где вода Замзам?', 'Где женская часть?', 'Не понимаю, говорите медленнее',
];

interface Turn { side: 'me' | 'them'; original: string; translation: string; translit?: string | null }

export default function TranslatorScreen() {
  const { toast } = useApp();
  const [myLang, setMyLang] = useLocalStorage('tr-my', 'ru');
  const [theirLang, setTheirLang] = useLocalStorage('tr-their', 'ar');
  const [last, setLast] = useState<Record<'me' | 'them', Turn | null>>({ me: null, them: null });
  const [recSide, setRecSide] = useState<'me' | 'them' | null>(null);
  const [busySide, setBusySide] = useState<'me' | 'them' | null>(null);
  const [rec, setRec] = useState<Recorder | null>(null);
  const [picker, setPicker] = useState<'me' | 'them' | null>(null);
  const [phrases, setPhrases] = useState(false);
  const [big, setBig] = useState<Turn | null>(null);

  const doTranslate = async (side: 'me' | 'them', original: string) => {
    const target = side === 'me' ? theirLang : myLang;
    const source = side === 'me' ? myLang : theirLang;
    setBusySide(side);
    try {
      const res = await api.post<{ translation: string; transliteration: string | null }>('/api/translate', { text: original, target, source });
      const turn: Turn = { side, original, translation: res.translation, translit: res.transliteration };
      // перевод показываем на половине слушателя
      setLast((prev) => ({ ...prev, [side === 'me' ? 'them' : 'me']: turn }));
      haptic.ok();
      speak(res.translation);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusySide(null);
    }
  };

  const toggleMic = async (side: 'me' | 'them') => {
    unlockAudio();
    if (recSide) {
      rec?.stop();
      return;
    }
    haptic.tap();
    const r = new Recorder();
    setRec(r);
    setRecSide(side);
    try {
      const audio = await r.start({ vad: true, silenceMs: 1300, noSpeechMs: 10000, maxMs: 45000 });
      setRecSide(null);
      if (!audio) return;
      setBusySide(side);
      const lang = side === 'me' ? myLang : theirLang;
      const text = await transcribe(audio, ['ru', 'ar', 'en', 'tr', 'ur', 'hi', 'id', 'fa', 'fr'].includes(lang) ? lang : undefined);
      if (text) await doTranslate(side, text);
      else setBusySide(null);
    } catch (e) {
      setRecSide(null);
      setBusySide(null);
      toast('Нет доступа к микрофону');
    } finally {
      releaseMic();
    }
  };

  const half = (side: 'me' | 'them') => {
    const turn = last[side];
    const lang = side === 'me' ? myLang : theirLang;
    const langs = side === 'me' ? MY_LANGS : THEIR_LANGS;
    const isRec = recSide === side;
    const isBusy = busySide === side;
    return (
      <div className={`tr-half ${side}`}>
        <div className="row between">
          <button className="lang-btn" onClick={() => setPicker(side)}>{langs[lang] ?? lang} ▾</button>
          {turn && (
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn" onClick={() => { unlockAudio(); speak(turn.translation); }} aria-label="Повторить"><Volume2 size={18} /></button>
              <button className="icon-btn" onClick={() => setBig(turn)} aria-label="Крупно"><Maximize2 size={18} /></button>
            </div>
          )}
        </div>
        <div className="tr-text" dir="auto">
          {turn ? (
            <>
              <div className="orig">{turn.original}</div>
              {turn.translation}
              {turn.translit && <div className="translit">{turn.translit}</div>}
            </>
          ) : (
            <span className="faint" style={{ fontSize: 18, fontWeight: 500 }}>
              {side === 'me' ? 'Нажмите на микрофон и говорите — перевод прозвучит вслух' : TAP_HINT[theirLang] ?? TAP_HINT.en}
            </span>
          )}
        </div>
        <div className="row between">
          {side === 'me' ? (
            <button className="btn sm plain" onClick={() => setPhrases(true)}><MessageSquareText size={16} /> Фразы</button>
          ) : <span />}
          <button className={`mic ${isRec ? 'rec' : ''}`} onClick={() => toggleMic(side)} disabled={!!busySide && !isRec} aria-label="Микрофон">
            {isBusy ? <span className="typing" style={{ filter: 'brightness(3)' }}><span /><span /><span /></span> : isRec ? <Square size={24} /> : <Mic size={26} />}
          </button>
          <span style={{ width: 80 }} />
        </div>
      </div>
    );
  };

  return (
    <div className="tr fade-in">
      {half('them')}
      {half('me')}

      <Sheet open={!!picker} onClose={() => setPicker(null)}>
        <div className="card-title">{picker === 'me' ? 'Ваш язык' : 'Язык собеседника'}</div>
        <div className="list mt8">
          {Object.entries(picker === 'me' ? MY_LANGS : THEIR_LANGS).map(([code, label]) => (
            <button key={code} className="list-item" style={{ width: '100%', textAlign: 'left' }}
              onClick={() => { haptic.select(); (picker === 'me' ? setMyLang : setTheirLang)(code); setPicker(null); }}>
              <span className="grow bold">{label}</span>
              {(picker === 'me' ? myLang : theirLang) === code && <span style={{ color: 'var(--accent)' }}>✓</span>}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={phrases} onClose={() => setPhrases(false)}>
        <div className="card-title">Быстрые фразы</div>
        <div className="stack mt12" style={{ gap: 8 }}>
          {PHRASES.map((p) => (
            <button key={p} className="card tight" style={{ textAlign: 'left' }} onClick={() => { unlockAudio(); setPhrases(false); doTranslate('me', p); }}>{p}</button>
          ))}
        </div>
      </Sheet>

      {big && (
        <div className="call" style={{ background: 'var(--surface)', color: 'var(--text)', justifyContent: 'center' }} onClick={() => setBig(null)}>
          <button className="icon-btn" style={{ position: 'absolute', top: 16, right: 16 }}><X size={20} /></button>
          <div dir="auto" style={{ fontSize: 40, fontWeight: 750, lineHeight: 1.25, textAlign: 'center', padding: 12 }}>{big.translation}</div>
          {big.translit && <div className="mt12" style={{ color: 'var(--gold)', fontSize: 18, textAlign: 'center' }}>{big.translit}</div>}
          <div className="muted mt16 center">{big.original}</div>
        </div>
      )}
    </div>
  );
}

const TAP_HINT: Record<string, string> = {
  ar: 'اضغط على الميكروفون وتكلم',
  en: 'Tap the microphone and speak',
  ur: 'مائیک دبائیں اور بولیں',
  hi: 'माइक दबाएँ और बोलें',
  bn: 'মাইক চাপুন এবং বলুন',
  id: 'Tekan mikrofon dan bicara',
  ms: 'Tekan mikrofon dan bercakap',
  fa: 'میکروفون را بزنید و صحبت کنید',
  tr: 'Mikrofona dokunun ve konuşun',
  fr: 'Appuyez sur le micro et parlez',
};
