import JSZip from 'jszip';
import { beforeAll, describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { DocxDocument } from '../primitives/document.js';
import { parseXml } from '../primitives/xml.js';
import { childElements } from '../primitives/dom-helpers.js';
import { generateDocx } from '../generation/compile.js';
import { checkGeneratedPackage } from '../generation/structural-checks.js';
import type { DocumentSpec } from '../generation/types.js';
import { probeSofficeUsable, resolveSoffice } from './libreoffice-oracle.js';
import { probeDocxIdentity, probeDocxToPdf } from './generation-probes.js';
import { writeIntegrationArtifact, getIntegrationOutputModeLabel } from './output-artifacts.js';

const TEST_FEATURE = 'add-docx-generation';
const test = testAllure.epic('Document Generation').withLabels({ feature: TEST_FEATURE });

function phase1Spec(): DocumentSpec {
  return {
    meta: { title: 'SDX generation phase 1', author: 'safe-docx tests', createdIso: '2026-06-10T00:00:00Z' },
    sections: [
      {
        page: { sizeTwips: { w: 12240, h: 15840 } },
        blocks: [
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Phase 1 skeleton document.' }] },
          { kind: 'paragraph', runs: [{ kind: 'text', text: 'Plain paragraphs, explicit page setup, no styles yet.' }] },
        ],
      },
    ],
  };
}

/** Re-zip the generated package with one part removed — a tampering helper. */
async function repackWithout(buffer: Buffer, removedPart: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  zip.remove(removedPart);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

describe('Traceability: generated package structural integrity', () => {
  test.openspec('[SDX-GEN-010] the package relationship graph is closed')(
    'Scenario: the package relationship graph is closed',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let generated!: Buffer;
      await given('a generated package', async () => {
        generated = await generateDocx(phase1Spec());
      });

      await when('the structural checks enumerate parts, content types, and relationships', async () => {
        const result = await checkGeneratedPackage(generated);
        await attachPrettyJson('structural-check-result', result);
        expect(result.ok).toBe(true);
      });

      await then('removing a relationship target is detected as a dangling reference', async () => {
        const tampered = await repackWithout(generated, 'docProps/core.xml');
        const result = await checkGeneratedPackage(tampered);
        await attachPrettyJson('tampered-check-result', result);
        expect(result.ok).toBe(false);
        expect(result.issues.some((i) => i.check === 'relationship_target')).toBe(true);
      });
    },
  );

  test.openspec('[SDX-GEN-011] every XML part carries an XML declaration')(
    'Scenario: every XML part carries an XML declaration',
    async ({ given, when, then }: AllureBddContext) => {
      let generated!: Buffer;
      await given('a generated package', async () => {
        generated = await generateDocx(phase1Spec());
      });

      let partTexts!: Array<{ name: string; head: string }>;
      await when('every XML part is read back from the zip', async () => {
        const zip = await JSZip.loadAsync(generated);
        partTexts = await Promise.all(
          Object.values(zip.files)
            .filter((f) => !f.dir && (f.name.endsWith('.xml') || f.name.endsWith('.rels')))
            .map(async (f) => ({ name: f.name, head: (await f.async('text')).slice(0, 60) })),
        );
        expect(partTexts.length).toBeGreaterThanOrEqual(6);
      });

      await then('each part begins with an <?xml declaration (xmldom omits it; emitters must prepend)', async () => {
        for (const part of partTexts) {
          expect(part.head.startsWith('<?xml'), `${part.name} starts with: ${part.head}`).toBe(true);
        }
      });
    },
  );

  test
    .openspec('[SDX-GEN-012] exactly one body-level sectPr, positioned last')
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.17' })(
    'Scenario: exactly one body-level sectPr, positioned last',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      let generated!: Buffer;
      await given('a generated package', async () => {
        generated = await generateDocx(phase1Spec());
      });

      await when('the document body is parsed', async () => {
        const zip = await JSZip.loadAsync(generated);
        const documentXml = await zip.file('word/document.xml')!.async('text');
        const body = parseXml(documentXml).getElementsByTagName('w:body').item(0)!;
        const kids = childElements(body);
        const sectPrKids = kids.filter((k) => k.tagName === 'w:sectPr');
        expect(sectPrKids).toHaveLength(1);
        expect(kids[kids.length - 1]!.tagName).toBe('w:sectPr');
      });

      await then('a duplicated body-level sectPr is rejected by the structural checks', async () => {
        const zip = await JSZip.loadAsync(generated);
        const documentXml = await zip.file('word/document.xml')!.async('text');
        const doubled = documentXml.replace('<w:body>', '<w:body><w:sectPr></w:sectPr>');
        zip.file('word/document.xml', doubled);
        const tampered = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
        const result = await checkGeneratedPackage(tampered);
        await attachPrettyJson('tampered-sectpr-result', result);
        expect(result.ok).toBe(false);
        expect(result.issues.some((i) => i.check === 'sectpr')).toBe(true);
      });
    },
  );

  test('phase 1 review artifact is written for the manual compatibility matrix', async () => {
    const generated = await generateDocx(phase1Spec());
    const outputPath = await writeIntegrationArtifact('generation-phase1-minimal.docx', generated);
    expect(outputPath).toContain('generation-phase1-minimal.docx');
    expect(generated.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[generation artifacts] wrote ${outputPath} (${getIntegrationOutputModeLabel()})`);
  });
});

// Gated on a LibreOffice binary; CI does not install one, so the probes are a
// local developer check (set SAFE_DOCX_SOFFICE_BIN for non-standard locations).
const soffice = resolveSoffice();
const describeProbes = soffice ? describe : describe.skip;
if (!soffice) {
  // eslint-disable-next-line no-console
  console.warn(
    '[generation-package-structure] SKIP: no LibreOffice (soffice) binary found; ' +
      'cross-reader probes run locally only.',
  );
}

describeProbes('Traceability: LibreOffice probes over generated packages', () => {
  // `resolveSoffice()` proves the binary EXISTS, not that it can launch: under
  // a restricted shell it dies with SIGABRT during init, which would FAIL these
  // tests rather than skip them (observed: exit 134, "Abort trap: 6"). Probe
  // launchability once and skip the body when it is unusable.
  let sofficeUsable = false;
  beforeAll(async () => {
    sofficeUsable = soffice ? await probeSofficeUsable(soffice) : false;
    if (!sofficeUsable) {
      // eslint-disable-next-line no-console
      console.warn(
        '[generation-package-structure] SKIP: soffice present but not launchable ' +
          '(sandbox abort); cross-reader probes skipped.',
      );
    }
  }, 60_000); // probeSofficeUsable launches soffice; the 10s default hook timeout is too short.

  test.openspec('[SDX-GEN-090] LibreOffice identity round-trip succeeds')(
    'Scenario: LibreOffice identity round-trip succeeds',
    async ({ given, when, then, attachPrettyJson }: AllureBddContext) => {
      if (!sofficeUsable) return;
      let generated!: Buffer;
      await given('a generated full-package document', async () => {
        generated = await generateDocx(phase1Spec());
      });

      let savedPackage!: Buffer;
      await when('LibreOffice loads and re-saves it headlessly', async () => {
        const probe = await probeDocxIdentity(generated, soffice);
        savedPackage = probe.savedPackage;
        expect(savedPackage.length).toBeGreaterThan(0);
      });

      await then('the re-saved package loads with the paragraph content preserved', async () => {
        const doc = await DocxDocument.load(savedPackage);
        doc.insertParagraphBookmarks('sdx-gen-090');
        const texts = doc.readParagraphs().paragraphs.map((p) => p.text);
        await attachPrettyJson('resaved-paragraphs', texts);
        expect(texts.join('\n')).toContain('Phase 1 skeleton document.');
      });
    },
    120_000,
  );

  test.openspec('[SDX-GEN-091] headless PDF conversion succeeds')(
    'Scenario: headless PDF conversion succeeds',
    async ({ given, when, then }: AllureBddContext) => {
      if (!sofficeUsable) return;
      let generated!: Buffer;
      await given('a generated full-package document', async () => {
        generated = await generateDocx(phase1Spec());
      });

      let pdf!: Buffer;
      await when('LibreOffice converts it to PDF headlessly', async () => {
        const probe = await probeDocxToPdf(generated, soffice);
        pdf = probe.pdf;
      });

      await then('the conversion produced a non-empty PDF', async () => {
        expect(pdf.length).toBeGreaterThan(0);
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      });
    },
    120_000,
  );
});
