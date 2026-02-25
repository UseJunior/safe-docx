import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { itAllure as it, allureStep, allureJsonAttachment } from './helpers/allure-test.js';
import { DocxDocument } from '../src/primitives/document.js';
import { OOXML, W } from '../src/primitives/namespaces.js';

const TEST_FEATURE = 'add-apply-plan-and-style-source';
const test = it.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });
const humanReadableTest = test.allure({
  tags: ['human-readable'],
  parameters: { audience: 'non-technical' },
});

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${OOXML.W_NS}">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

async function makeDocxBuffer(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', makeDocXml(bodyXml));
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

function getWAttr(el: Element, localName: string): string | null {
  return (
    el.getAttributeNS(OOXML.W_NS, localName) ??
    el.getAttribute(`w:${localName}`) ??
    el.getAttribute(localName)
  );
}

function directWChild(parent: Element, localName: string): Element | null {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI === OOXML.W_NS && el.localName === localName) return el;
  }
  return null;
}

function getParagraphStyleId(paragraph: Element): string | null {
  const pPr = directWChild(paragraph, W.pPr);
  if (!pPr) return null;
  const pStyle = directWChild(pPr, W.pStyle);
  return pStyle ? getWAttr(pStyle, 'val') : null;
}

function getParagraphSpacing(paragraph: Element): { before: string | null; after: string | null } {
  const pPr = directWChild(paragraph, W.pPr);
  if (!pPr) return { before: null, after: null };
  const spacing = directWChild(pPr, W.spacing);
  if (!spacing) return { before: null, after: null };
  return {
    before: getWAttr(spacing, 'before'),
    after: getWAttr(spacing, 'after'),
  };
}

function getFirstRunFormattingTags(paragraph: Element): string[] {
  const firstRun = directWChild(paragraph, W.r);
  if (!firstRun) return [];
  const rPr = directWChild(firstRun, W.rPr);
  if (!rPr) return [];

  const tags: string[] = [];
  for (const child of Array.from(rPr.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI === OOXML.W_NS) tags.push(el.localName);
  }
  return tags;
}

