import { describe, expect } from 'vitest';
import {
  DocxArchive,
  OOXML,
  UnsupportedConformanceClassError,
  WML_STRICT_NS,
  buildSyntheticDocx,
} from '@usejunior/docx-core';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocuments } from '../index.js';

const TEST_FEATURE = 'refuse-wml-strict-documents';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '2.1' });

async function asStrict(buffer: Buffer): Promise<Buffer> {
  const archive = await DocxArchive.load(buffer);
  const xml = await archive.getDocumentXml();
  expect(xml).toContain(OOXML.W_NS);
  archive.setDocumentXml(xml.split(OOXML.W_NS).join(WML_STRICT_NS));
  return archive.save();
}

async function settle(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => undefined, (error: unknown) => error);
}

describe('comparison refuses WML Strict inputs', () => {
  test.openspec('[SDX-CONF-03] Comparison refuses a WML Strict input with the same typed error as load')(
    '[SDX-CONF-03] either Strict input fails closed and the error names the side',
    async ({ given, when, then, and }: AllureBddContext) => {
      let transitional: Buffer;
      let strict: Buffer;
      let bothStrict: unknown;
      let strictRevised: unknown;
      let strictOriginal: unknown;

      await given('a Transitional package and its Strict-namespace rewrite', async () => {
        transitional = await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] });
        strict = await asStrict(transitional);
      }, { namespace: WML_STRICT_NS });

      await when('compareDocuments runs with Strict on both sides, the revised side, and the original side', async () => {
        bothStrict = await settle(compareDocuments(strict, strict));
        strictRevised = await settle(compareDocuments(transitional, strict));
        strictOriginal = await settle(compareDocuments(strict, transitional));
      });

      await then('each comparison rejects with UnsupportedConformanceClassError', () => {
        expect(bothStrict).toBeInstanceOf(UnsupportedConformanceClassError);
        expect(strictRevised).toBeInstanceOf(UnsupportedConformanceClassError);
        expect(strictOriginal).toBeInstanceOf(UnsupportedConformanceClassError);
        expect((bothStrict as UnsupportedConformanceClassError).code).toBe('UNSUPPORTED_CONFORMANCE_CLASS');
      });

      await and('the error names the conformance class and the offending side', () => {
        expect((bothStrict as UnsupportedConformanceClassError).side).toBe('original');
        expect((strictRevised as UnsupportedConformanceClassError).side).toBe('revised');
        expect((strictRevised as UnsupportedConformanceClassError).message).toContain("the revised document's word/document.xml");
        expect((strictOriginal as UnsupportedConformanceClassError).side).toBe('original');
        expect((strictOriginal as UnsupportedConformanceClassError).message).toContain('WML Strict');
      });
    },
  );

  test('a Transitional pair still compares', async ({ given, when, then }: AllureBddContext) => {
    let original: Buffer;
    let revised: Buffer;
    let result: Awaited<ReturnType<typeof compareDocuments>>;

    await given('two Transitional packages that differ in one word', async () => {
      original = await buildSyntheticDocx({ paragraphs: ['Alpha bravo charlie.'] });
      revised = await buildSyntheticDocx({ paragraphs: ['Alpha bravo delta.'] });
    });

    await when('compareDocuments runs', async () => {
      result = await compareDocuments(original, revised);
    });

    await then('a redline package is produced', () => {
      expect(result.document.length).toBeGreaterThan(0);
      expect(result.stats).toBeDefined();
    });
  });
});
