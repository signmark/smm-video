import { useState, useEffect } from 'react';
import { navigate } from '../App';
import { API } from '../api';
import { Search, Filter, SortAsc, SortDesc, Trash2, Clock, Smartphone, Monitor, Square, Play, RotateCcw, AlertTriangle, Film, Loader2, X } from 'lucide-react';
import {
  filterAndSortProjects,
  isRunningStatus,
  STATUS_FILTER_OPTIONS,
  SORT_OPTIONS,
  type StatusFilter,
  type SortOrder,
  type ProjectForFilter,
} from '../lib/project-filter';
import { getStepStates, getErrorStep, PIPELINE_STEPS } from '../lib/progress-steps';

interface VideoProject extends ProjectForFilter {
  progress: number;
  progressMessage: string;
  error?: string;
  duration: number;
  language: string;
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

function FormatIcon({ format }: { format: string }) {
  if (format === '9:16') return <Smartphone size={16} style={{ color: 'var(--text-muted)' }} />;
  if (format === '16:9') return <Monitor size={16} style={{ color: 'var(--text-muted)' }} />;
  return <Square size={16} style={{ color: 'var(--text-muted)' }} />;
}

export default function Home() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      isRunningStatus(p.status)
    );
    if (hasActive) {
      const id = setInterval(fetchProjects, 4000);
      return () => clearInterval(id);
    }
  }, [projects.map((p) => p.status).join(',')]);

  const filtered = filterAndSortProjects(projects, search, statusFilter, sortOrder);

  async function handleDelete(id: string) {
    if (!confirm('Удалить проект? Это действие нельзя отменить.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/videos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
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

      {/* Search, filter, sort — always visible */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            data-testid="input-search"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px 8px 32px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text)', fontSize: 14, outline: 'none',
            }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          data-testid="select-status-filter"
          style={{
            padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', background: 'var(--bg-card)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer',
          }}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          data-testid="select-sort"
          style={{
            padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', background: 'var(--bg-card)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer',
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map((p) => (
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
              onDelete={() => handleDelete(p.id)}
              deleting={deletingId === p.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getExpiryLabel(createdAt: string): { label: string; urgent: boolean } | null {
  const RETENTION_DAYS = 3;
  const age = Date.now() - new Date(createdAt).getTime();
  const msRemaining = RETENTION_DAYS * 24 * 60 * 60 * 1000 - age;
  if (msRemaining <= 0) return null;
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  if (daysRemaining === 1) return { label: 'удалится завтра', urgent: true };
  return { label: `${daysRemaining} дн.`, urgent: false };
}

function ProjectCard({ project: p, onClick, onResume, onRestart, onDelete, deleting }: {
  project: VideoProject;
  onClick: () => void;
  onResume: () => void;
  onRestart: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isActive = isRunningStatus(p.status);
  const isError = p.status === 'error';
  const isDone = p.status === 'done';
  const expiry = isDone ? getExpiryLabel(p.createdAt) : null;

  // For active projects, show current step from progress-steps
  let activeStepLabel = '';
  if (isActive) {
    const steps = getStepStates(p.status, p.progress);
    const current = steps.find((s) => s.state === 'current');
    if (current) activeStepLabel = current.label;
  }

  // For error projects, show which step failed
  let errorStepLabel = '';
  if (isError) {
    const errorStep = getErrorStep(p.progress);
    if (errorStep >= 0 && errorStep < PIPELINE_STEPS.length) {
      errorStepLabel = PIPELINE_STEPS[errorStep].label;
    }
  }

  return (
    <div
      onClick={onClick}
      data-testid={`card-project-${p.id}`}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${isError ? '#ef444466' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(139,92,246,0.1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = isError ? '#ef444466' : 'var(--border)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      {/* Thumbnail / status placeholder */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: 'var(--bg-card2)' }}>
        {isDone ? (
          <>
            <img
              src={`${API}/videos/${p.id}/thumbnail`}
              alt=""
              loading="lazy"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = (e.target as HTMLImageElement).parentElement?.querySelector('.thumb-fallback');
                if (fallback) (fallback as HTMLElement).style.display = 'flex';
              }}
            />
            <div className="thumb-fallback" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'none', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card2)' }}>
              <Film size={24} style={{ color: 'var(--text-muted)' }} />
            </div>
          </>
        ) : (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {isActive && (
              <>
                <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{activeStepLabel}</span>
              </>
            )}
            {isError && (
              <>
                <AlertTriangle size={24} style={{ color: '#ef4444' }} />
                <span style={{ fontSize: 12, color: '#ef4444' }}>{errorStepLabel || 'Ошибка'}</span>
              </>
            )}
            {!isActive && !isError && (
              <Film size={24} style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
        )}
        {/* Format badge */}
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
          <FormatIcon format={p.format} />
          <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>{p.format}</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.topic?.split(/[.!?]\s+/).slice(0, 2).join('. ').slice(0, 80)}
        </div>

        {/* Status + metadata row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: STATUS_COLOR[p.status] + '22',
              color: STATUS_COLOR[p.status],
              border: `1px solid ${STATUS_COLOR[p.status]}44`,
            }}
          >
            {STATUS_LABEL[p.status] || p.status}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {p.duration}с
          </span>
          {expiry && (
            <span style={{ fontSize: 11, color: expiry.urgent ? '#f87171' : '#6b7280', display: 'flex', alignItems: 'center', gap: 3 }} title="Видеофайл автоматически удаляется через 3 дня после создания.">
              <Trash2 size={10} /> {expiry.label}
            </span>
          )}
        </div>

        {/* Actions row */}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
          {isError && (
            <>
              <button
                data-testid={`button-resume-${p.id}`}
                onClick={onResume}
                title="Продолжить с того места, где остановилось"
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: 'none', background: '#1d4ed8', color: '#fff', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Play size={10} /> Продолжить
              </button>
              <button
                data-testid={`button-restart-${p.id}`}
                onClick={onRestart}
                title="Начать генерацию заново"
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: 'none', background: '#4c1d95', color: '#fff', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <RotateCcw size={10} /> Заново
              </button>
            </>
          )}
          <button
            data-testid={`button-delete-${p.id}`}
            onClick={onDelete}
            disabled={deleting}
            title="Удалить проект"
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: '#ef4444', cursor: deleting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}
          >
            <Trash2 size={10} /> {deleting ? '...' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div className="animate-pulse" style={{ width: '100%', paddingTop: '56.25%', background: 'var(--bg-card2)' }} />
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="animate-pulse" style={{ height: 14, width: '70%', background: 'var(--bg-card2)', borderRadius: 4 }} />
            <div className="animate-pulse" style={{ height: 12, width: '50%', background: 'var(--bg-card2)', borderRadius: 4 }} />
            <div className="animate-pulse" style={{ height: 20, width: '30%', background: 'var(--bg-card2)', borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      <div
        style={{
          gridColumn: '1 / -1',
          textAlign: 'center',
          padding: '80px 20px',
          color: 'var(--text-muted)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <Film size={64} style={{ color: 'var(--text-muted)' }} />
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
    </div>
  );
}
