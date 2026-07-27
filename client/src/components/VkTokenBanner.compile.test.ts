import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('VkTokenBanner TypeScript guard', () => {
  it('has no unresolved identifiers in the component', () => {
    const fileName = path.resolve(process.cwd(), 'client/src/components/VkTokenBanner.tsx');
    const program = ts.createProgram([fileName], {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      noEmit: true,
      noResolve: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    });

    const unresolved = ts.getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.code === 2304)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));

    expect(unresolved).toEqual([]);
  }, 15_000);
});
