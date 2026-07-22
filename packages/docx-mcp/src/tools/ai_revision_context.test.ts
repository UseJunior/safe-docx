import path from 'node:path';
import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { SessionManager } from '../session/manager.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readDocumentXmlFromPath } from '../testing/docx_test_utils.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { formatLayout } from './format_layout.js';
import { insertParagraph } from './insert_paragraph.js';
import { replaceText } from './replace_text.js';
import { save } from './save.js';

const WORDPROCESSING_ML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI_AUTHOR = 'SafeDocX';
const test = testAllure.epic('Document Editing').withLabels({ feature: 'AI Revision Context' });

function createManager(aiAuthor: string | null = AI_AUTHOR): SessionManager {
  return new SessionManager({ ttlMs: 60_000, defaultAiAuthor: aiAuthor });
}

function wordAttr(element: Element, localName: string): string | null {
  return (
    element.getAttributeNS(WORDPROCESSING_ML_NS, localName)
    ?? element.getAttribute(`w:${localName}`)
    ?? element.getAttribute(localName)
  );
}

function findRevisionElements(doc: Document, localName: string, author: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS(WORDPROCESSING_ML_NS, localName)).filter(
    (node) => wordAttr(node, 'author') === author,
  );
}

function visibleDocumentText(doc: Document): string {
  return Array.from(doc.getElementsByTagNameNS(WORDPROCESSING_ML_NS, 't'))
    .map((node) => node.textContent ?? '')
    .join('');
}

async function saveCleanAndReadXml(
  mgr: SessionManager,
  inputPath: string,
  outputPath: string,
): Promise<{ result: Awaited<ReturnType<typeof save>>; xml: string; doc: Document }> {
  // #126: write-time tracked markup is in the tracked (redline) artifact; the
  // clean artifact accepts the AI edits. Read the tracked output here. For an
  // untracked session (no AI author) the tracked artifact carries no markup, so
  // the "no tracked markup" case still holds.
  const result = await save(mgr, {
    file_path: inputPath,
    save_to_local_path: outputPath,
    save_format: 'tracked',
  });
  assertSuccess(result, 'save');

  const xml = await readDocumentXmlFromPath(outputPath);
  return { result, xml, doc: parseXml(xml) };
}

