import { describe, expect } from 'vitest';
import JSZip from 'jszip';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { buildSyntheticDocx } from '../src/integration/synthetic-docx-fixture.js';
import {
  UnsupportedConformanceClassError,
  WML_STRICT_NS,
  detectWmlConformanceClass,
} from '../src/primitives/conformance.js';
import { DocxDocument } from '../src/primitives/document.js';
import { OOXML } from '../src/primitives/namespaces.js';
import { parseXml } from '../src/primitives/xml.js';

const TEST_FEATURE = 'refuse-wml-strict-documents';

const test = testAllure
  .epic('DOCX Primitives')
  .withLabels({ feature: 'Document' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '2.1' });

const BODY_TEXT = 'Alpha bravo charlie.';

/**
 * Rewrite the main document part's WordprocessingML namespace. This is the
 * reproduction from #1025: the same package, with every `w:` element moved
 * from the Transitional namespace to the Strict one.
 */
async function withDocumentNamespace(buffer: Buffer, from: string, to: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain(from);
  zip.file('word/document.xml', xml.split(from).join(to));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('WML conformance-class gate at load', () => {
  test.openspec('[SDX-CONF-01] Loading a WML Strict package throws a typed conformance-class error')(
    '[SDX-CONF-01] a Strict-namespace document.xml is refused instead of reading as empty',
    async ({ given, when, then, and }: AllureBddContext) => {
      let strict: Buffer;
      let failure: unknown;

      await given('a synthetic package whose document.xml uses the Strict WordprocessingML namespace', async () => {
        const transitional = await buildSyntheticDocx({ paragraphs: [BODY_TEXT] });
        strict = await withDocumentNamespace(transitional, OOXML.W_NS, WML_STRICT_NS);
      }, { namespace: WML_STRICT_NS });

      await when('DocxDocument.load is called', async () => {
        failure = await DocxDocument.load(strict).then(
          () => undefined,
          (error: unknown) => error,
        );
      });

      await then('it rejects with UnsupportedConformanceClassError carrying the typed code', () => {
        expect(failure).toBeInstanceOf(UnsupportedConformanceClassError);
        const error = failure as UnsupportedConformanceClassError;
        expect(error.code).toBe('UNSUPPORTED_CONFORMANCE_CLASS');
        expect(error.name).toBe('UnsupportedConformanceClassError');
        expect(error.conformanceClass).toBe('strict');
        expect(error.namespaceUri).toBe(WML_STRICT_NS);
        expect(error.partPath).toBe('word/document.xml');
      });

      await and('the message names the conformance class and the hint says how to re-save', () => {
        const error = failure as UnsupportedConformanceClassError;
        expect(error.message).toContain('WML Strict');
        expect(error.message).toContain('ISO/IEC 29500 Strict');
        expect(error.message).toContain(WML_STRICT_NS);
        expect(error.hint).toMatch(/Transitional/);
      });
    },
  );

  test.openspec('[SDX-CONF-02] A Transitional control package loads and reads its body text')(
    '[SDX-CONF-02] the unmodified Transitional package still loads and yields its text',
    async ({ given, when, then, and }: AllureBddContext) => {
      let transitional: Buffer;
      let declaresStrictPrefix: Buffer;
      let text: string;
      let controlText: string;

      await given('the same synthetic package in the Transitional namespace', async () => {
        transitional = await buildSyntheticDocx({ paragraphs: [BODY_TEXT] });
      });

      await and('a Transitional package that merely declares the Strict URI as an unused prefix', async () => {
        const zip = await JSZip.loadAsync(transitional);
        const xml = await zip.file('word/document.xml')!.async('string');
        zip.file(
          'word/document.xml',
          xml.replace('<w:document ', `<w:document xmlns:strict="${WML_STRICT_NS}" `),
        );
        declaresStrictPrefix = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
      });

      await when('both packages are loaded, indexed, and rendered as plain text', async () => {
        // toPlainText renders the document view, which is keyed by paragraph
        // bookmarks; index first, as the MCP session path does.
        const doc = await DocxDocument.load(transitional);
        doc.normalize();
        doc.insertParagraphBookmarks('conformance-gate');
        text = await doc.toPlainText();
        const control = await DocxDocument.load(declaresStrictPrefix);
        control.normalize();
        control.insertParagraphBookmarks('conformance-gate');
        controlText = await control.toPlainText();
      });

      await then('the Transitional package reads its body text', () => {
        expect(text).toContain(BODY_TEXT);
      });

      await and('the gate keys on the root element namespace, not on the URI appearing anywhere', () => {
        expect(controlText).toContain(BODY_TEXT);
      });
    },
  );

  test('detectWmlConformanceClass classifies by the root element namespace', async ({ given, when, then }: AllureBddContext) => {
    let strictDoc: Document;
    let transitionalDoc: Document;
    let foreignDoc: Document;

    await given('three parsed parts with Strict, Transitional, and unrelated root namespaces', () => {
      strictDoc = parseXml(`<w:document xmlns:w="${WML_STRICT_NS}"><w:body/></w:document>`);
      transitionalDoc = parseXml(`<w:document xmlns:w="${OOXML.W_NS}"><w:body/></w:document>`);
      foreignDoc = parseXml('<root xmlns="urn:example:other"/>');
    });

    await when('each part is classified', () => {});

    await then('Strict and Transitional are named and an unrelated root is null', () => {
      expect(detectWmlConformanceClass(strictDoc)).toBe('strict');
      expect(detectWmlConformanceClass(transitionalDoc)).toBe('transitional');
      expect(detectWmlConformanceClass(foreignDoc)).toBeNull();
    });
  });
});
