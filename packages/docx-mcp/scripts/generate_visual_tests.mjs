import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SessionManager } from '../dist/session/manager.js';
import { openDocument } from '../dist/tools/open_document.js';
import { readFile } from '../dist/tools/read_file.js';
import { grep } from '../dist/tools/grep.js';
import { replaceText } from '../dist/tools/replace_text.js';
import { insertParagraph } from '../dist/tools/insert_paragraph.js';
import { download } from '../dist/tools/download.js';

import { compareDocuments } from '../../docx-comparison/dist/index.js';
import { DocxArchive } from '../../docx-comparison/dist/shared/docx/DocxArchive.js';
import {
  acceptAllChanges,
  rejectAllChanges,
  extractTextWithParagraphs,
  compareTexts,
} from '../../docx-comparison/dist/baselines/atomizer/trackChangesAcceptorAst.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUT_ROOT = path.join(
  REPO_ROOT,
  'tests/test_outputs/safe-docx-ts-visual',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeText(filePath, text) {
  await fs.writeFile(filePath, text, 'utf8');
}

async function findParaIdLiteral(mgr, sessionId, literalSubstr) {
  const res = await grep(mgr, {
    session_id: sessionId,
    patterns: [escapeRegex(literalSubstr)],
    case_sensitive: false,
    whole_word: false,
    max_results: 10,
    context_chars: 80,
  });
  if (!res.success) throw new Error(`grep failed: ${res.error?.message ?? 'unknown'}`);
  const m = (res.matches ?? [])[0];
  if (!m) throw new Error(`Could not find paragraph containing: ${literalSubstr}`);
  return m.para_id;
}

async function doReplaceText(mgr, sessionId, pid, oldStr, newStr, instruction) {
  const r = await replaceText(mgr, {
    session_id: sessionId,
    target_paragraph_id: pid,
    old_string: oldStr,
    new_string: newStr,
    instruction,
  });
  if (!r.success) throw new Error(`replace_text failed: ${r.error?.message ?? 'unknown'}`);
}

async function doInsertParagraphAfter(mgr, sessionId, anchorPid, newStr, instruction) {
  const r = await insertParagraph(mgr, {
    session_id: sessionId,
    positional_anchor_node_id: anchorPid,
    position: 'AFTER',
    new_string: newStr,
    instruction,
  });
  if (!r.success) throw new Error(`insert_paragraph failed: ${r.error?.message ?? 'unknown'}`);
}