describe('tracked AI revisions through MCP tools', () => {
  registerCleanup();

  test('replace_text emits insertion and deletion wrappers with the configured author', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const opened = await given('a tracked session with one paragraph', () =>
      openSession(['Alpha Beta'], { mgr: createManager() }),
    );

    const edited = await when('replace_text edits the paragraph', () =>
      replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Alpha',
        new_string: 'Gamma',
        instruction: 'Replace Alpha with Gamma.',
      }),
    );
    assertSuccess(edited, 'replace_text');

    const saved = await then('the clean save contains AI-authored insertion and deletion markup', () =>
      saveCleanAndReadXml(opened.mgr, opened.inputPath, path.join(opened.tmpDir, 'replace-text.docx')),
    );

    expect(findRevisionElements(saved.doc, 'ins', AI_AUTHOR)).toHaveLength(1);
    expect(findRevisionElements(saved.doc, 'del', AI_AUTHOR)).toHaveLength(1);
    expect(visibleDocumentText(saved.doc)).toContain('Gamma Beta');
  });

  test('insert_paragraph emits paragraph-mark and run-level insertions with the configured author', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const opened = await given('a tracked session with an anchor paragraph', () =>
      openSession(['Anchor paragraph.'], { mgr: createManager() }),
    );

    const inserted = await when('insert_paragraph adds a paragraph after the anchor', () =>
      insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: opened.firstParaId,
        new_string: 'Inserted paragraph.',
        instruction: 'Insert a paragraph after the anchor.',
      }),
    );
    assertSuccess(inserted, 'insert_paragraph');

    const saved = await then('the saved document preserves both insertion markers with the AI author', () =>
      saveCleanAndReadXml(opened.mgr, opened.inputPath, path.join(opened.tmpDir, 'insert-paragraph.docx')),
    );

    const insertions = findRevisionElements(saved.doc, 'ins', AI_AUTHOR);
    const paragraphMarkInsertion = insertions.find(
      (element) => (element.parentNode as Element | null)?.localName === 'rPr',
    );
    const runLevelInsertion = insertions.find(
      (element) => element.textContent?.includes('Inserted paragraph.') === true,
    );

    expect(paragraphMarkInsertion).toBeDefined();
    expect(runLevelInsertion).toBeDefined();
  });

  test('format_layout emits pPrChange with the configured author', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const opened = await given('a tracked session with a paragraph to reformat', () =>
      openSession(['Spacing paragraph.'], { mgr: createManager() }),
    );

    const formatted = await when('format_layout applies paragraph spacing', () =>
      formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_spacing: {
          paragraph_ids: [opened.firstParaId],
          before_twips: 240,
        },
      }),
    );
    assertSuccess(formatted, 'format_layout');

    const saved = await then('the saved document contains a tracked paragraph property change', () =>
      saveCleanAndReadXml(opened.mgr, opened.inputPath, path.join(opened.tmpDir, 'format-layout.docx')),
    );

    expect(findRevisionElements(saved.doc, 'pPrChange', AI_AUTHOR)).toHaveLength(1);
  });

  test('replace_text stays byte-compatible with untracked mode when aiAuthor is null', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const opened = await given('an untracked session', () =>
      openSession(['Alpha Beta'], { mgr: createManager(null) }),
    );

    const edited = await when('replace_text edits the paragraph', () =>
      replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.firstParaId,
        old_string: 'Alpha',
        new_string: 'Gamma',
        instruction: 'Replace Alpha with Gamma.',
      }),
    );
    assertSuccess(edited, 'replace_text');

    const saved = await then('the clean save contains no tracked insertion or deletion markup', () =>
      saveCleanAndReadXml(opened.mgr, opened.inputPath, path.join(opened.tmpDir, 'untracked.docx')),
    );

    expect(saved.xml).not.toContain('<w:ins');
    expect(saved.xml).not.toContain('<w:del');
  });

  test('new revision ids start after the highest pre-existing w:id in the document', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${WORDPROCESSING_ML_NS}">` +
      `<w:body>` +
      `<w:p><w:r><w:t>Alpha Beta</w:t></w:r></w:p>` +
      `<w:p><w:ins w:id="42" w:author="Existing" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Prior revision</w:t></w:r></w:ins></w:p>` +
      `</w:body></w:document>`;

    const opened = await given('a tracked session whose source document already contains revision id 42', () =>
      openSession([], { mgr: createManager(), xml }),
    );

    const edited = await when('replace_text emits a new tracked revision', () =>
      replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[0]!,
        old_string: 'Alpha',
        new_string: 'Gamma',
        instruction: 'Replace Alpha with Gamma.',
      }),
    );
    assertSuccess(edited, 'replace_text');

    const saved = await then('the new AI-authored revision ids avoid the existing id range', () =>
      saveCleanAndReadXml(opened.mgr, opened.inputPath, path.join(opened.tmpDir, 'collision.docx')),
    );

    const ids = [
      ...findRevisionElements(saved.doc, 'ins', AI_AUTHOR),
      ...findRevisionElements(saved.doc, 'del', AI_AUTHOR),
    ]
      .map((element) => Number.parseInt(wordAttr(element, 'id') ?? '', 10))
      .filter((id) => Number.isFinite(id));

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id >= 43)).toBe(true);
  });

  test('save reports AI-emitted revisions after multiple tracked MCP edits', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    const opened = await given('a tracked session with two paragraphs', () =>
      openSession(['Alpha Beta', 'Spacing paragraph.'], { mgr: createManager() }),
    );

    const replaced = await when('replace_text edits the first paragraph', () =>
      replaceText(opened.mgr, {
        file_path: opened.inputPath,
        target_paragraph_id: opened.paraIds[0]!,
        old_string: 'Alpha',
        new_string: 'Gamma',
        instruction: 'Replace Alpha with Gamma.',
      }),
    );
    assertSuccess(replaced, 'replace_text');

    const inserted = await when('insert_paragraph adds a new paragraph', () =>
      insertParagraph(opened.mgr, {
        file_path: opened.inputPath,
        positional_anchor_node_id: opened.paraIds[1]!,
        new_string: 'Inserted paragraph.',
        instruction: 'Insert a paragraph after the spacing paragraph.',
      }),
    );
    assertSuccess(inserted, 'insert_paragraph');

    const formatted = await when('format_layout applies spacing to the second paragraph', () =>
      formatLayout(opened.mgr, {
        file_path: opened.inputPath,
        paragraph_spacing: {
          paragraph_ids: [opened.paraIds[1]!],
          before_twips: 240,
        },
      }),
    );
    assertSuccess(formatted, 'format_layout');

    const saved = await then('save returns a revision summary for the emitted AI changes', () =>
      saveCleanAndReadXml(opened.mgr, opened.inputPath, path.join(opened.tmpDir, 'summary.docx')),
    );

    const revisions = saved.result.revisions as { count: number; author: string; ids?: number[] } | undefined;
    expect(revisions).toBeDefined();
    expect(revisions?.author).toBe(AI_AUTHOR);
    expect(revisions?.count).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(revisions?.ids)).toBe(true);
    expect(revisions?.ids?.length).toBeGreaterThanOrEqual(5);
    expect(saved.xml).toContain('w:pPrChange');
  });
});
