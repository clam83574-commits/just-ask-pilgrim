import { api } from './api';

/* ---------------- Запись с VAD ---------------- */

export interface Recording { base64: string; format: string; durationMs: number }

function pickMime(): { mime: string; format: string } {
  const opts = [
    { mime: 'audio/webm;codecs=opus', format: 'webm' },
    { mime: 'audio/webm', format: 'webm' },
    { mime: 'audio/mp4', format: 'm4a' },
    { mime: 'audio/ogg;codecs=opus', format: 'ogg' },
  ];
  for (const o of opts) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(o.mime)) return o;
  return { mime: '', format: 'm4a' };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

let sharedStream: MediaStream | null = null;
let sharedCtx: AudioContext | null = null;

export async function ensureMic(): Promise<MediaStream> {
  if (sharedStream && sharedStream.getAudioTracks().some((t) => t.readyState === 'live')) return sharedStream;
  sharedStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  return sharedStream;
}

export function releaseMic() {
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
}

function audioCtx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    sharedCtx = new Ctx();
  }
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

export interface RecordOptions {
  /** Автоматически закончить после паузы в речи. */
  vad?: boolean;
  silenceMs?: number;
  maxMs?: number;
  /** Сколько ждать начала речи, прежде чем сдаться (только с vad). */
  noSpeechMs?: number;
  onLevel?: (level: number) => void;
}

export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private raf = 0;
  private startedAt = 0;
  private resolveStop: ((r: Recording | null) => void) | null = null;
  private heardSpeech = false;
  private cancelled = false;
  format = 'webm';

  async start(opts: RecordOptions = {}): Promise<Recording | null> {
    const stream = await ensureMic();
    const { mime, format } = pickMime();
    this.format = format;
    this.chunks = [];
    this.cancelled = false;
    this.heardSpeech = false;
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    const done = new Promise<Recording | null>((resolve) => (this.resolveStop = resolve));
    this.rec.onstop = async () => {
      cancelAnimationFrame(this.raf);
      const durationMs = Date.now() - this.startedAt;
      if (this.cancelled || !this.chunks.length || (opts.vad && !this.heardSpeech)) return this.resolveStop?.(null);
      const blob = new Blob(this.chunks, { type: this.rec?.mimeType || mime });
      this.resolveStop?.({ base64: await blobToBase64(blob), format, durationMs });
    };
    this.rec.start(250);
    this.startedAt = Date.now();
    this.monitor(stream, opts);
    return done;
  }

  private monitor(stream: MediaStream, opts: RecordOptions) {
    const ctx = audioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const silenceMs = opts.silenceMs ?? 1100;
    const maxMs = opts.maxMs ?? 30000;
    const noSpeechMs = opts.noSpeechMs ?? 9000;
    let floor = 0.01;
    let lastVoice = Date.now();
    const tick = () => {
      if (!this.rec || this.rec.state !== 'recording') return;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      const elapsed = Date.now() - this.startedAt;
      if (elapsed < 350) floor = Math.max(floor, rms);
      const threshold = Math.max(0.018, floor * 2.2);
      if (rms > threshold) {
        lastVoice = Date.now();
        if (elapsed > 150) this.heardSpeech = true;
      }
      opts.onLevel?.(Math.min(1, rms / 0.12));
      if (opts.vad) {
        if (this.heardSpeech && Date.now() - lastVoice > silenceMs) return this.stop();
        if (!this.heardSpeech && elapsed > noSpeechMs) return this.stop();
      }
      if (elapsed > maxMs) return this.stop();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
  }

  cancel() {
    this.cancelled = true;
    this.stop();
  }

  get isRecording() {
    return this.rec?.state === 'recording';
  }
}

export async function transcribe(rec: Recording, language?: string): Promise<string> {
  const res = await api.post<{ text: string }>('/api/stt', { audio: rec.base64, format: rec.format, language });
  return res.text;
}

/* ---------------- Воспроизведение ---------------- */

const player = new Audio();
player.preload = 'auto';
(player as any).playsInline = true;
let unlocked = false;

function silentWav(): Blob {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, str: string) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples * 2, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Вызывать в обработчике нажатия — иначе iOS не даст играть звук позже. */
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  player.src = URL.createObjectURL(silentWav());
  player.play().catch(() => {});
  audioCtx();
}

let currentUrl: string | null = null;
let stopped = false;

function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    player.src = currentUrl;
    player.onended = () => resolve();
    player.onerror = () => resolve();
    player.play().catch(() => resolve());
  });
}

export function stopSpeaking() {
  stopped = true;
  player.pause();
}

async function ttsBlob(text: string, voice?: string): Promise<Blob | null> {
  try {
    const res = await api.raw('/api/tts', { text, voice });
    return await res.blob();
  } catch {
    return null;
  }
}

/** Делит текст на куски по предложениям: первый короткий — чтобы звук пошёл быстрее. */
export function splitForSpeech(text: string): string[] {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';
  for (const s of sentences) {
    const limit = chunks.length === 0 ? 90 : 260;
    if ((buf + s).length > limit && buf) {
      chunks.push(buf.trim());
      buf = s;
    } else buf += s;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

/** Озвучить текст: куски синтезируются параллельно, играют по очереди. */
export async function speak(text: string, opts: { voice?: string; onStart?: () => void } = {}): Promise<void> {
  stopped = false;
  const parts = splitForSpeech(cleanText(text).replace(/^•\s*/gm, ''));
  const blobs = parts.map((p) => ttsBlob(p, opts.voice));
  let started = false;
  for (const b of blobs) {
    const blob = await b;
    if (stopped) return;
    if (!blob) continue;
    if (!started) {
      started = true;
      opts.onStart?.();
    }
    await playBlob(blob);
    if (stopped) return;
  }
}

export const isSpeaking = () => !player.paused && !player.ended;

/** Убирает markdown-разметку, если модель всё же её прислала. */
export const cleanText = (t: string) =>
  t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[*-]\s+/gm, '• ').replace(/[*_`]/g, '');
