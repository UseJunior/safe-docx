/**
 * End-to-end coverage for revised insertion claims that collide with settled
 * original content.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.20
 * @see https://github.com/UseJunior/safe-docx/issues/359
 */

import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import {
  CorrelationStatus,
  childElements,
  type ComparisonUnitAtom,
  type OpcPart,
} from '@usejunior/docx-core';
import {
  acceptAllChanges,
  extractTextWithParagraphs,
  normalizeText,
  rejectAllChanges,
} from '../../index.js';
import { compareDocumentsAtomizer as compareDocuments } from './pipeline.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import {
  buildDocxFromBodyXml,
  paragraphWithText,
} from '../../testing/ooxml-fixtures.js';
import { el } from '../../testing/dom-test-helpers.js';
import { resolveRevisedInsCollisionOnRun } from './inPlaceModifier.js';

const TEST_FEATURE = 'Inplace Insertion Provenance';
const TRACKED_AUTHOR = 'Revised Author';
const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.20' });

const MOCK_PART: OpcPart = {
  uri: 'word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function mockAtom(overrides: Partial<ComparisonUnitAtom> = {}): ComparisonUnitAtom {
  return {
    contentElement: el('w:t', {}, undefined, 'text'),
    ancestorElements: [],
    ancestorUnids: [],
    part: MOCK_PART,
    sha1Hash: 'collision',
    correlationStatus: CorrelationStatus.Equal,
    ...overrides,
  };
}

function collisionAtom(
  revisedParagraph: Element | undefined,
  originalParagraph: Element | undefined,
  overrides: Partial<ComparisonUnitAtom> = {},
): ComparisonUnitAtom {
  return mockAtom({
    sourceDocument: 'revised',
    revTrackElement: el('w:ins'),
    sourceParagraphElement: revisedParagraph,
    comparisonUnitAtomBefore: mockAtom({
      sourceDocument: 'original',
      sourceParagraphElement: originalParagraph,
    }),
    ...overrides,
  });
}

async function documentXml(docx: Buffer): Promise<string> {
  const part = (await JSZip.loadAsync(docx)).file('word/document.xml');
  if (!part) throw new Error('comparison result omitted word/document.xml');
  return part.async('string');
}

function projectionText(xml: string, projection: 'accept' | 'reject'): string {
  const projected = projection === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml);
  return normalizeText(extractTextWithParagraphs(projected));
}

