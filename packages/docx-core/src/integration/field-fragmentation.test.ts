/**
 * Integration Tests — ECMA-376 Field-Fragmentation Conformance (issue #217)
 *
 * Asserts the expected fragmented shape of the combined inplace comparison
 * output for field-modification scenarios:
 *
 *   - `w:fldChar` runs MUST NOT appear inside `<w:del>`. (ECMA-376 Part 4 —
 *     Word treats this as fatal and discards the field state machine.)
 *   - For instr-modification scenarios, `<w:ins>` / `<w:del>` MUST wrap only
 *     `w:instrText` / `w:delInstrText` payloads; `w:fldChar` markers MUST be
 *     emitted at run-sibling level.
 *   - `validateFieldStructure` MUST return true on the combined output AND on
 *     both the post-accept and post-reject projections.
 *
 * Whole-field INSERTION is NOT fragmented (a complete `<w:ins>` containing
 * `[begin..end]` is well-formed under ECMA-376). The existing insertion
 * coverage in `lean-spec-bridge.test.ts:907–941` continues to assert that
 * stronger shape.
 *
 * These tests are red against the pre-#217 engine. They go green after the
 * fragmentation work in `inPlaceModifier.ts` lands (Phase 2 / Phase 3 of the
 * `fragment-ins-del-at-field-boundaries` OpenSpec change).
 */

import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { compareDocuments } from '../index.js';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { validateFieldStructure } from '../baselines/atomizer/pipeline.js';
import {
  acceptAllChanges,
  rejectAllChanges,
} from '../baselines/atomizer/trackChangesAcceptorAst.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Field Fragmentation (ECMA-376)',
  story: 'Issue #217 — fragment <w:ins>/<w:del> at field-character boundaries',
  severity: 'critical',
});

// =============================================================================
// Helpers
// =============================================================================

async function buildFieldDocx(bodyXml: string): Promise<Buffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;
  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

async function compareInplace(original: Buffer, revised: Buffer): Promise<string> {
  const result = await compareDocuments(original, revised, {
    engine: 'atomizer',
    reconstructionMode: 'inplace',
  });
  if (result.reconstructionModeUsed !== 'inplace') {
    throw new Error(
      `expected inplace mode but engine fell back to ${result.reconstructionModeUsed ?? 'unknown'}: ` +
        `${result.fallbackReason ?? 'no reason'}`,
    );
  }
  const archive = await DocxArchive.load(result.document);
  return await archive.getDocumentXml();
}

function hasAncestorWithTag(el: Element, tag: string): boolean {
  let cur: Node | null = el.parentNode;
  while (cur && cur.nodeType === 1) {
    if ((cur as Element).tagName === tag) return true;
    cur = cur.parentNode;
  }
  return false;
}

function assertNoFldCharInside(combined: string, parentTag: string): void {
  const doc = new DOMParser().parseFromString(combined, 'application/xml');
  const fldChars = doc.getElementsByTagName('w:fldChar');
  const offenders: string[] = [];
  for (let i = 0; i < fldChars.length; i++) {
    const el = fldChars[i];
    if (!el) continue;
    if (hasAncestorWithTag(el as unknown as Element, parentTag)) {
      offenders.push(el.getAttribute('w:fldCharType') ?? '(no fldCharType)');
    }
  }
  expect(
    offenders,
    `w:fldChar (${offenders.join(', ')}) appeared inside <${parentTag}>. ` +
      `ECMA-376 forbids w:fldChar inside w:del (and #217 also fragments w:ins for modifications).`,
  ).toEqual([]);
}

function assertFieldStructureSurvives(combined: string): void {
  expect(validateFieldStructure(combined), 'validateFieldStructure(combined) must hold').toBe(true);
  expect(
    validateFieldStructure(acceptAllChanges(combined)),
    'validateFieldStructure(acceptAllChanges(combined)) must hold',
  ).toBe(true);
  expect(
    validateFieldStructure(rejectAllChanges(combined)),
    'validateFieldStructure(rejectAllChanges(combined)) must hold',
  ).toBe(true);
}

function makeField(instr: string, result: string): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:t>${result}</w:t></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

// =============================================================================
// Modification fixtures (ECMA-376 mandates fragmentation)
// =============================================================================

// ---------------------------------------------------------------------------
// Engine note (verified 2026-05-23 via probe script): the collapsed-field atom
// hashes by VISIBLE text only. So a pure-instr-only modification (e.g.,
// FORMCHECKBOX → FORMTEXT with identical result "☐") is silently absorbed —
// the comparator sees Equal atoms and emits the revised document verbatim
// with no tracked changes. That is a SEPARATE GAP (not in scope for #217).
// To exercise the fragmentation code path, the scenarios below combine instr
// and result changes so the engine actually emits <w:ins>/<w:del>.
// ---------------------------------------------------------------------------

