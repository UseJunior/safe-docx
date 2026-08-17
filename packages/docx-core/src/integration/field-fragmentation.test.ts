/**
 * Integration Tests — complex-field tracked-change behavior (issue #217 retraction)
 *
 * Asserts the Word-compatible shape of combined inplace comparison output:
 *
 *   - instruction changes replace the whole field, including `w:fldChar`,
 *     inside `<w:del>` / `<w:ins>`;
 *   - result-only changes preserve the field and redline only cached text;
 *   - `validateFieldStructure` MUST return true on the combined output AND on
 *     both the post-accept and post-reject projections.
 *
 * Microsoft Word 16.112 and Aspose.Words 25.10 were measured on 2026-08-14
 * using the minimal scenarios below. Both produced those two behaviors.
 */

import { describe, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { compareDocumentsAtomizer as compareDocuments } from '@usejunior/docx-compare';
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
import { validateBookmarkIntegrity } from '../shared/validators/structural.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'Field Fragmentation (ECMA-376)',
    story: 'Issue #217 retraction — preserve visible whole-field deletions',
    severity: 'critical',
  })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.13' });

// =============================================================================
// Helpers
// =============================================================================

async function compareInplace(
  original: Buffer,
  revised: Buffer,
  comparisonStrategy: 'tagged-tree' | 'legacy' = 'tagged-tree',
): Promise<string> {
  const result = await compareDocuments(original, revised, {
    reconstructionMode: 'inplace',
    comparisonStrategy,
  });
  if (result.reconstructionModeUsed !== 'inplace') {
    throw new Error(
      `expected inplace mode but engine fell back to ${result.reconstructionModeUsed ?? 'unknown'}: ` +
        `${result.fallbackReason ?? 'no reason'} ${JSON.stringify(result.fallbackDiagnostics)}`,
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
      `expected the field markers to remain outside <${parentTag}> for a surgical result edit.`,
  ).toEqual([]);
}

function assertWholeFieldInside(combined: string, parentTag: 'w:del' | 'w:ins'): void {
  const doc = new DOMParser().parseFromString(combined, 'application/xml');
  const fldChars = Array.from(doc.getElementsByTagName('w:fldChar')) as unknown as Element[];
  const inside = fldChars.filter((el) => hasAncestorWithTag(el, parentTag));
  expect(inside.map((el) => el.getAttribute('w:fldCharType'))).toEqual([
    'begin',
    'separate',
    'end',
  ]);
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

function visibleText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.getElementsByTagName('w:t'))
    .map((node) => node.textContent ?? '')
    .join('');
}

// Guards against a vacuous pass: wrapper-shape + validateFieldStructure
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
// permits arbitrarily nested fields; both marker pairs must survive replacement.
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
// must still recognize the begin/end pair as a field boundary.
function makeSeparatorlessField(instr: string): string {
  return fldChar('begin') + instrText(instr, { preserve: true }) + fldChar('end');
}

// =============================================================================
// Modification fixtures — Word/Aspose oracle measurements from 2026-08-14
// =============================================================================

// ---------------------------------------------------------------------------
// Engine note (verified 2026-05-23 via probe script): the collapsed-field atom
// hashes by VISIBLE text only. So a pure-instr-only modification (e.g.,
// FORMCHECKBOX → FORMTEXT with identical result "☐") is silently absorbed —
// the comparator sees Equal atoms and emits the revised document verbatim
// with no tracked changes. That is a SEPARATE GAP (not in scope for #217).
// To exercise the whole-field replacement path, the scenarios below combine instr
// and result changes so the engine actually emits <w:ins>/<w:del>.
// ---------------------------------------------------------------------------

