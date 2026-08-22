/**
 * AI-132: prevent server code from reading files at runtime.
 *
 * The server is bundled into a single file by esbuild. Any readFileSync/readFile/__dirname
 * that expects sibling files to exist will work in tests but fail in production.
 *
 * This test scans server/ for forbidden patterns and fails on any hit
 * not in the explicit allowlist.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SERVER_DIR = join(__dirname, '..');

/** Files/patterns allowed to use filesystem reads. Each entry has a reason. */
const ALLOWLIST: Record<string, string> = {
  'server/vite.ts': 'Vite dev server reads HTML templates at dev time only; not included in production bundle',
  'server/services/social/base-service.ts': 'Reads user-uploaded image files for publishing to social platforms',
  'server/services/autonomous-ai.ts': 'Persists autonomous cycle state to local file (state file is created at runtime)',
  'server/services/beget-s3-direct.ts': 'Reads local files before uploading to S3 storage',
  'server/services/beget-s3-storage-aws.ts': 'Reads local files before uploading to S3 storage',
  'server/services/publish-fallback-journal.ts': 'Reads fallback journal file (created at runtime)',
  'server/telegram-bot/index.ts': 'Reads temporary files for Telegram media uploads',
  'server/index.ts': 'Dynamic import of url/path for __dirname computation in production static serving (computed from import.meta.url, not filesystem)',
  'server/routes/video.ts': 'Reads user-uploaded processed video files for serving to clients',
};

const FORBIDDEN = ['readFileSync', 'readFile', '__dirname'];

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      result.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      result.push(full);
    }
  }
  return result;
}

interface Violation {
  file: string;
  line: number;
  pattern: string;
}

function findViolations(): Violation[] {
  const files = collectTsFiles(SERVER_DIR);
  const violations: Violation[] = [];

  for (const filePath of files) {
    const relPath = relative(join(__dirname, '..', '..'), filePath);
    if (ALLOWLIST[relPath]) continue;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('import ')) continue;

      for (const forbidden of FORBIDDEN) {
        if (line.includes(forbidden)) {
          violations.push({ file: relPath, line: i + 1, pattern: forbidden });
        }
      }
    }
  }
  return violations;
}

describe('AI-132: no runtime file reads in server code', () => {
  it('no forbidden patterns outside allowlist', () => {
    const violations = findViolations();
    if (violations.length > 0) {
      const details = violations.map(
        (v) => '  ' + v.file + ':' + v.line + ' uses ' + v.pattern
      ).join('\n');
      expect.fail(
        'Found runtime file reads in bundled server code:\n' + details +
        '\n\nAdd to ALLOWLIST with a reason, or refactor to import data as a module.'
      );
    }
  });
});
