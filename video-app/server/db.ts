import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '../data');

export interface Scene {
  id: string;
  text: string;       // short subtitle shown on screen (max 8 words)
  narration?: string; // full voiceover text sized to fill the clip duration
  imagePrompt: string;
  motionPrompt?: string;     // I2V: what moves and how — passed to FAL as animation prompt
  backgroundPrompt?: string; // layer 1: background/environment only (no subject)
  subjectPrompt?: string;    // layer 2: subject on white background (product/person)
  endImagePrompt?: string;   // Kling only: final state of the scene (tail_image_url)
  t2vPrompt?: string;
  imagePath?: string;
  duration: number;
  videoSource?: 'ai' | 'stock' | 'stock-animated'; // 'ai' = generate via FAL/Imagen (default), 'stock' = Pexels stock clip, 'stock-animated' = Pexels photo animated via FAL
  stockQuery?: string;          // custom search query for Pexels (defaults to imagePrompt)
  stockAvailable?: boolean;     // set by precheck: true = clip found & downloaded, false = not found
  stockPhotoAvailable?: boolean; // set by precheck: true = Pexels photo found, saved as variant 0
}

export interface Script {
  title: string;
  consistencyBlock?: string;
  stockPrechecked?: boolean; // true after runStockPrecheck has finished
  scenes: Scene[];
}

export type VideoFormat = '9:16' | '16:9' | '1:1';

export type SubtitleStyle = 'none' | 'plain' | 'fade' | 'karaoke' | 'tiktok' | 'word-by-word' | 'cinematic' | 'cinematic-full' | 'bar';

// I2V = image-to-video, T2V = text-to-video
export type AnimationModel =
  | 'wan'          // Wan 2.7 I2V
  | 'kling'        // Kling v1.6 Standard I2V
  | 'kling-pro'    // Kling v1.6 Pro I2V
  | 'minimax'      // MiniMax I2V
  | 'seedance'     // Seedance v1 Lite I2V
  | 'wan-t2v'      // Wan 2.7 Text-to-Video
  | 'kling-t2v'    // Kling v3 Standard Text-to-Video
  | 'kling-pro-t2v'// Kling v3 Pro Text-to-Video
  | 'luma'         // Luma Dream Machine Ray 2 Flash T2V
  | 'seedance-t2v' // Seedance 1 Lite Text-to-Video
  | 'seedance2-t2v'// Seedance 2.0 Text-to-Video
  | 'veo3'         // Google Veo 3.1 T2V
  | 'happy-horse'  // Alibaba Happy Horse T2V
  | 'chain';       // Chain: Kling T2V (сцена 1) → Kling I2V (сцены 2+)

export type VideoStatus =
  | 'idle'
  | 'generating_script'
  | 'script_ready'
  | 'generating_images'
  | 'animating'
  | 'assembling'
  | 'done'
  | 'error';

export interface VideoProject {
  id: string;
  title: string;
  topic: string;
  format: VideoFormat;
  duration: number;
  language: 'ru' | 'en';
  animationModel: AnimationModel;
  subtitleStyle: SubtitleStyle;
  voice?: string;
  clipDuration?: 5 | 10;
  subtitleFont?: string;
  subtitleSize?: string;
  subtitleColor?: string;
  musicStyle?: string;
  status: VideoStatus;
  progress: number;
  progressMessage: string;
  script?: Script;
  customScenario?: string;
  landingUrl?: string;
  additionalDetails?: string;
  videoPath?: string;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Directus backend ──────────────────────────────────────────────────────────

function getDirectusConfig(): { baseUrl: string; token: string } | null {
  const isReplitDev = !!process.env.REPL_ID && !process.env.REPLIT_DEPLOYMENT;

  const baseUrl = isReplitDev
    ? 'https://directus.roboflow.space'
    : (process.env.DIRECTUS_URL || 'https://directus.nplanner.ru');

  const token = isReplitDev
    ? (process.env.DIRECTUS_DEV_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN)
    : (process.env.DIRECTUS_PROD_TOKEN || process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN);

  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

async function directusFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const cfg = getDirectusConfig();
  if (!cfg) throw new Error('Directus not configured');
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      ...(options.headers as Record<string, string>),
    },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || JSON.stringify(json);
    throw new Error(`Directus ${res.status}: ${msg}`);
  }
  return json;
}

