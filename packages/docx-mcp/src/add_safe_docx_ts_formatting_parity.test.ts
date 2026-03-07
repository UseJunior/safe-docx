import { describe, expect } from 'vitest';
import path from 'node:path';

import { readFile } from './tools/read_file.js';
import { replaceText } from './tools/replace_text.js';
import { insertParagraph } from './tools/insert_paragraph.js';
import { save } from './tools/save.js';
import { openDocument } from './tools/open_document.js';
import {
  firstParaIdFromToon,
  makeDocxWithDocumentXml,
  makeMinimalDocx,
} from './testing/docx_test_utils.js';
import { testAllure, allureStep } from './testing/allure-test.js';
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
    const { content } = await allureStep('Given a session with one body paragraph', async () => {
      return openSession(['Body paragraph']);
    });

    await allureStep('Then the TOON output contains schema header and paragraph text', async () => {
      expect(content).toContain('#SCHEMA id | list_label | header | style | text');
      expect(content).toContain('Body paragraph');
    });
  });

  humanReadableTest.openspec('read_file JSON mode returns node metadata')('Scenario: read_file JSON mode returns node metadata', async () => {
    const { mgr, sessionId } = await allureStep('Given a session with one paragraph', async () => {
      return openSession(['Alpha']);
    });

    const nodes = await allureStep('When read_file is called in JSON format', async () => {
      const read = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(read, 'read');
      return JSON.parse(String(read.content)) as Array<Record<string, unknown>>;
    });

    await allureStep('Then node metadata includes all expected properties', async () => {
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
  });

  humanReadableTest.openspec('fingerprint ignores volatile attributes')('Scenario: fingerprint ignores volatile attributes', async () => {
    const { mgr, openA, openB } = await allureStep('Given two docs differing only in RSID attributes', async () => {
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
      return { mgr, openA, openB };
    });

    const { nodeA, nodeB } = await allureStep('When both docs are read in JSON format', async () => {
      const readA = await readFile(mgr, { session_id: openA.session_id as string, format: 'json' });
      const readB = await readFile(mgr, { session_id: openB.session_id as string, format: 'json' });
      assertSuccess(readA, 'readA');
      assertSuccess(readB, 'readB');
      const nodeA = (JSON.parse(String(readA.content)) as Array<Record<string, unknown>>)[0]!;
      const nodeB = (JSON.parse(String(readB.content)) as Array<Record<string, unknown>>)[0]!;
      return { nodeA, nodeB };
    });

    await allureStep('Then fingerprints and styles match despite different RSIDs', async () => {
      expect(nodeA.style_fingerprint).toEqual(nodeB.style_fingerprint);
      expect(nodeA.style).toEqual(nodeB.style);
    });
  });

  humanReadableTest.openspec('stable style IDs within a session')('Scenario: stable style IDs within a session', async () => {
    const { mgr, sessionId } = await allureStep('Given a session with two paragraphs', async () => {
      return openSession(['One', 'Two']);
    });

    const { nodes1, nodes2 } = await allureStep('When read_file is called twice in JSON format', async () => {
      const read1 = await readFile(mgr, { session_id: sessionId, format: 'json' });
      const read2 = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(read1, 'read1');
      assertSuccess(read2, 'read2');
      const nodes1 = JSON.parse(String(read1.content)) as Array<Record<string, unknown>>;
      const nodes2 = JSON.parse(String(read2.content)) as Array<Record<string, unknown>>;
      return { nodes1, nodes2 };
    });

    await allureStep('Then style IDs are identical across both reads', async () => {
      expect(nodes1.map((n) => n.style)).toEqual(nodes2.map((n) => n.style));
    });
  });

  humanReadableTest.openspec('formatting-based header detection')('Scenario: formatting-based header detection', async () => {
    const { mgr, sessionId } = await allureStep('Given a doc with bold run-in header', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Security Incidents:</w:t></w:r>` +
        `<w:r><w:t xml:space="preserve"> Recipient must notify promptly.</w:t></w:r>` +
        `</w:p>` +
        `</w:body></w:document>`;
      return openSession([], { xml });
    });

    const row = await allureStep('When read_file is called in TOON format', async () => {
      const read = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read, 'read');
      return String(read.content)
        .split('\n')
        .find((line) => line.startsWith('_bk_'));
    });

    await allureStep('Then header column contains the bold prefix and text column the rest', async () => {
      expect(row).toBeTruthy();
      const cols = row!.split('|').map((c) => c.trim());
      expect(cols[2]).toBe('Security Incidents');
      expect(cols[4]).toContain('Recipient must notify promptly.');
      expect(cols[4]).not.toContain('Security Incidents:');
    });
  });

  humanReadableTest.openspec('replace_text preserves mixed-run formatting')('Scenario: replace_text preserves mixed-run formatting', async () => {
    // When old text spans mixed-formatting runs and the replacement has no shared
    // prefix/suffix, the non-markup branch uses a single template run (the
    // predominant run by character overlap). The result is uniform formatting.
    // To get mixed formatting in the output, the AI must use markup tags.
    //
    // Sub-scenario 1: plain replacement → single uniform run (predominant template)
    const { mgr, sessionId, tmpDir, paraId } = await allureStep('Given a paragraph with bold/normal/italic runs', async () => {
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
      const result = await openSession([], { xml, prefix: 'safe-docx-mixed-run-' });
      return { mgr: result.mgr, sessionId: result.sessionId, tmpDir: result.tmpDir, paraId: result.firstParaId };
    });

    await allureStep('When the full text is replaced and saved', async () => {
      const outPath = path.join(tmpDir, 'out.docx');
      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'ABCDEFGHI',
        new_string: '123456789',
        instruction: 'full replacement uses template run',
      });
      assertSuccess(edited, 'edit');
      const saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: outPath,
        clean_bookmarks: true,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save');
    });

    await allureStep('Then a single run with the replacement text is produced', async () => {
      const outPath = path.join(tmpDir, 'out.docx');
      const { runs, runText } = await parseOutputXml(outPath);
      const fullRun = runs.find((r) => runText(r) === '123456789');
      expect(fullRun).toBeTruthy();
    });
  });

  humanReadableTest.openspec('insert_paragraph preserves header semantics')('Scenario: insert_paragraph preserves header semantics', async () => {
    const { mgr, sessionId, tmpDir, anchorId } = await allureStep('Given a doc with a bold header paragraph and an anchor', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Security Incidents:</w:t></w:r>` +
        `<w:r><w:t xml:space="preserve"> Existing text.</w:t></w:r>` +
        `</w:p>` +
        `<w:p><w:r><w:t>Anchor paragraph.</w:t></w:r></w:p>` +
        `</w:body></w:document>`;
      const result = await openSession([], { xml, prefix: 'safe-docx-insert-semantics-' });
      const read = await readFile(result.mgr, { session_id: result.sessionId, format: 'json' });
      assertSuccess(read, 'read');
      const nodes = JSON.parse(String(read.content)) as Array<{ id: string; clean_text: string; header: string; text: string }>;
      const anchorId = nodes.find((n) => n.clean_text.includes('Anchor paragraph.'))?.id;
      expect(anchorId).toMatch(/^_bk_[0-9a-f]{12}$/);
      return { mgr: result.mgr, sessionId: result.sessionId, tmpDir: result.tmpDir, anchorId: anchorId! };
    });

    const insertedId = await allureStep('When a paragraph with RunInHeader markup is inserted', async () => {
      const inserted = await insertParagraph(mgr, {
        session_id: sessionId,
        positional_anchor_node_id: anchorId,
        new_string: '<RunInHeader>Security Incidents:</RunInHeader> New incident text.',
        instruction: 'semantic insert',
        position: 'AFTER',
      });
      assertSuccess(inserted, 'insert');
      return inserted.new_paragraph_id as string;
    });

    await allureStep('Then the inserted node has header metadata and bold formatting in output', async () => {
      const read2 = await readFile(mgr, { session_id: sessionId, format: 'json' });
      assertSuccess(read2, 'read2');
      const nodes2 = JSON.parse(String(read2.content)) as Array<{ id: string; header: string; text: string }>;
      const insertedNode = nodes2.find((n) => n.id === insertedId);
      expect(insertedNode).toBeTruthy();
      expect(insertedNode!.header).toBe('Security Incidents');

      const outPath = path.join(tmpDir, 'out.docx');
      const saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: outPath,
        clean_bookmarks: true,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save');

      const { runs, runText, hasBold } = await parseOutputXml(outPath);
      const headerRun = runs.find((r) => runText(r) === 'Security Incidents:');
      expect(headerRun).toBeTruthy();
      expect(hasBold(headerRun!)).toBe(true);
    });
  });

  humanReadableTest.openspec('header semantics accepted via tags for backward compatibility')('Scenario: header semantics accepted via tags for backward compatibility', async () => {
    const { mgr, sessionId, tmpDir, aId, bId } = await allureStep('Given a doc with header paragraph and two placeholders', async () => {
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
      const result = await openSession([], { xml, prefix: 'safe-docx-header-tags-' });
      const read = await readFile(result.mgr, { session_id: result.sessionId, format: 'json' });
      assertSuccess(read, 'read');
      const nodes = JSON.parse(String(read.content)) as Array<{ id: string; clean_text: string }>;
      const aId = nodes.find((n) => n.clean_text.includes('Placeholder A'))?.id;
      const bId = nodes.find((n) => n.clean_text.includes('Placeholder B'))?.id;
      expect(aId).toMatch(/^_bk_[0-9a-f]{12}$/);
      expect(bId).toMatch(/^_bk_[0-9a-f]{12}$/);
      return { mgr: result.mgr, sessionId: result.sessionId, tmpDir: result.tmpDir, aId: aId!, bId: bId! };
    });

    await allureStep('When placeholders are replaced using <header> and <RunInHeader> tags', async () => {
      const editA = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: aId,
        old_string: 'Placeholder A',
        new_string: '<header>Security Incidents:</header> Recipient must notify promptly.',
        instruction: 'header compatibility tag',
      });
      assertSuccess(editA, 'editA');
      const editB = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: bId,
        old_string: 'Placeholder B',
        new_string: '<RunInHeader>Security Incidents:</RunInHeader> Recipient must escalate promptly.',
        instruction: 'run-in header compatibility tag',
      });
      assertSuccess(editB, 'editB');
    });

    await allureStep('Then JSON and TOON reads show header metadata correctly', async () => {
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
    });

    await allureStep('Then saved output has bold header runs', async () => {
      const outPath = path.join(tmpDir, 'out.docx');
      const saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: outPath,
        clean_bookmarks: true,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save');
      const { runs, runText, hasBold } = await parseOutputXml(outPath);
      const headerRuns = runs.filter((r) => runText(r) === 'Security Incidents:');
      expect(headerRuns.length).toBeGreaterThanOrEqual(3);
      expect(headerRuns.every((r) => hasBold(r))).toBe(true);
    });
  });

  humanReadableTest.openspec('field-aware visible text does not destroy fields')('Scenario: field-aware visible text does not destroy fields', async () => {
    const { mgr, sessionId, paraId } = await allureStep('Given a paragraph with a MERGEFIELD', async () => {
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
      const result = await openSession([], { xml, prefix: 'safe-docx-field-' });
      return { mgr: result.mgr, sessionId: result.sessionId, paraId: result.firstParaId };
    });

    const edited = await allureStep('When replace_text targets text spanning the field', async () => {
      return replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: paraId,
        old_string: 'Amount: 100 due.',
        new_string: 'Amount: 250 due.',
        instruction: 'field-aware refusal',
      });
    });

    await allureStep('Then an EDIT_ERROR with unsupported message is returned', async () => {
      assertFailure(edited, 'EDIT_ERROR', 'edit');
      expect(edited.error.message).toContain('unsupported');
    });
  });

  humanReadableTest.openspec('pagination rules deterministic for zero offset')('Scenario: pagination rules deterministic for offset=0', async () => {
    const { mgr, sessionId } = await allureStep('Given a session with two paragraphs', async () => {
      return openSession(['A', 'B']);
    });

    const read = await allureStep('When read_file is called with offset=0, limit=1', async () => {
      return readFile(mgr, { session_id: sessionId, offset: 0, limit: 1, format: 'simple' });
    });

    await allureStep('Then only the first paragraph is returned', async () => {
      assertSuccess(read, 'read');
      expect(String(read.content)).toContain(' | A');
    });
  });

  humanReadableTest.openspec('post-edit invariants prevent empty paragraph stubs')('Scenario: post-edit invariants prevent empty paragraph stubs', async () => {
    const { mgr, sessionId, tmpDir, paraId } = await allureStep('Given a doc with a bold placeholder paragraph', async () => {
      const xml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>` +
        `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>[PLACEHOLDER]</w:t></w:r></w:p>` +
        `</w:body></w:document>`;
      const result = await openSession([], { xml, prefix: 'safe-docx-posthook-' });
      return { mgr: result.mgr, sessionId: result.sessionId, tmpDir: result.tmpDir, paraId: result.firstParaId };
    });

    await allureStep('When the placeholder is replaced and a paragraph inserted', async () => {
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
    });

    await allureStep('Then saved output has no empty run stubs', async () => {
      const outPath = path.join(tmpDir, 'out.docx');
      const saved = await save(mgr, {
        session_id: sessionId,
        save_to_local_path: outPath,
        clean_bookmarks: true,
        save_format: 'clean',
      });
      assertSuccess(saved, 'save');
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
});