async function runCase(params) {
  const { name, inputPath, applyEdits } = params;
  const outDir = path.join(OUT_ROOT, name);
  await ensureDir(outDir);

  const originalCopy = path.join(outDir, 'original.docx');
  const revisedPath = path.join(outDir, 'revised.docx');
  const redlineRebuildPath = path.join(outDir, 'redline.rebuild.docx');
  const redlineInplacePath = path.join(outDir, 'redline.inplace.docx');

  await fs.copyFile(inputPath, originalCopy);

  const mgr = new SessionManager({ ttlMs: 60 * 60 * 1000 });
  const opened = await openDocument(mgr, { file_path: inputPath });
  if (!opened.success) throw new Error(`open_document failed: ${opened.error?.message ?? 'unknown'}`);
  const sessionId = opened.session_id;

  const beforeToon = await readFile(mgr, { session_id: sessionId, offset: 1, limit: 80, format: 'toon' });
  if (!beforeToon.success) throw new Error(`read_file before failed: ${beforeToon.error?.message ?? 'unknown'}`);
  await writeText(path.join(outDir, 'before.toon.txt'), String(beforeToon.content));

  await applyEdits({ mgr, sessionId });

  const afterToon = await readFile(mgr, { session_id: sessionId, offset: 1, limit: 80, format: 'toon' });
  if (!afterToon.success) throw new Error(`read_file after failed: ${afterToon.error?.message ?? 'unknown'}`);
  await writeText(path.join(outDir, 'after.toon.txt'), String(afterToon.content));

  const saved = await download(mgr, { session_id: sessionId, save_to_local_path: revisedPath, clean_bookmarks: true });
  if (!saved.success) throw new Error(`download failed: ${saved.error?.message ?? 'unknown'}`);

  const originalBytes = await fs.readFile(inputPath);
  const revisedBytes = await fs.readFile(revisedPath);

  const rebuild = await compareDocuments(originalBytes, revisedBytes, {
    author: 'Safe-Docx TS',
    engine: 'atomizer',
    reconstructionMode: 'rebuild',
    premergeRuns: false,
  });
  await fs.writeFile(redlineRebuildPath, rebuild.document);

  const inplace = await compareDocuments(originalBytes, revisedBytes, {
    author: 'Safe-Docx TS',
    engine: 'atomizer',
    reconstructionMode: 'inplace',
    premergeRuns: false,
  });
  await fs.writeFile(redlineInplacePath, inplace.document);

  const [originalArchive, revisedArchive, rebuildArchive, inplaceArchive] = await Promise.all([
    DocxArchive.load(originalBytes),
    DocxArchive.load(revisedBytes),
    DocxArchive.load(rebuild.document),
    DocxArchive.load(inplace.document),
  ]);
  const [originalXml, revisedXml, rebuildXml, inplaceXml] = await Promise.all([
    originalArchive.getDocumentXml(),
    revisedArchive.getDocumentXml(),
    rebuildArchive.getDocumentXml(),
    inplaceArchive.getDocumentXml(),
  ]);

  const originalText = extractTextWithParagraphs(originalXml);
  const revisedText = extractTextWithParagraphs(revisedXml);
  const rebuildAcceptedText = extractTextWithParagraphs(acceptAllChanges(rebuildXml));
  const rebuildRejectedText = extractTextWithParagraphs(rejectAllChanges(rebuildXml));
  const inplaceAcceptedText = extractTextWithParagraphs(acceptAllChanges(inplaceXml));
  const inplaceRejectedText = extractTextWithParagraphs(rejectAllChanges(inplaceXml));

  const stats = {
    rebuild: rebuild.stats,
    inplace: inplace.stats,
    roundtrip: {
      rebuild_accept_normalized: compareTexts(revisedText, rebuildAcceptedText).normalizedIdentical,
      rebuild_reject_normalized: compareTexts(originalText, rebuildRejectedText).normalizedIdentical,
      inplace_accept_normalized: compareTexts(revisedText, inplaceAcceptedText).normalizedIdentical,
      inplace_reject_normalized: compareTexts(originalText, inplaceRejectedText).normalizedIdentical,
    },
  };
  await writeText(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 2));

  return { outDir, stats };
}

await ensureDir(OUT_ROOT);

const results = [];

// Case 1: NDA example (real document from Downloads).
results.push(
  await runCase({
    name: '01_nda_example_31',
    inputPath: path.join(os.homedir(), 'Downloads', 'NDA_Example[31].docx'),
    applyEdits: async ({ mgr, sessionId }) => {
      // Effective date
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'is made as of the ______ day of');
        await doReplaceText(
          mgr,
          sessionId,
          pid,
          'the ______ day of _________, 201_',
          'January 15, 2025',
          'Set effective date to January 15, 2025.',
        );
      }

      // Counterparty
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'and [Counterparty], located at [Address]');
        await doReplaceText(
          mgr,
          sessionId,
          pid,
          '[Counterparty], located at [Address]',
          'Technology Service Provider, Inc., a Delaware corporation with its principal place of business in Las Vegas, Nevada',
          'Set counterparty identity to TSPI.',
        );
      }

      // Purpose (definition-style introduction: (the "R&D Business"))
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'for the purpose of [describe specific purpose of disclosure]');
        await doReplaceText(
          mgr,
          sessionId,
          pid,
          '[describe specific purpose of disclosure]',
          'facilitating confidential discussions between TSPI and R&G regarding the possible acquisition by R&G of TSPI research and development business unit (the <definition>R&D Business</definition>), based in Boston, MA',
          'Set Purpose to TSPI R&D acquisition discussions (introduce defined term).',
        );
      }

      // SEC exception (references should be unquoted)
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'Exceptions; Compelled Disclosure');
        const old = 'or (iv) is approved for release or is no longer treated as confidential or proprietary by Disclosing Party.';
        const add =
          'or (iv) is approved for release or is no longer treated as confidential or proprietary by Disclosing Party; or (v) consists of filings and communications with the Securities and Exchange Commission regarding the possible spin-out of the R&D Business and separate public offering of equity in the R&D Business.';
        await doReplaceText(mgr, sessionId, pid, old, add, 'Add SEC filings/communications exception.');
      }

      // Term to 5 years
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'This Agreement shall be effective for a period');
        await doReplaceText(mgr, sessionId, pid, '[three (3) years]', 'five (5) years', 'Set NDA term to 5 years.');
      }

      // Insert breach notice paragraph
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'Confidentiality Obligations');
        await doInsertParagraphAfter(
          mgr,
          sessionId,
          pid,
          'During the period that either party holds the Confidential Information of the other party, the party holding such information shall provide the other party notice of any material security breach within twenty-four (24) hours.',
          'Add 24-hour breach notice obligation.',
        );
      }

      // Fill signature block counterparty placeholder (highlighted in template).
      {
        const pid = await findParaIdLiteral(mgr, sessionId, '[Counterparty Name]');
        await doReplaceText(
          mgr,
          sessionId,
          pid,
          '[Counterparty Name]',
          'Technology Service Provider, Inc.',
          'Fill signature block counterparty name.',
        );
      }
    },
  }),
);

