#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

function toolJson(result) {
  const text = result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: { code: 'BAD_SERVER_RESPONSE', message: text } };
  }
}

function extractParagraphIdsAndText(toonContent) {
  const lines = String(toonContent).split('\n');
  return lines
    .filter((l) => l.startsWith('_bk_') && l.includes('|'))
    .map((l) => {
      const [idPart, ...rest] = l.split('|');
      return { id: idPart.trim(), text: rest.join('|').trim() };
    });
}

function pickUniqueToken(text) {
  // Pick a "word-like" token that appears exactly once in the paragraph.
  // Avoid very short tokens and numbers.
  const tokens = text.match(/[A-Za-z][A-Za-z0-9_-]{5,}/g) ?? [];
  for (const t of tokens) {
    const count = text.split(t).length - 1;
    if (count === 1) return t;
  }
  return null;
}

const args = parseArgs(process.argv);
if (!args.in || !args.out) {
  // eslint-disable-next-line no-console
  console.error('Usage: node mcp_smoke_edit.mjs --in <input.docx> --out <output.docx>');
  process.exit(2);
}

const cwd = process.cwd();
const serverPath = path.resolve(cwd, 'packages/safe-docx/dist/cli.js');

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  cwd,
  stderr: 'inherit',
});

const client = new Client({ name: 'safe-docx-smoke', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);

try {
  const opened = toolJson(await client.callTool({ name: 'open_document', arguments: { file_path: args.in } }));
  if (!opened.success) throw new Error(JSON.stringify(opened, null, 2));
  const sessionId = opened.session_id;

  // Read a slice of the doc to find candidate text.
  const readRes = toolJson(await client.callTool({ name: 'read_file', arguments: { session_id: sessionId, limit: 50 } }));
  if (!readRes.success) throw new Error(JSON.stringify(readRes, null, 2));

  const paras = extractParagraphIdsAndText(readRes.content);
  if (paras.length === 0) throw new Error('No readable paragraphs found');

  // Pick first paragraph with a unique token.
  let chosen = null;
  for (const p of paras) {
    const token = pickUniqueToken(p.text);
    if (token) {
      chosen = { paraId: p.id, oldStr: token, newStr: `${token}_TS` };
      break;
    }
  }
  if (!chosen) throw new Error('Failed to find a unique token in the first 50 paragraphs');

  const edited = toolJson(
    await client.callTool({
      name: 'replace_text',
      arguments: {
        session_id: sessionId,
        target_paragraph_id: chosen.paraId,
        old_string: chosen.oldStr,
        new_string: chosen.newStr,
        instruction: 'smoke test edit',
      },
    }),
  );
  if (!edited.success) throw new Error(JSON.stringify(edited, null, 2));

  const saved = toolJson(
    await client.callTool({
      name: 'download',
      arguments: { session_id: sessionId, save_to_local_path: args.out, clean_bookmarks: true },
    }),
  );
  if (!saved.success) throw new Error(JSON.stringify(saved, null, 2));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ opened, chosen, edited, saved }, null, 2));
} finally {
  await transport.close().catch(() => {});
}
