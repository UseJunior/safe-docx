/**
 * Caller-chosen document properties (`DocumentSpec.meta`).
 *
 * A generated document's docProps/core.xml and docProps/app.xml carry what
 * the spec asks for: a modified date apart from the created one, the last
 * author, and an Application that can be renamed or left out. A spec without
 * the new keys keeps the bytes it always compiled to.
 */

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { readZipText } from '../primitives/zip.js';
import { parseXml } from '../primitives/xml.js';
import { generateDocx } from './compile.js';
import { GenerationSpecError } from './errors.js';
import { checkGeneratedPackage } from './structural-checks.js';
import type { DocumentSpec } from './types.js';

const TEST_FEATURE = 'add-document-properties-control';
const test = testAllure
  .epic('Document Generation')
  .withLabels({ feature: TEST_FEATURE })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 2, section: '8.3.4.3' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '22.2' },
  );

const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DCTERMS = 'http://purl.org/dc/terms/';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

function spec(meta: DocumentSpec['meta']): DocumentSpec {
  return {
    meta,
    sections: [{ blocks: [{ kind: 'paragraph', runs: [{ kind: 'text', text: 'Body' }] }] }],
  };
}

const BASE = { title: 'Props', author: 'Jane Roe', createdIso: '2026-01-02T03:04:05Z' };

async function core(buffer: Buffer): Promise<Document> {
  return parseXml((await readZipText(buffer, 'docProps/core.xml'))!);
}

async function applications(buffer: Buffer): Promise<string[]> {
  const app = parseXml((await readZipText(buffer, 'docProps/app.xml'))!);
  return Array.from(app.getElementsByTagNameNS(EP, 'Application')).map((element) => element.textContent ?? '');
}

describe('Caller-chosen document properties', () => {
  test.openspec('[SDX-GEN-136] meta writes the chosen modified date, last author and application, and null omits the application')(
    'Scenario: meta writes the chosen modified date, last author and application, and null omits the application',
    async ({ given, then, attachPrettyJson }: AllureBddContext) => {
      const chosenSpec = spec({ ...BASE, modifiedIso: '2026-02-03T04:05:06Z', lastModifiedBy: 'Counsel', application: 'Acme Drafting' });
      const omittedSpec = spec({ ...BASE, application: null });
      const plainSpec = spec(BASE);
      let chosen!: Buffer;
      let omitted!: Buffer;
      let plain!: Buffer;
      await given('a spec with the new keys, one with application null and one without them', async () => {
        chosen = await generateDocx(chosenSpec);
        omitted = await generateDocx(omittedSpec);
        plain = await generateDocx(plainSpec);
        await attachPrettyJson('docprops', {
          chosen: { core: await readZipText(chosen, 'docProps/core.xml'), app: await readZipText(chosen, 'docProps/app.xml') },
          omitted: { app: await readZipText(omitted, 'docProps/app.xml') },
        });
      });

      await then('the chosen package carries both dates, the last author and the application', async () => {
        const doc = await core(chosen);
        const created = doc.getElementsByTagNameNS(DCTERMS, 'created')[0]!;
        const modified = doc.getElementsByTagNameNS(DCTERMS, 'modified')[0]!;
        expect(created.textContent).toBe('2026-01-02T03:04:05Z');
        expect(modified.textContent).toBe('2026-02-03T04:05:06Z');
        for (const date of [created, modified]) {
          expect(date.prefix).toBe('dcterms');
          expect(date.getAttributeNS(XSI, 'type')).toBe('dcterms:W3CDTF');
        }
        expect(doc.getElementsByTagNameNS(CP, 'lastModifiedBy')[0]!.textContent).toBe('Counsel');
        expect(await applications(chosen)).toEqual(['Acme Drafting']);
      });

      await then('application null leaves the Application element out', async () => {
        expect(await applications(omitted)).toEqual([]);
      });

      await then('a spec without the new keys keeps modified equal to created and Application safe-docx', async () => {
        const doc = await core(plain);
        expect(doc.getElementsByTagNameNS(DCTERMS, 'modified')[0]!.textContent).toBe('2026-01-02T03:04:05Z');
        expect(doc.getElementsByTagNameNS(CP, 'lastModifiedBy')).toHaveLength(0);
        expect(await applications(plain)).toEqual(['safe-docx']);
      });

      await then('every package passes the structural checks and compiles byte-identically', async () => {
        for (const [buffer, source] of [[chosen, chosenSpec], [omitted, omittedSpec], [plain, plainSpec]] as const) {
          const result = await checkGeneratedPackage(buffer);
          expect(result.ok, JSON.stringify(result.issues)).toBe(true);
          expect((await generateDocx(source)).equals(buffer)).toBe(true);
        }
      });

      await then('an invalid date, an empty application or a control character is refused before compilation', async () => {
        await expect(generateDocx(spec({ ...BASE, modifiedIso: '2026-02-30T00:00:00Z' }))).rejects.toBeInstanceOf(GenerationSpecError);
        await expect(generateDocx(spec({ ...BASE, application: '' }))).rejects.toThrow(/application/);
        await expect(generateDocx(spec({ ...BASE, lastModifiedBy: 'bad\u0007name' }))).rejects.toBeInstanceOf(GenerationSpecError);
        await expect(generateDocx(spec({ ...BASE, createdIso: 'yesterday' }))).rejects.toThrow(/createdIso/);
      });
    },
  );
});