function projectToDirectus(p: Partial<VideoProject>): Record<string, any> {
  const d: Record<string, any> = {};
  if (p.id !== undefined) d.id = p.id;
  if (p.title !== undefined) d.title = p.title;
  if (p.topic !== undefined) d.topic = p.topic;
  if (p.customScenario !== undefined) d.custom_scenario = p.customScenario;
  if (p.landingUrl !== undefined) d.landing_url = p.landingUrl;
  if (p.additionalDetails !== undefined) d.additional_details = p.additionalDetails ?? null;
  if (p.format !== undefined) d.format = p.format;
  if (p.duration !== undefined) d.duration = p.duration;
  if (p.language !== undefined) d.language = p.language;
  if (p.animationModel !== undefined) d.animation_model = p.animationModel;
  if (p.subtitleStyle !== undefined) d.subtitle_style = p.subtitleStyle;
  if (p.voice !== undefined) d.voice = p.voice;
  if (p.clipDuration !== undefined) d.clip_duration = p.clipDuration;
  if (p.subtitleFont !== undefined) d.subtitle_font = p.subtitleFont;
  if (p.subtitleSize !== undefined) d.subtitle_size = p.subtitleSize;
  if (p.subtitleColor !== undefined) d.subtitle_color = p.subtitleColor;
  if (p.musicStyle !== undefined) d.music_style = p.musicStyle;
  if (p.status !== undefined) d.status = p.status;
  if (p.progress !== undefined) d.progress = p.progress;
  if (p.progressMessage !== undefined) d.progress_message = p.progressMessage;
  if (p.script !== undefined) d.script = p.script ?? null;
  if (p.videoPath !== undefined) d.video_path = p.videoPath ?? null;
  if (p.videoUrl !== undefined) d.video_url = p.videoUrl ?? null;
  if (p.error !== undefined) d.error = p.error ?? null;
  return d;
}

function directusToProject(row: any): VideoProject {
  return {
    id: String(row.id),
    title: row.title,
    topic: row.topic ?? '',
    customScenario: row.custom_scenario ?? undefined,
    landingUrl: row.landing_url ?? undefined,
    additionalDetails: row.additional_details ?? undefined,
    format: row.format as VideoFormat,
    duration: row.duration,
    language: row.language ?? 'ru',
    animationModel: (row.animation_model ?? 'wan') as AnimationModel,
    subtitleStyle: (row.subtitle_style ?? 'karaoke') as SubtitleStyle,
    voice: row.voice ?? undefined,
    clipDuration: row.clip_duration ? (Number(row.clip_duration) as 5 | 10) : undefined,
    subtitleFont: row.subtitle_font ?? undefined,
    subtitleSize: row.subtitle_size ?? undefined,
    subtitleColor: row.subtitle_color ?? undefined,
    musicStyle: row.music_style ?? undefined,
    status: (row.status ?? 'idle') as VideoStatus,
    progress: row.progress ?? 0,
    progressMessage: row.progress_message ?? '',
    script: row.script ?? undefined,
    videoPath: row.video_path ?? undefined,
    videoUrl: row.video_url ?? undefined,
    error: row.error ?? undefined,
    createdAt:
      row.date_created ?? row.created_at ?? new Date().toISOString(),
    updatedAt:
      row.date_updated ?? row.updated_at ?? new Date().toISOString(),
  };
}

let directusAvailable: boolean | null = null;

async function checkDirectus(): Promise<boolean> {
  if (directusAvailable !== null) return directusAvailable;
  try {
    await directusFetch('/items/video_projects?limit=1');

    const created = await directusFetch('/items/video_projects', {
      method: 'POST',
      body: JSON.stringify({
        title: 'probe', topic: 'probe', format: '9:16',
        duration: 30, language: 'ru', animation_model: 'wan',
        status: 'idle', progress: 0, progress_message: '',
      }),
    });
    await directusFetch(`/items/video_projects/${created.data?.id}`, { method: 'DELETE' }).catch(() => {});

    directusAvailable = true;
    console.log('[video-db] Using Directus as storage backend');
  } catch (e: any) {
    directusAvailable = false;
    console.warn('[video-db] Directus unavailable, falling back to PostgreSQL/JSON:', e.message);
  }
  return directusAvailable;
}

// ── PostgreSQL backend ────────────────────────────────────────────────────────

let pool: InstanceType<typeof Pool> | null = null;

