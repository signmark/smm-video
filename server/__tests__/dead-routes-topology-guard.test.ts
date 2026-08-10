import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

describe('Task #6: Guard against dead gemini and force-check server route topologies', () => {
  it('ensures deleted dead route files remain removed', () => {
    const deadFiles = [
      'server/api/force-check-content-status.ts',
      'server/api/gemini-routes.ts',
      'server/routes/gemini-routes.ts',
      'server/routes/register-gemini-routes.ts',
    ];

    for (const relPath of deadFiles) {
      expect(existsSync(join(ROOT, relPath)), `File ${relPath} should not exist`).toBe(false);
    }
  });

  it('ensures active server/routes-gemini.ts remains registered in server/index.ts', () => {
    const serverIndexPath = join(ROOT, 'server', 'index.ts');
    const content = readFileSync(serverIndexPath, 'utf-8');

    // Verify active routes-gemini import and registration
    expect(content).toContain('import { registerGeminiRoutes } from "./routes-gemini";');
    expect(content).toContain('registerGeminiRoutes(app);');
  });

  it('ensures no active code imports dead route files or exports', () => {
    const serverIndexPath = join(ROOT, 'server', 'index.ts');
    const content = readFileSync(serverIndexPath, 'utf-8');

    expect(content).not.toContain('force-check-content-status');
    expect(content).not.toContain('register-gemini-routes');
    expect(content).not.toContain('/routes/gemini-routes');
    expect(content).not.toContain('/api/gemini-routes');
  });
});
