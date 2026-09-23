import { readFile } from 'node:fs/promises';
import { describe, expect } from 'vitest';
import { readZipText } from '@usejunior/docx-core';
import { testAllure } from '../../docx-core/src/testing/allure-test.js';
import { compileMarkdoc } from './compile.js';
import { DocxMarkdocError } from './errors.js';
import { importDocxToMarkdoc } from './import.js';
import { selectedStories } from './story-inventory.js';

const storyTest = testAllure.epic('Document Markdoc').withLabels({ feature: 'add-markdoc-header-footer-authoring' });

describe('real selected-story Markdoc authoring', () => {
  storyTest.openspec('[SDX-MDOC-128] Accept and reject recover authentic header states')(
    'edits the public OpenAgreements letter-of-intent footer without body substitution',
    async () => {
      const source = await readFile(new URL('../../../tests/test_documents/open-agreements/letter-of-intent.docx', import.meta.url));
      const original = Buffer.from(source);
      const imported = await importDocxToMarkdoc(source);
      expect(source.equals(original)).toBe(true);
      const match = imported.markdoc.match(/\{% para (story="[^"]+" id="[^"]+" fingerprint="[^"]+" style="[^"]+") %\}\n([^\n]*Letter of Intent[^\n]*)\n\{% \/para %\}/u);
      expect(match).not.toBeNull();
      const before = match![2]!;
      const after = before.replace('Letter of Intent', 'Letter of Interest');
      const markdoc = imported.markdoc.replace(match![0], [
        `{% change ${match![1]} operation="footer-title" format="inherit-source-paragraph" %}`,
        '{% before %}', before, '{% /before %}',
        '{% after %}', after, '{% /after %}', '{% /change %}',
      ].join('\n'));
      const result = await compileMarkdoc(imported.anchoredSource, markdoc).catch((error: unknown) => {
        if (error instanceof DocxMarkdocError) {
          const details = error.details as { certificate?: { storyProjections?: unknown } } | undefined;
          throw new Error(`${error.code}: ${JSON.stringify(details?.certificate?.storyProjections)}`);
        }
        throw error;
      });
      expect(result.certificate.passed).toBe(true);
      expect(result.certificate.storyProjections).toEqual(expect.arrayContaining([expect.objectContaining({ passed: true })]));
      const trackedFooter = await readZipText(result.tracked, 'word/footer1.xml');
      expect((await selectedStories(result.clean)).flatMap((story) => story.paragraphsInOrder.map((paragraph) => paragraph.text)))
        .toEqual(expect.arrayContaining([expect.stringContaining('Letter of Interest')]));
      expect(trackedFooter).toContain('w:del');
      expect(trackedFooter).toContain('w:ins');
    },
    30_000,
  );
});
