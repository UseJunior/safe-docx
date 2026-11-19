/**
 * Real-corpus bookmark-inventory and empty-revision-wrapper invariants.
 *
 * For a comparison of original A with revision B, Reject All must restore A's
 * bookmark inventory and Accept All must produce B's. The redline itself must
 * not carry revision wrappers with no content: an empty `w:ins`/`w:del` marks
 * no inserted or deleted run content.
 *
 * Known defects are pinned as exact characterization outcomes so a behavior
 * change fails the gate in either direction.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.1
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @see https://github.com/UseJunior/safe-docx/issues/1280
 * @see https://github.com/UseJunior/safe-docx/issues/1281
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { compareDocumentsAtomizer } from '../tagged/pipeline.js';
import { acceptAllChanges, rejectAllChanges } from '../tagged/trackChangesAcceptorAst.js';
import { testAllure } from '../testing/allure-test.js';
import { stripXmlLeadingNoise } from '@usejunior/docx-core';
import { emptyRevisionWrapperIds } from '../testing/revisionWrapperShape.js';
import {
  deleteOneRealParagraph,
  REAL_CORPUS_ENV,
  resolveRealCorpusAvailability,
} from './real-corpus-fixtures.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TEST_FEATURE = 'docx-comparison';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: TEST_FEATURE,
    story: 'Word-Authored Agreement Bookmark Inventory',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.1' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
  );

function attr(element: XmlElement, name: string): string | null {
  return element.getAttribute(`w:${name}`) ?? element.getAttributeNS(W_NS, name);
}

/** Sorted names of bookmarks whose start has a matching end in the document. */
function pairedBookmarkNames(documentXml: string): string[] {
  const document = new DOMParser().parseFromString(stripXmlLeadingNoise(documentXml), 'text/xml');
  const endIds = new Set(
    Array.from(document.getElementsByTagName('w:bookmarkEnd')).map((end) => attr(end, 'id')),
  );
  return Array.from(document.getElementsByTagName('w:bookmarkStart'))
    .filter((start) => endIds.has(attr(start, 'id')))
    .map((start) => attr(start, 'name') ?? '')
    .sort();
}

function multisetDifference(left: string[], right: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const name of right) remaining.set(name, (remaining.get(name) ?? 0) + 1);
  const out: string[] = [];
  for (const name of left) {
    const count = remaining.get(name) ?? 0;
    if (count > 0) remaining.set(name, count - 1);
    else out.push(name);
  }
  return out;
}

async function documentXmlOf(docx: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(docx);
  return stripXmlLeadingNoise(await zip.file('word/document.xml')!.async('string'));
}

interface InventoryOutcome {
  /** Names in A missing from reject(compare(A, B)). */
  rejectMissing: string[];
  /** Names in reject(compare(A, B)) that A lacks. */
  rejectExtra: string[];
  /** Names in B missing from accept(compare(A, B)). */
  acceptMissing: string[];
  /** Names in accept(compare(A, B)) that B lacks. */
  acceptExtra: string[];
  /** `w:ins`/`w:del` ids in the redline with no content. */
  emptyRevisionWrappers: string[];
}

const CLEAN: InventoryOutcome = {
  rejectMissing: [],
  rejectExtra: [],
  acceptMissing: [],
  acceptExtra: [],
  emptyRevisionWrappers: [],
};

/**
 * Pinned out-of-scope characterization outcomes, keyed by corpus entry id.
 * An entry absent here must be clean.
 */
const KNOWN_OUTCOMES: Record<string, InventoryOutcome> = {};

const corpusRoot = process.env[REAL_CORPUS_ENV] ?? '';
const corpusAvailability = resolveRealCorpusAvailability(corpusRoot);

describe.skipIf(!corpusAvailability.available)('real-corpus bookmark inventory under accept/reject', () => {
  for (const entry of corpusAvailability.entries) {
    test.openspec('Reject All restores the original bookmark names and Accept All yields the revised ones')(
      `${entry.id} × tagged-spine × paragraph-deletion bookmark inventory`,
      async () => {
        const original = readFileSync(join(corpusRoot, entry.id, 'source.docx'));
        const { revised } = await deleteOneRealParagraph(original, entry.id);
        const result = await compareDocumentsAtomizer(original, revised, {
          author: 'Real Corpus Bookmark Gate',
          date: new Date('2026-11-05T00:00:00Z'),
        });
        const originalXml = await documentXmlOf(original);
        const revisedXml = await documentXmlOf(revised);
        const comparedXml = await documentXmlOf(result.document);

        const originalNames = pairedBookmarkNames(originalXml);
        const revisedNames = pairedBookmarkNames(revisedXml);
        const rejectedNames = pairedBookmarkNames(rejectAllChanges(comparedXml));
        const acceptedNames = pairedBookmarkNames(acceptAllChanges(comparedXml));

        expect({
          rejectMissing: multisetDifference(originalNames, rejectedNames),
          rejectExtra: multisetDifference(rejectedNames, originalNames),
          acceptMissing: multisetDifference(revisedNames, acceptedNames),
          acceptExtra: multisetDifference(acceptedNames, revisedNames),
          emptyRevisionWrappers: emptyRevisionWrapperIds(comparedXml),
        }).toEqual(KNOWN_OUTCOMES[entry.id] ?? CLEAN);
      },
      240_000,
    );
  }
});
