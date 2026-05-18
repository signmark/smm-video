import { useState, useEffect } from 'react';
import { navigate } from '../App';
import { API } from '../api';

interface VideoProject {
  id: string;
  title: string;
  topic: string;
  format: string;
  duration: number;
  language: string;
  status: string;
  progress: number;
  progressMessage: string;
  error?: string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Ожидание',
  generating_script: 'Скрипт...',
  generating_images: 'Изображения...',
  assembling: 'Рендер...',
  done: 'Готово',
  error: 'Ошибка',
};

const STATUS_COLOR: Record<string, string> = {
  idle: '#555',
  generating_script: '#f59e0b',
  generating_images: '#3b82f6',
  assembling: '#a78bfa',
  done: '#22c55e',
  error: '#ef4444',
};

const FORMAT_ICON: Record<string, string> = {
  '9:16': '📱',
  '16:9': '🖥️',
  '1:1': '⬜',
};

export default function Home() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchProjects() {
    try {
      const res = await fetch(`${API}/videos`);
      if (res.ok) setProjects(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProjects();
    const hasActive = projects.some((p) =>
      ['generating_script', 'generating_images', 'assembling'].includes(p.status)
    );
    if (hasActive) {
      const id = setInterval(fetchProjects, 4000);
      return () => clearInterval(id);
    }
  }, [projects.map((p) => p.status).join(',')]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80, color: 'var(--text-muted)' }}>
        Загрузка...
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>Мои видео</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
            Генерация Shorts, Reels, TikTok и других форматов
          </p>
        </div>
        <button
          onClick={() => navigate('/create')}
          data-testid="button-create"
          style={{
            padding: '10px 20px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--accent)',
            color: 'white',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Создать
        </button>
      </div>

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onClick={() => navigate(`/video/${p.id}`)}
              onResume={async () => {
                await fetch(`${API}/videos/${p.id}/resume`, { method: 'POST' });
                fetchProjects();
                navigate(`/video/${p.id}`);
              }}
              onRestart={async () => {
                await fetch(`${API}/videos/${p.id}/reset`, { method: 'POST' });
                fetchProjects();
                navigate(`/video/${p.id}`);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project: p, onClick, onResume, onRestart }: { project: VideoProject; onClick: () => void; onResume: () => void; onRestart: () => void }) {
  const isActive = ['generating_script', 'generating_images', 'assembling'].includes(p.status);
  const isError = p.status === 'error';

  return (
    <div
      onClick={onClick}
      data-testid={`card-project-${p.id}`}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${isError ? '#ef444466' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '16px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = isError ? '#ef444466' : 'var(--border)')}
    >
      <div style={{ fontSize: 28, flexShrink: 0 }}>{FORMAT_ICON[p.format] || '🎬'}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.topic?.split(/[.!?]\s+/).slice(0, 2).join('. ').slice(0, 120)}
        </div>
        {isActive && (
          <div style={{ marginTop: 8 }}>
            <div style={{ background: 'var(--bg-card2)', borderRadius: 999, height: 4, overflow: 'hidden', width: 200 }}>
              <div
                style={{
                  height: '100%',
                  width: `${p.progress}%`,
                  background: 'var(--accent)',
                  borderRadius: 999,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              {p.progressMessage}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        <span
          style={{
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: STATUS_COLOR[p.status] + '22',
            color: STATUS_COLOR[p.status],
            border: `1px solid ${STATUS_COLOR[p.status]}44`,
          }}
        >
          {STATUS_LABEL[p.status] || p.status}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {p.format} · {p.duration}с
        </span>
        {isError && (
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
            <button
              data-testid={`button-resume-${p.id}`}
              onClick={onResume}
              title="Продолжить с того места, где остановилось"
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              ▶ Продолжить
            </button>
            <button
              data-testid={`button-restart-${p.id}`}
              onClick={onRestart}
              title="Начать генерацию заново"
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#4c1d95', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
            >
              🔄 Заново
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '80px 20px',
        color: 'var(--text-muted)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 64 }}>🎬</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          Ещё нет видео
        </div>
        <p style={{ fontSize: 14, maxWidth: 360, lineHeight: 1.6 }}>
          Создайте первое видео — AI сгенерирует скрипт, изображения и соберёт MP4
        </p>
      </div>
      <button
        onClick={() => navigate('/create')}
        style={{
          padding: '12px 28px',
          borderRadius: 'var(--radius)',
          border: 'none',
          background: 'var(--accent)',
          color: 'white',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          marginTop: 8,
        }}
      >
        + Создать первое видео
      </button>
    </div>
  );
}