describe('Field fragmentation — modification scenarios', () => {
  test(
    'FORMCHECKBOX → FORMTEXT (with result change): w:fldChar runs are unwrapped, only payloads are wrapped',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original FORMCHECKBOX field (result "☐") and a revised FORMTEXT field (result "answer")',
        async () => {
          const original = await buildFieldDocx(
            `<w:p><w:r><w:t>Status: </w:t></w:r>${makeField(' FORMCHECKBOX ', '☐')}</w:p>`,
          );
          const revised = await buildFieldDocx(
            `<w:p><w:r><w:t>Status: </w:t></w:r>${makeField(' FORMTEXT ', 'answer')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del> or <w:ins>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertNoFldCharInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'HYPERLINK target rewrite (with link-text change): fragmented output keeps fldChar unwrapped',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original HYPERLINK "https://a.example" (text "old link") and a revised HYPERLINK "https://b.example" (text "new link")',
        async () => {
          const original = await buildFieldDocx(
            `<w:p>${makeField(' HYPERLINK "https://a.example" ', 'old link')}</w:p>`,
          );
          const revised = await buildFieldDocx(
            `<w:p>${makeField(' HYPERLINK "https://b.example" ', 'new link')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del> or <w:ins>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertNoFldCharInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'PAGEREF target rewrite (with result-page change): fragmented output keeps fldChar unwrapped',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original PAGEREF _Toc-A (result "12") and a revised PAGEREF _Toc-B (result "15")',
        async () => {
          const original = await buildFieldDocx(
            `<w:p><w:r><w:t>See page </w:t></w:r>${makeField(' PAGEREF _Toc-A \\h ', '12')}</w:p>`,
          );
          const revised = await buildFieldDocx(
            `<w:p><w:r><w:t>See page </w:t></w:r>${makeField(' PAGEREF _Toc-B \\h ', '15')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del> or <w:ins>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertNoFldCharInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'bookmarked field modification (with result change): fragmented output keeps fldChar unwrapped',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original bookmarked NUMPAGES (result "3") and a revised bookmarked SECTIONPAGES (result "1")',
        async () => {
          const wrapBookmark = (inner: string) =>
            `<w:bookmarkStart w:id="1" w:name="fld"/>${inner}<w:bookmarkEnd w:id="1"/>`;
          const original = await buildFieldDocx(
            `<w:p>${wrapBookmark(makeField(' NUMPAGES ', '3'))}</w:p>`,
          );
          const revised = await buildFieldDocx(
            `<w:p>${wrapBookmark(makeField(' SECTIONPAGES ', '1'))}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del> or <w:ins>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertNoFldCharInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'result-text-only change (NUMPAGES 3 → 4): w:fldChar runs are unwrapped, only delText/text payloads are wrapped',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original NUMPAGES with result "3" and a revised with result "4" (instr unchanged)',
        async () => {
          const original = await buildFieldDocx(
            `<w:p><w:r><w:t>Pages: </w:t></w:r>${makeField(' NUMPAGES ', '3')}</w:p>`,
          );
          const revised = await buildFieldDocx(
            `<w:p><w:r><w:t>Pages: </w:t></w:r>${makeField(' NUMPAGES ', '4')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del> or <w:ins>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertNoFldCharInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );
});

// =============================================================================
// Whole-field deletion fixture (Phase 3 — research-gated representation)
// =============================================================================

describe('Field fragmentation — whole-field deletion', () => {
  test(
    'whole-field deletion: w:fldChar runs are NOT placed inside <w:del>',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original document containing a NUMPAGES field and a revised document with the field removed',
        async () => {
          const original = await buildFieldDocx(
            `<w:p><w:r><w:t>Total pages </w:t></w:r>${makeField(' NUMPAGES ', '3')}<w:r><w:t> here.</w:t></w:r></w:p>`,
          );
          const revised = await buildFieldDocx(
            `<w:p><w:r><w:t>Total pages here.</w:t></w:r></w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del>; field structure validates on combined/accept/reject', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertFieldStructureSurvives(combined);
      });
    },
  );
});

// =============================================================================
// Edge cases (Phase 1.5 / Phase 2 — verify the classifier handles corner cases)
// =============================================================================

describe('Field fragmentation — edge cases', () => {
  test.skip(
    'nested field modification: outer field unchanged, inner instr modified — TODO Phase 2 if classifier supports',
    async () => {
      // Placeholder: nested-field correlation through the collapsed-field
      // atomizer needs Phase 1.5 classifier work to verify. Re-enable once
      // classification covers this.
    },
  );

  test.skip(
    'field without separator (deferred-result field): instr modification fragments correctly',
    async () => {
      // Placeholder: ECMA-376 permits a field without a separator (the result
      // appears at the end side). Currently rare in safe-docx fixtures; revisit
      // post-Phase 2 to ensure the classifier doesn't false-classify these as
      // non-fields.
    },
  );
});
