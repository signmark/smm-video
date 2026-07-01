import { useState, useRef, useEffect, FormEvent } from 'react';
import { navigate } from '../App';
import { API } from '../api';

function SubtitleStylePreview({ style, color = '#ffffff' }: { style: string; color?: string }) {
  const frame: React.CSSProperties = {
    width: 52, height: 92, borderRadius: 4, background: 'linear-gradient(160deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%)',
    position: 'relative', overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.08)',
  };
  const sample = 'Ключевой момент';
  const words = sample.split(' ');

  const bottomBase: React.CSSProperties = {
    position: 'absolute', left: 0, right: 0, textAlign: 'center', padding: '0 4px',
    fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word',
  };

  if (style === 'none') return (
    <div style={frame}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 18, opacity: 0.3 }}>🚫</span>
      </div>
    </div>
  );

  if (style === 'plain') return (
    <div style={frame}>
      <div style={{ ...bottomBase, bottom: 10, fontSize: 6, color, background: 'rgba(0,0,0,0.65)', borderRadius: 2, padding: '3px 4px' }}>
        {sample}
      </div>
    </div>
  );

  if (style === 'fade') return (
    <div style={frame}>
      <div style={{ ...bottomBase, bottom: 10, fontSize: 6, color, background: 'rgba(0,0,0,0.65)', borderRadius: 2, padding: '3px 4px', opacity: 0.75 }}>
        {sample}
      </div>
    </div>
  );

  if (style === 'fade-zoom') return (
    <div style={frame}>
      <div style={{ ...bottomBase, bottom: 10, fontSize: 6, color, background: 'rgba(0,0,0,0.65)', borderRadius: 2, padding: '3px 4px', opacity: 0.75, transform: 'scale(1.04)', transformOrigin: 'bottom center' }}>
        {sample}
      </div>
    </div>
  );

  if (style === 'karaoke') return (
    <div style={frame}>
      <div style={{ ...bottomBase, bottom: 10, fontSize: 6, color: 'rgba(255,255,255,0.9)', background: 'rgba(0,0,0,0.7)', borderRadius: 2, padding: '3px 4px' }}>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>{words[0]} </span>
        <span style={{ color: '#facc15', textShadow: '0 0 6px rgba(250,204,21,0.6)' }}>{words[1]}</span>
      </div>
    </div>
  );

  if (style === 'tiktok') return (
    <div style={frame}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: 0.5, textShadow: '0 2px 8px rgba(0,0,0,0.8)', textAlign: 'center' }}>
          {words[1]}
        </span>
      </div>
    </div>
  );

  if (style === 'word-by-word') return (
    <div style={frame}>
      <div style={{ ...bottomBase, bottom: 10, fontSize: 6, color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.65)', borderRadius: 2, padding: '3px 4px' }}>
        <span>{words[0]} </span>
        <span style={{ color: '#facc15' }}>{words[1]}</span>
      </div>
    </div>
  );

  if (style === 'cinematic') return (
    <div style={frame}>
      <div style={{ position: 'absolute', top: '35%', left: 0, right: 0, textAlign: 'center', padding: '0 4px' }}>
        <span style={{ fontSize: 7, fontWeight: 900, color, textTransform: 'uppercase', letterSpacing: 1, textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>
          {words[0].toUpperCase()}
          <br />
          {words[1].toUpperCase()}
        </span>
      </div>
    </div>
  );

  if (style === 'cinematic-full') return (
    <div style={frame}>
      <div style={{ position: 'absolute', top: '30%', left: 0, right: 0, textAlign: 'center', padding: '0 5px' }}>
        <span style={{ fontSize: 6, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.5, textShadow: '0 2px 12px rgba(0,0,0,0.9)', filter: 'blur(0.3px)', lineHeight: 1.4 }}>
          {sample}
        </span>
      </div>
    </div>
  );

  if (style === 'bar') return (
    <div style={frame}>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.78)', padding: '5px 4px', textAlign: 'center' }}>
        <span style={{ fontSize: 6, fontWeight: 600, color }}>{sample}</span>
      </div>
    </div>
  );

  if (style === 'word-timed') return (
    <div style={frame}>
      <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: '#facc15', textShadow: '0 2px 8px rgba(0,0,0,0.85)' }}>
          {words[1]}
        </span>
      </div>
      <div style={{ position: 'absolute', bottom: 6, left: 0, right: 0, textAlign: 'center', fontSize: 5, opacity: 0.5, color: '#fff' }}>
        точно по речи
      </div>
    </div>
  );

  return <div style={frame} />;
}

const FORMATS = [
  { value: '9:16', label: '9:16 — Shorts / Reels / TikTok', emoji: '📱' },
  { value: '16:9', label: '16:9 — YouTube / Горизонтальное', emoji: '🖥️' },
  { value: '1:1', label: '1:1 — Квадрат / Instagram', emoji: '⬜' },
];

const DURATIONS = [
  { value: 15, label: '15 сек — Stories' },
  { value: 30, label: '30 сек — короткое' },
  { value: 60, label: '60 сек — Shorts/Reels' },
  { value: 90, label: '90 сек — расширенное' },
];

// I2V = Image-to-Video (existing pipeline: frame → animate)
// T2V = Text-to-Video (new pipeline: text → video directly)
const I2V_MODELS = [
  {
    value: 'wan',
    label: 'Wan 2.7',
    speed: '~30-60с',
    quality: '★★★★☆',
    desc: 'Быстро, хорошее качество',
    clip: '~6 с/клип',
    color: '#0ea5e9',
    frames: 1 as 1 | 2,
  },
  {
    value: 'minimax',
    label: 'MiniMax Video-01',
    speed: '~40-80с',
    quality: '★★★★☆',
    desc: 'Плавная анимация',
    clip: '~6 с/клип',
    color: '#8b5cf6',
    frames: 1 as 1 | 2,
  },
  {
    value: 'kling',
    label: 'Kling v3 Standard',
    speed: '~90-150с',
    quality: '★★★★★',
    desc: 'Высокое качество',
    clip: '5 или 10 с/клип',
    color: '#f59e0b',
    frames: 2 as 1 | 2,
  },
  {
    value: 'kling-pro',
    label: 'Kling v3 Pro',
    speed: '~120-180с',
    quality: '★★★★★',
    desc: 'Максимальное качество',
    clip: '5 или 10 с/клип',
    color: '#ef4444',
    frames: 2 as 1 | 2,
  },
  {
    value: 'seedance',
    label: 'Seedance v1 Lite',
    speed: '~60-90с',
    quality: '★★★☆☆',
    desc: 'Средняя скорость',
    clip: '5 или 10 с/клип',
    color: '#10b981',
    frames: 1 as 1 | 2,
  },
  {
    value: 'seedance2',
    label: 'Seedance 2.0',
    speed: '~60-90с',
    quality: '★★★★☆',
    desc: 'Улучшенное качество движения',
    clip: '5 или 10 с/клип',
    color: '#06b6d4',
    frames: 1 as 1 | 2,
  },
];