// Case 2: P Unit Agreement (repo doc).
results.push(
  await runCase({
    name: '02_p_unit_agreement_john_smith',
    inputPath: path.join(REPO_ROOT, 'tests/test_documents/P Unit Agreement - John Smith.docx'),
    applyEdits: async ({ mgr, sessionId }) => {
      // Title
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'Form of Participant Agreement');
        await doReplaceText(
          mgr,
          sessionId,
          pid,
          'Form of Participant Agreement',
          'Form of Participant Agreement (TS Visual Test)',
          'Add a visual-test marker to the title.',
        );
      }

      // Date + participant name
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'This Participant Agreement (this');
        await doReplaceText(mgr, sessionId, pid, 'January 1, 2024', 'January 15, 2025', 'Update Agreement date.');
        await doReplaceText(mgr, sessionId, pid, 'Emily Morgan', 'Jordan Lee', 'Update Participant name.');
      }

      // Units granted + hurdle amount
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'The Company hereby grants [Number of Units] Class P Units');
        await doReplaceText(mgr, sessionId, pid, '[Number of Units]', '50,000', 'Set number of units granted.');
        await doReplaceText(
          mgr,
          sessionId,
          pid,
          'The Profits Interest Hurdle for such Class P Units shall be $0.00.',
          'The Profits Interest Hurdle for such Class P Units shall be $150,000.00.',
          'Set a non-zero hurdle amount.',
        );
      }

      // Insert a new paragraph after NOW, THEREFORE (non-numbered), to test insertion.
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'NOW, THEREFORE, in consideration of the mutual promises');
        await doInsertParagraphAfter(
          mgr,
          sessionId,
          pid,
          'Notwithstanding anything to the contrary, the Company may withhold, delay, or condition delivery of any Units to ensure compliance with applicable law and internal policies.',
          'Insert a company-favorable proviso paragraph.',
        );
      }
    },
  }),
);

// Case 3: Conflict check (definition-heavy small doc).
results.push(
  await runCase({
    name: '03_conflict_check',
    inputPath: path.join(REPO_ROOT, 'tests/test_documents/Conflict check.docx'),
    applyEdits: async ({ mgr, sessionId }) => {
      // Adjust a numeric definition.
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'Prime Rate" means 5%');
        await doReplaceText(mgr, sessionId, pid, '5%', '6.25%', 'Update Prime Rate numeric definition.');
      }

      // Change a definition sentence to ensure <definition> handling works when present.
      {
        const pid = await findParaIdLiteral(mgr, sessionId, 'Agreement" means this Purchase Agreement');
        await doReplaceText(
          mgr,
          sessionId,
          pid,
          '"Agreement" means this Purchase Agreement dated as of the Effective Date.',
          '<definition>Agreement</definition> means this Purchase Agreement dated as of February 10, 2026.',
          'Update Agreement definition date; keep semantic tag in new_string.',
        );
      }
    },
  }),
);

await writeText(path.join(OUT_ROOT, 'README.txt'),
  [
    'Safe-Docx TS visual outputs',
    '',
    'Each subfolder contains:',
    '- original.docx',
    '- revised.docx (edited by Safe-Docx TS)',
    '- redline.rebuild.docx (docx-comparison, rebuild mode)',
    '- redline.inplace.docx (docx-comparison, inplace mode)',
    '- before.toon.txt / after.toon.txt (TOON snapshots)',
    '- stats.json (includes round-trip accept/reject parity checks)',
    '',
    'Open the redline docs in Word and review Accept All / Reject All behavior, plus formatting preservation.',
  ].join('\n'));

console.log('Wrote visual outputs to:', OUT_ROOT);
for (const r of results) {
  console.log('-', r.outDir, r.stats);
}