function getPool(): InstanceType<typeof Pool> | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  }
  return pool;
}

async function ensureTable(): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS video_projects (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      topic         TEXT NOT NULL,
      format        TEXT NOT NULL,
      duration      INTEGER NOT NULL,
      language      TEXT NOT NULL DEFAULT 'ru',
      animation_model TEXT NOT NULL DEFAULT 'wan',
      status        TEXT NOT NULL DEFAULT 'idle',
      progress      INTEGER NOT NULL DEFAULT 0,
      progress_message TEXT NOT NULL DEFAULT '',
      script        JSONB,
      custom_scenario TEXT,
      video_path    TEXT,
      video_url     TEXT,
      error         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS custom_scenario TEXT`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS subtitle_style TEXT NOT NULL DEFAULT 'karaoke'`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS voice TEXT`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS clip_duration INTEGER`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS subtitle_font TEXT`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS subtitle_size TEXT`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS subtitle_color TEXT`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS music_style TEXT`);
  await p.query(`ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS landing_url TEXT`);
}

let tableReady = false;
async function requireTable(): Promise<void> {
  if (!tableReady) {
    await ensureTable();
    tableReady = true;
  }
}

function rowToProject(row: any): VideoProject {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    format: row.format as VideoFormat,
    duration: row.duration,
    language: (row.language ?? 'ru') as 'ru' | 'en',
    animationModel: row.animation_model as AnimationModel,
    subtitleStyle: (row.subtitle_style ?? 'karaoke') as SubtitleStyle,
    voice: row.voice ?? undefined,
    clipDuration: row.clip_duration ? (Number(row.clip_duration) as 5 | 10) : undefined,
    subtitleFont: row.subtitle_font ?? undefined,
    subtitleSize: row.subtitle_size ?? undefined,
    subtitleColor: row.subtitle_color ?? undefined,
    musicStyle: row.music_style ?? undefined,
    status: row.status as VideoStatus,
    progress: row.progress,
    progressMessage: row.progress_message,
    script: row.script ?? undefined,
    customScenario: row.custom_scenario ?? undefined,
    landingUrl: row.landing_url ?? undefined,
    videoPath: row.video_path ?? undefined,
    videoUrl: row.video_url ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// ── JSON fallback ─────────────────────────────────────────────────────────────

const DB_FILE = path.join(DATA_DIR, 'projects.json');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'images'), { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'videos'), { recursive: true });
}

