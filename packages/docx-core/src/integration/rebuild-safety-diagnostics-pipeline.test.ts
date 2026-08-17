/**
 * Integration Tests — Round-trip safety screening of rebuild output
 *
 * Characterizes the retained legacy reconstruction engine's round-trip safety suite
 * (text equality, bookmark diagnostics, per-story field structure) on rebuild
 * output. Rebuild is the terminal reconstruction strategy, so failures that
 * are outside the supported opaque-field preflight surface in
 * `rebuildSafetyDiagnostics` as caller-visible warnings.
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
  resultText,
} from '../testing/ooxml-fixtures.js';
import { compareDocumentsAtomizer as compareDocuments } from '@usejunior/docx-compare';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Rebuild Safety Diagnostics (#226)' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

// A field opened (begin → instrText → separate → result) but never closed:
// the body story's begin/end counts are 1:0, so validateFieldStructure must
// reject any output that carries it.
const UNCLOSED_DATE_FIELD =
  fldChar('begin') +
  instrText(' DATE ', { preserve: true }) +
  fldChar('separate') +
  resultText('3');

async function buildMalformedFieldPair(): Promise<{ original: Buffer; revised: Buffer }> {
  return {
    original: await buildDocxFromBodyXml(
      paragraphWithField('Intro', UNCLOSED_DATE_FIELD, '') + paragraphWithText('Hello'),
    ),
    revised: await buildDocxFromBodyXml(
      paragraphWithField('Intro', UNCLOSED_DATE_FIELD, '') + paragraphWithText('Hello world'),
    ),
  };
}

describe('Legacy rebuild-output safety screening (issue #226) — rollback engine', () => {
  test(
    'explicit rebuild returns unsupported malformed fields with fieldStructure diagnostics',
    async ({ given, when, then, and, attachPrettyJson }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('original/revised pair whose body opens an unsupported DATE field that never closes', async () => {
        ({ original, revised } = await buildMalformedFieldPair());
      });

      await when('compared with reconstructionMode: rebuild requested explicitly', async () => {
        result = await compareDocuments(original, revised, {
          reconstructionMode: 'rebuild',
          comparisonStrategy: 'legacy',
        });
        await attachPrettyJson('comparison-metadata.json', {
          reconstructionModeUsed: result.reconstructionModeUsed,
          fallbackReason: result.fallbackReason,
          rebuildSafetyDiagnostics: result.rebuildSafetyDiagnostics,
        });
      });

      await then('rebuild output is returned for the unsupported field instruction', () => {
        expect(result.document.length).toBeGreaterThan(0);
        expect(result.reconstructionModeUsed).toBe('rebuild');
      });
      await and('the existing fieldStructure diagnostic remains caller-visible', () => {
        expect(result.rebuildSafetyDiagnostics?.failedChecks).toContain('fieldStructure');
        expect(result.rebuildSafetyDiagnostics?.checks.fieldStructure).toBe(false);
      });
    },
  );

  test(
    'legacy strategy default reconstruction mode keeps malformed-field diagnostics',
    async ({ given, when, then }: AllureBddContext) => {
      let original: Buffer = Buffer.alloc(0);
      let revised: Buffer = Buffer.alloc(0);
      let result: Awaited<ReturnType<typeof compareDocuments>>;

      await given('original/revised pair whose body opens an unsupported DATE field that never closes', async () => {
        ({ original, revised } = await buildMalformedFieldPair());
      });

      await when('compared without specifying a reconstruction mode', async () => {
        result = await compareDocuments(original, revised, {
          comparisonStrategy: 'legacy',
        });
      });

      await then('the fieldStructure failure is surfaced without opaque preflight rejection', () => {
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
          reconstructionMode: 'rebuild',
          comparisonStrategy: 'legacy',
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