const T2V_MODELS = [
  {
    value: 'kling-t2v',
    label: 'Kling v3 Standard',
    speed: '~90-150с',
    quality: '★★★★☆',
    desc: 'Высокое качество, реалистичное движение',
    clip: '5 или 10 с/клип',
    color: '#f59e0b',
  },
  {
    value: 'kling-pro-t2v',
    label: 'Kling v3 Pro',
    speed: '~120-180с',
    quality: '★★★★★',
    desc: 'Максимальное качество T2V',
    clip: '5 или 10 с/клип',
    color: '#f59e0b',
  },
  {
    value: 'luma',
    label: 'Luma Ray 2 Flash',
    speed: '~30-45с',
    quality: '★★★★☆',
    desc: 'Динамичная камера, яркие цвета. Быстро.',
    clip: '5 или 9 с/клип',
    color: '#06b6d4',
  },
  {
    value: 'seedance-t2v',
    label: 'Seedance 1 Lite T2V',
    speed: '~20-40с',
    quality: '★★★★☆',
    desc: 'ByteDance T2V: динамичные сцены, хорошая детализация',
    clip: '5 или 10 с/клип',
    color: '#10b981',
  },
  {
    value: 'wan-t2v',
    label: 'Wan T2V 1.3B',
    speed: '~20-40с',
    quality: '★★★☆☆',
    desc: 'Быстрая лёгкая модель без опорного кадра',
    clip: '~6 с/клип',
    color: '#0ea5e9',
  },
  {
    value: 'seedance2-t2v',
    label: 'Seedance 2.0 T2V',
    speed: '~30-60с',
    quality: '★★★★★',
    desc: 'ByteDance Seedance 2.0: улучшенное качество и детализация',
    clip: '5 или 10 с/клип',
    color: '#10b981',
  },
  {
    value: 'veo3',
    label: 'Google Veo 3.1',
    speed: '~2-5 мин',
    quality: '★★★★★',
    desc: 'Топовая модель от Google. Фотореализм, плавное движение.',
    clip: '~8 с/клип',
    color: '#4285f4',
  },
  {
    value: 'happy-horse',
    label: 'Alibaba Happy Horse',
    speed: '~30-60с',
    quality: '★★★★☆',
    desc: 'Alibaba T2V: яркий стиль, хорошая детализация',
    clip: '5 или 10 с/клип',
    color: '#ff6a00',
  },
  {
    value: 'chain',
    label: 'Chain T2V→I2V',
    speed: '~5-10 мин',
    quality: '★★★★★',
    desc: 'Kling T2V для сцены 1, затем I2V с последнего кадра — связное повествование',
    clip: '5 или 10 с/клип',
    color: '#a855f7',
  },
];

const HEYGEN_MODELS = [
  {
    value: 'heygen-avatar',
    label: 'HeyGen Avatar (Digital Twin)',
    speed: '~2-5 мин',
    quality: '★★★★★',
    desc: 'Говорящий аватар с липсинком под нашу озвучку. Подходит для каждой сцены.',
    clip: 'по длине озвучки',
    color: '#ec4899',
  },
  {
    value: 'heygen-agent',
    label: 'HeyGen Video Agent',
    speed: '~3-6 мин',
    quality: '★★★★★',
    desc: 'Один промпт → готовый ролик целиком. Сценарий по сценам не используется.',
    clip: 'весь ролик',
    color: '#d946ef',
  },
];

// Curated HeyGen digital-twin avatar presets (FAL avatar5). Name must match FAL preset.
const HEYGEN_AVATARS = [
  'Abigail Sofa Front',
  'Aiden Office Front',
  'Anna Casual Front',
  'Brandon Suit Front',
  'Daisy Studio Front',
  'Elena Business Front',
  'Ethan Casual Front',
  'Isabella Studio Front',
  'Liam Office Front',
  'Mia Sofa Front',
  'Noah Suit Front',
  'Sophia Business Front',
];

const SCENARIO_PLACEHOLDER = `Опишите сценарий по сценам. Например:

Сцена 1: Бабушка сидит у окна сельского дома, смотрит на небо. Над деревней появляется дрон.

Сцена 2: Дрон зависает перед окном, мигает огнями. Бабушка удивлённо смотрит.

Сцена 3: Бабушка выходит на крыльцо с метлой. Дрон отступает.

AI сам разобьёт ваш сценарий на нужное количество сцен, придумает визуальные описания и субтитры.`;

const SUBTITLE_STYLES = [
  {
    value: 'none',
    label: 'Без субтитров',
    desc: 'Только видео и звук',
    icon: '🚫',
  },
  {
    value: 'plain',
    label: 'Статичный',
    desc: 'Текст просто стоит — без анимации и эффектов',
    icon: '💬',
  },
  {
    value: 'fade',
    label: 'Плавное появление',
    desc: 'Вся фраза плавно проявляется и гаснет',
    icon: '🌅',
  },
  {
    value: 'fade-zoom',
    label: 'Fade + Zoom',
    desc: 'Фраза появляется с лёгким увеличением — мягкий pop-in эффект',
    icon: '🔍',
  },
  {
    value: 'karaoke',
    label: 'Karaoke',
    desc: 'Каждое слово подсвечивается по мере произнесения',
    icon: '🎤',
  },
  {
    value: 'tiktok',
    label: 'TikTok',
    desc: 'Одно крупное слово в центре — как авто-субтитры Reels',
    icon: '⚡',
  },
  {
    value: 'word-by-word',
    label: 'Построчный',
    desc: 'Слова накапливаются одно за другим (текущее — жёлтым)',
    icon: '📝',
  },
  {
    value: 'cinematic',
    label: 'Кино — титры',
    desc: 'Короткая ключевая фраза сцены: blur-reveal, крупно, по центру — как трейлер',
    icon: '🎬',
  },
  {
    value: 'cinematic-full',
    label: 'Кино — полный текст',
    desc: 'Весь произносимый нарратив с blur-reveal — как в документальных фильмах',
    icon: '🎞️',
  },
  {
    value: 'bar',
    label: 'Плашка',
    desc: 'Белый текст на тёмной полупрозрачной подложке — как в новостях',
    icon: '📰',
  },
  {
    value: 'word-timed',
    label: 'По словам (Whisper)',
    desc: 'Каждое слово появляется точно в момент произнесения — тайминги из Whisper, идеальная синхронизация',
    icon: '🎯',
  },
] as const;