async function readJSON(): Promise<VideoProject[]> {
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeJSON(projects: VideoProject[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(DB_FILE, JSON.stringify(projects, null, 2));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createProject(data: {
  title: string;
  topic: string;
  format: VideoFormat;
  duration: number;
  language: 'ru' | 'en';
  animationModel?: AnimationModel;
  subtitleStyle?: SubtitleStyle;
  voice?: string;
  clipDuration?: 5 | 10;
  subtitleFont?: string;
  subtitleSize?: string;
  subtitleColor?: string;
  musicStyle?: string;
  customScenario?: string;
  landingUrl?: string;
}): Promise<VideoProject> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const project: VideoProject = {
    id,
    animationModel: 'wan',
    subtitleStyle: 'karaoke',
    ...data,
    status: 'idle',
    progress: 0,
    progressMessage: 'Ожидание запуска',
    createdAt: now,
    updatedAt: now,
  };

  if (await checkDirectus()) {
    const body = projectToDirectus(project);
    delete body.id;
    const res = await directusFetch('/items/video_projects', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const created = directusToProject(res.data);
    // Directus CREATE may not accept all fields (permission split between create/update)
    // Always PATCH subtitle_style and animation_model explicitly after creation
    if (created.subtitleStyle !== project.subtitleStyle || created.animationModel !== project.animationModel) {
      const patch = await directusFetch(`/items/video_projects/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          subtitle_style: project.subtitleStyle,
          animation_model: project.animationModel,
        }),
      });
      return directusToProject(patch.data);
    }
    return created;
  }

  const p = getPool();
  if (p) {
    await requireTable();
    await p.query(
      `INSERT INTO video_projects
        (id, title, topic, format, duration, language, animation_model, subtitle_style, voice, clip_duration,
         subtitle_font, subtitle_size, subtitle_color,
         status, progress, progress_message, custom_scenario, landing_url, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        project.id, project.title, project.topic, project.format,
        project.duration, project.language, project.animationModel, project.subtitleStyle,
        project.voice ?? null, project.clipDuration ?? null,
        project.subtitleFont ?? null, project.subtitleSize ?? null, project.subtitleColor ?? null,
        project.status, project.progress, project.progressMessage,
        project.customScenario ?? null, project.landingUrl ?? null,
        project.createdAt, project.updatedAt,
      ]
    );
    return project;
  }

  const projects = await readJSON();
  projects.push(project);
  await writeJSON(projects);
  return project;
}

export async function getProject(id: string): Promise<VideoProject | null> {
  if (await checkDirectus()) {
    try {
      const res = await directusFetch(`/items/video_projects/${id}`);
      return res.data ? directusToProject(res.data) : null;
    } catch (e: any) {
      if (e.message.includes('403') || e.message.includes('404')) return null;
      throw e;
    }
  }

  const p = getPool();
  if (p) {
    await requireTable();
    const res = await p.query('SELECT * FROM video_projects WHERE id = $1', [id]);
    return res.rows.length ? rowToProject(res.rows[0]) : null;
  }
  const projects = await readJSON();
  return projects.find((pr) => pr.id === id) || null;
}

export async function listProjects(): Promise<VideoProject[]> {
  if (await checkDirectus()) {
    const res = await directusFetch('/items/video_projects?sort=-date_created&limit=200');
    return (res.data ?? []).map(directusToProject);
  }

  const p = getPool();
  if (p) {
    await requireTable();
    const res = await p.query('SELECT * FROM video_projects ORDER BY created_at DESC');
    return res.rows.map(rowToProject);
  }
  const projects = await readJSON();
  return projects.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function updateProject(
  id: string,
  updates: Partial<VideoProject>
): Promise<VideoProject | null> {
  const now = new Date().toISOString();

  if (await checkDirectus()) {
    const body = projectToDirectus(updates);
    delete body.id;
    const res = await directusFetch(`/items/video_projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return res.data ? directusToProject(res.data) : null;
  }

  const p = getPool();
  if (p) {
    await requireTable();
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    const colMap: Record<string, string> = {
      title: 'title', topic: 'topic', format: 'format', duration: 'duration',
      language: 'language', animationModel: 'animation_model',
      subtitleStyle: 'subtitle_style', voice: 'voice', clipDuration: 'clip_duration',
      subtitleFont: 'subtitle_font', subtitleSize: 'subtitle_size', subtitleColor: 'subtitle_color',
      musicStyle: 'music_style', status: 'status',
      progress: 'progress', progressMessage: 'progress_message', script: 'script',
      customScenario: 'custom_scenario', landingUrl: 'landing_url', videoPath: 'video_path',
      videoUrl: 'video_url', error: 'error',
    };

    for (const [key, col] of Object.entries(colMap)) {
      if (key in updates) {
        const val = (updates as any)[key];
        fields.push(`${col} = $${i++}`);
        values.push(key === 'script' && val !== undefined ? JSON.stringify(val) : val ?? null);
      }
    }

    if (fields.length === 0) return getProject(id);

    fields.push(`updated_at = $${i++}`);
    values.push(now);
    values.push(id);

    const res = await p.query(
      `UPDATE video_projects SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return res.rows.length ? rowToProject(res.rows[0]) : null;
  }

  const projects = await readJSON();
  const idx = projects.findIndex((pr) => pr.id === id);
  if (idx === -1) return null;
  projects[idx] = { ...projects[idx], ...updates, updatedAt: now };
  await writeJSON(projects);
  return projects[idx];
}

export async function deleteProject(id: string): Promise<boolean> {
  if (await checkDirectus()) {
    try {
      await directusFetch(`/items/video_projects/${id}`, { method: 'DELETE' });
      return true;
    } catch {
      return false;
    }
  }

  const p = getPool();
  if (p) {
    await requireTable();
    const res = await p.query('DELETE FROM video_projects WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }
  const projects = await readJSON();
  const idx = projects.findIndex((pr) => pr.id === id);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  await writeJSON(projects);
  return true;
}

export const DATA_PATHS = {
  imagesDir: (projectId: string) => path.join(DATA_DIR, 'images', projectId),
  videoFile: (projectId: string) => path.join(DATA_DIR, 'videos', `${projectId}.mp4`),
};

ensureDataDir().catch(() => {});
