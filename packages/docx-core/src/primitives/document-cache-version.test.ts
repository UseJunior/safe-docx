import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { DocxDocument } from './document.js';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: 'Document view cache' });

describe('document mutation versions', () => {
  test('reading cached views never resets the mutation version', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('before')));
    doc.insertParagraphBookmarks('cache-version');
    const version = doc.getMutationVersion();
    const first = doc.buildDocumentView();
    expect(doc.buildDocumentView().nodes).toBe(first.nodes);
    expect(doc.getMutationVersion()).toBe(version);
    const id = doc.readParagraphs().paragraphs[0]!.id;
    doc.replaceText({ targetParagraphId: id, findText: 'before', replaceText: 'after' });
    expect(doc.getMutationVersion()).toBeGreaterThan(version);
    expect(doc.buildDocumentView().nodes).not.toBe(first.nodes);
    const changed = doc.getMutationVersion();
    doc.buildDocumentView({ showFormatting: true });
    expect(doc.getMutationVersion()).toBe(changed);
  });

  test('official notification invalidates a view after exposed DOM mutation', async () => {
    const doc = await DocxDocument.load(await buildDocxFromBodyXml(paragraphWithText('before')));
    doc.insertParagraphBookmarks('cache-notification');
    const first = doc.buildDocumentView();
    const paragraph = doc.getParagraphElementById(doc.readParagraphs().paragraphs[0]!.id)!;
    paragraph.getElementsByTagName('w:t')[0]!.textContent = 'after';
    doc.markMutated();
    const next = doc.buildDocumentView();
    expect(next.nodes).not.toBe(first.nodes);
    expect(next.nodes[0]!.clean_text).toBe('after');
  });
});
