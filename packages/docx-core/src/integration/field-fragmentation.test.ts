/**
 * Integration Tests — ECMA-376 Field-Fragmentation Conformance (issue #217)
 *
 * Asserts the expected fragmented shape of the combined inplace comparison
 * output for field-deletion and field-modification scenarios:
 *
 *   - `w:fldChar` runs MUST NOT appear inside `<w:del>`. (ECMA-376 Part 4 —
 *     Word treats this as fatal and discards the field state machine.)
 *   - On the `<w:del>` side, fragmentation wraps only the `w:instrText`
 *     (renamed to `w:delInstrText`) and result-text (renamed to `w:delText`)
 *     payloads; `w:fldChar` markers are emitted at run-sibling level.
 *   - `validateFieldStructure` MUST return true on the combined output AND on
 *     both the post-accept and post-reject projections.
 *
 * Whole-field INSERTION (and move-destination) is NOT fragmented. ECMA-376
 * permits `w:fldChar` inside `<w:ins>` and `<w:moveTo>`; only `<w:del>` bars
 * it. The existing insertion coverage in `lean-spec-bridge.test.ts:907–941`
 * continues to assert the stronger wrapper-neutrality shape for inserted
 * fields.
 *
 * These tests are red against the pre-#217 engine. They go green after the
 * fragmentation work in `inPlaceModifier.ts` lands (Phase 2 / Phase 3 of the
 * `fragment-ins-del-at-field-boundaries` OpenSpec change).
 */

import { describe, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { compareDocuments } from '@usejunior/docx-compare';
import { DocxArchive } from '../shared/docx/DocxArchive.js';
import { validateFieldStructure } from '@usejunior/docx-compare';
import {
  acceptAllChanges,
  rejectAllChanges,
} from '@usejunior/docx-compare';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  buildDocxFromBodyXml,
  fldChar,
  instrText,
  resultText,
} from '../testing/ooxml-fixtures.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Field Fragmentation (ECMA-376)',
    story: 'Issue #217 — fragment <w:ins>/<w:del> at field-character boundaries',
    severity: 'critical',
  })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.13' });

// =============================================================================
// Helpers
// =============================================================================

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

function countTag(combined: string, tag: string): number {
  const doc = new DOMParser().parseFromString(combined, 'application/xml');
  return doc.getElementsByTagName(tag).length;
}

// Guards against a vacuous pass: assertNoFldCharInside + validateFieldStructure
// also hold when the comparator emits zero tracked changes (e.g., the whole edit
// is silently absorbed). These scenarios are only meaningful if del/ins are
// actually present, so assert that the fragmentation path ran at all.
function assertEmitsTrackedChanges(combined: string): void {
  expect(countTag(combined, 'w:del'), 'expected at least one <w:del>').toBeGreaterThan(0);
  expect(countTag(combined, 'w:ins'), 'expected at least one <w:ins>').toBeGreaterThan(0);
}

function makeField(instr: string, result: string): string {
  return (
    fldChar('begin') +
    instrText(instr, { preserve: true }) +
    fldChar('separate') +
    resultText(result) +
    fldChar('end')
  );
}

// A nested field — the canonical { IF { <inner> } = 1 "<result>" } shape, where
// the inner field lives inside the outer instruction region. ECMA-376 §17.16.5.1
// permits arbitrarily nested fields; both the inner and outer fldChar pairs must
// stay unwrapped on the deletion side.
function makeNestedField(innerInstr: string, result: string): string {
  return (
    fldChar('begin') +
    instrText(' IF ', { preserve: true }) +
    fldChar('begin') +
    instrText(innerInstr, { preserve: true }) +
    fldChar('separate') +
    resultText('1') +
    fldChar('end') +
    instrText(' = 1 ', { preserve: true }) +
    fldChar('separate') +
    resultText(result) +
    fldChar('end')
  );
}

