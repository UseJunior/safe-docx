import { describe, expect } from 'vitest';
import path from 'node:path';

import { readFile } from './read_file.js';
import { replaceText } from './replace_text.js';
import { download } from './download.js';
import { testAllure } from '../testing/allure-test.js';
import {
  assertSuccess,
  parseOutputXml,
  registerCleanup,
  openSession,
} from '../testing/session-test-utils.js';

const TEST_FEATURE = 'add-run-level-formatting-visibility';

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rIdHyperlink1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
    Target="https://example.com/portal"
    TargetMode="External"
  />
</Relationships>`;

function buildFormattingFixtureXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ` +
    `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>` +
    `<w:p>` +
    `<w:r><w:t xml:space="preserve">Body text </w:t></w:r>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> and </w:t></w:r>` +
    `<w:r><w:rPr><w:i/></w:rPr><w:t>Italic</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> and </w:t></w:r>` +
    `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Underline</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> and </w:t></w:r>` +
    `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>Marked</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> and </w:t></w:r>` +
    `<w:hyperlink r:id="rIdHyperlink1">` +
    `<w:r><w:t>Portal</w:t></w:r>` +
    `</w:hyperlink>` +
    `</w:p>` +
    `</w:body></w:document>`
  );
}

function buildEditFixtureXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    `<w:p><w:r><w:t>Value: [X]</w:t></w:r></w:p>` +
    `</w:body></w:document>`
  );
}

describe('Traceability: Run-Level Formatting Visibility', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: TEST_FEATURE });
  const humanReadableTest = test.allure({
    tags: ['human-readable'],
    parameters: { audience: 'non-technical' },
  });

  registerCleanup();

  humanReadableTest.openspec('TOON output shows inline formatting tags at run boundaries by default')(
    'Scenario: TOON output shows inline formatting tags at run boundaries by default',
    async () => {
      const { mgr, sessionId } = await openSession([], {
        xml: buildFormattingFixtureXml(),
        extraFiles: {
          '[Content_Types].xml': CONTENT_TYPES_XML,
          '_rels/.rels': RELS_XML,
          'word/_rels/document.xml.rels': DOCUMENT_RELS_XML,
        },
      });

      const read = await readFile(mgr, { session_id: sessionId });
      assertSuccess(read, 'read_file');
      const content = String(read.content);

      expect(content).toContain('<b>Bold</b>');
      expect(content).toContain('<i>Italic</i>');
      expect(content).toContain('<u>Underline</u>');
      expect(content).toContain('<highlighting>Marked</highlighting>');
      expect(content).toContain('<a href="https://example.com/portal">Portal</a>');
    },
  );

  humanReadableTest.openspec('show_formatting=false suppresses inline tags')(
    'Scenario: show_formatting=false suppresses inline tags',
    async () => {
      const { mgr, sessionId } = await openSession([], {
        xml: buildFormattingFixtureXml(),
        extraFiles: {
          '[Content_Types].xml': CONTENT_TYPES_XML,
          '_rels/.rels': RELS_XML,
          'word/_rels/document.xml.rels': DOCUMENT_RELS_XML,
        },
      });

      const read = await readFile(mgr, { session_id: sessionId, show_formatting: false });
      assertSuccess(read, 'read_file show_formatting=false');
      const content = String(read.content);

      expect(content).not.toContain('<b>');
      expect(content).not.toContain('<i>');
      expect(content).not.toContain('<u>');
      expect(content).not.toContain('<highlighting>');
      expect(content).not.toContain('<a href=');
      expect(content).toContain('Body text Bold and Italic and Underline and Marked and Portal');
    },
  );

  humanReadableTest.openspec('writable tag vocabulary matches replace_text new_string vocabulary')(
    'Scenario: writable tag vocabulary matches replace_text new_string vocabulary',
    async () => {
      const { mgr, sessionId, firstParaId, tmpDir } = await openSession([], {
        xml: buildEditFixtureXml(),
        extraFiles: {
          '[Content_Types].xml': CONTENT_TYPES_XML,
          '_rels/.rels': RELS_XML,
        },
      });

      const edited = await replaceText(mgr, {
        session_id: sessionId,
        target_paragraph_id: firstParaId,
        old_string: '[X]',
        new_string: '<b>Bold</b> <i>Italic</i> <u>Underline</u> <highlighting>Marked</highlighting>',
        instruction: 'Validate writable formatting tags in new_string',
      });
      assertSuccess(edited, 'replace_text');

      const outputPath = path.join(tmpDir, 'formatted-output.docx');
      const saved = await download(mgr, {
        session_id: sessionId,
        save_to_local_path: outputPath,
        clean_bookmarks: true,
        download_format: 'clean',
      });
      assertSuccess(saved, 'download');

      const { runs, runText, hasBold, hasItalic, hasUnderline, hasHighlight } = await parseOutputXml(outputPath);
      const boldRun = runs.find((r) => runText(r).includes('Bold'));
      const italicRun = runs.find((r) => runText(r).includes('Italic'));
      const underlineRun = runs.find((r) => runText(r).includes('Underline'));
      const highlightRun = runs.find((r) => runText(r).includes('Marked'));

      expect(boldRun).toBeTruthy();
      expect(italicRun).toBeTruthy();
      expect(underlineRun).toBeTruthy();
      expect(highlightRun).toBeTruthy();
      expect(hasBold(boldRun!)).toBe(true);
      expect(hasItalic(italicRun!)).toBe(true);
      expect(hasUnderline(underlineRun!)).toBe(true);
      expect(hasHighlight(highlightRun!)).toBe(true);
    },
  );
});
