/**
 * Traceability: the default save/finalization path serializes write-time
 * tracked markup directly (no comparison), the clean artifact accepts the AI
 * author's edits while preserving untouched blocks (#408), and the save report
 * carries none of the retired comparison-engine fields.
 *
 * OpenSpec change: remove-comparison-from-default-save.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { makeDocxWithDocumentXml, readDocumentXmlFromPath } from '../testing/docx_test_utils.js';
import {
  assertSuccess,
  createTestSessionManager,
  createTrackedTempDir,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { openDocument } from './open_document.js';
import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';

const TEST_FEATURE = 'remove-comparison-from-default-save';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI_AUTHOR = 'Finalization Test';

const serializer = new XMLSerializer();

// Two proofErr/rsid-fragmented body paragraphs (what open-time normalization
// rewrites in memory) around a middle edit target — so an untouched-block
// byte-identity check is meaningful.
const FIXTURE_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W_NS}"><w:body>` +
  `<w:p><w:proofErr w:type="spellStart"/><w:r w:rsidR="00AA0001"><w:t>Lorem</w:t></w:r>` +
  `<w:proofErr w:type="spellEnd"/><w:r w:rsidR="00AA0002"><w:t xml:space="preserve"> ipsum intro</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>{placeholder}</w:t></w:r></w:p>` +
  `<w:p><w:proofErr w:type="gramStart"/><w:r><w:t>dolor</w:t></w:r>` +
  `<w:proofErr w:type="gramEnd"/><w:r><w:t xml:space="preserve"> sit outro</w:t></w:r></w:p>` +
  `</w:body></w:document>`;

function bodyBlocks(xml: string): string[] {
  const doc = parseXml(xml);
  const body = doc.getElementsByTagNameNS(W_NS, 'body').item(0);
  if (!body) return [];
  const out: string[] = [];
  let child = body.firstChild;
  while (child) {
    if (child.nodeType === 1) out.push(serializer.serializeToString(child as never));
    child = child.nextSibling;
  }
  return out;
}

async function openEditedSession(): Promise<{
  mgr: ReturnType<typeof createTestSessionManager>;
  filePath: string;
  inputPath: string;
  tmpDir: string;
}> {
  const mgr = createTestSessionManager({ defaultAiAuthor: AI_AUTHOR });
  const tmpDir = await createTrackedTempDir('safe-docx-finalize-');
  const inputPath = path.join(tmpDir, 'input.docx');
  await fs.writeFile(inputPath, new Uint8Array(await makeDocxWithDocumentXml(FIXTURE_XML)));

  const opened = await openDocument(mgr, { file_path: inputPath });
  assertSuccess(opened, 'open');
  const filePath = (opened.file_path as string) ?? inputPath;

  const read = await readFile(mgr, { file_path: filePath });
  assertSuccess(read, 'read');
  const paraId = String(read.content)
    .split('\n')
    .find((l) => l.startsWith('_bk_') && l.includes('{placeholder}'))!
    .split('|')[0]!
    .trim();

  const edited = await replaceText(mgr, {
    file_path: filePath,
    target_paragraph_id: paraId,
    old_string: '{placeholder}',
    new_string: 'two (2) years',
    instruction: 'Fill the placeholder',
  });
  assertSuccess(edited, 'edit');
  return { mgr, filePath, inputPath, tmpDir };
}

describe('Traceability: Write-Time Canonical Redline on Save', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });
  registerCleanup();

  humanReadableTest.openspec('default save serializes write-time tracked markup without comparison')('Scenario: default save serializes write-time tracked markup without comparison', async ({ given, when, then }: AllureBddContext) => {
    let session: Awaited<ReturnType<typeof openEditedSession>>;
    let saved: Awaited<ReturnType<typeof save>>;
    let trackedXml = '';

    await given('a tracked session whose AI author has edited a paragraph', async () => {
      session = await openEditedSession();
    });

    await when('save is called with tracked output', async () => {
      const trackedPath = path.join(session.tmpDir, 'tracked.docx');
      saved = await save(session.mgr, {
        file_path: session.filePath,
        save_to_local_path: trackedPath,
        save_format: 'tracked',
      });
      assertSuccess(saved, 'save tracked');
      trackedXml = await readDocumentXmlFromPath(trackedPath);
    });

    await then('the redline is the write-time markup and no comparison engine ran', () => {
      expect(trackedXml.includes('<w:ins') || trackedXml.includes('<w:del')).toBe(true);
      expect(saved.tracked_changes_source).toBe('write-time');
      // A comparison/reconstruction run would surface these fields; write-time never does.
      expect((saved as Record<string, unknown>).tracked_reconstruction_mode).toBeUndefined();
    });
  });

  humanReadableTest.openspec('clean artifact accepts AI edits and preserves untouched blocks')('Scenario: clean artifact accepts AI edits and preserves untouched blocks', async ({ given, when, then }: AllureBddContext) => {
    let session: Awaited<ReturnType<typeof openEditedSession>>;
    let inputBlocks: string[] = [];
    let cleanBlocks: string[] = [];

    await given('a tracked session with an edit to one paragraph among several', async () => {
      session = await openEditedSession();
    });

    await when('the clean artifact is generated', async () => {
      const cleanPath = path.join(session.tmpDir, 'clean.docx');
      const saved = await save(session.mgr, {
        file_path: session.filePath,
        save_to_local_path: cleanPath,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save clean');
      inputBlocks = bodyBlocks(await readDocumentXmlFromPath(session.inputPath));
      cleanBlocks = bodyBlocks(await readDocumentXmlFromPath(cleanPath));
    });

    await then('the edit is accepted and untouched paragraphs stay byte-identical to the source', () => {
      expect(cleanBlocks).toHaveLength(inputBlocks.length);
      // Edited paragraph: accepted final text, no residual markup.
      expect(cleanBlocks[1]).toContain('two (2) years');
      expect(cleanBlocks[1]).not.toContain('w:ins');
      expect(cleanBlocks[1]).not.toContain('w:del');
      // Untouched paragraphs: byte-identical, keeping proofErr + split runs (#408).
      expect(cleanBlocks[0]).toBe(inputBlocks[0]);
      expect(cleanBlocks[2]).toBe(inputBlocks[2]);
      expect(cleanBlocks[0]).toContain('proofErr');
    });
  });

  humanReadableTest.openspec('comparison-only fields are absent from the save report')('Scenario: comparison-only fields are absent from the save report', async ({ given, when, then }: AllureBddContext) => {
    let session: Awaited<ReturnType<typeof openEditedSession>>;
    let saved: Awaited<ReturnType<typeof save>>;

    await given('a tracked session with an edit', async () => {
      session = await openEditedSession();
    });

    await when('save is called with the deprecated comparison knobs supplied', async () => {
      saved = await save(session.mgr, {
        file_path: session.filePath,
        save_to_local_path: path.join(session.tmpDir, 'both.docx'),
        save_format: 'both',
        tracked_changes_engine: 'atomizer',
        fail_on_rebuild_fallback: true,
      });
      assertSuccess(saved, 'save both');
    });

    await then('the report omits comparison fields and the deprecated knobs are ignored', () => {
      const record = saved as Record<string, unknown>;
      expect(record.tracked_reconstruction_mode).toBeUndefined();
      expect(record.tracked_fallback_reason).toBeUndefined();
      expect(record.tracked_blocks_restored).toBeUndefined();
      expect(record.tracked_restore_error).toBeUndefined();
      expect(saved.tracked_changes_source).toBe('write-time');
    });
  });
});
