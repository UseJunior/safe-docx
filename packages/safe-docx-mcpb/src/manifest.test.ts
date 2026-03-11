import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { SAFE_DOCX_MCP_TOOLS } from '../../docx-mcp/src/tool_catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

const test = testAllure.epic('Safe DOCX MCP Bundle').withLabels({ feature: 'Manifest Contract' });

describe('safe-docx-mcpb manifest contract', () => {
  test('declares a node MCP server entrypoint wired to dist/index.js', async ({ given, when, then, and }: AllureBddContext) => {
    let manifest!: {
      server?: {
        type?: string;
        entry_point?: string;
        mcp_config?: { command?: string; args?: string[] };
      };
    };
    await given('the manifest.json file', async () => {
      const manifestPath = path.join(packageRoot, 'manifest.json');
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    });
    await then('the server type is node', () => {
      expect(manifest.server?.type).toBe('node');
    });
    await and('the entry point is dist/index.js', () => {
      expect(manifest.server?.entry_point).toBe('dist/index.js');
    });
    await and('the MCP config uses node with the correct args', () => {
      expect(manifest.server?.mcp_config?.command).toBe('node');
      expect(manifest.server?.mcp_config?.args).toContain('${__dirname}/dist/index.js');
    });
  });

  test('publishes canonical tool names from safe-docx', async ({ given, when, then, and }: AllureBddContext) => {
    let manifestToolNames!: string[];
    let canonicalToolNames!: string[];
    await given('manifest.json and the canonical tool catalog', async () => {
      const manifestPath = path.join(packageRoot, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        tools?: Array<{ name?: string }>;
      };
      manifestToolNames = (manifest.tools ?? [])
        .map((tool) => tool.name)
        .filter((name): name is string => typeof name === 'string');
      canonicalToolNames = SAFE_DOCX_MCP_TOOLS.map((tool) => tool.name);
    });
    await then('there are no duplicate tool names in manifest', () => {
      const duplicates = manifestToolNames.filter((name, index) => manifestToolNames.indexOf(name) !== index);
      expect(duplicates).toEqual([]);
    });
    await and('all canonical tools are present in manifest', () => {
      const manifestSet = new Set(manifestToolNames);
      const missing = canonicalToolNames.filter((name) => !manifestSet.has(name));
      expect(missing).toEqual([]);
    });
    await and('no extra tools exist beyond canonical set', () => {
      const canonicalSet = new Set(canonicalToolNames);
      const extra = manifestToolNames.filter((name) => !canonicalSet.has(name));
      expect(extra).toEqual([]);
    });
  });
});