// A separator-less field — begin/instr/end with no `separate` marker. ECMA-376
// §17.16.5.1 permits this (the field carries no cached result). The classifier
// must still recognize the begin/end pair as a field boundary so the fldChar
// markers are emitted unwrapped on the deletion side.
function makeSeparatorlessField(instr: string): string {
  return fldChar('begin') + instrText(instr, { preserve: true }) + fldChar('end');
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
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Status: </w:t></w:r>${makeField(' FORMCHECKBOX ', '☐')}</w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Status: </w:t></w:r>${makeField(' FORMTEXT ', 'answer')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
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
          const original = await buildDocxFromBodyXml(
            `<w:p>${makeField(' HYPERLINK "https://a.example" ', 'old link')}</w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p>${makeField(' HYPERLINK "https://b.example" ', 'new link')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
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
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>See page </w:t></w:r>${makeField(' PAGEREF _Toc-A \\h ', '12')}</w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>See page </w:t></w:r>${makeField(' PAGEREF _Toc-B \\h ', '15')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
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
          const original = await buildDocxFromBodyXml(
            `<w:p>${wrapBookmark(makeField(' NUMPAGES ', '3'))}</w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p>${wrapBookmark(makeField(' SECTIONPAGES ', '1'))}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'deleted field with an internal bookmark survives accept/reject (pre-existing first-source-run hoist; regression guard)',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'a NUMPAGES field with bookmarkStart between begin and instrText in the original; field deleted in revised',
        async () => {
          const fieldWithInternalBookmark =
            `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
            `<w:bookmarkStart w:id="9" w:name="bm_inside_field"/>` +
            `<w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
            `<w:r><w:t>3</w:t></w:r>` +
            `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
            `<w:bookmarkEnd w:id="9"/>`;
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Pages </w:t></w:r>${fieldWithInternalBookmark}<w:r><w:t> total.</w:t></w:r></w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Pages total.</w:t></w:r></w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar inside <w:del>; field validates; bookmarkStart/End survive in the combined view', () => {
        assertNoFldCharInside(combined, 'w:del');
        assertFieldStructureSurvives(combined);
        // The pre-existing engine behavior hoists the bookmarkStart found
        // adjacent to the first source run BEFORE the first emitted element
        // (the begin fldChar). It does NOT walk per-source-run, so a bookmark
        // sitting between later field runs would not be cloned. That is a
        // known limitation documented in the OpenSpec design Risks section
        // and tracked as a follow-up. This fixture only guards the first-run
        // case from regressing.
        expect(combined, 'bookmarkStart cloned into combined output').toMatch(
          /<w:bookmarkStart[^>]*w:name="bm_inside_field"/,
        );
        expect(combined, 'bookmarkEnd cloned into combined output').toMatch(
          /<w:bookmarkEnd[^>]*w:id="9"/,
        );
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
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Pages: </w:t></w:r>${makeField(' NUMPAGES ', '3')}</w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Pages: </w:t></w:r>${makeField(' NUMPAGES ', '4')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then('no w:fldChar appears inside <w:del>; field structure validates', () => {
        assertNoFldCharInside(combined, 'w:del');
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
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Total pages </w:t></w:r>${makeField(' NUMPAGES ', '3')}<w:r><w:t> here.</w:t></w:r></w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
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
  test(
    'nested whole-field replacement (IF { PAGE } … → IF { NUMPAGES } …): both inner and outer fldChar runs stay unwrapped',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original IF field wrapping a PAGE field (result "first") and a revised one wrapping NUMPAGES (result "second")',
        async () => {
          // Because the whole collapsed-field atom changes, the engine emits a
          // whole-field deletion + whole-field insertion (NOT a surgical
          // inner-only edit). This still exercises the property under test: with
          // nested fields, neither the inner nor the outer fldChar pair may be
          // wrapped on the deletion side. (Per the engine note above, a pure
          // instr-only edit would be absorbed, so the inner instr change is
          // paired with a result change to force del/ins emission.)
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Page check: </w:t></w:r>${makeNestedField(' PAGE ', 'first')}</w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Page check: </w:t></w:r>${makeNestedField(' NUMPAGES ', 'second')}</w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then(
        'tracked changes are emitted; no fldChar (inner or outer) is inside <w:del>; old content is wrapped and new content inserted; field structure validates',
        () => {
          assertEmitsTrackedChanges(combined);
          assertNoFldCharInside(combined, 'w:del');
          // Both nested field marker pairs survive as fldChar runs (2 fields ×
          // begin/separate/end, on both the deleted and inserted sides = 12).
          expect(countTag(combined, 'w:fldChar'), 'all six markers preserved on both sides').toBe(
            12,
          );
          // Deleted (original) field payloads are wrapped as del-text.
          expect(combined).toContain('<w:delInstrText');
          expect(combined).toMatch(/<w:delInstrText[^>]*> PAGE <\/w:delInstrText>/);
          expect(combined).toMatch(/<w:delText>first<\/w:delText>/);
          // Revised field content lands on the insertion side, unwrapped.
          expect(combined).toMatch(/<w:instrText[^>]*> NUMPAGES <\/w:instrText>/);
          expect(combined).toContain('second');
          assertFieldStructureSurvives(combined);
        },
      );
    },
  );

  test(
    'field without separator (deferred-result field) deleted: fldChar runs stay unwrapped',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original document containing a separator-less AUTONUM field and a revised document with the field removed',
        async () => {
          // ECMA-376 permits a field with no `separate` marker, hence no cached
          // result text. An instr-only edit on such a field is absorbed (no
          // visible delta), so whole-field deletion is used to drive the
          // deletion-side fragmentation path: the begin/end markers must be
          // emitted unwrapped while only the delInstrText payload is wrapped.
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Item </w:t></w:r>${makeSeparatorlessField(' AUTONUM ')}<w:r><w:t> done.</w:t></w:r></w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Item  done.</w:t></w:r></w:p>`,
          );
          combined = await compareInplace(original, revised);
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then(
        'tracked changes are emitted; the field is begin/end only (no separate); instr is wrapped as delInstrText; no fldChar inside <w:del>; field structure validates',
        () => {
          assertEmitsTrackedChanges(combined);
          assertNoFldCharInside(combined, 'w:del');
          // Separator-less shape preserved: exactly the begin/end pair, no
          // `separate` marker is synthesized by the engine.
          const doc = new DOMParser().parseFromString(combined, 'application/xml');
          const types: string[] = [];
          const markers = doc.getElementsByTagName('w:fldChar');
          for (let i = 0; i < markers.length; i++) {
            types.push(markers[i]?.getAttribute('w:fldCharType') ?? '');
          }
          expect(types).toEqual(['begin', 'end']);
          // The instruction payload is the wrapped deletion content.
          expect(combined).toMatch(/<w:delInstrText[^>]*> AUTONUM <\/w:delInstrText>/);
          assertFieldStructureSurvives(combined);
        },
      );
    },
  );
});
