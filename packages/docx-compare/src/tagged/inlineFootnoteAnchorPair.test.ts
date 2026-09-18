import { describe, expect } from 'vitest';
import { parseXml, serializeXml } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { alignedInlineFootnoteAnchorPair } from './inlineFootnoteAnchorPair.js';

const TEST_FEATURE = 'Inline footnote anchor eligibility';
const test = testAllure.epic('Document Comparison').withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' });
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AUTHOR = 'Comparator';

function pairFixture(properties = '', whitespace = '') {
  // These dedicated wrapper shapes are the subject of the eligibility tests,
  // including deliberately ambiguous/malformed controls; not package fixtures.
  const document = parseXml(`<w:document xmlns:w="${W}"><w:body><w:p><w:del w:id="10" w:author="${AUTHOR}" w:date="2026-09-17T00:00:00Z">${whitespace}<w:r>${whitespace}${properties}<w:footnoteReference w:id="1"/>${whitespace}</w:r>${whitespace}</w:del>${whitespace}<w:ins w:id="11" w:author="${AUTHOR}" w:date="2026-09-17T00:00:00Z">${whitespace}<w:r>${whitespace}${properties}<w:footnoteReference w:id="2"/>${whitespace}</w:r>${whitespace}</w:ins></w:p></w:body></w:document>`);
  const paragraph = document.getElementsByTagNameNS(W, 'p')[0]!;
  const oldWrapper = document.getElementsByTagNameNS(W, 'del')[0]!;
  const newWrapper = document.getElementsByTagNameNS(W, 'ins')[0]!;
  const oldRun = oldWrapper.getElementsByTagNameNS(W, 'r')[0]!;
  const newRun = newWrapper.getElementsByTagNameNS(W, 'r')[0]!;
  const oldReference = oldRun.getElementsByTagNameNS(W, 'footnoteReference')[0]!;
  const newReference = newRun.getElementsByTagNameNS(W, 'footnoteReference')[0]!;
  return { document, paragraph, oldWrapper, newWrapper, oldRun, newRun, oldReference, newReference };
}
type PairFixture = ReturnType<typeof pairFixture>;

