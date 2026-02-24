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

function extractParagraphLines(toonContent) {
  const lines = String(toonContent).split('\n');
  return lines
    .filter((l) => l.startsWith('_bk_') && l.includes('|'))
    .map((l) => {
      const [idPart, ...rest] = l.split('|');
      return { id: idPart.trim(), text: rest.join('|').trim() };
    });
}

function countOcc(hay, needle) {
  if (!needle) return 0;
  return hay.split(needle).length - 1;
}

function pickUniqueOldString(text, token) {
  // Try token as-is, then expand with context until unique.
  let idx = text.indexOf(token);
  if (idx < 0) return null;
  for (let ctx = 0; ctx <= 80; ctx += 10) {
    const start = Math.max(0, idx - ctx);
    const end = Math.min(text.length, idx + token.length + ctx);
    const cand = text.slice(start, end).trim();
    if (cand.length < token.length) continue;
    if (countOcc(text, cand) === 1) return cand;
  }
  return null;
}

async function callTool(client, name, args) {
  return toolJson(await client.callTool({ name, arguments: args }));
}

async function findParagraphByPatterns(client, sessionId, patterns) {
  const grepRes = await callTool(client, 'grep', { session_id: sessionId, patterns, case_sensitive: false });
  if (!grepRes.success) return { ok: false, why: grepRes };
  if (!grepRes.matches?.length) return { ok: false, why: { code: 'NO_MATCH', patterns } };
  const paraId = grepRes.matches[0].para_id;
  const readRes = await callTool(client, 'read_file', { session_id: sessionId, node_ids: [paraId] });
  if (!readRes.success) return { ok: false, why: readRes };
  const paras = extractParagraphLines(readRes.content);
  const p = paras[0];
  if (!p) return { ok: false, why: { code: 'NO_PARAGRAPH_TEXT', paraId } };
  return { ok: true, paraId, text: p.text, grepRes };
}

