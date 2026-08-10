import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Dead routes regression guard (task #6)', () => {
  const rootDir = path.resolve(__dirname, '../../');

  const removedFiles = [
    'server/api/force-check-content-status.ts',
    'server/api/gemini-routes.ts',
    'server/routes/gemini-routes.ts',
    'server/routes/register-gemini-routes.ts'
  ];

  it('proves removed dead route files do not exist on disk', () => {
    for (const relPath of removedFiles) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `File ${relPath} should remain deleted`).toBe(false);
    }
  });

  it('ensures no imports or references exist across server and client codebase', () => {
    const searchTerms = [
      'force-check-content-status',
      'register-gemini-routes',
      'api/gemini-routes',
      'routes/gemini-routes'
    ];

    function scanDir(dir: string, fileList: string[] = []): string[] {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build') continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          scanDir(filePath, fileList);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.json')) {
          fileList.push(filePath);
        }
      }
      return fileList;
    }

    const serverFiles = scanDir(path.join(rootDir, 'server'));
    const clientFiles = scanDir(path.join(rootDir, 'client'));
    const allFiles = [...serverFiles, ...clientFiles];

    for (const filePath of allFiles) {
      if (filePath.includes('dead-routes-guard.test.ts')) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const term of searchTerms) {
        expect(content.includes(term), `File ${path.relative(rootDir, filePath)} references removed module/route '${term}'`).toBe(false);
      }
    }
  });
});
