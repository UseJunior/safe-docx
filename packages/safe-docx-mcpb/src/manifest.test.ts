import { describe, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itAllure } from './testing/allure-test.js';
import { SAFE_DOCX_MCP_TOOLS } from '../../safe-docx/src/tool_catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

describe('safe-docx-mcpb manifest contract', () => {
  const it = itAllure.epic('Safe DOCX MCP Bundle').withLabels({ feature: 'Manifest contract' });

  it('declares a node MCP server entrypoint wired to dist/index.js', async () => {
    const manifestPath = path.join(packageRoot, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      server?: {
        type?: string;
        entry_point?: string;
        mcp_config?: { command?: string; args?: string[] };
      };
    };

    expect(manifest.server?.type).toBe('node');
    expect(manifest.server?.entry_point).toBe('dist/index.js');
    expect(manifest.server?.mcp_config?.command).toBe('node');
    expect(manifest.server?.mcp_config?.args).toContain('${__dirname}/dist/index.js');
  });

  it('publishes canonical tool names from safe-docx', async () => {
    const manifestPath = path.join(packageRoot, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      tools?: Array<{ name?: string }>;
    };

    const manifestToolNames = (manifest.tools ?? [])
      .map((tool) => tool.name)
      .filter((name): name is string => typeof name === 'string');
    const canonicalToolNames = SAFE_DOCX_MCP_TOOLS.map((tool) => tool.name);

    const manifestSet = new Set(manifestToolNames);
    const canonicalSet = new Set(canonicalToolNames);

    const duplicates = manifestToolNames.filter((name, index) => manifestToolNames.indexOf(name) !== index);
    const missing = canonicalToolNames.filter((name) => !manifestSet.has(name));
    const extra = manifestToolNames.filter((name) => !canonicalSet.has(name));

    expect(duplicates).toEqual([]);
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });
});
