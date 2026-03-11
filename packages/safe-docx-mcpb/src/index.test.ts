import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const test = testAllure.epic('Safe DOCX MCP Bundle').withLabels({ feature: 'Entrypoint Wiring' });

describe('safe-docx-mcpb entrypoint wiring', () => {
  test('delegates runtime to @usejunior/safe-docx runServer', async ({ given, when, then }: AllureBddContext) => {
    let source!: string;
    await given('the index.ts entrypoint file', async () => {
      const entryPath = path.join(__dirname, 'index.ts');
      source = await fs.readFile(entryPath, 'utf8');
    });
    await then('it imports runServer from @usejunior/safe-docx', () => {
      expect(source).toContain("import { runServer } from '@usejunior/safe-docx'");
    });
    await then('it invokes runServer with error handling', () => {
      expect(source).toContain('runServer().catch');
    });
  });
});
