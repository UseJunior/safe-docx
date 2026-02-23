import { describe, expect } from 'vitest';
import path from 'node:path';

import { readFile } from './tools/read_file.js';
import { replaceText } from './tools/replace_text.js';
import { insertParagraph } from './tools/insert_paragraph.js';
import { download } from './tools/download.js';
import { openDocument } from './tools/open_document.js';
import {
  firstParaIdFromToon,
  makeDocxWithDocumentXml,
  makeMinimalDocx,
} from './testing/docx_test_utils.js';
import { testAllure } from './testing/allure-test.js';
import {
  openSession,
  assertSuccess,
  assertFailure,
  registerCleanup,
  createTrackedTempDir,
  createTestSessionManager,
  parseOutputXml,
} from './testing/session-test-utils.js';
import fs from 'node:fs/promises';

const TEST_FEATURE = 'add-safe-docx-ts-formatting-parity';

describe('Traceability: TypeScript Formatting Parity', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  registerCleanup();

  humanReadableTest.openspec('read_file returns TOON schema with structure columns')('Scenario: read_file returns TOON schema with structure columns', async () => {
    const { content } = await openSession(['Body paragraph']);
    expect(content).toContain('#SCHEMA id | list_label | header | style | text');
    expect(content).toContain('Body paragraph');
  });

  humanReadableTest.openspec('read_file JSON mode returns node metadata')('Scenario: read_file JSON mode returns node metadata', async () => {
    const { mgr, sessionId } = await openSession(['Alpha']);

    const read = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(read, 'read');
    const nodes = JSON.parse(String(read.content)) as Array<Record<string, unknown>>;
    expect(nodes.length).toBeGreaterThan(0);
    const node = nodes[0]!;
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('list_label');
    expect(node).toHaveProperty('header');
    expect(node).toHaveProperty('style');
    expect(node).toHaveProperty('text');
    expect(node).toHaveProperty('style_fingerprint');
    expect(node).toHaveProperty('header_formatting');
    expect(node).toHaveProperty('numbering');
  });

  humanReadableTest.openspec('fingerprint ignores volatile attributes')('Scenario: fingerprint ignores volatile attributes', async () => {
    const base =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p RSID_MARKER><w:r><w:t>Clause text</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const xmlA = base.replace('RSID_MARKER', 'w:rsidR="00112233" w:rsidRDefault="00112233"');
    const xmlB = base.replace('RSID_MARKER', 'w:rsidR="AABBCCDD" w:rsidRDefault="AABBCCDD"');

    const mgr = createTestSessionManager();
    const tmpDir = await createTrackedTempDir('safe-docx-fingerprint-');
    const pathA = path.join(tmpDir, 'a.docx');
    const pathB = path.join(tmpDir, 'b.docx');
    await fs.writeFile(pathA, new Uint8Array(await makeDocxWithDocumentXml(xmlA)));
    await fs.writeFile(pathB, new Uint8Array(await makeDocxWithDocumentXml(xmlB)));

    const openA = await openDocument(mgr, { file_path: pathA });
    const openB = await openDocument(mgr, { file_path: pathB });
    assertSuccess(openA, 'openA');
    assertSuccess(openB, 'openB');

    const readA = await readFile(mgr, { session_id: openA.session_id as string, format: 'json' });
    const readB = await readFile(mgr, { session_id: openB.session_id as string, format: 'json' });
    assertSuccess(readA, 'readA');
    assertSuccess(readB, 'readB');

    const nodeA = (JSON.parse(String(readA.content)) as Array<Record<string, unknown>>)[0]!;
    const nodeB = (JSON.parse(String(readB.content)) as Array<Record<string, unknown>>)[0]!;
    expect(nodeA.style_fingerprint).toEqual(nodeB.style_fingerprint);
    expect(nodeA.style).toEqual(nodeB.style);
  });

  humanReadableTest.openspec('stable style IDs within a session')('Scenario: stable style IDs within a session', async () => {
    const { mgr, sessionId } = await openSession(['One', 'Two']);

    const read1 = await readFile(mgr, { session_id: sessionId, format: 'json' });
    const read2 = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(read1, 'read1');
    assertSuccess(read2, 'read2');

    const nodes1 = JSON.parse(String(read1.content)) as Array<Record<string, unknown>>;
    const nodes2 = JSON.parse(String(read2.content)) as Array<Record<string, unknown>>;
    expect(nodes1.map((n) => n.style)).toEqual(nodes2.map((n) => n.style));
  });

  humanReadableTest.openspec('formatting-based header detection')('Scenario: formatting-based header detection', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Security Incidents:</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> Recipient must notify promptly.</w:t></w:r>` +
      `</w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId } = await openSession([], { xml });

    const read = await readFile(mgr, { session_id: sessionId });
    assertSuccess(read, 'read');

    const row = String(read.content)
      .split('\n')
      .find((line) => line.startsWith('jr_para_'));
    expect(row).toBeTruthy();
    const cols = row!.split('|').map((c) => c.trim());
    expect(cols[2]).toBe('Security Incidents');
    expect(cols[4]).toContain('Recipient must notify promptly.');
    expect(cols[4]).not.toContain('Security Incidents:');
  });

  humanReadableTest.openspec('defined term bolding via <definition> role model')('Scenario: defined term bolding via <definition> role model', async () => {
    const prevLegacy = process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
    process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = '1';
    try {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:t xml:space="preserve">Definition: </w:t></w:r>` +
        `<w:r><w:t>"</w:t></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Confidential Information</w:t></w:r>` +
        `<w:r><w:t>" means data.</w:t></w:r>` +
        `</w:p>` +
        `<w:p><w:r><w:t>Insert: [TERM]</w:t></w:r></w:p>` +
        `</w:body></w:document>`;

      const { mgr, sessionId, tmpDir } = await openSession([], { xml, prefix: 'safe-docx-def-role-' });
      const outPath = path.join(tmpDir, 'out.docx');

      const read = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(read, 'read');
      const nodes = JSON.parse(String(read.content)) as Array<{ id: string; clean_text: string }>;
      const targetId = nodes.find((n) => n.clean_text.includes('[TERM]'))?.id;
      expect(targetId).toMatch(/^jr_para_[0-9a-f]{12}$/);

      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: targetId!,
        old_string: '[TERM]',
        new_string: '<definition>Closing Cash</definition>',
        instruction: 'definition style role model',
      });
      assertSuccess(edited, 'edit');

      const saved = await download(mgr, {
        session_id: sessionId,
        save_to_local_path: outPath,
        clean_bookmarks: true,
        download_format: 'clean',
      });
      assertSuccess(saved, 'download');

      const { runs, runText, hasBold, dom } = await parseOutputXml(outPath);
      expect(dom.getElementsByTagName('definition').length).toBe(0);

      const termRun = runs.find((r) => runText(r).includes('Closing Cash'));
      expect(termRun).toBeTruthy();
      expect(hasBold(termRun!)).toBe(true);
    } finally {
      if (prevLegacy === undefined) delete process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
      else process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = prevLegacy;
    }
  });

  humanReadableTest.openspec('replace_text preserves mixed-run formatting')('Scenario: replace_text preserves mixed-run formatting', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>ABC</w:t></w:r>` +
      `<w:r><w:t>DEF</w:t></w:r>` +
      `<w:r><w:rPr><w:i/></w:rPr><w:t>GHI</w:t></w:r>` +
      `</w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId, tmpDir, firstParaId: paraId } = await openSession([], { xml, prefix: 'safe-docx-mixed-run-' });
    const outPath = path.join(tmpDir, 'out.docx');

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'ABCDEFGHI',
      new_string: '123456789',
      instruction: 'preserve mixed-run styling',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { runs, runText, hasBold, hasItalic } = await parseOutputXml(outPath);

    const r1 = runs.find((r) => runText(r) === '123');
    const r2 = runs.find((r) => runText(r) === '456');
    const r3 = runs.find((r) => runText(r) === '789');
    expect(r1).toBeTruthy();
    expect(r2).toBeTruthy();
    expect(r3).toBeTruthy();
    expect(hasBold(r1!)).toBe(true);
    expect(hasItalic(r1!)).toBe(false);
    expect(hasBold(r2!)).toBe(false);
    expect(hasItalic(r2!)).toBe(false);
    expect(hasBold(r3!)).toBe(false);
    expect(hasItalic(r3!)).toBe(true);
  });

  humanReadableTest.openspec('insert_paragraph preserves header/definition semantics')('Scenario: insert_paragraph preserves header/definition semantics', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:t>"</w:t></w:r>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Confidential Information</w:t></w:r>` +
      `<w:r><w:t>" means data.</w:t></w:r>` +
      `</w:p>` +
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Security Incidents:</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> Existing text.</w:t></w:r>` +
      `</w:p>` +
      `<w:p><w:r><w:t>Anchor paragraph.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId, tmpDir } = await openSession([], { xml, prefix: 'safe-docx-insert-semantics-' });
    const outPath = path.join(tmpDir, 'out.docx');

    const read = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(read, 'read');
    const nodes = JSON.parse(String(read.content)) as Array<{ id: string; clean_text: string; header: string; text: string }>;
    const anchorId = nodes.find((n) => n.clean_text.includes('Anchor paragraph.'))?.id;
    expect(anchorId).toMatch(/^jr_para_[0-9a-f]{12}$/);

    const inserted = await insertParagraph(mgr, {
      session_id: sessionId,
      positional_anchor_node_id: anchorId!,
      new_string: '<RunInHeader>Security Incidents:</RunInHeader> "Closing Cash" means all unrestricted cash.',
      instruction: 'semantic insert',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert');
    const insertedId = inserted.new_paragraph_id as string;

    const read2 = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(read2, 'read2');
    const nodes2 = JSON.parse(String(read2.content)) as Array<{ id: string; header: string; text: string }>;
    const insertedNode = nodes2.find((n) => n.id === insertedId);
    expect(insertedNode).toBeTruthy();
    expect(insertedNode!.header).toBe('Security Incidents');

    const readToon = await readFile(mgr, { session_id: sessionId });
    assertSuccess(readToon, 'read TOON');
    const row = String(readToon.content)
      .split('\n')
      .find((line) => line.startsWith(`${insertedId} |`));
    expect(row).toBeTruthy();
    const cols = row!.split('|').map((c) => c.trim());
    expect(cols[2]).toBe('Security Incidents');
    expect(cols[4]).toMatch(
      /<definition>(?:<b>)?Closing Cash(?:<\/b>)?<\/definition> means all unrestricted cash\./,
    );
    expect(cols[4]).not.toContain('Security Incidents:');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { runs, runText, hasBold, dom } = await parseOutputXml(outPath);
    expect(dom.getElementsByTagName('definition').length).toBe(0);

    const headerRun = runs.find((r) => runText(r) === 'Security Incidents:');
    const termRun = runs.find((r) => runText(r).includes('Closing Cash'));
    expect(headerRun).toBeTruthy();
    expect(termRun).toBeTruthy();
    expect(hasBold(headerRun!)).toBe(true);
    expect(hasBold(termRun!)).toBe(true);
  });

  humanReadableTest.openspec('auto-tagged explicit definition gets role model styling')('Scenario: auto-tagged explicit definition gets role model styling', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:t>"</w:t></w:r>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Confidential Information</w:t></w:r>` +
      `<w:r><w:t>" means data.</w:t></w:r>` +
      `</w:p>` +
      `<w:p><w:r><w:t>Insert: [DEF]</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId, tmpDir } = await openSession([], { xml, prefix: 'safe-docx-auto-def-' });
    const outPath = path.join(tmpDir, 'out.docx');

    const read = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(read, 'read');
    const nodes = JSON.parse(String(read.content)) as Array<{ id: string; clean_text: string }>;
    const targetId = nodes.find((n) => n.clean_text.includes('[DEF]'))?.id;
    expect(targetId).toMatch(/^jr_para_[0-9a-f]{12}$/);

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: targetId!,
      old_string: '[DEF]',
      new_string: '"Closing Cash" means all unrestricted cash.',
      instruction: 'auto definition detection',
    });
    assertSuccess(edited, 'edit');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { runs, runText, hasBold, dom } = await parseOutputXml(outPath);

    const termRun = runs.find((r) => runText(r) === 'Closing Cash');
    expect(termRun).toBeTruthy();
    expect(hasBold(termRun!)).toBe(true);
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paragraphText = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'))
      .map((p) => Array.from((p as Element).getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent ?? '').join(''))
      .find((text) => text.includes('Insert:'));
    expect(paragraphText).toContain('Insert: "Closing Cash" means all unrestricted cash.');
  });

  humanReadableTest.openspec('header semantics accepted via tags for backward compatibility')('Scenario: header semantics accepted via tags for backward compatibility', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Security Incidents:</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> Existing process.</w:t></w:r>` +
      `</w:p>` +
      `<w:p><w:r><w:t>Placeholder A</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Placeholder B</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId, tmpDir } = await openSession([], { xml, prefix: 'safe-docx-header-tags-' });
    const outPath = path.join(tmpDir, 'out.docx');

    const read = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(read, 'read');
    const nodes = JSON.parse(String(read.content)) as Array<{ id: string; clean_text: string }>;
    const aId = nodes.find((n) => n.clean_text.includes('Placeholder A'))?.id;
    const bId = nodes.find((n) => n.clean_text.includes('Placeholder B'))?.id;
    expect(aId).toMatch(/^jr_para_[0-9a-f]{12}$/);
    expect(bId).toMatch(/^jr_para_[0-9a-f]{12}$/);

    const editA = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: aId!,
      old_string: 'Placeholder A',
      new_string: '<header>Security Incidents:</header> Recipient must notify promptly.',
      instruction: 'header compatibility tag',
    });
    assertSuccess(editA, 'editA');

    const editB = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: bId!,
      old_string: 'Placeholder B',
      new_string: '<RunInHeader>Security Incidents:</RunInHeader> Recipient must escalate promptly.',
      instruction: 'run-in header compatibility tag',
    });
    assertSuccess(editB, 'editB');

    const read2 = await readFile(mgr, { session_id: sessionId, format: 'json' });
    assertSuccess(read2, 'read2');
    const nodes2 = JSON.parse(String(read2.content)) as Array<{ id: string; header: string; text: string }>;
    const nodeA = nodes2.find((n) => n.id === aId);
    const nodeB = nodes2.find((n) => n.id === bId);
    expect(nodeA).toBeTruthy();
    expect(nodeB).toBeTruthy();
    expect(nodeA!.header).toBe('Security Incidents');
    expect(nodeB!.header).toBe('Security Incidents');

    const readToon = await readFile(mgr, { session_id: sessionId });
    assertSuccess(readToon, 'read TOON');
    const rowA = String(readToon.content)
      .split('\n')
      .find((line) => line.startsWith(`${aId} |`));
    const rowB = String(readToon.content)
      .split('\n')
      .find((line) => line.startsWith(`${bId} |`));
    expect(rowA).toBeTruthy();
    expect(rowB).toBeTruthy();
    const colsA = rowA!.split('|').map((c) => c.trim());
    const colsB = rowB!.split('|').map((c) => c.trim());
    expect(colsA[2]).toBe('Security Incidents');
    expect(colsB[2]).toBe('Security Incidents');
    expect(colsA[4]).toContain('Recipient must notify promptly.');
    expect(colsB[4]).toContain('Recipient must escalate promptly.');
    expect(colsA[4]).not.toContain('Security Incidents:');
    expect(colsB[4]).not.toContain('Security Incidents:');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { runs, runText, hasBold } = await parseOutputXml(outPath);

    const headerRuns = runs.filter((r) => runText(r) === 'Security Incidents:');
    expect(headerRuns.length).toBeGreaterThanOrEqual(3);
    expect(headerRuns.every((r) => hasBold(r))).toBe(true);
  });

  humanReadableTest.openspec('field-aware visible text does not destroy fields')('Scenario: field-aware visible text does not destroy fields', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p>` +
      `<w:r><w:t xml:space="preserve">Amount: </w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> MERGEFIELD Amount </w:instrText></w:r>` +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>100</w:t></w:r>` +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      `<w:r><w:t xml:space="preserve"> due.</w:t></w:r>` +
      `</w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId, firstParaId: paraId } = await openSession([], { xml, prefix: 'safe-docx-field-' });

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: 'Amount: 100 due.',
      new_string: 'Amount: 250 due.',
      instruction: 'field-aware refusal',
    });
    assertFailure(edited, 'EDIT_ERROR', 'edit');
    expect(edited.error.message).toContain('unsupported');
  });

  humanReadableTest.openspec('pagination rules deterministic for zero offset')('Scenario: pagination rules deterministic for offset=0', async () => {
    const { mgr, sessionId } = await openSession(['A', 'B']);

    const read = await readFile(mgr, { session_id: sessionId, offset: 0, limit: 1, format: 'simple' });
    assertSuccess(read, 'read');
    expect(String(read.content)).toContain(' | A');
  });

  humanReadableTest.openspec('post-edit invariants prevent empty paragraph stubs')('Scenario: post-edit invariants prevent empty paragraph stubs', async () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>` +
      `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>[PLACEHOLDER]</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const { mgr, sessionId, tmpDir, firstParaId: paraId } = await openSession([], { xml, prefix: 'safe-docx-posthook-' });
    const outPath = path.join(tmpDir, 'out.docx');

    const edited = await replaceText(mgr, {
      session_id: sessionId,
      target_paragraph_id: paraId,
      old_string: '[PLACEHOLDER]',
      new_string: 'X',
      instruction: 'cleanup empty runs',
    });
    assertSuccess(edited, 'edit');

    const inserted = await insertParagraph(mgr, {
      session_id: sessionId,
      positional_anchor_node_id: paraId,
      new_string: 'Next',
      instruction: 'ensure paragraph integrity',
      position: 'AFTER',
    });
    assertSuccess(inserted, 'insert');

    const saved = await download(mgr, {
      session_id: sessionId,
      save_to_local_path: outPath,
      clean_bookmarks: true,
      download_format: 'clean',
    });
    assertSuccess(saved, 'download');

    const { runs } = await parseOutputXml(outPath);
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    for (const run of runs) {
      const nonRPrChildren = Array.from(run.childNodes).filter((child) => {
        if (child.nodeType !== 1) return false;
        const elementChild = child as Element;
        return !(elementChild.namespaceURI === W_NS && elementChild.localName === 'rPr');
      });
      expect(nonRPrChildren.length).toBeGreaterThan(0);
    }
  });
});