function replaceElement(element: Element, namespace: string, name: string) {
  const replacement = element.ownerDocument!.createElementNS(namespace, name);
  for (const attribute of Array.from(element.attributes)) {
    replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.parentNode!.replaceChild(replacement, element);
  return replacement;
}

describe('pure inline footnote anchor eligibility', () => {
  for (const properties of ['', '<w:rPr><w:b/><w:color w:val="123456"/></w:rPr>']) {
    for (const whitespace of ['', '\n  ']) {
      test(`returns the exact eligible nodes without mutation: properties=${Boolean(properties)}, whitespace=${Boolean(whitespace)}`, () => {
        const fixture = pairFixture(properties, whitespace);
        const before = serializeXml(fixture.document);
        const result = alignedInlineFootnoteAnchorPair(fixture.document, '1', '2', AUTHOR);
        expect(result).toHaveLength(4);
        expect(result![0]).toBe(fixture.oldWrapper);
        expect(result![1]).toBe(fixture.newWrapper);
        expect(result![2]).toBe(fixture.newRun);
        expect(result![3]).toBe(fixture.newReference);
        expect(serializeXml(fixture.document)).toBe(before);
      });
    }
  }

  test('matches decimal-equivalent IDs and ignores only identity and namespace declarations', () => {
    const fixture = pairFixture();
    fixture.oldReference.setAttributeNS(W, 'w:id', '01');
    fixture.newReference.setAttributeNS(W, 'w:id', '+2');
    fixture.oldReference.setAttributeNS(W, 'w:customMarkFollows', '0');
    fixture.newReference.setAttributeNS(W, 'w:customMarkFollows', '0');
    fixture.oldWrapper.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:unused', 'urn:unused');
    const unrelated = fixture.document.createElementNS(W, 'w:p');
    const run = fixture.document.createElementNS(W, 'w:r');
    const reference = fixture.document.createElementNS(W, 'w:footnoteReference');
    reference.setAttributeNS(W, 'w:id', '99');
    run.appendChild(reference);
    // An unrelated malformed reference must not become either candidate ID.
    run.appendChild(fixture.document.createElementNS(W, 'w:footnoteReference'));
    unrelated.appendChild(run);
    fixture.paragraph.parentNode!.appendChild(unrelated);
    const before = serializeXml(fixture.document);
    const result = alignedInlineFootnoteAnchorPair(fixture.document, '1', '2', AUTHOR);
    expect(result?.[3]).toBe(fixture.newReference);
    expect(serializeXml(fixture.document)).toBe(before);
  });

  const refusals: Array<[string, (fixture: PairFixture) => void]> = [
    ['missing old anchor', f => { f.oldRun.removeChild(f.oldReference); }],
    ['missing new anchor', f => { f.newRun.removeChild(f.newReference); }],
    ['duplicate decimal-equivalent old anchor', f => {
      const duplicate = f.oldReference.cloneNode(true) as Element;
      duplicate.setAttributeNS(W, 'w:id', '+1'); f.oldRun.appendChild(duplicate);
    }],
    ['duplicate new anchor', f => { f.newRun.appendChild(f.newReference.cloneNode(true)); }],
    ['reference outside a run', f => { f.oldWrapper.appendChild(f.oldReference); }],
    ['foreign run namespace', f => { replaceElement(f.oldRun, 'urn:foreign', 'x:r'); }],
    ['wrong run kind', f => { replaceElement(f.oldRun, W, 'w:smartTag'); }],
    ['foreign wrapper namespace', f => { replaceElement(f.oldWrapper, 'urn:foreign', 'x:del'); }],
    ['wrong wrapper kind', f => { replaceElement(f.oldWrapper, W, 'w:moveFrom'); }],
    ['foreign old author', f => { f.oldWrapper.setAttributeNS(W, 'w:author', 'Other'); }],
    ['foreign new author', f => { f.newWrapper.setAttributeNS(W, 'w:author', 'Other'); }],
    ['opaque wrapper attribute', f => { f.oldWrapper.setAttributeNS('urn:foreign', 'x:opaque', 'retain'); }],
    ['wrapper outside a paragraph', f => {
      const container = f.document.createElementNS(W, 'w:hyperlink');
      f.paragraph.insertBefore(container, f.oldWrapper); container.appendChild(f.oldWrapper);
    }],
    ['extra wrapper run', f => { f.oldWrapper.appendChild(f.document.createElementNS(W, 'w:r')); }],
    ['opaque wrapper comment', f => { f.oldWrapper.appendChild(f.document.createComment('retain')); }],
    ['extra run text', f => {
      const text = f.document.createElementNS(W, 'w:t'); text.textContent = 'retain'; f.oldRun.appendChild(text);
    }],
    ['opaque run child', f => { f.oldRun.appendChild(f.document.createElementNS('urn:foreign', 'x:opaque')); }],
    ['pending run property history', f => {
      const properties = f.document.createElementNS(W, 'w:rPr');
      properties.appendChild(f.document.createElementNS(W, 'w:rPrChange'));
      f.oldRun.insertBefore(properties, f.oldReference);
    }],
    ['different paragraphs', f => {
      const paragraph = f.document.createElementNS(W, 'w:p');
      f.paragraph.parentNode!.appendChild(paragraph); paragraph.appendChild(f.newWrapper);
    }],
    ['intervening content', f => { f.paragraph.insertBefore(f.document.createElementNS(W, 'w:r'), f.newWrapper); }],
    ['intervening opaque comment', f => { f.paragraph.insertBefore(f.document.createComment('retain'), f.newWrapper); }],
    ['intervening non-whitespace text', f => { f.paragraph.insertBefore(f.document.createTextNode('retain'), f.newWrapper); }],
    ['reversed wrapper order', f => { f.paragraph.insertBefore(f.newWrapper, f.oldWrapper); }],
    ['changed anchor formatting', f => {
      const properties = f.document.createElementNS(W, 'w:rPr');
      properties.appendChild(f.document.createElementNS(W, 'w:b')); f.newRun.insertBefore(properties, f.newReference);
    }],
    ['changed reference properties', f => { f.newReference.setAttributeNS(W, 'w:customMarkFollows', '1'); }],
  ];
  for (const [reason, mutate] of refusals) {
    test(`declines ${reason} without consuming source history`, () => {
      const fixture = pairFixture(); mutate(fixture);
      const before = serializeXml(fixture.document);
      expect(alignedInlineFootnoteAnchorPair(fixture.document, '1', '2', AUTHOR)).toBeUndefined();
      expect(serializeXml(fixture.document)).toBe(before);
    });
  }
});
