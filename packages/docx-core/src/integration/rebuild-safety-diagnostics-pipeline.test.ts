/**
 * Integration Tests — Round-trip safety screening of rebuild output
 *
 * Verifies that `compareDocumentsAtomizer` runs the round-trip safety suite
 * (text equality, bookmark diagnostics, per-story field structure) on rebuild
 * output. Rebuild is the terminal reconstruction strategy — there is no
 * further fallback — so failures must not block the output; they surface in
 * `rebuildSafetyDiagnostics` as a caller-visible warning. Previously the
 * direct-rebuild path (including the default mode) returned its output with
 * zero safety screening, so a malformed field per the ECMA-376 fldChar
 * begin/end pairing rules could ship undetected.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/226
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import {
  buildDocxFromBodyXml,
  fldChar,
  instrText,
  paragraphWithField,
  paragraphWithText,
  FIELD_INSTRUCTIONS,
  resultText,
} from '../testing/ooxml-fixtures.js';
import { compareDocuments } from '../index.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Rebuild Safety Diagnostics (#226)' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 4, section: '17.16.5' });

// A field opened (begin → instrText → separate → result) but never closed:
// the body story's begin/end counts are 1:0, so validateFieldStructure must
// reject any output that carries it.
const UNCLOSED_PAGE_FIELD =
  fldChar('begin') +
  instrText(FIELD_INSTRUCTIONS.PAGE, { preserve: true }) +
  fldChar('separate') +
  resultText('3');

async function buildMalformedFieldPair(): Promise<{ original: Buffer; revised: Buffer }> {
  return {
    original: await buildDocxFromBodyXml(
      paragraphWithField('Intro', UNCLOSED_PAGE_FIELD, '') + paragraphWithText('Hello'),
    ),
    revised: await buildDocxFromBodyXml(
      paragraphWithField('Intro', UNCLOSED_PAGE_FIELD, '') + paragraphWithText('Hello world'),
    ),
  };
}

describe('Rebuild-output safety screening (issue #226) — pipeline-level', () => {
  test(
    'explicit rebuild with a malformed body field returns output WITH fieldStructure failure surfaced',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('original/revised pair whose body opens a field that never closes', async () => {
        ({ original, revised } = await buildMalformedFieldPair());
      });

      await when('compared with reconstructionMode: rebuild requested explicitly', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
        await attachPrettyJson('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason,
          rebuildSafetyDiagnostics: result.rebuildSafetyDiagnostics,
        });
      });

      await then('rebuild output is still returned (no further fallback exists)', () => {
        expect(result.document.length).toBeGreaterThan(0);
        expect(result.reconstructionModeUsed).toBe('rebuild');
        expect(result.fallbackReason).toBeUndefined();
      });

      await and('the fieldStructure failure is surfaced in rebuildSafetyDiagnostics', () => {
        const diagnostics = result.rebuildSafetyDiagnostics;
        expect(diagnostics, 'rebuild output must be safety-screened').toBeDefined();
        expect(diagnostics?.failedChecks).toContain('fieldStructure');
        expect(diagnostics?.checks.fieldStructure).toBe(false);
      });
    },
  );

  test(
    'default mode (no reconstructionMode) gets the same rebuild safety screening',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('original/revised pair whose body opens a field that never closes', async () => {
        ({ original, revised } = await buildMalformedFieldPair());
      });

      await when('compared without specifying a reconstruction mode', async () => {
        result = await compareDocuments(original, revised, { engine: 'atomizer' });
        await attachPrettyJson('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          rebuildSafetyDiagnostics: result.rebuildSafetyDiagnostics,
        });
      });

      await then('the fieldStructure failure is surfaced in rebuildSafetyDiagnostics', () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        expect(result.rebuildSafetyDiagnostics?.failedChecks).toContain('fieldStructure');
      });
    },
  );

  test(
    'explicit rebuild on a well-formed pair reports no safety diagnostics',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('original/revised pair with plain well-formed paragraphs', async () => {
        original = await buildDocxFromBodyXml(paragraphWithText('Hello'));
        revised = await buildDocxFromBodyXml(paragraphWithText('Hello world'));
      });

      await when('compared with reconstructionMode: rebuild requested explicitly', async () => {
        result = await compareDocuments(original, revised, {
          engine: 'atomizer',
          reconstructionMode: 'rebuild',
        });
        await attachPrettyJson('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          rebuildSafetyDiagnostics: result.rebuildSafetyDiagnostics,
        });
      });

      await then('all safety checks pass and no diagnostics field is present', () => {
        expect(result.reconstructionModeUsed).toBe('rebuild');
        expect(result.rebuildSafetyDiagnostics).toBeUndefined();
      });
    },
  );
});
