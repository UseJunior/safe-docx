/**
 * Unit cases for `pairStoriesThroughSectionAlignment`: the pairing rule and
 * the page checks that drop a pair, on effective bindings built directly.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.5
 * @conformance ECMA-376 edition 5, Part 1 § 17.10.1
 * @see https://github.com/UseJunior/safe-docx/issues/1390
 */

import { describe, expect } from 'vitest';
import { OOXML } from '@usejunior/docx-core';
import { testAllure } from '../testing/allure-test.js';
import { resolveEffectiveStoryBindings, type EffectiveStoryBindings } from './effectiveStoryBindings.js';
import {
  alignedStoryKeys,
  BLANK_STORY_IDENTITY,
  pairStoriesThroughSectionAlignment,
  type SectionAlignedPairingInput,
} from './sectionAlignedStoryPairing.js';

const TEST_FEATURE = 'Section-Aligned Header/Footer Story Pairing';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.1' },
  );

const W_NS = OOXML.W_NS;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Bindings for sections given as lists of `[role, relationship id]` footer references. */
function bindings(sections: Array<Array<[string, string]>>, evenAndOdd = false): EffectiveStoryBindings {
  const sectPr = (references: Array<[string, string]>): string =>
    `<w:sectPr>${references.map(([role, id]) => `<w:footerReference w:type="${role}" r:id="${id}"/>`).join('')}</w:sectPr>`;
  const body = sections.slice(0, -1).map((references) => `<w:p><w:pPr>${sectPr(references)}</w:pPr></w:p>`).join('') +
    sectPr(sections.at(-1)!);
  const ids = [...new Set(sections.flat().map(([, id]) => id))];
  return resolveEffectiveStoryBindings({
    documentXml: `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`,
    relationshipsXml: `<Relationships xmlns="${PKG_NS}">` +
      ids.map((id) => `<Relationship Id="${id}" Type="${R_NS}/footer" Target="${id}.xml"/>`).join('') + '</Relationships>',
    settingsXml: `<w:settings xmlns:w="${W_NS}">${evenAndOdd ? '<w:evenAndOddHeaders/>' : ''}</w:settings>`,
  });
}

/** Identity by part name, so each fixture part has its own content. */
const contentOf = (path: string | undefined): string =>
  path === undefined ? BLANK_STORY_IDENTITY : path;

function input(overrides: Partial<SectionAlignedPairingInput>): SectionAlignedPairingInput {
  return {
    rejected: bindings([[['default', 'b']]]),
    original: bindings([[['default', 'a']]]),
    accepted: bindings([[['default', 'b']]]),
    revised: bindings([[['default', 'b']]]),
    originalIdentity: contentOf,
    revisedIdentity: contentOf,
    comparedIdentity: contentOf,
    eligible: () => true,
    ...overrides,
  };
}

describe('pairStoriesThroughSectionAlignment (#1390)', () => {
  test('pairs the compared part with the one original story its pages show', () => {
    const pairing = pairStoriesThroughSectionAlignment(input({}));
    expect([...pairing.pairs]).toEqual([['word/b.xml', 'word/a.xml']]);
    expect(pairing.representedSectionKinds).toEqual([{ sectionIndex: 0, kind: 'footer' }]);
  });

  test('does not pair when the projections and inputs have different section counts', () => {
    expect(alignedStoryKeys(bindings([[['default', 'b']], [['default', 'b']]]), bindings([[['default', 'a']]]))).toBeUndefined();
    const pairing = pairStoriesThroughSectionAlignment(input({
      rejected: bindings([[['default', 'b']], [['default', 'b']]]),
    }));
    expect(pairing.pairs.size).toBe(0);
    expect(pairing.representedSectionKinds).toEqual([]);
  });

  test('does not pair a part whose pages show two different original stories', () => {
    const pairing = pairStoriesThroughSectionAlignment(input({
      rejected: bindings([[['default', 'b']], [['default', 'b']]]),
      original: bindings([[['default', 'a']], [['default', 'c']]]),
      accepted: bindings([[['default', 'b']], [['default', 'b']]]),
      revised: bindings([[['default', 'b']], [['default', 'b']]]),
    }));
    expect(pairing.pairs.size).toBe(0);
  });

  test('does not pair a part whose pages were blank in the original, nor an ineligible one', () => {
    expect(pairStoriesThroughSectionAlignment(input({ original: bindings([[]]) })).pairs.size).toBe(0);
    expect(pairStoriesThroughSectionAlignment(input({ eligible: () => false })).pairs.size).toBe(0);
  });

  test('drops a pair when an original page showing the paired story would not come back', () => {
    // Even pages are on in the compared package with no even story, so its
    // rejected even pages are blank where the original showed story a.
    const pairing = pairStoriesThroughSectionAlignment(input({
      rejected: bindings([[['default', 'b']]], true),
      accepted: bindings([[['default', 'b']]], true),
      revised: bindings([[['default', 'b']]], true),
    }));
    expect(pairing.pairs.size).toBe(0);
    expect(pairing.representedSectionKinds).toEqual([]);
  });

  test('drops a pair when Accept All would show the paired part where the revision shows another story', () => {
    const pairing = pairStoriesThroughSectionAlignment(input({
      accepted: bindings([[['default', 'b']], [['default', 'b']]]),
      revised: bindings([[['default', 'b']], [['default', 'd']]]),
      rejected: bindings([[['default', 'b']]]),
    }));
    expect(pairing.pairs.size).toBe(0);
  });

  test('pairs a new even story with the default story the original showed on even pages', () => {
    const pairing = pairStoriesThroughSectionAlignment(input({
      rejected: bindings([[['default', 'b'], ['even', 'e']]], true),
      accepted: bindings([[['default', 'b'], ['even', 'e']]], true),
      revised: bindings([[['default', 'b'], ['even', 'e']]], true),
    }));
    expect([...pairing.pairs].sort()).toEqual([['word/b.xml', 'word/a.xml'], ['word/e.xml', 'word/a.xml']]);
  });
});
