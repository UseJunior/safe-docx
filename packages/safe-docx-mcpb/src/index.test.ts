import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('safe-docx-mcpb entrypoint wiring', () => {
  it('delegates runtime to @usejunior/safedocx runServer', async () => {
    const entryPath = path.join(__dirname, 'index.ts');
    const source = await fs.readFile(entryPath, 'utf8');

    expect(source).toContain("import { runServer } from '@usejunior/safedocx'");
    expect(source).toContain('runServer().catch');
  });
});
