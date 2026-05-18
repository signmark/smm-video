import { useState, useEffect, useRef, useCallback } from 'react';
import { navigate } from '../App';
import { API } from '../api';

// ── Token refresh logic (mirrors main app's refreshAuth.ts) ─────────────────
async function getValidToken(): Promise<string | null> {
  const token = localStorage.getItem('auth_token');
  const refreshToken = localStorage.getItem('refresh_token');

  // Check if token is expired or expiring within 60 seconds
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (!payload.exp || payload.exp > now + 60) return token; // still valid
    } catch { /* malformed — fall through to refresh */ }
  }

  // Try to refresh
  if (refreshToken) {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('auth_token', data.token);
          if (data.user_id) localStorage.setItem('user_id', data.user_id);
          return data.token;
        }
      }
    } catch { /* ignore */ }
  }

  return token; // return whatever we have (might be expired — server will tell us)
}

// ── SaveToCampaign: fetch user campaigns from main app and save video there ──
function SaveToCampaign({ projectId, projectTitle }: { projectId: string; projectTitle: string }) {
  const [open, setOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [contentType, setContentType] = useState<'clip' | 'video'>('clip');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  async function authHeaders(): Promise<Record<string, string>> {
    const t = await getValidToken();
    return t ? { 'Authorization': `Bearer ${t}` } : {};
  }

  async function handleLogin() {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка входа');
      localStorage.setItem('auth_token', data.token);
      if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
      setNeedLogin(false);
      loadCampaigns();
    } catch (e: any) {
      setLoginError(e.message);
    } finally {
      setLoginLoading(false);
    }
  }

  async function loadCampaigns() {
    setLoading(true);
    setError(null);
    setNeedLogin(false);
    try {
      const headers = await authHeaders();
      if (!headers['Authorization']) { setNeedLogin(true); return; }
      const res = await fetch(`${API}/campaigns-proxy`, { headers });
      const text = await res.text();
      if (res.status === 401 || res.status === 403) { setNeedLogin(true); return; }
      if (!res.ok) throw new Error(`Ошибка ${res.status}: ${text.slice(0, 120)}`);
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(`Ответ не JSON: ${text.slice(0, 80)}`); }
      const raw = data.data || data.campaigns || (Array.isArray(data) ? data : []);
      const list: Array<{ id: string; name: string }> = raw.map((c: any) => ({
        id: c.id,
        name: c.name || c.title || `Кампания ${c.id}`,
      }));
      setCampaigns(list);
      if (list.length > 0) setSelectedId(list[0].id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/videos/${projectId}/save-to-campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ campaignId: selectedId, contentType, appUrl: window.location.origin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка сохранения');
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div style={{ background: 'rgba(22,101,52,0.15)', border: '1px solid #166534', borderRadius: 'var(--radius)', padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>✅</span>
        <span style={{ color: '#86efac', fontWeight: 600 }}>Видео сохранено в кампанию!</span>
        <button onClick={() => { setSaved(false); setOpen(false); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#86efac', cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>✕</button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); loadCampaigns(); }}
        style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.07)', color: '#c4b5fd', fontSize: 14, cursor: 'pointer', marginBottom: 16 }}
      >
        📂 Сохранить в кампанию SMM
      </button>
    );
  }

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 12, color: '#c4b5fd' }}>📂 Сохранить в кампанию</div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Загружаю кампании...</div>
      ) : needLogin ? (
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>Войдите в SMM Manager чтобы выбрать кампанию:</div>
          <input
            type="email" placeholder="Email" value={loginEmail}
            onChange={e => setLoginEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ width: '100%', padding: '7px 10px', marginBottom: 6, background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
          />
          <input
            type="password" placeholder="Пароль" value={loginPassword}
            onChange={e => setLoginPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            style={{ width: '100%', padding: '7px 10px', marginBottom: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
          />
          {loginError && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 6 }}>{loginError}</div>}
          <button
            onClick={handleLogin} disabled={loginLoading}
            style={{ width: '100%', padding: '8px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {loginLoading ? 'Вход...' : 'Войти'}
          </button>
        </div>
      ) : error ? (
        <div style={{ color: '#f87171', fontSize: 13 }}>
          {error}{' '}
          <button onClick={loadCampaigns} style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 13 }}>Повторить</button>
        </div>
      ) : campaigns.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Кампании не найдены. <button onClick={loadCampaigns} style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 13 }}>Обновить</button></div>
      ) : (
        <>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 14, marginBottom: 8 }}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {(['clip', 'video'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setContentType(t)}
                style={{ flex: 1, padding: '7px', borderRadius: 'var(--radius-sm)', border: contentType === t ? 'none' : '1px solid var(--border)', background: contentType === t ? '#7c3aed' : 'transparent', color: contentType === t ? 'white' : 'var(--text-muted)', fontSize: 13, fontWeight: contentType === t ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s' }}
              >
                {t === 'clip' ? '🎬 Клип' : '🎞️ Видео'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={saving || !selectedId}
              style={{ flex: 1, padding: '8px', borderRadius: 'var(--radius-sm)', border: 'none', background: saving ? '#4c1d95' : '#7c3aed', color: 'white', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? '⏳ Сохраняю...' : '✓ Сохранить'}
            </button>
            <button onClick={() => setOpen(false)} style={{ padding: '8px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer' }}>
              Отмена
            </button>
          </div>
        </>
      )}
      {error && (
        error === 'NOT_LOGGED_IN' ? (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b' }}>
            🔐 Войдите в <a href="/" target="_blank" rel="noopener noreferrer" style={{ color: '#fbbf24', textDecoration: 'underline' }}>SMM-менеджер</a>, чтобы сохранять видео в кампании.
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{error}</div>
        )
      )}
    </div>
  );
}

function SceneAudioPlayer({ projectId, sceneIndex }: { projectId: string; sceneIndex: number }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle() {
    if (unavailable) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
      return;
    }
    if (!audioRef.current) {
      setLoading(true);
      const audio = new Audio(`${API}/videos/${projectId}/audio/${sceneIndex}`);
      audioRef.current = audio;
      audio.addEventListener('ended', () => setPlaying(false));
      audio.addEventListener('error', () => { setLoading(false); setUnavailable(true); setPlaying(false); });
      audio.addEventListener('canplay', () => {
        setLoading(false);
        audio.play().then(() => setPlaying(true)).catch(() => { setUnavailable(true); setLoading(false); });
      }, { once: true });
      audio.load();
    } else {
      audioRef.current.currentTime = 0;
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
    }
  }

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  if (unavailable) return null;
  return (
    <button
      onClick={toggle}
      data-testid={`button-audio-${sceneIndex}`}
      style={{ marginTop: 8, padding: '4px 10px', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 4, background: playing ? 'rgba(167,139,250,0.15)' : 'transparent', color: '#c4b5fd', fontSize: 11, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: loading ? 0.6 : 1 }}
    >
      {loading ? '⏳ Загрузка...' : playing ? '⏹ Стоп' : '▶ Слушать'}
    </button>
  );
}

interface Scene {
  id: string;
  text: string;
  narration?: string;
  imagePrompt: string;
  motionPrompt?: string;
  backgroundPrompt?: string;
  subjectPrompt?: string;
  t2vPrompt?: string;
  duration: number;
  selectedVariant?: number;
  videoSource?: 'ai' | 'stock';
  stockAvailable?: boolean;
  stockPhotoAvailable?: boolean;
  stockQuery?: string;
}

interface VideoProject {
  id: string;
  title: string;
  topic: string;
  format: string;
  duration: number;
  language: string;
  animationModel: string;
  subtitleStyle: string;
  clipDuration?: number;
  status: string;
  progress: number;
  progressMessage: string;
  script?: { title: string; scenes: Scene[] };
  videoUrl?: string;
  error?: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Ожидание',
  generating_script: 'Генерация сценария...',
  script_ready: 'Сценарий готов',
  generating_images: 'Генерация изображений',
  animating: 'Анимация клипов',
  assembling: 'Рендеринг видео',
  done: 'Готово',
  error: 'Ошибка',
};

const STATUS_COLORS: Record<string, string> = {
  idle: 'var(--text-muted)',
  generating_script: 'var(--yellow)',
  script_ready: '#a78bfa',
  generating_images: 'var(--blue)',
  animating: '#60a5fa',
  assembling: 'var(--accent-light)',
  done: 'var(--green)',
  error: 'var(--red)',
};

const T2V_MODELS = ['wan-t2v', 'kling-t2v', 'kling-pro-t2v', 'luma', 'seedance-t2v', 'chain'];

// ── Component: image variant picker for I2V scenes ─────────────────────────
function SceneImageVariants({
  projectId,
  sceneIndex,
  sceneId,
  selectedVariant,
  onSelect,
  stockPhotoAvailable,
}: {
  projectId: string;
  sceneIndex: number;
  sceneId: string;
  selectedVariant?: number;
  onSelect: (variant: number) => void;
  stockPhotoAvailable?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamps, setStamps] = useState<number[]>([0, 0, 0, 0]);
  const [hasVariants, setHasVariants] = useState(false);
  const [checked, setChecked] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [hasCustom, setHasCustom] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Check if variants already exist on mount
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const [r0, r3] = await Promise.all([
          fetch(`${API}/videos/${projectId}/images/${sceneIndex}/0`, { method: 'HEAD' }).catch(() => null),
          fetch(`${API}/videos/${projectId}/images/${sceneIndex}/3`, { method: 'HEAD' }).catch(() => null),
        ]);
        if (!cancelled) {
          setHasVariants(r0?.ok === true);
          setHasCustom(r3?.ok === true);
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    }
    probe();
    return () => { cancelled = true; };
  }, [projectId, sceneIndex]);

  async function handleUploadFrame(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const reader = new FileReader();
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${API}/videos/${projectId}/scenes/${sceneIndex}/upload-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки');
      setHasCustom(true);
      setStamps((s) => { const n = [...s]; n[3] = Date.now(); return n; });
      onSelect(3);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function generate(isRegen = false) {
    setLoading(true);
    if (isRegen) setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`${API}/videos/${projectId}/scenes/${sceneIndex}/generate-variants`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Ошибка генерации');
      }
      setStamps([Date.now(), Date.now(), Date.now()]);
      setHasVariants(true);
      if (selectedVariant === undefined) onSelect(0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }

  if (!checked) return null;

  const showVariants = (hasVariants || hasCustom) && !regenerating;

  return (
    <div style={{ marginTop: 12 }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleUploadFrame}
      />

      {showVariants ? (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {/* AI variants 0–2 */}
            {[0, 1, 2].map((v) => {
              const isSelected = selectedVariant === v;
              return (
                <div
                  key={v}
                  onClick={() => onSelect(v)}
                  style={{ flex: 1, borderRadius: 6, border: isSelected ? '2.5px solid #7c3aed' : '2px solid var(--border)', overflow: 'hidden', cursor: 'pointer', position: 'relative', background: 'var(--bg-card2)', aspectRatio: '9/16', transition: 'border-color 0.15s' }}
                >
                  <img
                    src={`${API}/videos/${projectId}/images/${sceneIndex}/${v}?t=${stamps[v]}`}
                    alt={`Вариант ${v + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {isSelected && (
                    <div style={{ position: 'absolute', top: 4, right: 4, background: '#7c3aed', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'white', fontWeight: 700 }}>✓</div>
                  )}
                  {v === 0 && stockPhotoAvailable && (
                    <div style={{ position: 'absolute', top: 4, left: 4, background: '#0ea5e9', borderRadius: 3, fontSize: 9, color: 'white', padding: '1px 5px', fontWeight: 700 }}>📷</div>
                  )}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', fontSize: 10, color: 'white', textAlign: 'center', padding: '2px 0' }}>{v + 1}</div>
                </div>
              );
            })}
            {/* Custom upload slot (variant 3) */}
            <div
              style={{ flex: 1, borderRadius: 6, border: selectedVariant === 3 ? '2.5px solid #2563eb' : '2px dashed rgba(96,165,250,0.4)', overflow: 'hidden', cursor: uploading ? 'wait' : 'pointer', position: 'relative', background: 'var(--bg-card2)', aspectRatio: '9/16', transition: 'border-color 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              {hasCustom ? (
                <>
                  <img
                    src={`${API}/videos/${projectId}/images/${sceneIndex}/3?t=${stamps[3]}`}
                    alt="Свой кадр"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'absolute', inset: 0 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    onClick={(e) => { e.stopPropagation(); onSelect(3); }}
                  />
                  <div
                    style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.5)'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0)'; (e.currentTarget as HTMLElement).style.opacity = '0'; }}
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  >
                    <div style={{ fontSize: 18 }}>📤</div>
                    <div style={{ fontSize: 10, color: 'white', marginTop: 2 }}>Заменить</div>
                  </div>
                  {selectedVariant === 3 && (
                    <div style={{ position: 'absolute', top: 4, right: 4, background: '#2563eb', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'white', fontWeight: 700, zIndex: 2 }}>✓</div>
                  )}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', fontSize: 10, color: '#93c5fd', textAlign: 'center', padding: '2px 0', zIndex: 2 }}>📤</div>
                </>
              ) : uploading ? (
                <div style={{ fontSize: 18, opacity: 0.5 }}>⏳</div>
              ) : (
                <div style={{ textAlign: 'center', padding: 4 }}>
                  <div style={{ fontSize: 20, opacity: 0.5 }}>📤</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.2 }}>Свой кадр</div>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => generate(true)}
            disabled={loading}
            style={{ fontSize: 11, padding: '3px 10px', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 4, background: 'transparent', color: '#a78bfa', cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            🔄 Перегенерировать
          </button>
        </>
      ) : loading ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[0, 1, 2].map((v) => (
            <div key={v} style={{ flex: 1, borderRadius: 6, border: '2px solid var(--border)', background: 'var(--bg-card2)', aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 18, opacity: 0.4 }}>⏳</div>
            </div>
          ))}
          <div style={{ flexShrink: 0, fontSize: 12, color: '#a78bfa', opacity: 0.7 }}>Генерирую...</div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => generate(false)}
            style={{ padding: '5px 12px', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 4, background: 'transparent', color: '#a78bfa', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            🖼️ Сгенерировать кадры
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{ padding: '5px 12px', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 4, background: 'transparent', color: '#93c5fd', fontSize: 12, cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 5, opacity: uploading ? 0.6 : 1 }}
          >
            📤 Загрузить свой кадр
          </button>
        </div>
      )}
      {error && <div style={{ marginTop: 4, fontSize: 11, color: '#ef4444' }}>{error}</div>}
    </div>
  );
}


export default function VideoDetail({ id }: { id: string }) {
  const [project, setProject] = useState<VideoProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);
  const [topicExpanded, setTopicExpanded] = useState(false);
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editPromptText, setEditPromptText] = useState('');
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [editingStockQuery, setEditingStockQuery] = useState<string | null>(null); // sceneId
  const [stockQueryDraft, setStockQueryDraft] = useState('');
  const [retryingStock, setRetryingStock] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchProject() {
    try {
      const res = await fetch(`${API}/videos/${id}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setProject(data);
      // Stop polling on stable states (but keep polling if precheck still running)
      const prechecked = data.script?.stockPrechecked;
      if (['done', 'error'].includes(data.status) || (data.status === 'script_ready' && prechecked)) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    } catch {
      navigate('/');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProject();
    pollRef.current = setInterval(fetchProject, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  async function handleDelete() {
    if (!confirm('Удалить проект?')) return;
    setDeleting(true);
    await fetch(`${API}/videos/${id}`, { method: 'DELETE' });
    navigate('/');
  }

  async function handleStartGeneration() {
    setGenerating(true);
    const res = await fetch(`${API}/videos/${id}/generate`, { method: 'POST' });
    if (res.ok) {
      setProject((p) => p ? { ...p, status: 'generating_images', progress: 20 } : p);
      if (!pollRef.current) pollRef.current = setInterval(fetchProject, 3000);
    }
    setGenerating(false);
  }

  async function handleRegenerate() {
    const res = await fetch(`${API}/videos/${id}/generate`, { method: 'POST' });
    if (res.ok) {
      setProject((p) => p ? { ...p, status: 'generating_script', progress: 0 } : p);
      if (!pollRef.current) pollRef.current = setInterval(fetchProject, 3000);
    }
  }

  async function handleResume() {
    setResuming(true);
    const res = await fetch(`${API}/videos/${id}/resume`, { method: 'POST' });
    if (res.ok) {
      setProject((p) => p ? { ...p, status: 'assembling', progress: 78, progressMessage: 'Определяю с какого места продолжить...' } : p);
      if (!pollRef.current) pollRef.current = setInterval(fetchProject, 3000);
    } else {
      const json = await res.json().catch(() => ({}));
      alert(json.error || 'Не удалось продолжить');
    }
    setResuming(false);
  }

  const handleDownload = useCallback(async () => {
    if (!project?.videoUrl) return;
    setDownloading(true);
    setFileMissing(false);
    try {
      const res = await fetch(project.videoUrl);
      if (res.status === 404) {
        const json = await res.json().catch(() => ({}));
        if (json.missing) { setFileMissing(true); return; }
      }
      if (!res.ok) throw new Error('Ошибка загрузки');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${project.title || 'video'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (e) {
      alert('Не удалось скачать видео. Попробуйте ещё раз.');
    } finally {
      setDownloading(false);
    }
  }, [project]);

  const handleResetAndRegenerate = useCallback(async () => {
    if (!project) return;
    await fetch(`${API}/videos/${project.id}/reset`, { method: 'POST' });
    await fetchProject();
    if (!pollRef.current) pollRef.current = setInterval(fetchProject, 3000);
  }, [project]);

  async function handleRegenerateScript() {
    if (!confirm('Сгенерировать сценарий заново? Текущий будет заменён.')) return;
    await fetch(`${API}/videos/${id}/generate-script`, { method: 'POST' });
    setProject((p) => p ? { ...p, status: 'generating_script', progress: 5 } : p);
    if (!pollRef.current) pollRef.current = setInterval(fetchProject, 3000);
  }

  async function handleRetryStock(sceneId: string, sceneIndex: number, query: string) {
    setRetryingStock((s) => new Set(s).add(sceneId));
    setEditingStockQuery(null);
    try {
      const res = await fetch(`${API}/videos/${id}/scenes/${sceneIndex}/stock-retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockQuery: query }),
      });
      const data = await res.json();
      setProject((p) => {
        if (!p?.script) return p;
        const scenes = p.script.scenes.map((s, i) =>
          i === sceneIndex
            ? { ...s, stockQuery: query, stockAvailable: data.available, videoSource: data.videoSource }
            : s
        );
        return { ...p, script: { ...p.script, scenes } };
      });
    } catch {}
    setRetryingStock((s) => { const n = new Set(s); n.delete(sceneId); return n; });
  }

  async function handleSetVideoSource(sceneId: string, videoSource: 'ai' | 'stock' | 'stock-animated') {
    const body: Record<string, any> = { videoSource };
    if (videoSource === 'stock-animated') body.selectedVariant = 0;
    await fetch(`${API}/videos/${id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setProject((p) => {
      if (!p?.script) return p;
      const scenes = p.script.scenes.map((s) =>
        s.id === sceneId
          ? { ...s, videoSource, ...(videoSource === 'stock-animated' ? { selectedVariant: 0 } : {}) }
          : s
      );
      return { ...p, script: { ...p.script, scenes } };
    });
  }

  async function handleSaveScene(sceneId: string) {
    await fetch(`${API}/videos/${id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editText }),
    });
    setProject((p) => {
      if (!p?.script) return p;
      const scenes = p.script.scenes.map((s) => s.id === sceneId ? { ...s, text: editText } : s);
      return { ...p, script: { ...p.script, scenes } };
    });
    setEditingScene(null);
  }

  async function handleSavePrompt(sceneId: string, field: 't2vPrompt' | 'imagePrompt') {
    await fetch(`${API}/videos/${id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: project!.script!.scenes.find(s => s.id === sceneId)!.text, [field]: editPromptText }),
    });
    setProject((p) => {
      if (!p?.script) return p;
      const scenes = p.script.scenes.map((s) => s.id === sceneId ? { ...s, [field]: editPromptText } : s);
      return { ...p, script: { ...p.script, scenes } };
    });
    setEditingPrompt(null);
  }

  function togglePrompt(sceneId: string) {
    setExpandedPrompts((prev) => {
      const next = new Set(prev);
      next.has(sceneId) ? next.delete(sceneId) : next.add(sceneId);
      return next;
    });
  }

  async function handleSelectVariant(sceneId: string, variant: number) {
    await fetch(`${API}/videos/${id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedVariant: variant }),
    });
    setProject((p) => {
      if (!p?.script) return p;
      const scenes = p.script.scenes.map((s) => s.id === sceneId ? { ...s, selectedVariant: variant } : s);
      return { ...p, script: { ...p.script, scenes } };
    });
  }

  if (loading) return <LoadingSpinner />;
  if (!project) return null;

  const isActive = ['generating_script', 'generating_images', 'animating', 'assembling'].includes(project.status);
  const isScriptReady = project.status === 'script_ready';
  const isDone = project.status === 'done';
  const isError = project.status === 'error';
  const isT2V = T2V_MODELS.includes(project.animationModel);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <button
        onClick={() => navigate('/')}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 14, marginBottom: 16, cursor: 'pointer' }}
      >
        ← Назад к проектам
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>{project.title}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>
            {(() => {
              const TRUNC = 120;
              const topic = project.topic || '';
              const needsTrunc = topic.length > TRUNC;
              return (
                <>
                  {topicExpanded || !needsTrunc ? topic : topic.slice(0, TRUNC)}
                  {needsTrunc && !topicExpanded && (
                    <button onClick={() => setTopicExpanded(true)} style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: 13, cursor: 'pointer', padding: '0 3px' }}>
                      ...ещё
                    </button>
                  )}
                  {needsTrunc && topicExpanded && (
                    <button onClick={() => setTopicExpanded(false)} style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: 13, cursor: 'pointer', padding: '0 3px' }}>
                      {' '}скрыть
                    </button>
                  )}
                </>
              );
            })()}
            {' '}· {project.format} · {project.duration}с · {project.language === 'ru' ? 'Русский' : 'English'}
            {project.animationModel === 'chain' ? ' · Chain' : isT2V ? ' · T2V' : ' · I2V'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isError && (
            <>
              <button
                onClick={handleResume}
                disabled={resuming}
                data-testid="button-resume"
                style={btnStyle(resuming ? '#1e3a5f' : '#1d4ed8')}
                title="Продолжить с того места, где остановились"
              >
                {resuming ? '⏳ Продолжаем...' : '▶ Продолжить'}
              </button>
              <button onClick={handleRegenerate} style={btnStyle('var(--accent)')}>
                🔄 Заново
              </button>
            </>
          )}
          <button onClick={handleDelete} disabled={deleting || isActive} style={btnStyle('#7f1d1d')}>
            🗑️ Удалить
          </button>
        </div>
      </div>

      {/* Status card */}
      <div style={{ background: 'var(--bg-card)', border: `1px solid ${isScriptReady ? 'rgba(167,139,250,0.3)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isActive ? 16 : 0 }}>
          <span style={{ fontSize: 22 }}>
            {isDone ? '✅' : isError ? '❌' : isScriptReady ? '📋' : isActive ? '⏳' : '🕐'}
          </span>
          <div>
            <div style={{ fontWeight: 600, color: STATUS_COLORS[project.status] }}>
              {STATUS_LABELS[project.status] || project.status}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {project.progressMessage}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 700, color: STATUS_COLORS[project.status] }}>
            {project.progress}%
          </div>
        </div>

        {isActive && (
          <div style={{ background: 'var(--bg-card2)', borderRadius: 999, height: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${project.progress}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width 0.5s ease' }} />
          </div>
        )}

        {isError && project.error && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#2d0a0a', borderRadius: 'var(--radius-sm)', color: '#fca5a5', fontSize: 13 }}>
            {project.error}
          </div>
        )}
      </div>

      {/* Video player */}
      {isDone && project.videoUrl && !fileMissing && (
        <div style={{ marginBottom: 24 }}>
          <video
            key={project.videoUrl}
            controls
            playsInline
            style={{
              width: '100%',
              maxHeight: 540,
              borderRadius: 'var(--radius)',
              background: '#000',
              display: 'block',
            }}
          >
            <source src={project.videoUrl} type="video/mp4" />
          </video>
        </div>
      )}

      {/* Download button */}
      {isDone && project.videoUrl && (
        <div style={{ background: fileMissing ? 'rgba(127,29,29,0.2)' : 'var(--bg-card)', border: `1px solid ${fileMissing ? '#7f1d1d' : '#1a3a1a'}`, borderRadius: 'var(--radius)', padding: 20, marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            {fileMissing ? (
              <>
                <div style={{ fontWeight: 600, color: 'var(--red)' }}>⚠️ Файл видео не найден</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Среда была перезапущена и файл потерян. Нажмите «Перегенерировать» — сценарий сохранён.</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 600, color: 'var(--green)' }}>🎬 Видео готово!</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Нажмите кнопку для скачивания MP4</div>
              </>
            )}
          </div>
          {fileMissing ? (
            <button
              onClick={handleResetAndRegenerate}
              data-testid="button-regenerate"
              style={{ padding: '10px 24px', borderRadius: 'var(--radius-sm)', background: '#7c3aed', color: 'white', fontWeight: 600, fontSize: 15, border: 'none', cursor: 'pointer' }}
            >
              🔄 Перегенерировать
            </button>
          ) : (
            <button
              onClick={handleDownload}
              disabled={downloading}
              data-testid="button-download"
              style={{ padding: '10px 24px', borderRadius: 'var(--radius-sm)', background: downloading ? '#166534' : 'var(--green)', color: 'white', fontWeight: 600, fontSize: 15, border: 'none', cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.7 : 1 }}
            >
              {downloading ? '⏳ Загрузка...' : '⬇️ Скачать MP4'}
            </button>
          )}
        </div>
      )}

      {/* Save to SMM campaign — show whenever video is done, regardless of local file */}
      {isDone && project.videoUrl && (
        <SaveToCampaign projectId={project.id} projectTitle={project.title} />
      )}

      {/* ── SCRIPT REVIEW (script_ready state) ─────────────────────────────── */}
      {isScriptReady && project.script && (
        <div style={{ background: 'rgba(167,139,250,0.06)', border: '1.5px solid rgba(167,139,250,0.3)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#c4b5fd' }}>📋 Проверьте сценарий</div>
            <button
              onClick={handleRegenerateScript}
              style={{ fontSize: 12, padding: '4px 12px', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: '#a78bfa', cursor: 'pointer' }}
            >
              🔄 Перегенерировать
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
            AI сгенерировал сценарий. Вы можете отредактировать текст субтитров в каждой сцене. Когда всё готово — нажмите «Генерировать видео».
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {project.script.scenes.map((scene, i) => (
              <div
                key={scene.id}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' }}
              >
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, color: 'white' }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    {editingScene === scene.id ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          autoFocus
                          style={{ flex: 1, background: 'var(--bg-card2)', border: '1.5px solid #7c3aed', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '6px 10px', fontSize: 14, outline: 'none' }}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveScene(scene.id); if (e.key === 'Escape') setEditingScene(null); }}
                        />
                        <button onClick={() => handleSaveScene(scene.id)} style={{ padding: '6px 12px', border: 'none', borderRadius: 'var(--radius-sm)', background: '#7c3aed', color: 'white', fontSize: 12, cursor: 'pointer' }}>✓</button>
                        <button onClick={() => setEditingScene(null)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{scene.text}</span>
                        <button
                          onClick={() => { setEditingScene(scene.id); setEditText(scene.text); }}
                          style={{ padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {project.clipDuration ?? scene.duration}с
                        {(project.animationModel === 'chain' ? i === 0 : !!scene.t2vPrompt)
                          ? <span style={{ marginLeft: 8, color: '#86efac' }}>T2V</span>
                          : <span style={{ marginLeft: 8, color: '#93c5fd' }}>I2V</span>}
                      </div>
                      {/* Source toggle */}
                      {(() => {
                        const prechecked = (project.script as any)?.stockPrechecked;
                        const checking = !prechecked && scene.videoSource === 'stock' && (scene as any).stockAvailable === undefined;
                        const available = (scene as any).stockAvailable as boolean | undefined;
                        const stockColor = scene.videoSource === 'stock'
                          ? (available === false ? '#ef4444' : '#0ea5e9')
                          : 'transparent';
                        const stockLabel = checking
                          ? '⏳ Stock'
                          : available === true
                            ? '✅ Stock'
                            : available === false
                              ? '❌ Stock'
                              : '📹 Stock';
                        const stockTitle = checking
                          ? 'Проверяю наличие в Pexels...'
                          : available === true
                            ? 'Клип найден в Pexels ✓'
                            : available === false
                              ? 'Клип не найден в Pexels — переключитесь на AI'
                              : 'Стоковое видео (Pexels)';
                        const photoAvailable = (scene as any).stockPhotoAvailable as boolean | undefined;
                        const isAnimated = scene.videoSource === 'stock-animated';
                        return (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => handleSetVideoSource(scene.id, 'ai')}
                              title="Генерировать через AI (FAL/Imagen)"
                              style={{
                                padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                                background: (!scene.videoSource || scene.videoSource === 'ai') ? '#7c3aed' : 'transparent',
                                color: (!scene.videoSource || scene.videoSource === 'ai') ? 'white' : 'var(--text-muted)',
                                border: (!scene.videoSource || scene.videoSource === 'ai') ? 'none' : '1px solid var(--border)',
                              }}
                            >🤖 AI</button>
                            <button
                              onClick={() => handleSetVideoSource(scene.id, 'stock')}
                              title={stockTitle}
                              style={{
                                padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                                background: scene.videoSource === 'stock' ? stockColor : 'transparent',
                                color: scene.videoSource === 'stock' ? 'white' : available === true ? '#38bdf8' : available === false ? '#fca5a5' : 'var(--text-muted)',
                                border: scene.videoSource === 'stock' ? 'none' : available === true ? '1px solid #38bdf8' : available === false ? '1px solid #fca5a5' : '1px solid var(--border)',
                              }}
                            >{stockLabel}</button>
                            {photoAvailable && (
                              <button
                                onClick={() => handleSetVideoSource(scene.id, 'stock-animated')}
                                title="Стоковое фото → анимировать через FAL.AI (I2V)"
                                style={{
                                  padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                                  background: isAnimated ? '#0f766e' : 'transparent',
                                  color: isAnimated ? 'white' : '#34d399',
                                  border: isAnimated ? 'none' : '1px solid #34d399',
                                }}
                              >🎞️ Анимировать фото</button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    {scene.videoSource === 'stock-animated' && (scene as any).stockPhotoAvailable && (
                      <div style={{ marginTop: 6 }}>
                        <img
                          src={`${API}/videos/${id}/images/${i}/0`}
                          alt=""
                          style={{ width: '100%', borderRadius: 6, maxHeight: 180, objectFit: 'cover', display: 'block' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <div style={{ marginTop: 4, fontSize: 11, color: '#34d399', opacity: 0.85 }}>
                          🎞️ Pexels фото → будет анимировано через FAL.AI: <em>{((scene as any).stockQuery || scene.imagePrompt || '').slice(0, 70)}</em>
                        </div>
                      </div>
                    )}
                    {(scene.videoSource === 'stock' || (scene as any).stockAvailable === false) && (() => {
                      const available = (scene as any).stockAvailable as boolean | undefined;
                      if (available === false) {
                        return (
                          <div style={{ marginTop: 6, fontSize: 11, color: '#fca5a5', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, padding: '5px 8px' }}>
                            ❌ Не найдено в Pexels — сцена будет сгенерирована через AI
                          </div>
                        );
                      }
                      return (
                        <div style={{ marginTop: 6 }}>
                          <video
                            src={`${API}/videos/${id}/clips/${i}`}
                            style={{ width: '100%', borderRadius: 6, maxHeight: 180, background: '#000', display: 'block' }}
                            controls
                            muted
                            playsInline
                            preload="metadata"
                          />
                          <div style={{ marginTop: 4, fontSize: 11, color: '#7dd3fc', opacity: 0.7 }}>
                            ✅ Pexels: <em>{((scene as any).stockQuery || scene.imagePrompt || '').slice(0, 70)}</em>
                          </div>
                        </div>
                      );
                    })()}
                    {scene.narration && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, borderLeft: '2px solid rgba(167,139,250,0.3)', paddingLeft: 8 }}>
                        {scene.narration}
                      </div>
                    )}
                    {/* ── Prompt inline (truncated, expandable) ── */}
                    {(() => {
                      const isT2VScene = project.animationModel === 'chain' ? i === 0 : !!scene.t2vPrompt;
                      const promptField: 't2vPrompt' | 'imagePrompt' = isT2VScene ? 't2vPrompt' : 'imagePrompt';
                      const promptValue = isT2VScene ? (scene.t2vPrompt || '') : (scene.imagePrompt || '');
                      const isExpanded = expandedPrompts.has(scene.id);
                      const isEditingThisPrompt = editingPrompt === scene.id;
                      const TRUNC = 110;
                      const needsTrunc = promptValue.length > TRUNC;
                      return (
                        <>
                          <div style={{ marginTop: 8 }}>
                            {isEditingThisPrompt ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <textarea
                                  value={editPromptText}
                                  onChange={(e) => setEditPromptText(e.target.value)}
                                  autoFocus
                                  rows={5}
                                  style={{ width: '100%', background: 'var(--bg-card2)', border: '1.5px solid #7c3aed', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '8px 10px', fontSize: 12, lineHeight: 1.6, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                                />
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button onClick={() => handleSavePrompt(scene.id, promptField)} style={{ padding: '5px 14px', border: 'none', borderRadius: 'var(--radius-sm)', background: '#7c3aed', color: 'white', fontSize: 12, cursor: 'pointer' }}>✓ Сохранить</button>
                                  <button onClick={() => setEditingPrompt(null)} style={{ padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>✕</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, wordBreak: 'break-word' }}>
                                <span style={{ color: isT2VScene ? '#86efac' : '#93c5fd', fontWeight: 600, marginRight: 4 }}>
                                  {isT2VScene ? 'T2V:' : 'Промпт:'}
                                </span>
                                {promptValue ? (
                                  <>
                                    {(isExpanded || !needsTrunc) ? promptValue : promptValue.slice(0, TRUNC)}
                                    {needsTrunc && !isExpanded && (
                                      <button onClick={() => togglePrompt(scene.id)} style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: 11, cursor: 'pointer', padding: '0 3px' }}>
                                        ...ещё
                                      </button>
                                    )}
                                    {needsTrunc && isExpanded && (
                                      <button onClick={() => togglePrompt(scene.id)} style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: 11, cursor: 'pointer', padding: '0 3px' }}>
                                        {' '}скрыть
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ color: '#6b7280', fontStyle: 'italic' }}>пусто</span>
                                )}
                                <button
                                  onClick={() => { setEditingPrompt(scene.id); setEditPromptText(promptValue); }}
                                  style={{ marginLeft: 5, padding: '1px 6px', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 3, background: 'rgba(124,58,237,0.1)', color: '#c4b5fd', fontSize: 10, cursor: 'pointer' }}
                                >✏️</button>
                              </div>
                            )}
                          </div>
                          {/* Image variants — only for I2V scenes */}
                          {!isT2VScene && (
                            <SceneImageVariants
                              projectId={project.id}
                              sceneIndex={i}
                              sceneId={scene.id}
                              selectedVariant={scene.selectedVariant}
                              onSelect={(v) => handleSelectVariant(scene.id, v)}
                              stockPhotoAvailable={scene.stockPhotoAvailable}
                            />
                          )}
                        </>
                      );
                    })()}
                    <SceneAudioPlayer projectId={project.id} sceneIndex={i} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleStartGeneration}
            disabled={generating}
            data-testid="button-start-generation"
            style={{ width: '100%', padding: '14px', borderRadius: 'var(--radius)', border: 'none', background: generating ? '#4c1d95' : '#7c3aed', color: 'white', fontSize: 16, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1 }}
          >
            {generating ? '⏳ Запускаем...' : `🚀 Генерировать видео (${project.animationModel === 'chain' ? 'Chain T2V→I2V' : isT2V ? 'T2V' : 'I2V'})`}
          </button>
        </div>
      )}

      {/* Script display (after generation / during) */}
      {project.script && !isScriptReady && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
            📝 Скрипт: {project.script.title}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {project.script.scenes.map((scene, i) => {
              const isT2VScene = project.animationModel === 'chain' ? i === 0 : !!scene.t2vPrompt;
              const hasImage = !isT2VScene && typeof scene.selectedVariant === 'number';
              return (
                <div
                  key={scene.id}
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', display: 'flex', gap: 14 }}
                >
                  {/* Selected image or stock clip thumbnail */}
                  {scene.videoSource === 'stock' && scene.stockAvailable ? (
                    <div style={{ width: 80, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: '#000', alignSelf: 'flex-start' }}>
                      <video
                        src={`${API}/videos/${project.id}/clips/${i}`}
                        style={{ width: '100%', display: 'block' }}
                        muted
                        playsInline
                        preload="metadata"
                        controls
                      />
                    </div>
                  ) : hasImage && (
                    <div style={{ width: 54, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-card2)', aspectRatio: '9/16', alignSelf: 'flex-start' }}>
                      <img
                        src={`${API}/videos/${project.id}/images/${i}/${scene.selectedVariant}`}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                  )}
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{scene.text}</div>
                    {(scene.narration || scene.text) && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5, borderLeft: '2px solid rgba(167,139,250,0.3)', paddingLeft: 8 }}>
                        {scene.narration || scene.text}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                      {project.clipDuration ?? scene.duration}с
                      {isT2VScene
                        ? <span style={{ marginLeft: 8, color: '#86efac' }}>T2V</span>
                        : <span style={{ marginLeft: 8, color: '#93c5fd' }}>I2V</span>}
                    </div>
                    <SceneAudioPlayer projectId={project.id} sceneIndex={i} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return { padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', background: bg, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
}

function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <div style={{ color: 'var(--text-muted)' }}>Загрузка...</div>
    </div>
  );
}
