#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    [
      'Usage:',
      '  node packages/safe-docx/scripts/mcp_local_edit.mjs \\',
      '    --in <input.docx> \\',
      '    --out <output.docx> \\',
      '    --para <jr_para_...> \\',
      '    --old <old_string> \\',
      '    --new <new_string>',
      '',
      'Tip: omit --para to auto-grep by --old and use the first match.',
    ].join('\n'),
  );
}

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

const args = parseArgs(process.argv);
if (!args.in || !args.out || !args.old || args.new === undefined) {
  usage();
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

const client = new Client({ name: 'safe-docx-local-tester', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);

try {
  const opened = toolJson(await client.callTool({ name: 'open_document', arguments: { file_path: args.in } }));
  if (!opened.success) throw new Error(JSON.stringify(opened, null, 2));
  const sessionId = opened.session_id;

  let paraId = args.para;
  if (!paraId) {
    const grepRes = toolJson(
      await client.callTool({
        name: 'grep',
        arguments: { session_id: sessionId, patterns: [args.old], case_sensitive: true, whole_word: false },
      }),
    );
    if (!grepRes.success) throw new Error(JSON.stringify(grepRes, null, 2));
    if (!grepRes.matches?.length) throw new Error('No grep matches found');
    paraId = grepRes.matches[0].para_id;
  }

  const edited = toolJson(
    await client.callTool({
      name: 'replace_text',
      arguments: {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: args.old,
        new_string: args.new,
        instruction: 'local test edit',
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
  console.log(JSON.stringify({ opened, edited, saved }, null, 2));
} finally {
  await transport.close().catch(() => {});
}