type SubtitleStyleValue = typeof SUBTITLE_STYLES[number]['value'];

const CLIP_DURATION_MODELS = new Set(['kling', 'kling-pro', 'seedance', 'seedance2', 'kling-t2v', 'kling-pro-t2v', 'luma', 'seedance-t2v', 'seedance2-t2v', 'happy-horse']);

const SUBTITLE_FONTS = [
  { value: 'DejaVu Sans',      label: 'Стандартный', desc: 'Округлый sans-serif' },
  { value: 'DejaVu Serif',     label: 'С засечками',  desc: 'Классический serif' },
  { value: 'DejaVu Sans Mono', label: 'Моно',         desc: 'Моноширинный' },
  { value: 'Impact',           label: 'Impact',       desc: 'Жирный ударный' },
] as const;

const SUBTITLE_SIZES = [
  { value: 'small',  label: 'S', hint: 'Маленький' },
  { value: 'medium', label: 'M', hint: 'Средний' },
  { value: 'large',  label: 'L', hint: 'Крупный' },
  { value: 'xlarge', label: 'XL', hint: 'Огромный' },
] as const;

const SUBTITLE_COLOR_PRESETS = [
  { value: '#ffffff', label: 'Белый' },
  { value: '#ffff00', label: 'Жёлтый' },
  { value: '#00ffff', label: 'Голубой' },
  { value: '#ff8800', label: 'Оранжевый' },
  { value: '#ff69b4', label: 'Розовый' },
  { value: '#00ff88', label: 'Зелёный' },
] as const;

const MUSIC_STYLES = [
  { value: 'none',       label: 'Без музыки',          emoji: '🔇', desc: 'Только голос, без фона' },
  { value: 'ambient',    label: 'Эмбиент',              emoji: '🌊', desc: 'Спокойный атмосферный фон' },
  { value: 'cinematic',  label: 'Кинематографическая',  emoji: '🎬', desc: 'Эпическая оркестровая' },
  { value: 'corporate',  label: 'Корпоративная',        emoji: '💼', desc: 'Мотивирующая деловая' },
  { value: 'electronic', label: 'Электронная',          emoji: '⚡', desc: 'Современная динамичная' },
  { value: 'acoustic',   label: 'Акустическая',         emoji: '🎸', desc: 'Лёгкая гитарная' },
  { value: 'jazz',       label: 'Джаз',                 emoji: '🎷', desc: 'Расслабленный джазовый фон' },
] as const;

type MusicStyleValue = typeof MUSIC_STYLES[number]['value'];

const VOICES = [
  { value: 'alloy',   label: 'Alloy',   desc: 'Нейтральный, универсальный',   emoji: '⚪' },
  { value: 'nova',    label: 'Nova',    desc: 'Женский, тёплый и живой',       emoji: '🔴' },
  { value: 'shimmer', label: 'Shimmer', desc: 'Женский, мягкий и чёткий',      emoji: '🟣' },
  { value: 'echo',    label: 'Echo',    desc: 'Мужской, приятный и уверенный', emoji: '🔵' },
  { value: 'onyx',    label: 'Onyx',    desc: 'Мужской, глубокий и серьёзный', emoji: '⚫' },
  { value: 'fable',   label: 'Fable',   desc: 'Выразительный, повествовательный', emoji: '🟤' },
  { value: 'ash',     label: 'Ash',     desc: 'Мужской, спокойный и чёткий',   emoji: '🟢' },
  { value: 'coral',   label: 'Coral',   desc: 'Женский, дружелюбный и живой',  emoji: '🟠' },
  { value: 'sage',    label: 'Sage',    desc: 'Женский, умеренный и деловой',  emoji: '🟡' },
] as const;