describe('Inplace revised insertion provenance collisions', () => {
  test(
    'promotes a colliding inline insertion to settled content',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await buildDocxFromBodyXml(
        paragraphWithText('!') + paragraphWithText('!') + paragraphWithText('I'),
      );
      const revised = await buildDocxFromBodyXml(
        `<w:p><w:r><w:t>6.</w:t></w:r>` +
          `<w:ins w:id="7" w:author="${TRACKED_AUTHOR}" w:date="2026-07-23T12:00:00Z">` +
          `<w:r><w:t>I</w:t></w:r></w:ins></w:p>`,
      );

      await given('settled original text matched by a revised-side inline insertion', () => {});
      const result = await compareDocuments(original, revised, {
        reconstructionMode: 'inplace',
        comparisonStrategy: 'legacy',
      });
      const combined = await documentXml(result.document);
      await when('the documents are compared in inplace mode', () => {});

      await then('the comparison remains inplace and removes the stale insertion claim', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(combined).not.toContain(`w:author="${TRACKED_AUTHOR}"`);
      });
      await and('accept and reject preserve the revised and original projections', () => {
        expect(projectionText(combined, 'accept')).toBe('6.I');
        expect(projectionText(combined, 'reject')).toBe('!\n!\nI');
      });
    },
  );

  test(
    'promotes a colliding inserted paragraph to settled content',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await buildDocxFromBodyXml(
        paragraphWithText('Alpha text.') + paragraphWithText('Added para.'),
      );
      const revised = await buildDocxFromBodyXml(
        paragraphWithText('Alpha text.') +
          `<w:p><w:pPr><w:rPr>` +
          `<w:ins w:id="8" w:author="${TRACKED_AUTHOR}" w:date="2026-07-23T12:00:00Z"/>` +
          `</w:rPr></w:pPr>` +
          `<w:ins w:id="9" w:author="${TRACKED_AUTHOR}" w:date="2026-07-23T12:00:00Z">` +
          `<w:r><w:t>Added para.</w:t></w:r></w:ins></w:p>`,
      );

      await given('a settled original paragraph marked inserted on the revised side', () => {});
      const result = await compareDocuments(original, revised, {
        reconstructionMode: 'inplace',
        comparisonStrategy: 'legacy',
      });
      const combined = await documentXml(result.document);
      await when('the documents are compared in inplace mode', () => {});

      await then('the comparison remains inplace and removes both insertion markers', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(combined).not.toContain(`w:author="${TRACKED_AUTHOR}"`);
      });
      await and('both projections keep the settled paragraph', () => {
        expect(projectionText(combined, 'accept')).toBe('Alpha text.\nAdded para.');
        expect(projectionText(combined, 'reject')).toBe('Alpha text.\nAdded para.');
      });
    },
  );

  test(
    'promotes a colliding formatted insertion to settled formatted content',
    async ({ given, when, then, and }: AllureBddContext) => {
      const original = await buildDocxFromBodyXml(
        `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Formatted text</w:t></w:r></w:p>`,
      );
      const revised = await buildDocxFromBodyXml(
        `<w:p><w:ins w:id="10" w:author="${TRACKED_AUTHOR}" w:date="2026-07-23T12:00:00Z">` +
          `<w:r><w:rPr><w:b/></w:rPr><w:t>Formatted text</w:t></w:r></w:ins></w:p>`,
      );

      await given('settled text whose revised insertion also changes formatting', () => {});
      const result = await compareDocuments(original, revised, {
        reconstructionMode: 'inplace',
        comparisonStrategy: 'legacy',
      });
      const combined = await documentXml(result.document);
      await when('the documents are compared in inplace mode', () => {});

      await then('the stale insertion claim is removed without losing the format change', () => {
        expect(result.reconstructionModeUsed).toBe('inplace');
        expect(combined).not.toContain(`w:author="${TRACKED_AUTHOR}"`);
        expect(combined).toContain('<w:rPrChange');
      });
      await and('both projections retain the settled text', () => {
        expect(projectionText(combined, 'accept')).toBe('Formatted text');
        expect(projectionText(combined, 'reject')).toBe('Formatted text');
      });
    },
  );

  test(
    'leaves non-collisions and ambiguous insertion wrappers unchanged',
    async ({ given, when, then }: AllureBddContext) => {
      const originalPlainParagraph = el('w:p');
      const guardAtoms = [
        collisionAtom(undefined, undefined, { sourceDocument: 'original' }),
        collisionAtom(undefined, undefined, { revTrackElement: el('w:del') }),
        mockAtom({ sourceDocument: 'revised', revTrackElement: el('w:ins') }),
        collisionAtom(undefined, undefined, {
          comparisonUnitAtomBefore: mockAtom({ revTrackElement: el('w:del') }),
        }),
      ];

      await given('atoms that do not meet every collision precondition', () => {});
      for (const atom of guardAtoms) {
        const run = el('w:r', {}, [el('w:t', {}, undefined, 'guarded')]);
        const wrapper = el('w:ins', {}, [run]);
        el('w:p', {}, [wrapper]);
        resolveRevisedInsCollisionOnRun(atom, run);
        expect(run.parentNode).toBe(wrapper);
      }

      const bareRun = el('w:r', {}, [el('w:t', {}, undefined, 'bare')]);
      el('w:p', {}, [bareRun]);
      resolveRevisedInsCollisionOnRun(collisionAtom(undefined, originalPlainParagraph), bareRun);

      const firstRun = el('w:r', {}, [el('w:t', {}, undefined, 'first')]);
      const secondRun = el('w:r', {}, [el('w:t', {}, undefined, 'second')]);
      const multiRunWrapper = el('w:ins', {}, [firstRun, secondRun]);
      el('w:p', {}, [multiRunWrapper]);
      resolveRevisedInsCollisionOnRun(
        collisionAtom(undefined, originalPlainParagraph),
        firstRun,
      );
      await when('the resolver examines the guarded and ambiguous cases', () => {});

      await then('it retains bare runs and multi-run insertion wrappers', () => {
        expect(bareRun.parentNode?.nodeName).toBe('w:p');
        expect(firstRun.parentNode).toBe(multiRunWrapper);
        expect(childElements(multiRunWrapper)).toEqual([firstRun, secondRun]);
      });
    },
  );

  test(
    'respects original paragraph revisions and removes only revised insertion metadata',
    async ({ given, when, then, and }: AllureBddContext) => {
      await given('each supported original paragraph revision marker', () => {});
      for (const marker of ['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo']) {
        const originalParagraph = el('w:p', {}, [
          el('w:pPr', {}, [el('w:rPr', {}, [el(marker)])]),
        ]);
        const run = el('w:r', {}, [el('w:t', {}, undefined, marker)]);
        const wrapper = el('w:ins', {}, [run]);
        el('w:p', {}, [wrapper]);
        resolveRevisedInsCollisionOnRun(
          collisionAtom(undefined, originalParagraph),
          run,
        );
        expect(run.parentNode).toBe(wrapper);
      }

      const originalParagraphWithoutRevision = el('w:p', {}, [
        el('w:pPr', {}, [el('w:rPr', {}, [el('w:b')])]),
      ]);
      const revisedParagraph = el('w:p', {}, [
        el('w:pPr', {}, [
          el('w:rPr', {}, [el('w:ins'), el('w:moveTo')]),
          el('w:spacing'),
        ]),
      ]);
      const run = el('w:r', {}, [el('w:t', {}, undefined, 'settled')]);
      const wrapper = el('w:ins', {}, [run]);
      revisedParagraph.appendChild(wrapper);

      resolveRevisedInsCollisionOnRun(
        collisionAtom(revisedParagraph, originalParagraphWithoutRevision),
        run,
      );
      await when('a true collision is resolved', () => {});

      await then('the run is unwrapped and only the paragraph insertion marker is removed', () => {
        expect(run.parentNode).toBe(revisedParagraph);
        const pPr = childElements(revisedParagraph)[0]!;
        const rPr = childElements(pPr)[0]!;
        expect(childElements(rPr).map((child) => child.tagName)).toEqual(['w:moveTo']);
      });
      await and('missing paragraph-property shapes are handled safely', () => {
        for (const paragraph of [
          undefined,
          el('w:p'),
          el('w:p', {}, [el('w:pPr')]),
          el('w:p', {}, [el('w:pPr', {}, [el('w:rPr', {}, [el('w:ins')])])]),
        ]) {
          const guardedRun = el('w:r', {}, [el('w:t', {}, undefined, 'safe')]);
          const guardedWrapper = el('w:ins', {}, [guardedRun]);
          (paragraph ?? el('w:p')).appendChild(guardedWrapper);
          resolveRevisedInsCollisionOnRun(
            collisionAtom(paragraph, el('w:p')),
            guardedRun,
          );
          expect(guardedRun.parentNode?.nodeName).toBe('w:p');
        }
      });
    },
  );
});
