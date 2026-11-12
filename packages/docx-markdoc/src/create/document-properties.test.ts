import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect } from 'vitest';
import { parseXml } from '@usejunior/docx-core';
import { testAllure } from '../../../docx-core/src/testing/allure-test.js';
import { runCreateCommand } from './cli-create.js';
import { createDocumentFromMarkdoc } from './create.js';

const TEST_FEATURE = 'add-document-properties-control';
const test = testAllure.epic('DOCX Markdoc').withLabels({
  feature: TEST_FEATURE,
  story: 'Issue 1201 document properties of created documents',
  severity: 'critical',
});

const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC = 'http://purl.org/dc/elements/1.1/';
const DCTERMS = 'http://purl.org/dc/terms/';
const EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

function source(frontmatter: string[]): string {
  return [
    ...(frontmatter.length > 0 ? ['---', ...frontmatter, '---', ''] : []),
    '# Mutual Nondisclosure Agreement',
    '',
    'Each party may disclose confidential information to the other party under this Agreement.',
    '',
  ].join('\n');
}

const KEYED = [
  'author: Jane Roe',
  'date: 2026-01-02',
  'modified: 2026-02-03T04:05:06Z',
  'last-modified-by: Outside Counsel',
  'application: Acme Drafting',
];

/** dc:creator, the two dates, cp:lastModifiedBy and every Application, read from the DOCX bytes through the DOM. */
async function docProps(docx: Buffer) {
  const zip = await JSZip.loadAsync(docx);
  const core = parseXml(await zip.file('docProps/core.xml')!.async('string'));
  const app = parseXml(await zip.file('docProps/app.xml')!.async('string'));
  const text = (ns: string, name: string) => core.getElementsByTagNameNS(ns, name)[0]?.textContent ?? null;
  return {
    creator: text(DC, 'creator'),
    created: text(DCTERMS, 'created'),
    modified: text(DCTERMS, 'modified'),
    lastModifiedBy: text(CP, 'lastModifiedBy'),
    applications: Array.from(app.getElementsByTagNameNS(EP, 'Application')).map((element) => element.textContent),
  };
}

describe('Traceability: document properties of created documents', () => {
  test.openspec('[SDX-MDOC-DOCPROPS-01] frontmatter chooses the modified date, last author and application')(
    'Scenario: frontmatter chooses the modified date, last author and application',
    async ({ given, then }) => {
      const keyed = source(KEYED);
      const omitted = source([...KEYED.slice(0, -1), 'application: none']);
      const built = await given('a keyed source and the same source with application: none, each created twice', async () => ({
        keyed: [await createDocumentFromMarkdoc(keyed), await createDocumentFromMarkdoc(keyed)],
        omitted: [await createDocumentFromMarkdoc(omitted), await createDocumentFromMarkdoc(omitted)],
      }));

      await then('the keyed DOCX carries each chosen property', async () => {
        expect(await docProps(built.keyed[0]!.docx)).toEqual({
          creator: 'Jane Roe',
          created: '2026-01-02T00:00:00Z',
          modified: '2026-02-03T04:05:06Z',
          lastModifiedBy: 'Outside Counsel',
          applications: ['Acme Drafting'],
        });
        expect(built.keyed[0]!.certificate.checks.properties).toMatchObject({ passed: true, negativeControlDetected: true });
      });

      await then('application: none leaves the Application element out', async () => {
        expect((await docProps(built.omitted[0]!.docx)).applications).toEqual([]);
        expect(built.omitted[0]!.certificate.checks.properties.values['app.application']).toBeNull();
      });

      await then('each source builds byte-identical DOCX files on both runs', () => {
        expect(built.keyed[0]!.docx.equals(built.keyed[1]!.docx)).toBe(true);
        expect(built.omitted[0]!.docx.equals(built.omitted[1]!.docx)).toBe(true);
        expect(built.keyed[0]!.certificate.checks.determinism.passed).toBe(true);
      });
    },
  );

  test.openspec('[SDX-MDOC-DOCPROPS-02] the properties are read back with a negative control and the 2006 default is reported')(
    'Scenario: the properties are read back with a negative control and the 2006 default is reported',
    async ({ given, then }) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'docprops-create-'));
      try {
        const result = await given('a source without date or the new keys, created through the CLI', async () => {
          const file = path.join(dir, 'nda.mdoc');
          await writeFile(file, source([]));
          return runCreateCommand([file, path.join(dir, 'out'), '--no-pdf']);
        });

        await then('checks.properties passes and records the 2006 dates and Application safe-docx', async () => {
          const { properties } = result.created.certificate.checks;
          expect(properties).toMatchObject({ passed: true, negativeControlDetected: true });
          expect(properties.values).toMatchObject({
            'core.created': '2006-01-01T00:00:00Z',
            'core.modified': '2006-01-01T00:00:00Z',
            'app.application': 'safe-docx',
          });
          const written = JSON.parse(await readFile(result.outputs.certificate, 'utf8'));
          expect(written.checks.properties.passed).toBe(true);
        });

        await then('the summary says both dates are the 2006 default because the frontmatter has no date', () => {
          expect(result.summary).toContain('properties ok (created and modified 2006-01-01T00:00:00Z (no frontmatter date; set date: to choose them); application "safe-docx"; negative control ok)');
        });

        await then('a keyed source names its own dates in the summary', async () => {
          const file = path.join(dir, 'keyed.mdoc');
          await writeFile(file, source(KEYED));
          const keyed = await runCreateCommand([file, path.join(dir, 'out-keyed'), '--no-pdf']);
          expect(keyed.summary).toContain('properties ok (created 2026-01-02T00:00:00Z, modified 2026-02-03T04:05:06Z; application "Acme Drafting"; negative control ok)');
        });

        await then('a lowering that writes a different Application fails verification', async () => {
          await expect(createDocumentFromMarkdoc(source(KEYED), {
            transformLowering(lowering) {
              return { ...lowering, spec: { ...lowering.spec, meta: { ...lowering.spec.meta, application: 'Tampered' } } };
            },
          })).rejects.toMatchObject({ code: 'CREATION_VERIFICATION_FAILED', message: expect.stringContaining('app.application') });
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test.openspec('[SDX-MDOC-DOCPROPS-03] invalid property keys are refused')(
    'Scenario: invalid property keys are refused',
    async ({ then }) => {
      await then('a bad modified, a modified before date, or an empty application or last-modified-by is refused', async () => {
        for (const frontmatter of [
          ['modified: last week'],
          ['date: 2026-03-01', 'modified: 2026-02-28'],
          ['date: 2026-03-01T10:00:00Z', 'modified: 2026-03-01T09:59:59Z'],
          ['application: ""'],
          ['last-modified-by: '],
        ]) {
          await expect(createDocumentFromMarkdoc(source(frontmatter)), frontmatter.join(' / ')).rejects.toMatchObject({ code: 'UNSUPPORTED_CREATION_FRONTMATTER' });
        }
        // modified equal to date is allowed.
        await expect(createDocumentFromMarkdoc(source(['date: 2026-03-01', 'modified: 2026-03-01']))).resolves.toBeDefined();
      });
    },
  );
});