describe('Field fragmentation — modification scenarios', () => {
  test(
    'FORMCHECKBOX → FORMTEXT (with result change): replaces the whole field',
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

      await then('both the deleted and inserted fields include their field markers', () => {
        assertWholeFieldInside(combined, 'w:del');
        assertWholeFieldInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'HYPERLINK target rewrite (with link-text change): replaces the whole field',
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

      await then('both the deleted and inserted fields include their field markers', () => {
        assertWholeFieldInside(combined, 'w:del');
        assertWholeFieldInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'PAGEREF target rewrite (with result-page change): replaces the whole field',
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

      await then('both the deleted and inserted fields include their field markers', () => {
        assertWholeFieldInside(combined, 'w:del');
        assertWholeFieldInside(combined, 'w:ins');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'bookmarked field modification (with result change): replaces the whole field',
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

      await then('both the deleted and inserted fields include their field markers', () => {
        assertWholeFieldInside(combined, 'w:del');
        assertWholeFieldInside(combined, 'w:ins');
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

      await then('accept and reject reproduce the revised and original behavior exactly', () => {
        assertFieldStructureSurvives(combined);

        const accepted = acceptAllChanges(combined);
        const rejected = rejectAllChanges(combined);

        expect(visibleText(accepted)).toBe('Pages total.');
        expect(accepted).not.toContain('NUMPAGES');
        expect(accepted).not.toContain('bm_inside_field');

        expect(visibleText(rejected)).toBe('Pages 3 total.');
        expect(countTag(rejected, 'w:fldChar')).toBe(3);
        expect(rejected).toContain('NUMPAGES');
        expect(rejected, 'Reject All restores the original bookmark start').toMatch(
          /<w:bookmarkStart[^>]*w:name="bm_inside_field"/,
        );
        expect(validateBookmarkIntegrity(rejected)).toEqual({
          unmatchedStartIds: [],
          unmatchedEndIds: [],
          duplicateStartIds: [],
          duplicateEndIds: [],
        });
        const rejectedDocument = new DOMParser().parseFromString(rejected, 'application/xml');
        const starts = Array.from(rejectedDocument.getElementsByTagName('w:bookmarkStart'));
        const ends = Array.from(rejectedDocument.getElementsByTagName('w:bookmarkEnd'));
        expect(starts).toHaveLength(1);
        expect(ends).toHaveLength(1);
        expect(ends[0]!.getAttribute('w:id')).toBe(starts[0]!.getAttribute('w:id'));
      });
    },
  );

  test(
    'result-text-only change (NUMPAGES 3 → 4): preserves fldChar and redlines only cached text',
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

  test(
    'result-only narrowing skips an outer field whose result contains a nested field',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given('the same outer IF instruction with a nested PAGE field in its changing result', async () => {
        const nestedResult = (value: string) =>
          fldChar('begin') + instrText(' IF ', { preserve: true }) + fldChar('separate') +
          makeField(' PAGE ', '7') + resultText(value) + fldChar('end');
        const original = await buildDocxFromBodyXml(`<w:p>${nestedResult('3')}</w:p>`);
        const revised = await buildDocxFromBodyXml(`<w:p>${nestedResult('4')}</w:p>`);
        combined = await compareInplace(original, revised);
      });

      await when('the inplace combined output is produced', async () => {});

      await then('both projections preserve the balanced nested fields and select the intended cache', () => {
        assertEmitsTrackedChanges(combined);
        assertFieldStructureSurvives(combined);

        const accepted = acceptAllChanges(combined);
        const rejected = rejectAllChanges(combined);

        // One balanced outer field and one balanced nested field remain live.
        // Duplicating both skeletons would produce 12 controls and needlessly
        // expose reader-specific field topology in the tracked document.
        expect(countTag(combined, 'w:fldChar')).toBe(6);
        expect(countTag(accepted, 'w:fldChar')).toBe(6);
        expect(countTag(rejected, 'w:fldChar')).toBe(6);
        expect(visibleText(accepted)).toBe('74');
        expect(visibleText(rejected)).toBe('73');
      });
    },
  );

  test(
    'result-only narrowing survives an adjacent prose replacement',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given('changed prose beside a NUMPAGES cached-result update', async () => {
        const original = await buildDocxFromBodyXml(
          `<w:p><w:r><w:t>This agreement has old total pages: </w:t></w:r>${makeField(' NUMPAGES ', '3')}<w:r><w:t> as calculated here.</w:t></w:r></w:p>`,
        );
        const revised = await buildDocxFromBodyXml(
          `<w:p><w:r><w:t>This agreement has new total pages: </w:t></w:r>${makeField(' NUMPAGES ', '4')}<w:r><w:t> as calculated here.</w:t></w:r></w:p>`,
        );
        combined = await compareInplace(original, revised);
      });

      await when('the inplace combined output is produced', async () => {});

      await then('the unchanged field scaffolding remains outside the result revisions', () => {
        assertEmitsTrackedChanges(combined);
        expect(countTag(combined, 'w:fldChar')).toBe(3);
        assertNoFldCharInside(combined, 'w:del');
        assertNoFldCharInside(combined, 'w:ins');
        expect(rejectAllChanges(combined)).toContain('old');
        expect(rejectAllChanges(combined)).toContain('3');
        expect(acceptAllChanges(combined)).toContain('new');
        expect(acceptAllChanges(combined)).toContain('4');
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test(
    'result-only narrowing skips fields whose marker attributes differ',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given('matching NUMPAGES instructions with original-only lock and dirty marker state', async () => {
        const originalField =
          '<w:r><w:fldChar w:fldCharType="begin" w:fldLock="true" w:dirty="true"/></w:r>' +
          instrText(' NUMPAGES ', { preserve: true }) + fldChar('separate') + resultText('3') + fldChar('end');
        const revisedField = makeField(' NUMPAGES ', '4');
        const original = await buildDocxFromBodyXml(`<w:p>${originalField}</w:p>`);
        const revised = await buildDocxFromBodyXml(`<w:p>${revisedField}</w:p>`);
        combined = await compareInplace(original, revised);
      });

      await when('the inplace combined output is produced', async () => {});

      await then('reject restores the original marker state instead of borrowing revised scaffolding', () => {
        assertEmitsTrackedChanges(combined);
        const rejected = rejectAllChanges(combined);
        expect(rejected).toMatch(/w:fldChar[^>]*w:fldCharType="begin"[^>]*w:fldLock="true"[^>]*w:dirty="true"/);
        assertFieldStructureSurvives(combined);
      });
    },
  );

  test('does not reuse one inserted field for repeated deleted instructions', async ({ given, when, then }: AllureBddContext) => {
    let combined: string;
    await given('two original NUMPAGES fields and one revised NUMPAGES field in anchored prose', async () => {
      const original = await buildDocxFromBodyXml(
        `<w:p><w:r><w:t>Stable opening prose. </w:t></w:r>${makeField(' NUMPAGES ', '3')}<w:r><w:t> middle </w:t></w:r>${makeField(' NUMPAGES ', '3')}<w:r><w:t> stable closing prose.</w:t></w:r></w:p>`,
      );
      const revised = await buildDocxFromBodyXml(
        `<w:p><w:r><w:t>Stable opening prose. </w:t></w:r>${makeField(' NUMPAGES ', '4')}<w:r><w:t> middle stable closing prose.</w:t></w:r></w:p>`,
      );
      combined = await compareInplace(original, revised);
    });

    await when('the repeated-instruction paragraph is compared', async () => {});

    await then('the insertion is consumed once and both projections remain exact', () => {
      expect(rejectAllChanges(combined).match(/>3</g)).toHaveLength(2);
      expect(acceptAllChanges(combined).match(/>4</g)).toHaveLength(1);
      assertFieldStructureSurvives(combined);
    });
  });
});

// =============================================================================
// Whole-field deletion fixture (Phase 3 — research-gated representation)
// =============================================================================

describe('Field fragmentation — whole-field deletion', () => {
  test(
    'whole-field deletion: w:fldChar runs are placed inside <w:del>',
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

      await then('the whole field is inside <w:del>; field structure validates on combined/accept/reject', () => {
        assertWholeFieldInside(combined, 'w:del');
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
    'nested whole-field replacement (IF { PAGE } … → IF { NUMPAGES } …): wraps both fields',
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
          combined = await compareInplace(original, revised, 'legacy');
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then(
        'tracked changes wrap every marker on both sides and field structure validates',
        () => {
          assertEmitsTrackedChanges(combined);
          expect(countTag(combined, 'w:fldChar')).toBe(12);
          const doc = new DOMParser().parseFromString(combined, 'application/xml');
          const markers = Array.from(doc.getElementsByTagName('w:fldChar')) as unknown as Element[];
          expect(markers.filter((el) => hasAncestorWithTag(el, 'w:del'))).toHaveLength(6);
          expect(markers.filter((el) => hasAncestorWithTag(el, 'w:ins'))).toHaveLength(6);
          // Both nested field marker pairs survive as fldChar runs (2 fields ×
          // begin/separate/end, on both the deleted and inserted sides = 12).
          expect(countTag(combined, 'w:fldChar'), 'all six markers preserved on both sides').toBe(
            12,
          );
          // Deleted (original) field payloads are wrapped as del-text.
          expect(combined).toContain('<w:delInstrText');
          expect(combined).toMatch(/<w:delInstrText[^>]*> PAGE <\/w:delInstrText>/);
          expect(combined).toMatch(/<w:delText>first<\/w:delText>/);
          // Revised field content lands on the insertion side.
          expect(combined).toMatch(/<w:instrText[^>]*> NUMPAGES <\/w:instrText>/);
          expect(combined).toContain('second');
          assertFieldStructureSurvives(combined);
        },
      );
    },
  );

  test(
    'field without separator (deferred-result field) deleted: wraps its fldChar runs',
    async ({ given, when, then }: AllureBddContext) => {
      let combined: string;

      await given(
        'an original document containing a separator-less AUTONUM field and a revised document with the field removed',
        async () => {
          // ECMA-376 permits a field with no `separate` marker, hence no cached
          // result text. An instr-only edit on such a field is absorbed (no
          // visible delta), so whole-field deletion is used to drive the
          // whole-field deletion path for a separator-less field.
          const original = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Item </w:t></w:r>${makeSeparatorlessField(' AUTONUM ')}<w:r><w:t> done.</w:t></w:r></w:p>`,
          );
          const revised = await buildDocxFromBodyXml(
            `<w:p><w:r><w:t>Item  done.</w:t></w:r></w:p>`,
          );
          combined = await compareInplace(original, revised, 'legacy');
        },
      );

      await when('the inplace combined output is produced', async () => {});

      await then(
        'tracked changes are emitted; the begin/end-only field is wholly wrapped and validates',
        () => {
          assertEmitsTrackedChanges(combined);
          const parsed = new DOMParser().parseFromString(combined, 'application/xml');
          const fieldMarkers = Array.from(parsed.getElementsByTagName('w:fldChar')) as unknown as Element[];
          expect(fieldMarkers.filter((el) => hasAncestorWithTag(el, 'w:del'))).toHaveLength(2);
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