describe('Traceability: insertParagraph styleSourceId', () => {
  humanReadableTest.openspec('styleSourceId clones pPr from specified paragraph')(
    'styleSourceId clones pPr from specified paragraph',
    async () => {
      const bodyXml = [
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>Anchor</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="120" w:after="360"/></w:pPr><w:r><w:t>Style Source</w:t></w:r></w:p>',
      ].join('');

      let doc!: DocxDocument;
      let anchorId = '';
      let styleSourceId = '';
      await allureStep('Given anchor and style-source paragraphs with different paragraph properties', async () => {
        doc = await DocxDocument.load(await makeDocxBuffer(bodyXml));
        doc.insertParagraphBookmarks('style-source-ppr');
        const refs = doc.readParagraphs().paragraphs;
        anchorId = refs[0]!.id;
        styleSourceId = refs[1]!.id;
      });

      let result!: ReturnType<DocxDocument['insertParagraph']>;
      await allureStep('When insertParagraph is called with styleSourceId set to the style-source paragraph', async () => {
        result = doc.insertParagraph({
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Inserted paragraph',
          styleSourceId,
        });
        await allureJsonAttachment('insert-paragraph-style-source-ppr-result', result);
      });

      await allureStep('Then the inserted paragraph clones style-source pPr and is positioned relative to the anchor', async () => {
        const inserted = doc.getParagraphElementById(result.newParagraphId);
        expect(inserted).toBeTruthy();
        const insertedStyleId = getParagraphStyleId(inserted!);
        const insertedSpacing = getParagraphSpacing(inserted!);
        expect(insertedStyleId).toBe('BodyText');
        expect(insertedSpacing).toEqual({ before: '120', after: '360' });

        const orderedIds = doc.readParagraphs().paragraphs.map((p) => p.id);
        expect(orderedIds.indexOf(result.newParagraphId)).toBe(orderedIds.indexOf(anchorId) + 1);
      });
    },
  );

  humanReadableTest.openspec('styleSourceId selects template run from style source')(
    'styleSourceId selects template run from style source',
    async () => {
      const bodyXml = [
        '<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Anchor</w:t></w:r></w:p>',
        [
          '<w:p>',
          '<w:r><w:rPr><w:b/></w:rPr><w:t>X</w:t></w:r>',
          '<w:r><w:rPr><w:i/></w:rPr><w:t>Longest template run text</w:t></w:r>',
          '</w:p>',
        ].join(''),
      ].join('');

      let doc!: DocxDocument;
      let anchorId = '';
      let styleSourceId = '';
      await allureStep('Given a style-source paragraph with multiple runs and distinct run formatting', async () => {
        doc = await DocxDocument.load(await makeDocxBuffer(bodyXml));
        doc.insertParagraphBookmarks('style-source-template-run');
        const refs = doc.readParagraphs().paragraphs;
        anchorId = refs[0]!.id;
        styleSourceId = refs[1]!.id;
      });

      let result!: ReturnType<DocxDocument['insertParagraph']>;
      await allureStep('When insertParagraph is called with styleSourceId', async () => {
        result = doc.insertParagraph({
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Inserted via style source',
          styleSourceId,
        });
      });

      await allureStep('Then the inserted run formatting is cloned from the style-source template run', async () => {
        const inserted = doc.getParagraphElementById(result.newParagraphId);
        expect(inserted).toBeTruthy();
        const tags = getFirstRunFormattingTags(inserted!);
        await allureJsonAttachment('insert-paragraph-style-source-template-run-tags', { tags });

        expect(tags).toContain('i');
        expect(tags).not.toContain('b');
        expect(tags).not.toContain('u');
      });
    },
  );

  humanReadableTest.openspec('styleSourceId not found falls back to anchor')(
    'styleSourceId not found falls back to anchor',
    async () => {
      const bodyXml = [
        '<w:p><w:pPr><w:pStyle w:val="HeadingFallback"/></w:pPr><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Anchor</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="BodyIgnored"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Style Source</w:t></w:r></w:p>',
      ].join('');

      let doc!: DocxDocument;
      let anchorId = '';
      await allureStep('Given a styleSourceId that does not exist in the document', async () => {
        doc = await DocxDocument.load(await makeDocxBuffer(bodyXml));
        doc.insertParagraphBookmarks('style-source-fallback');
        anchorId = doc.readParagraphs().paragraphs[0]!.id;
      });

      let result!: ReturnType<DocxDocument['insertParagraph']>;
      await allureStep('When insertParagraph is called with the missing styleSourceId', async () => {
        result = doc.insertParagraph({
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Inserted with fallback',
          styleSourceId: '_bk_missing_style_source',
        });
      });

      await allureStep('Then the primitive falls back to anchor formatting and sets styleSourceFallback=true', async () => {
        expect(result.styleSourceFallback).toBe(true);
        const inserted = doc.getParagraphElementById(result.newParagraphId);
        expect(inserted).toBeTruthy();

        const styleId = getParagraphStyleId(inserted!);
        const tags = getFirstRunFormattingTags(inserted!);
        await allureJsonAttachment('insert-paragraph-style-source-fallback', { styleId, tags });

        expect(styleId).toBe('HeadingFallback');
        expect(tags).toContain('u');
        expect(tags).not.toContain('i');
      });
    },
  );

  humanReadableTest.openspec('styleSourceId omitted preserves existing behavior')(
    'styleSourceId omitted preserves existing behavior',
    async () => {
      const bodyXml = [
        '<w:p><w:pPr><w:pStyle w:val="AnchorDefault"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Anchor</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="OtherStyle"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Other</w:t></w:r></w:p>',
      ].join('');

      let doc!: DocxDocument;
      let anchorId = '';
      await allureStep('Given anchor and non-anchor paragraphs with different formatting', async () => {
        doc = await DocxDocument.load(await makeDocxBuffer(bodyXml));
        doc.insertParagraphBookmarks('style-source-omitted');
        anchorId = doc.readParagraphs().paragraphs[0]!.id;
      });

      let result!: ReturnType<DocxDocument['insertParagraph']>;
      await allureStep('When insertParagraph is called without styleSourceId', async () => {
        result = doc.insertParagraph({
          positionalAnchorNodeId: anchorId,
          relativePosition: 'AFTER',
          newText: 'Inserted without style source',
        });
      });

      await allureStep('Then anchor formatting is used and styleSourceFallback is not set', async () => {
        expect(result.styleSourceFallback).toBeUndefined();
        const inserted = doc.getParagraphElementById(result.newParagraphId);
        expect(inserted).toBeTruthy();

        const styleId = getParagraphStyleId(inserted!);
        const tags = getFirstRunFormattingTags(inserted!);
        await allureJsonAttachment('insert-paragraph-style-source-omitted', { styleId, tags });

        expect(styleId).toBe('AnchorDefault');
        expect(tags).toContain('b');
        expect(tags).not.toContain('i');
      });
    },
  );
});
