import { describe, expect } from 'vitest';
import { buildDocxWithAncillaryParts, paragraphWithText } from '../testing/ooxml-fixtures.js';
import { testAllure } from '../testing/allure-test.js';
import { DocxDocument } from './document.js';
import { readZipText } from './zip.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const TEST_FEATURE = 'add-markdoc-header-footer-authoring';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

async function fixture(): Promise<Buffer> {
  const selected =
    `<w:hdr xmlns:w="${W_NS}"><w:p>` +
    `<w:del w:id="1" w:author="AI"><w:r><w:delText>Old date</w:delText></w:r></w:del>` +
    `<w:ins w:id="2" w:author="AI"><w:r><w:t>New date</w:t></w:r></w:ins>` +
    `</w:p></w:hdr>`;
  const orphan =
    `<w:hdr xmlns:w="${W_NS}"><w:p>` +
    `<w:ins w:id="3" w:author="AI"><w:r><w:t>Orphan edit</w:t></w:r></w:ins>` +
    `</w:p></w:hdr>`;
  return buildDocxWithAncillaryParts({
    bodyXml: paragraphWithText('Body'),
    sectPrXml:
      `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>` +
      `<w:headerReference w:type="even" r:id="rIdHeader"/></w:sectPr>`,
    relationships: [{
      id: 'rIdHeader',
      type: `${REL_BASE}/header`,
      target: 'running/header-custom.xml',
    }],
    parts: [
      { path: 'word/running/header-custom.xml', contentType: HEADER_CONTENT_TYPE, xml: selected },
      { path: 'word/header-orphan.xml', contentType: HEADER_CONTENT_TYPE, xml: orphan },
    ],
  });
}

describe('relationship-selected header/footer revision projection', () => {
  test.openspec('[SDX-PRIM-STORY-01] Selected header revisions project package-wide')(
    'accepts and rejects a shared selected header while leaving an orphan untouched',
    async () => {
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.5' });
      testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.10.4' });
      const source = await fixture();

      const acceptedDocument = await DocxDocument.load(source);
      const accepted = await acceptedDocument.acceptChanges();
      const acceptedBuffer = (await acceptedDocument.toBuffer()).buffer;
      const acceptedHeader = await readZipText(acceptedBuffer, 'word/running/header-custom.xml');
      expect(accepted).toMatchObject({ insertionsAccepted: 1, deletionsAccepted: 1 });
      expect(acceptedHeader).toContain('New date');
      expect(acceptedHeader).not.toContain('Old date');
      expect(acceptedHeader).not.toMatch(/<w:(?:ins|del)\b/);

      const rejectedDocument = await DocxDocument.load(source);
      const rejected = await rejectedDocument.rejectChanges();
      const rejectedBuffer = (await rejectedDocument.toBuffer()).buffer;
      const rejectedHeader = await readZipText(rejectedBuffer, 'word/running/header-custom.xml');
      expect(rejected).toMatchObject({ insertionsRemoved: 1, deletionsRestored: 1 });
      expect(rejectedHeader).toContain('Old date');
      expect(rejectedHeader).not.toContain('New date');
      expect(rejectedHeader).not.toMatch(/<w:(?:ins|del)\b/);

      expect(await readZipText(acceptedBuffer, 'word/header-orphan.xml'))
        .toBe(await readZipText(source, 'word/header-orphan.xml'));
      expect(await readZipText(rejectedBuffer, 'word/header-orphan.xml'))
        .toBe(await readZipText(source, 'word/header-orphan.xml'));
    },
  );
});
