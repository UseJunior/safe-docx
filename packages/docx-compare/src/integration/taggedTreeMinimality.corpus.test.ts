import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';
import { collectBookmarkReferenceNamesInXml } from '../tagged/bookmarkProjectionCompatibility.js';
import { buildTaggedTreeShadowXml } from '../tagged/taggedTreeShadow.js';
import { compareSourceProjectedFormattingFidelity } from '../tagged/formattingFidelity.js';
import { acceptAllChanges, rejectAllChanges } from '../tagged/trackChangesAcceptorAst.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const ORIGINAL = resolve(ROOT, 'tests/test_documents/redline/ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx');
const REVISED = resolve(ROOT, 'tests/test_documents/redline/ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx');

describe('public ILPA tagged-tree redline minimality', () => {
  const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Tagged-tree corpus minimality' });
  test('publishes balanced, unique, resolved bookmarks in both ILPA directions', async () => {
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' });
    testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' });
    const [deal, wof] = await Promise.all([readFile(ORIGINAL), readFile(REVISED)]);
    const projectionIssues = (xml: string): {
      duplicateNames: string[];
      duplicateStartIds: string[];
      duplicateEndIds: string[];
      unmatchedStartIds: string[];
      unmatchedEndIds: string[];
      unresolvedReferences: string[];
    } => {
      const document = parseXml(xml);
      const starts = Array.from(document.getElementsByTagName('w:bookmarkStart'));
      const ends = Array.from(document.getElementsByTagName('w:bookmarkEnd'));
      const names = starts.map((start) => start.getAttribute('w:name'))
        .filter((name): name is string => name !== null);
      const startIds = starts.map((start) => start.getAttribute('w:id'))
        .filter((id): id is string => id !== null);
      const endIds = ends.map((end) => end.getAttribute('w:id'))
        .filter((id): id is string => id !== null);
      const duplicates = (values: readonly string[]): string[] => [...new Set(
        values.filter((value, index) => values.indexOf(value) !== index),
      )].sort();
      return {
        duplicateNames: duplicates(names),
        duplicateStartIds: duplicates(startIds),
        duplicateEndIds: duplicates(endIds),
        unmatchedStartIds: startIds.filter((id) => !endIds.includes(id)),
        unmatchedEndIds: endIds.filter((id) => !startIds.includes(id)),
        unresolvedReferences: collectBookmarkReferenceNamesInXml(xml)
          .filter((name) => !names.includes(name)),
      };
    };
    const expected = {
      duplicateNames: [],
      duplicateStartIds: [],
      duplicateEndIds: [],
      unmatchedStartIds: [],
      unmatchedEndIds: [],
      unresolvedReferences: [],
    };

    for (const [label, original, revised] of [
      ['Deal-to-WOF', deal, wof],
      ['WOF-to-Deal', wof, deal],
    ] as const) {
      const result = await compareDocuments(original, revised, {
        author: `Corpus bookmark regression ${label}`,
        date: new Date('2026-08-21T12:00:00Z'),
      });
      const combinedXml = await (await DocxArchive.load(result.document)).getDocumentXml();
      const combinedDocument = parseXml(combinedXml);
      const illegalRunInnerRevisions = ['del', 'ins', 'moveFrom', 'moveTo'].flatMap((kind) =>
        Array.from(combinedDocument.getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          kind,
        )).filter((revision) => {
          const parent = revision.parentNode as Element | null;
          return parent?.localName === 'r' || parent?.localName === 'drawing';
        }).map((revision) => ({
          kind,
          parent: (revision.parentNode as Element).localName,
          id: revision.getAttributeNS(
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
            'id',
          ),
        })),
      );
      expect(illegalRunInnerRevisions, `${label} revision boundary topology`).toEqual([]);
      expect(projectionIssues(combinedXml), `${label} combined`).toEqual(expected);
      expect(projectionIssues(acceptAllChanges(combinedXml)), `${label} Accept All`)
        .toEqual(expected);
      expect(projectionIssues(rejectAllChanges(combinedXml)), `${label} Reject All`)
        .toEqual(expected);
    }
  }, 600_000);

  test('preserves the four reported common-text anchors and exact source projections', async () => {
    const [original, revised] = await Promise.all([readFile(ORIGINAL), readFile(REVISED)]);
    const originalXml = await (await DocxArchive.load(original)).getDocumentXml();
    const revisedXml = await (await DocxArchive.load(revised)).getDocumentXml();
    const taggedXml = buildTaggedTreeShadowXml({
      originalXml,
      revisedXml,
      author: 'Corpus minimality',
      date: new Date('2026-08-14T12:00:00Z'),
      detectFormatChanges: true,
      detectMoves: true,
    });
    const fidelity = compareSourceProjectedFormattingFidelity(originalXml, revisedXml, taggedXml);
    expect(fidelity.accept.score).toBe(1);
    expect(fidelity.reject.score).toBe(1);

    const document = parseXml(taggedXml);
    const paragraphs = Array.from(document.getElementsByTagName('w:p'));
    const revisionText = (paragraph: Element, kind: 'ins' | 'del'): string =>
      Array.from(paragraph.getElementsByTagName(`w:${kind}`)).map((node) => node.textContent ?? '').join('');
    const liveText = (paragraph: Element): string => Array.from(paragraph.getElementsByTagName('w:t'))
      .filter((node) => !['ins', 'del'].includes((node.parentNode?.parentNode as Element | null)?.localName ?? ''))
      .map((node) => node.textContent ?? '').join('');

    const headings = paragraphs.filter((paragraph) =>
      (paragraph.textContent ?? '').toUpperCase().includes('DEFINITIONS AND INTERPRETATION'));
    expect(headings.length).toBeGreaterThanOrEqual(2);
    for (const heading of headings) {
      expect(revisionText(heading, 'ins').trim().toUpperCase()).not.toBe('DEFINITIONS AND INTERPRETATION');
      expect(revisionText(heading, 'del').trim().toUpperCase()).not.toBe('DEFINITIONS AND INTERPRETATION');
      const inserted = revisionText(heading, 'ins').trim().toUpperCase();
      const deleted = revisionText(heading, 'del').trim().toUpperCase();
      if (inserted || deleted) expect(inserted).not.toBe(deleted);
    }
    const recital = paragraphs.find((paragraph) => (paragraph.textContent ?? '').includes('WHEREAS, the Fund was formed'))!;
    expect(liveText(recital)).toContain('Agreement of Limited');
    expect(revisionText(recital, 'ins')).not.toContain('Agreement of Limited');
    expect(revisionText(recital, 'del')).not.toContain('Agreement of Limited');
    const party = paragraphs.find((paragraph) => (paragraph.textContent ?? '').includes('such party to the Fund;'))!;
    expect(liveText(party)).toContain('such party to the Fund;');
    expect(revisionText(party, 'ins')).not.toContain('such party to the Fund;');
    expect(revisionText(party, 'del')).not.toContain('such party to the Fund;');
  // V8 coverage instrumentation can push this real ILPA comparison past three
  // minutes on CI while the uninstrumented suite remains substantially faster.
  }, 300_000);
});