const args = parseArgs(process.argv);
if (!args.in || !args.out) {
  // eslint-disable-next-line no-console
  console.error('Usage: node mcp_extensive_edit.mjs --in <input.docx> --out <output.docx>');
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

const client = new Client({ name: 'safe-docx-extensive', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);

const actions = [];

try {
  const opened = await callTool(client, 'open_document', { file_path: args.in });
  if (!opened.success) throw new Error(JSON.stringify(opened, null, 2));
  const sessionId = opened.session_id;
  actions.push({ step: 'open_document', opened });

  // Targets
  const targets = {
    governingLaw: await findParagraphByPatterns(client, sessionId, ['Governing Law', 'governing law', 'laws of the State']),
    grantee: await findParagraphByPatterns(client, sessionId, ['Name:', 'Grantee', 'Participant']),
    units: await findParagraphByPatterns(client, sessionId, ['Units', 'unit', 'Granted Units', 'Award']),
    hurdle: await findParagraphByPatterns(client, sessionId, ['Hurdle', 'hurdle', 'threshold', 'minimum return', '\\$']),
  };

  actions.push({ step: 'locate_targets', targets: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, v.ok ? { paraId: v.paraId } : v])) });

  // 1) Grantee: if we find "Name: X", replace X.
  if (targets.grantee.ok) {
    const txt = targets.grantee.text;
    let oldStr = null;
    let newStr = null;
    if (txt.includes('Name:')) {
      oldStr = pickUniqueOldString(txt, 'Name:');
      // Replace entire name line if present.
      const m = txt.match(/Name:\s*([A-Za-z][A-Za-z .'-]{2,})/);
      if (m) {
        oldStr = pickUniqueOldString(txt, `Name: ${m[1]}`) ?? oldStr;
        newStr = `Name: Jordan Lee`;
      }
    }
    if (!oldStr) oldStr = pickUniqueOldString(txt, 'Emily') ?? pickUniqueOldString(txt, 'Participant');
    if (!newStr) newStr = oldStr?.replace(/Emily Morgan|Emily|Participant/g, 'Jordan Lee') ?? null;
    if (oldStr && newStr && oldStr !== newStr) {
      const res = await callTool(client, 'replace_text', {
        session_id: sessionId,
        target_paragraph_id: targets.grantee.paraId,
        old_string: oldStr,
        new_string: newStr,
        instruction: 'Update grantee/participant name',
      });
      actions.push({ step: 'edit_grantee', paraId: targets.grantee.paraId, oldStr, newStr, res });
    }
  }

  // 2) Governing law: swap state if we can find a phrase.
  if (targets.governingLaw.ok) {
    const txt = targets.governingLaw.text;
    const token =
      (txt.match(/laws of the State of [A-Za-z ]+/i)?.[0] ?? null) ||
      (txt.includes('Delaware') ? 'Delaware' : null) ||
      (txt.includes('New York') ? 'New York' : null);
    const oldStr = token ? pickUniqueOldString(txt, token) : null;
    const newStr = oldStr
      ? oldStr.replace(/Delaware/gi, 'New York').replace(/Texas/gi, 'New York')
      : null;
    if (oldStr && newStr && oldStr !== newStr) {
      const res = await callTool(client, 'replace_text', {
        session_id: sessionId,
        target_paragraph_id: targets.governingLaw.paraId,
        old_string: oldStr,
        new_string: newStr,
        instruction: 'Change governing law',
      });
      actions.push({ step: 'edit_governing_law', paraId: targets.governingLaw.paraId, oldStr, newStr, res });
    } else {
      actions.push({ step: 'edit_governing_law_skipped', reason: 'no unique governing law substring found', paraId: targets.governingLaw.paraId, text: txt });
    }
  }

  // 3) Units granted: try to find a number near "Units" in the matched paragraph and change it.
  if (targets.units.ok) {
    const txt = targets.units.text;
    const m = txt.match(/(\d[\d,]{0,9})\s+Units\b/);
    if (m) {
      const oldStr = pickUniqueOldString(txt, `${m[1]} Units`) ?? pickUniqueOldString(txt, m[0]);
      const newStr = oldStr ? oldStr.replace(m[1], '5,000') : null;
      if (oldStr && newStr && oldStr !== newStr) {
        const res = await callTool(client, 'replace_text', {
          session_id: sessionId,
          target_paragraph_id: targets.units.paraId,
          old_string: oldStr,
          new_string: newStr,
          instruction: 'Update number of units granted',
        });
        actions.push({ step: 'edit_units', paraId: targets.units.paraId, oldStr, newStr, res });
      }
    } else {
      actions.push({ step: 'edit_units_skipped', reason: 'no "<number> Units" pattern in matched paragraph', paraId: targets.units.paraId, text: txt });
    }
  }

  // 4) Hurdle amount: try to change first $ amount in matched paragraph.
  if (targets.hurdle.ok) {
    const txt = targets.hurdle.text;
    const m = txt.match(/\$[\d,]+(?:\.\d{2})?/);
    if (m) {
      const oldStr = pickUniqueOldString(txt, m[0]);
      const newStr = '$250,000.00';
      if (oldStr && oldStr !== newStr) {
        const res = await callTool(client, 'replace_text', {
          session_id: sessionId,
          target_paragraph_id: targets.hurdle.paraId,
          old_string: oldStr,
          new_string: newStr,
          instruction: 'Update hurdle/threshold amount',
        });
        actions.push({ step: 'edit_hurdle', paraId: targets.hurdle.paraId, oldStr, newStr, res });
      }
    } else {
      actions.push({ step: 'edit_hurdle_skipped', reason: 'no $ amount in matched paragraph', paraId: targets.hurdle.paraId, text: txt });
    }
  }

  // Insert company-favorable provisos near units clause if we have it; otherwise after the first paragraph.
  const provisoAnchor = targets.units.ok ? targets.units.paraId : extractParagraphLines((await callTool(client, 'read_file', { session_id: sessionId, limit: 10 })).content)[0]?.id;
  if (provisoAnchor) {
    const paragraphsToInsert = [
      'Notwithstanding anything to the contrary, the Company may withhold, delay, or condition delivery of any Units to ensure compliance with applicable law and internal policies.',
      'Any unvested Units shall be automatically forfeited for no consideration upon termination of the Participant’s service relationship for Cause or upon any material breach of confidentiality, non-solicitation, or non-disparagement obligations.',
      'The Company may require the Participant to execute additional acknowledgements or joinders as a condition to continued eligibility under this Agreement.',
    ];
    let anchor = provisoAnchor;
    for (const pText of paragraphsToInsert) {
      const ins = await callTool(client, 'insert_paragraph', {
        session_id: sessionId,
        positional_anchor_node_id: anchor,
        new_string: pText,
        instruction: 'Add company-favorable proviso',
        position: 'AFTER',
      });
      actions.push({ step: 'insert_proviso', anchor, inserted: ins });
      if (ins.success && ins.new_paragraph_id) {
        anchor = ins.new_paragraph_id;
      }
    }
  }

  const saved = await callTool(client, 'download', { session_id: sessionId, save_to_local_path: args.out, clean_bookmarks: true });
  actions.push({ step: 'download', saved });
  if (!saved.success) throw new Error(JSON.stringify(saved, null, 2));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ session_id: sessionId, out: args.out, actions }, null, 2));
} finally {
  await transport.close().catch(() => {});
}
