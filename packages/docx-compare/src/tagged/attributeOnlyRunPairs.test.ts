import { describe, expect } from 'vitest';
import { DocxArchive, DocxDocument, buildSyntheticDocx, parseXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { compareDocuments, acceptAllChanges, rejectAllChanges } from '../index.js';

const TEST_FEATURE = 'Attribute-only run pairs';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The revision wrapper (`ins` or `del`) enclosing an element, if any. */
function wrapperOf(element: Element): string | undefined {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === W && ['ins', 'del'].includes((node as Element).localName)) {
      return (node as Element).localName;
    }
  }
  return undefined;
}
async function nativeDocumentXml(docx: Buffer, operation: 'acceptChanges' | 'rejectChanges'): Promise<string> {
  const complete = await DocxDocument.load(docx);
  await complete[operation]();
  return (await DocxArchive.load((await complete.toBuffer()).buffer)).getDocumentXml();
}

/**
 * A deleted/inserted pair of runs whose only difference is an attribute of the
 * run content is a real change: collapsing it into one untracked run would
 * make Reject return the revised value. The retired legacy no-op suppression
 * compared run content without attributes (#871); these pins keep that from
 * returning. Note references are covered by the note reference identity suite,
 * where an aligned pair is reconciled into one anchor with tracked definition
 * history rather than collapsed.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/852
 */
describe('attribute-only run pairs stay tracked', () => {
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.3.3.30' })('tracks a symbol whose only change is its character code', async () => {
    const body = (char: string) => '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r>' +
      `<w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr><w:sym w:font="Wingdings" w:char="${char}"/></w:r>` +
      '<w:r><w:t xml:space="preserve"> Bravo</w:t></w:r></w:p>';
    const result = await compareDocuments(await buildDocxFromBodyXml(body('F0A8')), await buildDocxFromBodyXml(body('F0FE')));
    const xml = await (await DocxArchive.load(result.document)).getDocumentXml();
    const symbols = (source: string) => Array.from(parseXml(source).getElementsByTagNameNS(W, 'sym'));
    expect(symbols(xml).map(sym => `${wrapperOf(sym)}:${sym.getAttributeNS(W, 'char')}`)).toEqual(['del:F0A8', 'ins:F0FE']);
    for (const [accepted, rejected] of [
      [acceptAllChanges(xml), rejectAllChanges(xml)],
      [await nativeDocumentXml(result.document, 'acceptChanges'), await nativeDocumentXml(result.document, 'rejectChanges')],
    ]) {
      expect(symbols(accepted!).map(sym => sym.getAttributeNS(W, 'char'))).toEqual(['F0FE']);
      expect(symbols(rejected!).map(sym => sym.getAttributeNS(W, 'char'))).toEqual(['F0A8']);
    }
  });
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.5' })('tracks a comment reference whose only change is the comment it names', async () => {
    const original = await buildSyntheticDocx({ paragraphs: ['Commented clause stays'], commentOnParagraph: 0, commentText: 'Original remark' });
    const revised = await buildSyntheticDocx({ paragraphs: ['Commented clause stays'], commentOnParagraph: 0, commentText: 'Revised remark' });
    const result = await compareDocuments(original, revised);
    const archive = await DocxArchive.load(result.document);
    const xml = await archive.getDocumentXml();
    const comments = new Map(Array.from(parseXml((await archive.getFile('word/comments.xml'))!).getElementsByTagNameNS(W, 'comment'))
      .map(comment => [comment.getAttributeNS(W, 'id'), comment.textContent]));
    const references = (source: string) => Array.from(parseXml(source).getElementsByTagNameNS(W, 'commentReference'));
    expect(references(xml).map(reference => `${wrapperOf(reference)}:${comments.get(reference.getAttributeNS(W, 'id'))}`))
      .toEqual(['del:Original remark', 'ins:Revised remark']);
    for (const [accepted, rejected] of [
      [acceptAllChanges(xml), rejectAllChanges(xml)],
      [await nativeDocumentXml(result.document, 'acceptChanges'), await nativeDocumentXml(result.document, 'rejectChanges')],
    ]) {
      expect(references(accepted!).map(reference => comments.get(reference.getAttributeNS(W, 'id')))).toEqual(['Revised remark']);
      expect(references(rejected!).map(reference => comments.get(reference.getAttributeNS(W, 'id')))).toEqual(['Original remark']);
    }
  });
});
