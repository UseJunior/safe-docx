import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itAllure } from './testing/allure-test.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('safe-docx-mcpb entrypoint wiring', () => {
  const it = itAllure.epic('Safe DOCX MCP Bundle').withLabels({ feature: 'Entrypoint wiring' });

  it('delegates runtime to @usejunior/safe-docx runServer', async () => {
    const entryPath = path.join(__dirname, 'index.ts');
    const source = await fs.readFile(entryPath, 'utf8');

    expect(source).toContain("import { runServer } from '@usejunior/docx-mcp'");
    expect(source).toContain('runServer().catch');
  });
});
