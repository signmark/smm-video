#!/usr/bin/env node
/**
 * Poll video_projects.date_updated during a production run to measure
 * actual intervals between progress updates.
 *
 * Usage:
 *   DIRECTUS_URL=https://directus.nplanner.ru DIRECTUS_TOKEN=xxx \
 *     node scripts/poll-progress-intervals.mjs 239 106 119
 *
 * Arguments: space-separated project IDs to track.
 * If none given, tracks all projects with active pipeline statuses.
 *
 * Output: raw timestamped lines to stdout (pipe to file).
 * Format: one JSON object per line for easy post-processing.
 */
import fs from 'fs';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const TOKEN = process.env.DIRECTUS_TOKEN;
const POLL_INTERVAL_MS = 2000;

if (!DIRECTUS_URL || !TOKEN) {
  console.error('Required env vars: DIRECTUS_URL, TOKEN');
  process.exit(1);
}

const trackIds = process.argv.slice(2).map(Number).filter(Boolean);
const trackAll = trackIds.length === 0;

const RUNNING_STATUSES = new Set([
  'generating_script', 'searching_stock', 'generating_images', 'animating', 'assembling',
]);

// Track last-seen state per project
const lastSeen = new Map();

function emit(event) {
  console.log(JSON.stringify(event));
}

async function poll() {
  try {
    const fields = 'id,title,status,progress,progress_message,date_updated';
    const url = trackAll
      ? `${DIRECTUS_URL}/items/video_projects?fields=${fields}&limit=100&sort=-date_updated`
      : `${DIRECTUS_URL}/items/video_projects?fields=${fields}&filter[id][_in]=${trackIds.join(',')}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      emit({ t: new Date().toISOString(), event: 'error', detail: `HTTP ${res.status}` });
      return;
    }
    const { data } = await res.json();
    if (!data) return;

    for (const p of data) {
      const id = p.id;
      const prev = lastSeen.get(id);
      const now = new Date().toISOString();

      if (!prev) {
        // First snapshot — record but don't emit as change
        lastSeen.set(id, {
          date_updated: p.date_updated,
          status: p.status,
          progress: p.progress,
          progress_message: p.progress_message,
        });

        if (RUNNING_STATUSES.has(p.status)) {
          emit({
            t: now, event: 'track_start',
            id, title: (p.title || '').substring(0, 40),
            status: p.status, progress: p.progress,
            date_updated: p.date_updated,
          });
        }
        continue;
      }

      if (prev.date_updated !== p.date_updated) {
        const prevTime = new Date(prev.date_updated).getTime();
        const currTime = new Date(p.date_updated).getTime();
        const gapSec = Math.round((currTime - prevTime) / 1000);

        emit({
          t: now, event: 'progress_update',
          id,
          status: p.status,
          progress: p.progress,
          progress_message: (p.progress_message || '').substring(0, 80),
          prev_date_updated: prev.date_updated,
          new_date_updated: p.date_updated,
          gap_sec: gapSec,
          prev_status: prev.status,
          prev_progress: prev.progress,
        });

        lastSeen.set(id, {
          date_updated: p.date_updated,
          status: p.status,
          progress: p.progress,
          progress_message: p.progress_message,
        });
      }
    }
  } catch (err) {
    emit({ t: new Date().toISOString(), event: 'error', detail: err.message });
  }
}

emit({ t: new Date().toISOString(), event: 'poller_start', track_ids: trackIds, track_all: trackAll, interval_ms: POLL_INTERVAL_MS });

// Initial snapshot
await poll();

// Poll every 2 seconds
setInterval(poll, POLL_INTERVAL_MS);
