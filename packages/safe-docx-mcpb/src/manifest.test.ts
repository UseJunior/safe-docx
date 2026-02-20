import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

describe('safe-docx-mcpb manifest contract', () => {
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

  it('publishes the expected core tool names', async () => {
    const manifestPath = path.join(packageRoot, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      tools?: Array<{ name?: string }>;
    };

    const names = new Set((manifest.tools ?? []).map((tool) => tool.name));

    expect(names.has('open_document')).toBe(true);
    expect(names.has('read_file')).toBe(true);
    expect(names.has('smart_edit')).toBe(true);
    expect(names.has('download')).toBe(true);
    expect(names.has('format_layout')).toBe(true);
    expect(names.has('accept_changes')).toBe(true);
    expect(names.has('add_comment')).toBe(true);
    expect(names.has('compare_documents')).toBe(true);
    expect(names.has('extract_revisions')).toBe(true);
  });
});
