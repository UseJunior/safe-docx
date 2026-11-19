import { XMLSerializer } from '@xmldom/xmldom';
import { parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { compareNoteDefinitions, findCorrespondingNotePairs } from './ancillaryNoteComparison.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const TEST_FEATURE = 'Ancillary Note Comparison';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const serializer = new XMLSerializer();
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

function definition(runs: string[]): Element {
  const runXml = runs.map((text) => `<w:r><w:t>${text}</w:t></w:r>`).join('');
  return parseXml(
    `<w:footnote xmlns:w="${W_NS}" w:id="1"><w:p>${runXml}</w:p></w:footnote>`,
  ).documentElement;
}

function serialize(elements: readonly Element[]): string {
  return elements.map((element) => serializer.serializeToString(element)).join('');
}

describe('ancillary note comparison normalization', () => {
  test('premerges safely compatible adjacent runs before publishing unchanged definitions', () => {
    const result = compareNoteDefinitions(
      definition(['Stable ', 'footnote']),
      definition(['Stable ', 'footnote']),
      { author: 'Comparison', date: new Date('2026-08-18T12:00:00Z') },
    );
    const xml = serialize(result);

    expect(xml.match(/<w:r(?:\s|>)/gu)).toHaveLength(1);
    expect(xml).toContain('<w:t>Stable </w:t><w:t>footnote</w:t>');
    expect(xml).not.toContain('<w:ins');
    expect(xml).not.toContain('<w:del');
  });

  test('keeps fragmented note edits projection-safe without extra revision ranges', () => {
    const result = compareNoteDefinitions(
      definition(['Shared ', 'before']),
      definition(['Shared ', 'after']),
      { author: 'Comparison', date: new Date('2026-08-18T12:00:00Z') },
    );
    const xml = `<w:document xmlns:w="${W_NS}"><w:body>${serialize(result)}</w:body></w:document>`;

    expect(xml.match(/<w:ins(?:\s|>)/gu)).toHaveLength(1);
    expect(xml.match(/<w:del(?:\s|>)/gu)).toHaveLength(1);
    expect(acceptAllChanges(xml)).toContain('after');
    expect(acceptAllChanges(xml)).not.toContain('before');
    expect(rejectAllChanges(xml)).toContain('before');
    expect(rejectAllChanges(xml)).not.toContain('after');
  });
});

describe('ordinal note anchor pairing', () => {
  const ref = (kind: string, id: number) => `<w:r><w:${kind}Reference w:id="${id}"/></w:r>`;
  const del = (inner: string) => `<w:del w:id="90" w:author="A">${inner}</w:del>`;
  const ins = (inner: string) => `<w:ins w:id="91" w:author="A">${inner}</w:ins>`;
  const story = (...paragraphs: string[]) =>
    `<w:document xmlns:w="${W_NS}"><w:body>${paragraphs.map((p) => `<w:p>${p}</w:p>`).join('')}</w:body></w:document>`;
  const pairs = (xml: string, kind: 'footnote' | 'endnote' = 'footnote') =>
    findCorrespondingNotePairs(xml, kind).map(({ originalId, revisedId, ordinal }) => `${ordinal}:${originalId}>${revisedId}`);

  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.14' })('pairs every changed position of a several-anchor paragraph by ordinal', () => {
    const xml = story(`${del(ref('footnote', 1))}${ins(ref('footnote', 4))}${ref('footnote', 2)}${del(ref('footnote', 3))}${ins(ref('footnote', 5))}`);
    expect(pairs(xml)).toEqual(['0:1>4', '2:3>5']);
    expect(findCorrespondingNotePairs(xml, 'footnote')[0]).toMatchObject({ originalSequence: ['1', '2', '3'], revisedSequence: ['4', '2', '5'] });
  });
  test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.11.7' })('counts only the requested kind in a mixed paragraph', () => {
    const xml = story(`${del(ref('footnote', 1))}${ins(ref('footnote', 3))}${ref('endnote', 1)}${ref('footnote', 2)}`);
    expect(pairs(xml)).toEqual(['0:1>3']);
    expect(pairs(xml, 'endnote')).toEqual([]);
  });
  test('declines a paragraph whose anchors were added, removed, moved or repeated', () => {
    // An added anchor makes the Reject and Accept sequences unequal in length.
    expect(pairs(story(`${ref('footnote', 1)}${ins(ref('footnote', 2))}`))).toEqual([]);
    // A removed anchor opposite a live one is not a deleted/inserted pair.
    expect(pairs(story(`${del(ref('footnote', 1))}${ref('footnote', 2)}${ins(ref('footnote', 3))}`))).toEqual([]);
    expect(pairs(story(`<w:moveFrom w:id="92" w:author="A">${ref('footnote', 1)}</w:moveFrom>${ins(ref('footnote', 2))}`))).toEqual([]);
    // A reference repeated in another paragraph is a copy, never one aligned note.
    expect(pairs(story(`${del(ref('footnote', 1))}${ins(ref('footnote', 2))}`, ref('footnote', 2)))).toEqual([]);
  });
});