export default function Create() {
  const [scriptMode, setScriptMode] = useState<'standard' | 'viral'>('standard');
  const [inputMode, setInputMode] = useState<'topic' | 'custom' | 'url'>('topic');
  const [topic, setTopic] = useState('');
  const [customScenario, setCustomScenario] = useState('');
  const [landingUrl, setLandingUrl] = useState('');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState('9:16');
  const [duration, setDuration] = useState(30);
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  const [pipelineMode, setPipelineMode] = useState<'i2v' | 't2v' | 'heygen'>('i2v');
  const [heygenAvatar, setHeygenAvatar] = useState<string>(HEYGEN_AVATARS[0]);
  const [animationModel, setAnimationModel] = useState('wan');
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleValue>('karaoke');
  const [clipDuration, setClipDuration] = useState<5 | 10>(10);
  const [subtitleFont, setSubtitleFont] = useState('DejaVu Sans');
  const [subtitleSize, setSubtitleSize] = useState('medium');
  const [subtitleColor, setSubtitleColor] = useState('#ffffff');
  const [voice, setVoice] = useState('alloy');
  const [musicStyle, setMusicStyle] = useState<MusicStyleValue>('ambient');
  const [musicVolume, setMusicVolume] = useState(0.18);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [playingMusic, setPlayingMusic] = useState(false);
  const [loadingMusicPreview, setLoadingMusicPreview] = useState(false);
  const [musicPreviewInfo, setMusicPreviewInfo] = useState<{ trackName: string; artistName: string } | null>(null);
  const [musicTrackIdx, setMusicTrackIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicAbortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [directorBrief, setDirectorBrief] = useState('');
  const [directorLoading, setDirectorLoading] = useState(false);
  const [directorRationale, setDirectorRationale] = useState('');
  const [directorError, setDirectorError] = useState('');

  // Stop all audio when navigating away from the page
  useEffect(() => {
    return () => {
      if (musicAbortRef.current) { musicAbortRef.current.abort(); musicAbortRef.current = null; }
      if (musicAudioRef.current) { musicAudioRef.current.pause(); musicAudioRef.current.src = ''; musicAudioRef.current = null; }
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null; }
    };
  }, []);

  function stopMusicPreview() {
    // Cancel any in-progress metadata fetch
    if (musicAbortRef.current) {
      musicAbortRef.current.abort();
      musicAbortRef.current = null;
    }
    // Stop and discard the audio element
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      musicAudioRef.current.src = '';
      musicAudioRef.current = null;
    }
    setPlayingMusic(false);
    setLoadingMusicPreview(false);
  }

  function playVoicePreview(v: string) {
    stopMusicPreview();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingVoice === v) {
      setPlayingVoice(null);
      return;
    }
    setPlayingVoice(v);
    const audio = new Audio(`${API}/tts-preview/${v}?lang=${language}&v=3`);
    audioRef.current = audio;
    audio.play().catch(() => {});
    audio.onended = () => { setPlayingVoice(null); audioRef.current = null; };
    audio.onerror = () => { setPlayingVoice(null); audioRef.current = null; };
  }

  async function playMusicPreview(idx?: number) {
    const trackIdx = idx ?? musicTrackIdx;

    // Toggle off if same button pressed while playing/loading
    if (idx === undefined && (playingMusic || loadingMusicPreview)) {
      stopMusicPreview();
      return;
    }

    // Always stop whatever is currently playing/loading first
    stopMusicPreview();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setPlayingVoice(null); }

    // Create abort controller for this load session
    const abortCtrl = new AbortController();
    musicAbortRef.current = abortCtrl;

    setLoadingMusicPreview(true);
    setMusicPreviewInfo(null);
    try {
      // Fetch metadata first (fast, no audio download)
      const metaResp = await fetch(
        `${API}/music/preview?style=${musicStyle}&idx=${trackIdx}&meta=1`,
        { signal: abortCtrl.signal },
      );
      if (!metaResp.ok) {
        const err = await metaResp.json().catch(() => ({ error: 'Ошибка запроса' }));
        throw new Error(err.error || 'Ошибка');
      }
      const { trackName, artistName } = await metaResp.json();

      // Bail out if another call has already taken over (abort was triggered)
      if (abortCtrl.signal.aborted) return;

      setMusicPreviewInfo({ trackName, artistName });

      // Create audio element — stop any audio that snuck in during the await
      if (musicAudioRef.current) {
        musicAudioRef.current.pause();
        musicAudioRef.current.src = '';
        musicAudioRef.current = null;
      }

      const audio = new Audio(`${API}/music/preview?style=${musicStyle}&idx=${trackIdx}&t=${Date.now()}`);
      musicAudioRef.current = audio;
      musicAbortRef.current = null;
      setLoadingMusicPreview(false);
      setPlayingMusic(true);

      audio.play().catch((e) => {
        if (e.name === 'AbortError') return;
        setMusicPreviewInfo({ trackName: 'Ошибка воспроизведения: ' + e.message, artistName: '' });
        setPlayingMusic(false);
        musicAudioRef.current = null;
      });
      audio.onended = () => { setPlayingMusic(false); musicAudioRef.current = null; };
      audio.onerror = () => { setPlayingMusic(false); musicAudioRef.current = null; };
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setMusicPreviewInfo({ trackName: 'Ошибка: ' + err.message, artistName: '' });
      setLoadingMusicPreview(false);
    }
  }

  async function nextMusicTrack() {
    const next = (musicTrackIdx + 1) % 10;
    setMusicTrackIdx(next);
    await playMusicPreview(next);
  }

  function handlePipelineSwitch(mode: 'i2v' | 't2v' | 'heygen') {
    setPipelineMode(mode);
    setAnimationModel(mode === 't2v' ? 'kling-t2v' : mode === 'heygen' ? 'heygen-avatar' : 'wan');
  }

  function applyPlan(plan: any, fillTopic: boolean) {
    if (plan.format) setFormat(plan.format);
    if (typeof plan.duration === 'number') setDuration(plan.duration);
    if (plan.language) setLanguage(plan.language);
    if (plan.scriptMode) setScriptMode(plan.scriptMode);
    if (plan.animationModel) {
      setAnimationModel(plan.animationModel);
      // Pipeline всегда выводим из модели, чтобы режим и модель не рассинхронизировались.
      setPipelineMode(
        HEYGEN_MODELS.some((m) => m.value === plan.animationModel) ? 'heygen'
        : T2V_MODELS.some((m) => m.value === plan.animationModel) ? 't2v'
        : 'i2v'
      );
    } else if (plan.pipelineMode) {
      setPipelineMode(plan.pipelineMode);
    }
    if (plan.clipDuration === 5 || plan.clipDuration === 10) setClipDuration(plan.clipDuration);
    if (plan.voice) setVoice(plan.voice);
    if (plan.subtitleStyle) setSubtitleStyle(plan.subtitleStyle as SubtitleStyleValue);
    if (plan.musicStyle) setMusicStyle(plan.musicStyle as MusicStyleValue);
    if (plan.title) setTitle(plan.title);
    if (fillTopic && plan.topic) {
      setInputMode('topic');
      setTopic(plan.topic);
    }
    setDirectorRationale(plan.rationale || '');
  }

  // useBrief=true — план по свободному брифу; иначе — по текущим полям формы.
  async function runDirector(useBrief: boolean) {
    const payload: Record<string, any> = {};
    if (useBrief) {
      if (!directorBrief.trim()) { setDirectorError('Опишите, какое видео вам нужно'); return; }
      payload.brief = directorBrief.trim();
    } else {
      if (inputMode === 'topic') {
        if (!topic.trim()) { setDirectorError('Сначала введите тему видео'); return; }
        payload.topic = topic.trim();
      } else if (inputMode === 'custom') {
        if (!customScenario.trim()) { setDirectorError('Сначала введите сценарий'); return; }
        payload.customScenario = customScenario.trim();
      } else {
        if (!landingUrl.trim()) { setDirectorError('Сначала введите ссылку на лендинг'); return; }
        payload.landingUrl = landingUrl.trim();
      }
      if (additionalDetails.trim()) payload.additionalDetails = additionalDetails.trim();
    }

    setDirectorLoading(true);
    setDirectorError('');
    setDirectorRationale('');
    try {
      const res = await fetch(`${API}/videos/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = 'Не удалось составить план';
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const plan = await res.json();
      applyPlan(plan, useBrief);
    } catch (err: any) {
      setDirectorError(err.message);
    } finally {
      setDirectorLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (inputMode === 'custom') {
      if (!customScenario.trim() || customScenario.trim().length < 10) {
        setError('Введите подробный сценарий (минимум 10 символов)');
        return;
      }
    } else if (inputMode === 'url') {
      if (!landingUrl.trim()) {
        setError('Введите URL лендинга');
        return;
      }
      try { new URL(landingUrl.trim()); } catch {
        setError('Введите корректный URL (например: https://example.com)');
        return;
      }
    } else {
      if (!topic.trim()) {
        setError('Введите тему видео');
        return;
      }
    }

    setLoading(true);
    setError('');
    try {
      const defaultTitle =
        inputMode === 'custom' ? 'Пользовательский сценарий'
        : inputMode === 'url' ? 'Промо-видео'
        : topic.trim();

      const body: Record<string, any> = {
        title: title.trim() || defaultTitle,
        format,
        duration,
        language,
        animationModel,
        heygenAvatar: animationModel === 'heygen-avatar' ? heygenAvatar : undefined,
        subtitleStyle,
        voice,
        clipDuration: CLIP_DURATION_MODELS.has(animationModel) ? clipDuration : undefined,
        subtitleFont: subtitleStyle !== 'none' ? subtitleFont : undefined,
        subtitleSize: subtitleStyle !== 'none' ? subtitleSize : undefined,
        subtitleColor: subtitleStyle !== 'none' ? subtitleColor : undefined,
        musicStyle,
        musicVolume: musicStyle !== 'none' ? musicVolume : undefined,
      };

      if (inputMode === 'custom') {
        body.customScenario = customScenario.trim();
        body.topic = title.trim() || 'Пользовательский сценарий';
      } else if (inputMode === 'url') {
        body.landingUrl = landingUrl.trim();
        body.topic = title.trim() || defaultTitle;
        if (additionalDetails.trim()) body.additionalDetails = additionalDetails.trim();
      } else {
        body.topic = topic.trim();
        if (additionalDetails.trim()) body.additionalDetails = additionalDetails.trim();
      }

      if (scriptMode === 'viral') body.scriptMode = 'viral';

      // Step 1: create project
      const res = await fetch(`${API}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let errMsg = 'Ошибка создания';
        try { errMsg = (await res.json()).error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const project = await res.json();

      // Step 2: generate script only (will pause for review)
      const scriptRes = await fetch(`${API}/videos/${project.id}/generate-script`, { method: 'POST' });
      if (!scriptRes.ok) {
        let errMsg = 'Ошибка генерации сценария';
        try { errMsg = (await scriptRes.json()).error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      // Navigate to detail page — user will see the script and click "Generate Video"
      navigate(`/video/${project.id}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  const currentModels = pipelineMode === 't2v' ? T2V_MODELS : pipelineMode === 'heygen' ? HEYGEN_MODELS : I2V_MODELS;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Новое видео</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>
        AI сгенерирует скрипт и соберёт видео
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* AI-режиссёр: предлагает настройки видео по брифу */}
        <div style={{ background: 'var(--bg-card2)', border: '1.5px solid var(--accent)', borderRadius: 'var(--radius-sm)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>🎬</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>AI-режиссёр</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>предложит формат, модель, голос, музыку и субтитры</span>
          </div>
          <textarea
            value={directorBrief}
            onChange={(e) => setDirectorBrief(e.target.value)}
            data-testid="input-director-brief"
            placeholder="Опишите словами, какое видео вам нужно. Например: «энергичный рекламный ролик про кофейню на 30 секунд для Reels»"
            rows={2}
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="button-director-brief"
              onClick={() => runDirector(true)}
              disabled={directorLoading}
              style={{ flex: 1, minWidth: 200, padding: '10px 14px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 'var(--radius-sm)', cursor: directorLoading ? 'wait' : 'pointer', background: 'var(--accent)', color: 'white', opacity: directorLoading ? 0.7 : 1 }}
            >
              {directorLoading ? '🤔 Думаю…' : '✨ Составить план по брифу'}
            </button>
            <button
              type="button"
              data-testid="button-director-auto"
              onClick={() => runDirector(false)}
              disabled={directorLoading}
              title="Подобрать настройки по уже заполненным полям (тема / сценарий / лендинг)"
              style={{ padding: '10px 14px', fontSize: 14, fontWeight: 600, border: '1.5px solid var(--accent)', borderRadius: 'var(--radius-sm)', cursor: directorLoading ? 'wait' : 'pointer', background: 'transparent', color: 'var(--accent)', opacity: directorLoading ? 0.7 : 1 }}
            >
              ⚡ Авто
            </button>
          </div>
          {directorError && (
            <p style={{ color: 'var(--danger, #ef4444)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>{directorError}</p>
          )}
          {directorRationale && (
            <div data-testid="text-director-rationale" style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text)' }}>План режиссёра:</strong> {directorRationale}
              <div style={{ marginTop: 4, fontSize: 12 }}>Поля ниже заполнены — проверьте и при необходимости измените.</div>
            </div>
          )}
        </div>

        {/* Content mode toggle */}
        <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1.5px solid var(--border)' }}>
          <button
            type="button"
            data-testid="mode-topic"
            onClick={() => setInputMode('topic')}
            style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', background: inputMode === 'topic' ? 'var(--accent)' : 'var(--bg-card2)', color: inputMode === 'topic' ? 'white' : 'var(--text-muted)', transition: 'all 0.15s' }}
          >
            💡 По теме
          </button>
          <button
            type="button"
            data-testid="mode-scenario"
            onClick={() => setInputMode('custom')}
            style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none', borderLeft: '1.5px solid var(--border)', cursor: 'pointer', background: inputMode === 'custom' ? 'var(--accent)' : 'var(--bg-card2)', color: inputMode === 'custom' ? 'white' : 'var(--text-muted)', transition: 'all 0.15s' }}
          >
            📝 Свой сценарий
          </button>
          <button
            type="button"
            data-testid="mode-url"
            onClick={() => setInputMode('url')}
            style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none', borderLeft: '1.5px solid var(--border)', cursor: 'pointer', background: inputMode === 'url' ? 'var(--accent)' : 'var(--bg-card2)', color: inputMode === 'url' ? 'white' : 'var(--text-muted)', transition: 'all 0.15s' }}
          >
            🌐 По лендингу
          </button>
        </div>

        {/* Topic / Custom scenario / Landing URL */}
        {inputMode === 'topic' ? (
          <>
            <Field label="Тема видео *" hint="Что должно быть в видео? Опишите кратко.">
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Например: топ 5 советов по продуктивности"
                rows={3}
                data-testid="input-topic"
                style={inputStyle}
              />
            </Field>
            <Field label="Дополнительные уточнения" hint="Стиль, декорации, обстановка, цветовая гамма, атмосфера — всё что важно передать AI">
              <textarea
                value={additionalDetails}
                onChange={(e) => setAdditionalDetails(e.target.value)}
                placeholder="Например: тёплые оранжевые тона, уютный деревянный интерьер, мягкий рассеянный свет"
                rows={2}
                data-testid="input-additional-details-topic"
                style={inputStyle}
              />
            </Field>
          </>
        ) : inputMode === 'custom' ? (
          <Field label="Подробный сценарий *" hint="Опишите сцены своими словами — AI разберёт и создаст визуализацию">
            <textarea
              value={customScenario}
              onChange={(e) => setCustomScenario(e.target.value)}
              placeholder={SCENARIO_PLACEHOLDER}
              rows={10}
              data-testid="input-custom-scenario"
              style={{ ...inputStyle, fontFamily: 'inherit', lineHeight: 1.6 }}
            />
            <div style={{ marginTop: 6, padding: '10px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              💡 AI разобьёт на {Math.round(duration / 10)} сцен по ~10 сек, придумает субтитры и промпты.
            </div>
          </Field>
        ) : (
          <>
            <Field label="URL лендинга *" hint="AI изучит страницу и создаст промо-рилс для вашего продукта">
              <input
                value={landingUrl}
                onChange={(e) => setLandingUrl(e.target.value)}
                placeholder="https://omemo.tech/"
                type="url"
                data-testid="input-landing-url"
                style={inputStyle}
              />
              <div style={{ marginTop: 6, padding: '10px 14px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                🤖 AI скачает страницу, извлечёт описание продукта и напишет продающий сценарий: хук → боль → решение → CTA.
              </div>
            </Field>
            <Field label="Дополнительные уточнения" hint="Стиль, декорации, обстановка, цветовая гамма, атмосфера — всё что важно передать AI">
              <textarea
                value={additionalDetails}
                onChange={(e) => setAdditionalDetails(e.target.value)}
                placeholder="Например: минималистичный белый офис, холодный синий свет, деловой стиль"
                rows={2}
                data-testid="input-additional-details-url"
                style={inputStyle}
              />
            </Field>
          </>
        )}

        <Field label="Название (необязательно)" hint="Отображается в списке проектов">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={inputMode === 'custom' ? 'Бабушка vs Дрон' : inputMode === 'url' ? 'Промо SMM Manager' : 'Мой крутой Reels'}
            data-testid="input-title"
            style={inputStyle}
          />
        </Field>

        {/* Script mode toggle */}
        <Field label="Режим сценария">
          <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1.5px solid var(--border)' }}>
            <button
              type="button"
              data-testid="script-mode-standard"
              onClick={() => setScriptMode('standard')}
              style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', background: scriptMode === 'standard' ? 'var(--accent)' : 'var(--bg-card2)', color: scriptMode === 'standard' ? 'white' : 'var(--text-muted)', transition: 'all 0.15s' }}
            >
              📊 Стандартный
            </button>
            <button
              type="button"
              data-testid="script-mode-viral"
              onClick={() => {
                setScriptMode('viral');
                setFormat('9:16');
                if (duration > 30) setDuration(30);
              }}
              style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, border: 'none', borderLeft: '1.5px solid var(--border)', cursor: 'pointer', background: scriptMode === 'viral' ? '#7c3aed' : 'var(--bg-card2)', color: scriptMode === 'viral' ? 'white' : 'var(--text-muted)', transition: 'all 0.15s' }}
            >
              🚀 Вирусный Reels
            </button>
          </div>
          {scriptMode === 'viral' && (
            <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'rgba(124,58,237,0.12)', border: '1.5px solid rgba(124,58,237,0.35)', fontSize: 13, color: '#c4b5fd', lineHeight: 1.6 }}>
              <strong style={{ color: '#a78bfa' }}>Hook / Body / CTA структура:</strong> Сцена 1 — резкий крючок (шок-факт, боль), средние сцены — быстрая польза, последняя — триггер комментариев. Рекомендуется 9:16, 15–30с.
            </div>
          )}
        </Field>

        <Field label="Формат">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FORMATS.map((f) => (
              <label
                key={f.value}
                data-testid={`format-${f.value}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${format === f.value ? 'var(--accent)' : 'var(--border)'}`, background: format === f.value ? '#1e1040' : 'var(--bg-card2)', cursor: 'pointer', transition: 'all 0.15s' }}
              >
                <input type="radio" name="format" value={f.value} checked={format === f.value} onChange={() => setFormat(f.value)} style={{ display: 'none' }} />
                <span style={{ fontSize: 22 }}>{f.emoji}</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{f.label}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Длительность">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {DURATIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                data-testid={`duration-${d.value}`}
                onClick={() => setDuration(d.value)}
                style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${duration === d.value ? 'var(--accent)' : 'var(--border)'}`, background: duration === d.value ? '#1e1040' : 'var(--bg-card2)', color: 'var(--text)', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Pipeline mode: I2V vs T2V */}
        <Field label="Метод генерации" hint="Image-to-Video: картинка → анимация. Text-to-Video: текст → видео напрямую.">
          <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1.5px solid var(--border)' }}>
            <button
              type="button"
              data-testid="pipeline-i2v"
              onClick={() => handlePipelineSwitch('i2v')}
              style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: pipelineMode === 'i2v' ? '#1e3a5f' : 'var(--bg-card2)', color: pipelineMode === 'i2v' ? '#60a5fa' : 'var(--text-muted)', transition: 'all 0.15s' }}
            >
              🖼️ Image-to-Video
              <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: pipelineMode === 'i2v' ? '#93c5fd' : 'var(--text-muted)' }}>Imagen4 → FAL I2V</div>
            </button>
            <button
              type="button"
              data-testid="pipeline-t2v"
              onClick={() => handlePipelineSwitch('t2v')}
              style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none', borderLeft: '1.5px solid var(--border)', cursor: 'pointer', background: pipelineMode === 't2v' ? '#1a3a2a' : 'var(--bg-card2)', color: pipelineMode === 't2v' ? '#4ade80' : 'var(--text-muted)', transition: 'all 0.15s' }}
            >
              ✨ Text-to-Video
              <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: pipelineMode === 't2v' ? '#86efac' : 'var(--text-muted)' }}>Текст → видео напрямую</div>
            </button>
            <button
              type="button"
              data-testid="pipeline-heygen"
              onClick={() => handlePipelineSwitch('heygen')}
              style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600, border: 'none', borderLeft: '1.5px solid var(--border)', cursor: 'pointer', background: pipelineMode === 'heygen' ? '#3a1a32' : 'var(--bg-card2)', color: pipelineMode === 'heygen' ? '#f472b6' : 'var(--text-muted)', transition: 'all 0.15s' }}
            >
              🧑‍💼 HeyGen Avatar
              <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2, color: pipelineMode === 'heygen' ? '#f9a8d4' : 'var(--text-muted)' }}>Говорящий аватар</div>
            </button>
          </div>

          {/* Pipeline description */}
          <div style={{ marginTop: 8, padding: '10px 14px', background: pipelineMode === 't2v' ? 'rgba(74,222,128,0.07)' : pipelineMode === 'heygen' ? 'rgba(236,72,153,0.07)' : 'rgba(96,165,250,0.07)', border: `1px solid ${pipelineMode === 't2v' ? 'rgba(74,222,128,0.2)' : pipelineMode === 'heygen' ? 'rgba(236,72,153,0.2)' : 'rgba(96,165,250,0.2)'}`, borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {pipelineMode === 'i2v' ? (
              <>🖼️ <strong style={{ color: 'var(--text)' }}>Image-to-Video:</strong> AI генерирует опорные кадры (Imagen4), затем оживляет их в видеоклипы. Лучше для видео с конкретным персонажем — первый кадр задаёт «ДНК» внешности.</>
            ) : pipelineMode === 't2v' ? (
              <>✨ <strong style={{ color: 'var(--text)' }}>Text-to-Video:</strong> AI пишет T2V-промпт с <em>consistency_block</em> и генерирует видео напрямую без картинки. Быстрее, меньше артефактов склейки. Лучше для абстрактного/атмосферного контента.</>
            ) : (
              <>🧑‍💼 <strong style={{ color: 'var(--text)' }}>HeyGen Avatar:</strong> говорящий цифровой человек, синхронизированный с озвучкой. <em>Digital Twin</em> — аватар в каждой сцене (~$0.10/сек); <em>Video Agent</em> — целый ролик из одного промпта (~$0.034/сек).</>
            )}
          </div>
        </Field>

        {/* Model selection */}
        <Field label={`Модель ${pipelineMode === 't2v' ? 'T2V' : pipelineMode === 'heygen' ? 'HeyGen' : 'I2V'}`} hint="Время ожидания — сколько FAL.AI обрабатывает запрос. Длина клипа указана отдельно.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {currentModels.map((m) => {
              const hasFrames = 'frames' in m;
              const isMultiFrame = hasFrames && (m as any).frames === 2;
              return (
                <label
                  key={m.value}
                  data-testid={`model-${m.value}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${animationModel === m.value ? m.color : 'var(--border)'}`, background: animationModel === m.value ? 'rgba(255,255,255,0.04)' : 'var(--bg-card2)', cursor: 'pointer', transition: 'all 0.15s' }}
                >
                  <input type="radio" name="animationModel" value={m.value} checked={animationModel === m.value} onChange={() => setAnimationModel(m.value)} style={{ display: 'none' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {m.label}
                      {hasFrames && (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: isMultiFrame ? 'rgba(251,191,36,0.15)' : 'rgba(148,163,184,0.12)',
                          color: isMultiFrame ? '#fbbf24' : '#94a3b8',
                          border: `1px solid ${isMultiFrame ? 'rgba(251,191,36,0.3)' : 'rgba(148,163,184,0.2)'}`,
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap',
                        }}>
                          {isMultiFrame ? '🖼️🖼️ 2 кадра' : '🖼️ 1 кадр'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {m.desc}
                      {isMultiFrame && (
                        <span style={{ color: '#fbbf24', marginLeft: 6 }}>· старт + финиш</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, color: m.color, fontWeight: 600 }}>{m.speed} ожид.</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{(m as any).clip}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{m.quality}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </Field>

        {animationModel === 'heygen-avatar' && (
          <Field label="Аватар" hint="Цифровой человек HeyGen, который озвучивает сцены. Имя должно совпадать с пресетом FAL.">
            <select
              data-testid="heygen-avatar-select"
              value={heygenAvatar}
              onChange={(e) => setHeygenAvatar(e.target.value)}
              style={{ width: '100%', padding: '11px 14px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text)', fontSize: 14, cursor: 'pointer' }}
            >
              {HEYGEN_AVATARS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Язык контента">
          <div style={{ display: 'flex', gap: 10 }}>
            {(['ru', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                data-testid={`lang-${l}`}
                onClick={() => setLanguage(l)}
                style={{ padding: '9px 24px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${language === l ? 'var(--accent)' : 'var(--border)'}`, background: language === l ? '#1e1040' : 'var(--bg-card2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                {l === 'ru' ? '🇷🇺 Русский' : '🇬🇧 English'}
              </button>
            ))}
          </div>
        </Field>

        {CLIP_DURATION_MODELS.has(animationModel) && (
          <Field label="Длина клипа" hint="Длина каждой сцены видео">
            <div style={{ display: 'flex', gap: 8 }}>
              {([5, 10] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  data-testid={`clip-duration-${d}`}
                  onClick={() => setClipDuration(d)}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${clipDuration === d ? 'var(--accent)' : 'var(--border)'}`, background: clipDuration === d ? '#1e1040' : 'var(--bg-card2)', color: clipDuration === d ? 'var(--accent)' : 'var(--text)', fontSize: 15, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
                >
                  {d}с {animationModel === 'luma' && d === 10 ? '(9с)' : ''}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Голос озвучки" hint="Выберите голос и нажмите ▶ чтобы послушать пример">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {VOICES.map((v) => {
              const active = voice === v.value;
              const isPlaying = playingVoice === v.value;
              return (
                <div
                  key={v.value}
                  data-testid={`voice-${v.value}`}
                  onClick={() => setVoice(v.value)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? '#1e1040' : 'var(--bg-card2)', cursor: 'pointer', transition: 'all 0.15s', position: 'relative' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>{v.emoji}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text)' }}>{v.label}</span>
                    </div>
                    <button
                      type="button"
                      data-testid={`voice-preview-${v.value}`}
                      onClick={(e) => { e.stopPropagation(); playVoicePreview(v.value); }}
                      title="Прослушать"
                      style={{ width: 26, height: 26, borderRadius: '50%', border: `1px solid ${isPlaying ? 'var(--accent)' : 'var(--border)'}`, background: isPlaying ? 'var(--accent)' : 'transparent', color: isPlaying ? 'white' : 'var(--text-muted)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
                    >
                      {isPlaying ? '■' : '▶'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{v.desc}</div>
                  {active && <div style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
            ⚠️ Голоса работают через OpenAI TTS. При проблемах с ключом или исчерпанном лимите будет использован стандартный голос (Edge TTS).
          </div>
        </Field>

        <Field label="Фоновая музыка" hint="Стиль музыки, которая будет подмешана под озвучку. Ищется в Jamendo (бесплатный сток) или генерируется AI.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {MUSIC_STYLES.map((m) => {
              const active = musicStyle === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  data-testid={`music-style-${m.value}`}
                  onClick={() => setMusicStyle(m.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? '#1e1040' : 'var(--bg-card2)',
                    color: 'var(--text)', textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
                    opacity: m.value === 'none' ? 0.7 : 1,
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{m.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text)' }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{m.desc}</div>
                  </div>
                  {active && <span style={{ fontSize: 14, color: 'var(--accent)', flexShrink: 0 }}>✓</span>}
                </button>
              );
            })}
          </div>
          {musicStyle !== 'none' && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="music-preview-btn"
                  onClick={() => playMusicPreview()}
                  disabled={loadingMusicPreview}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 14px', borderRadius: 'var(--radius-sm)',
                    border: `1.5px solid ${playingMusic ? 'var(--accent)' : 'var(--border)'}`,
                    background: playingMusic ? 'rgba(139,92,246,0.15)' : 'var(--bg-card2)',
                    color: playingMusic ? 'var(--accent)' : 'var(--text)',
                    cursor: loadingMusicPreview ? 'wait' : 'pointer',
                    fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 16 }}>
                    {loadingMusicPreview ? '⏳' : playingMusic ? '⏹' : '▶'}
                  </span>
                  {loadingMusicPreview ? 'Загрузка...' : playingMusic ? 'Остановить' : 'Прослушать'}
                </button>
                <button
                  type="button"
                  data-testid="music-next-btn"
                  onClick={nextMusicTrack}
                  disabled={loadingMusicPreview}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 12px', borderRadius: 'var(--radius-sm)',
                    border: '1.5px solid var(--border)',
                    background: 'var(--bg-card2)', color: 'var(--text-muted)',
                    cursor: loadingMusicPreview ? 'wait' : 'pointer',
                    fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
                  }}
                  title="Следующий трек"
                >
                  🔀 Другой трек
                </button>
              </div>
              {musicPreviewInfo && (
                <div style={{ fontSize: 11, color: playingMusic ? 'var(--accent)' : 'var(--text-muted)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  {playingMusic ? '🎵 ' : ''}
                  <strong>{musicPreviewInfo.trackName}</strong>
                  {musicPreviewInfo.artistName ? ` — ${musicPreviewInfo.artistName}` : ''}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>#{musicTrackIdx + 1}</span>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
                🎵 Треки Jamendo под лицензией CC.
              </div>
              {/* Music volume slider */}
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>🔊 Громкость музыки</span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{Math.round(musicVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  value={musicVolume}
                  onChange={e => setMusicVolume(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
                  <span>5% (тихо)</span>
                  <span style={{ color: musicVolume <= 0.2 ? 'var(--accent)' : 'var(--text-muted)' }}>18% (по умолчанию)</span>
                  <span>50% (громко)</span>
                </div>
              </div>
            </div>
          )}
        </Field>

        <Field label="Субтитры" hint="Как текст будет появляться на видео">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SUBTITLE_STYLES.map((s) => {
              const active = subtitleStyle === s.value;
              return (
                <label
                  key={s.value}
                  data-testid={`subtitle-${s.value}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? '#1e1040' : 'var(--bg-card2)', cursor: 'pointer', transition: 'all 0.15s' }}
                >
                  <input type="radio" name="subtitleStyle" value={s.value} checked={active} onChange={() => setSubtitleStyle(s.value)} style={{ display: 'none' }} />
                  <SubtitleStylePreview style={s.value} color={subtitleColor} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.desc}</div>
                  </div>
                  {active && <span style={{ fontSize: 16, color: 'var(--accent)', flexShrink: 0 }}>✓</span>}
                </label>
              );
            })}
          </div>
        </Field>

        {subtitleStyle !== 'none' && (
          <>
            <Field label="Шрифт субтитров">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {SUBTITLE_FONTS.map((f) => {
                  const active = subtitleFont === f.value;
                  return (
                    <button key={f.value} type="button" data-testid={`subtitle-font-${f.value}`}
                      onClick={() => setSubtitleFont(f.value)}
                      style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? '#1e1040' : 'var(--bg-card2)', color: active ? 'var(--accent)' : 'var(--text)', textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: f.value }}>{f.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</div>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Размер субтитров">
              <div style={{ display: 'flex', gap: 8 }}>
                {SUBTITLE_SIZES.map((s) => {
                  const active = subtitleSize === s.value;
                  return (
                    <button key={s.value} type="button" data-testid={`subtitle-size-${s.value}`}
                      onClick={() => setSubtitleSize(s.value)}
                      title={s.hint}
                      style={{ flex: 1, padding: '10px 0', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? '#1e1040' : 'var(--bg-card2)', color: active ? 'var(--accent)' : 'var(--text)', fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Цвет текста">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {SUBTITLE_COLOR_PRESETS.map((c) => {
                  const active = subtitleColor === c.value;
                  return (
                    <button key={c.value} type="button" data-testid={`subtitle-color-${c.value.replace('#','')}`}
                      onClick={() => setSubtitleColor(c.value)}
                      title={c.label}
                      style={{ width: 32, height: 32, borderRadius: '50%', border: `2.5px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`, background: c.value, cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0, boxShadow: active ? '0 0 0 2px var(--accent)' : 'none' }} />
                  );
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                  <input type="color" value={subtitleColor} onChange={(e) => setSubtitleColor(e.target.value)}
                    data-testid="subtitle-color-custom"
                    style={{ width: 32, height: 32, border: 'none', borderRadius: '50%', padding: 0, cursor: 'pointer', background: 'none' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{subtitleColor}</span>
                </div>
              </div>
            </Field>
          </>
        )}

        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-sm)', background: '#2d0a0a', border: '1px solid #7f1d1d', color: '#fca5a5', fontSize: 14 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          data-testid="button-submit"
          style={{ padding: '14px', borderRadius: 'var(--radius)', border: 'none', background: loading ? '#4c1d95' : 'var(--accent)', color: 'white', fontSize: 16, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'all 0.15s' }}
        >
          {loading ? '⏳ Генерирую сценарий...' : '✨ Сгенерировать сценарий'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</label>
      {hint && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>{hint}</span>}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-card2)',
  border: '1.5px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  padding: '10px 14px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
  resize: 'vertical' as const,
};
