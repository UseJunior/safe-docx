/**
 * Fail-closed refusal of comparison inputs that already carry tracked changes.
 *
 * Comparing a document that already contains revision markup passes the
 * pre-existing markup through and layers the comparison author's markup on
 * top, producing a two-author, nested-revision output Microsoft Word refuses
 * to open while the compare still exits 0 with normal stats. The guard under
 * test refuses such inputs at the lowest public comparison boundary with a
 * typed, recoverable error naming the offending operand and part.
 *
 * @see https://github.com/UseJunior/safe-docx/issues/742
 */

import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, afterAll } from 'vitest';
import { compareDocuments, TrackedInputRevisionError } from '../../index.js';
import * as packageRoot from '../../index.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { runCompareCli } from '../../cli/compare-two.js';
import { buildDocxFromBodyXml } from '../../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';

const TEST_FEATURE = 'add-tracked-input-comparison-guard';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: TEST_FEATURE });

const W_NS_DECL =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REVISION_ATTRS = 'w:id="901" w:author="Earlier" w:date="2026-01-01T00:00:00Z"';

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

const CLEAN_BODY = paragraph('Settled paragraph one.') + paragraph('Settled paragraph two.');

/**
 * One minimal well-formed body per revision kind the guard must detect: the
 * four content markers, the six property-change records, and the row-level
 * `w:trPr` marker spelling of `w:ins`/`w:del`.
 */
const TRACKED_BODY_BY_KIND: ReadonlyArray<{ marker: string; body: string }> = [
  {
    marker: 'w:ins',
    body: `<w:p><w:ins ${REVISION_ATTRS}><w:r><w:t>added</w:t></w:r></w:ins></w:p>`,
  },
  {
    marker: 'w:del',
    body: `<w:p><w:del ${REVISION_ATTRS}><w:r><w:delText>removed</w:delText></w:r></w:del></w:p>`,
  },
  {
    marker: 'w:moveFrom',
    body: `<w:p><w:moveFrom ${REVISION_ATTRS}><w:r><w:delText>moved away</w:delText></w:r></w:moveFrom></w:p>`,
  },
  {
    marker: 'w:moveTo',
    body: `<w:p><w:moveTo ${REVISION_ATTRS}><w:r><w:t>moved here</w:t></w:r></w:moveTo></w:p>`,
  },
  {
    marker: 'w:rPrChange',
    body: `<w:p><w:r><w:rPr><w:b/><w:rPrChange ${REVISION_ATTRS}><w:rPr/></w:rPrChange></w:rPr><w:t>reformatted</w:t></w:r></w:p>`,
  },
  {
    marker: 'w:pPrChange',
    body: `<w:p><w:pPr><w:pPrChange ${REVISION_ATTRS}><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>restyled</w:t></w:r></w:p>`,
  },
  {
    marker: 'w:sectPrChange',
    body: `${paragraph('body text')}<w:sectPr><w:sectPrChange ${REVISION_ATTRS}><w:sectPr/></w:sectPrChange></w:sectPr>`,
  },
  {
    marker: 'w:tblPrChange',
    body:
      `<w:tbl><w:tblPr><w:tblPrChange ${REVISION_ATTRS}><w:tblPr/></w:tblPrChange></w:tblPr>` +
      `<w:tblGrid><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${paragraph('after')}`,
  },
  {
    marker: 'w:trPrChange',
    body:
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:trPr><w:trPrChange ${REVISION_ATTRS}><w:trPr/></w:trPrChange></w:trPr>` +
      `<w:tc><w:tcPr/><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${paragraph('after')}`,
  },
  {
    marker: 'w:tcPrChange',
    body:
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcPrChange ${REVISION_ATTRS}><w:tcPr/></w:tcPrChange></w:tcPr>` +
      `<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${paragraph('after')}`,
  },
  // The three cell-topology records and the legacy numbering-change record
  // were execution-proven during peer review to pass the original ten-name
  // guard and survive the comparison with their prior author intact.
  {
    marker: 'w:cellIns',
    body:
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:cellIns ${REVISION_ATTRS}/></w:tcPr>` +
      `<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${paragraph('after')}`,
  },
  {
    marker: 'w:cellDel',
    body:
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:cellDel ${REVISION_ATTRS}/></w:tcPr>` +
      `<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${paragraph('after')}`,
  },
  {
    marker: 'w:cellMerge',
    body:
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:cellMerge w:vMerge="cont" ${REVISION_ATTRS}/></w:tcPr>` +
      `<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>${paragraph('after')}`,
  },
  {
    marker: 'w:numberingChange',
    body:
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>` +
      `<w:numberingChange ${REVISION_ATTRS} w:original="%1:1:0:."/>` +
      `</w:numPr></w:pPr><w:r><w:t>numbered</w:t></w:r></w:p>`,
  },
];

/** Row-level markers live at `w:trPr > w:ins|w:del` and count as tracked markup. */
const ROW_LEVEL_MARKER_BODY =
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>` +
  `<w:tr><w:trPr><w:del ${REVISION_ATTRS}/></w:trPr>` +
  `<w:tc><w:tcPr/><w:p><w:r><w:t>row kept by an unresolved deletion</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  paragraph('after');

async function addPart(docx: Buffer, path: string, xml: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  zip.file(path, xml);
  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

function storyPartXml(rootTag: string, content: string): string {
  return `<${rootTag} ${W_NS_DECL}>${content}</${rootTag}>`;
}

const TRACKED_RUN = `<w:p><w:ins ${REVISION_ATTRS}><w:r><w:t>story edit</w:t></w:r></w:ins></w:p>`;

/** Every revision story flavor the scan must cover, with tracked markup inside. */
const TRACKED_STORY_PARTS: ReadonlyArray<{ partPath: string; xml: string }> = [
  { partPath: 'word/header1.xml', xml: storyPartXml('w:hdr', TRACKED_RUN) },
  { partPath: 'word/footer3.xml', xml: storyPartXml('w:ftr', TRACKED_RUN) },
  {
    partPath: 'word/footnotes.xml',
    xml: storyPartXml('w:footnotes', `<w:footnote w:id="1">${TRACKED_RUN}</w:footnote>`),
  },
  {
    partPath: 'word/endnotes.xml',
    xml: storyPartXml('w:endnotes', `<w:endnote w:id="1">${TRACKED_RUN}</w:endnote>`),
  },
  {
    partPath: 'word/comments.xml',
    xml: storyPartXml('w:comments', `<w:comment w:id="1" w:author="Earlier">${TRACKED_RUN}</w:comment>`),
  },
  {
    partPath: 'word/glossary/document.xml',
    xml: storyPartXml('w:document', `<w:body>${TRACKED_RUN}</w:body>`),
  },
];

async function expectTrackedInputRefusal(
  promise: Promise<unknown>,
): Promise<TrackedInputRevisionError> {
  let failure: unknown;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(TrackedInputRevisionError);
  return failure as TrackedInputRevisionError;
}

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('tracked-input comparison guard', () => {
  test.openspec('[SDX-TRKIN-01] a tracked original operand is refused with a typed recoverable error')(
    'a pre-tracked original is refused before any comparison output exists',
    async ({ given, when, then, and }: AllureBddContext) => {
      let error: TrackedInputRevisionError;

      await given('an original that already carries a w:del and a clean revised document', () => {});
      const original = await buildDocxFromBodyXml(
        `<w:p><w:del ${REVISION_ATTRS}><w:r><w:delText>stale</w:delText></w:r></w:del></w:p>`,
      );
      const revised = await buildDocxFromBodyXml(CLEAN_BODY);

      await when('the documents are compared through the public entry point', async () => {
        error = await expectTrackedInputRefusal(compareDocuments(original, revised));
      });

      await then('the refusal is a TrackedInputRevisionError naming the original operand', () => {
        expect(error.name).toBe('TrackedInputRevisionError');
        expect(error.operand).toBe('original');
        expect(error.partPath).toBe('word/document.xml');
        expect(error.markers).toContain('w:del');
      });

      await and('the guard fires in BOTH reconstruction modes', async () => {
        // Rebuild is where the corruption manifests hardest — a 520-document
        // corpus differential showed rebuild unwrapping pre-existing tracked
        // changes into bare w:delText outside any w:del wrapper, the exact
        // shape Word rejects — while inplace merely passes the markup through,
        // still merging two authors' revision trees. Both modes must refuse.
        for (const reconstructionMode of ['inplace', 'rebuild'] as const) {
          const modeError = await expectTrackedInputRefusal(
            compareDocuments(original, revised, { reconstructionMode }),
          );
          expect(modeError.operand, reconstructionMode).toBe('original');
        }
      });

      await and('the message tells the caller how to recover', () => {
        expect(error.message).toContain('original document already contains tracked changes');
        expect(error.message).toContain('word/document.xml');
        expect(error.message).toContain('Accept or reject');
      });
    },
  );

  test.openspec('[SDX-TRKIN-02] a tracked revised operand is refused naming the revised operand')(
    'a pre-tracked revised input is attributed to the revised operand',
    async ({ given, when, then }: AllureBddContext) => {
      let error: TrackedInputRevisionError;

      await given('a clean original and a revised document that already carries a w:ins', () => {});
      const original = await buildDocxFromBodyXml(CLEAN_BODY);
      const revised = await buildDocxFromBodyXml(
        `<w:p><w:ins ${REVISION_ATTRS}><w:r><w:t>late edit</w:t></w:r></w:ins></w:p>`,
      );

      await when('the documents are compared', async () => {
        error = await expectTrackedInputRefusal(compareDocuments(original, revised));
      });

      await then('the error names the revised operand and its markers', () => {
        expect(error.operand).toBe('revised');
        expect(error.partPath).toBe('word/document.xml');
        expect(error.markers).toContain('w:ins');
        expect(error.message).toContain('revised document already contains tracked changes');
      });
    },
  );

  test.openspec('[SDX-TRKIN-04] every content and property revision kind trips the guard')(
    'all ten revision element kinds and the row-level marker are refused on either operand',
    async ({ given, when, then }: AllureBddContext) => {
      const clean = await buildDocxFromBodyXml(CLEAN_BODY);

      await given('one fixture per revision kind: content markers, property changes, row-level markers', () => {});

      await when('each fixture is compared as each operand', () => {});

      await then('each comparison is refused and reports that revision kind', async () => {
        for (const { marker, body } of TRACKED_BODY_BY_KIND) {
          const tracked = await buildDocxFromBodyXml(body);

          const asOriginal = await expectTrackedInputRefusal(compareDocuments(tracked, clean));
          expect(asOriginal.operand, marker).toBe('original');
          expect(asOriginal.markers, marker).toContain(marker);

          const asRevised = await expectTrackedInputRefusal(compareDocuments(clean, tracked));
          expect(asRevised.operand, marker).toBe('revised');
          expect(asRevised.markers, marker).toContain(marker);
        }

        const rowTracked = await buildDocxFromBodyXml(ROW_LEVEL_MARKER_BODY);
        const rowError = await expectTrackedInputRefusal(compareDocuments(rowTracked, clean));
        expect(rowError.markers).toContain('w:del');
      });
    },
  );

  test.openspec('[SDX-TRKIN-03] revision markup in a revision story part is refused with the part named')(
    'headers, footers, footnotes, endnotes, comments, and the glossary are all scanned',
    async ({ given, when, then }: AllureBddContext) => {
      const clean = await buildDocxFromBodyXml(CLEAN_BODY);

      await given('documents whose only tracked markup lives in a revision story part', () => {});

      await when('each document is compared as each operand', () => {});

      await then('each comparison is refused with the story part named', async () => {
        for (const { partPath, xml } of TRACKED_STORY_PARTS) {
          const tracked = await addPart(await buildDocxFromBodyXml(CLEAN_BODY), partPath, xml);

          const asOriginal = await expectTrackedInputRefusal(compareDocuments(tracked, clean));
          expect(asOriginal.operand, partPath).toBe('original');
          expect(asOriginal.partPath, partPath).toBe(partPath);
          expect(asOriginal.markers, partPath).toContain('w:ins');

          const asRevised = await expectTrackedInputRefusal(compareDocuments(clean, tracked));
          expect(asRevised.operand, partPath).toBe('revised');
          expect(asRevised.partPath, partPath).toBe(partPath);
        }
      });
    },
  );

  test.openspec('[SDX-TRKIN-06] the directly exported atomizer entry point is guarded')(
    'compareDocumentsAtomizer refuses tracked inputs exactly like compareDocuments',
    async ({ given, when, then, and }: AllureBddContext) => {
      let atomizerError: TrackedInputRevisionError;
      let publicError: TrackedInputRevisionError;

      await given('a tracked original that the public entry point refuses', () => {});
      const tracked = await buildDocxFromBodyXml(
        `<w:p><w:ins ${REVISION_ATTRS}><w:r><w:t>bypass attempt</w:t></w:r></w:ins></w:p>`,
      );
      const clean = await buildDocxFromBodyXml(CLEAN_BODY);

      await when('the same pair goes through compareDocumentsAtomizer directly', async () => {
        publicError = await expectTrackedInputRefusal(compareDocuments(tracked, clean));
        atomizerError = await expectTrackedInputRefusal(compareDocumentsAtomizer(tracked, clean));
      });

      await then('both entry points raise the same typed refusal', () => {
        expect(atomizerError.name).toBe('TrackedInputRevisionError');
        expect(atomizerError.operand).toBe(publicError.operand);
        expect(atomizerError.partPath).toBe(publicError.partPath);
        expect(atomizerError.markers).toEqual(publicError.markers);
      });

      await and('the package root exports no unguarded comparison entry', () => {
        // The unguarded orchestrator exists for engine tests (module-level
        // import only); exporting it from the root would be a working public
        // bypass of the guard — peer review demonstrated exactly that.
        expect(packageRoot).not.toHaveProperty('compareDocumentsAtomizerUnguarded');
      });
    },
  );

  test.openspec('[SDX-TRKIN-05] clean inputs continue to compare unchanged')(
    'a clean pair still compares, and packages without ancillary parts are fine',
    async ({ given, when, then, and }: AllureBddContext) => {
      let identical: Awaited<ReturnType<typeof compareDocuments>>;
      let edited: Awaited<ReturnType<typeof compareDocuments>>;

      await given('two clean documents with no revision story parts at all', () => {});
      const clean = await buildDocxFromBodyXml(CLEAN_BODY);
      const cleanEdited = await buildDocxFromBodyXml(
        paragraph('Settled paragraph one.') + paragraph('Settled paragraph two, amended.'),
      );

      await when('identical and edited clean pairs are compared', async () => {
        // buildDocxFromBodyXml emits no footnotes/headers/etc., so this also
        // covers the missing-part path: absent story parts are skipped.
        identical = await compareDocuments(clean, clean);
        edited = await compareDocuments(clean, cleanEdited);
      });

      await then('the identical pair reports no changes', () => {
        expect(identical.stats.insertions).toBe(0);
        expect(identical.stats.deletions).toBe(0);
      });

      await and('the edited pair produces a normal single-author comparison', () => {
        expect(edited.stats.insertions).toBeGreaterThan(0);
        expect(edited.document.length).toBeGreaterThan(0);
      });
    },
  );

  test.openspec('[SDX-TRKIN-07] malformed revision story parts defer to the ancillary safety boundary')(
    'a truncated notes part keeps its precise typed diagnostics instead of a tracked-input claim',
    async ({ given, when, then }: AllureBddContext) => {
      let failure: unknown;

      await given('an original whose footnotes part is truncated mid-element', () => {});
      const originalSeed = await buildDocxFromBodyXml(
        `${paragraph('Shared')}<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      );
      const original = await addPart(
        originalSeed,
        'word/footnotes.xml',
        `<w:footnotes ${W_NS_DECL}><w:footnote w:id="1"><w:p>`,
      );
      const revised = await buildDocxFromBodyXml(paragraph('Shared'));

      await when('the documents are compared', async () => {
        try {
          await compareDocuments(original, revised, { reconstructionMode: 'inplace' });
        } catch (error) {
          failure = error;
        }
      });

      await then('the failure is the ancillary boundary error, not TrackedInputRevisionError', () => {
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).name).toBe('AncillaryStorySafetyError');
        expect(failure).not.toBeInstanceOf(TrackedInputRevisionError);
      });
    },
  );

  test.openspec('[SDX-TRKIN-08] the comparison CLI refuses tracked inputs with the operand named')(
    'the real docx-comparison CLI propagates the refusal and writes no output',
    async ({ given, when, then, and }: AllureBddContext) => {
      let failure: unknown;
      let outputPath: string;

      await given('a tracked revised input staged on disk for the CLI', () => {});
      const dir = await mkdtemp(join(tmpdir(), 'trkin-cli-'));
      tempDirs.push(dir);
      const originalPath = join(dir, 'original.docx');
      const revisedPath = join(dir, 'revised.docx');
      outputPath = join(dir, 'out.docx');
      await writeFile(originalPath, new Uint8Array(await buildDocxFromBodyXml(CLEAN_BODY)));
      await writeFile(
        revisedPath,
        new Uint8Array(
          await buildDocxFromBodyXml(
            `<w:p><w:ins ${REVISION_ATTRS}><w:r><w:t>tracked</w:t></w:r></w:ins></w:p>`,
          ),
        ),
      );

      await when('runCompareCli runs with its REAL compare dependency (no injected fake)', async () => {
        try {
          await runCompareCli([originalPath, revisedPath, outputPath]);
        } catch (error) {
          failure = error;
        }
      });

      await then('the CLI run fails with the refusal naming the revised operand', () => {
        // The bin wrapper prints err.message and exits 1 for any rejection, so
        // a propagated TrackedInputRevisionError is a nonzero CLI exit whose
        // message names the offending operand.
        expect(failure).toBeInstanceOf(TrackedInputRevisionError);
        expect((failure as Error).message).toContain('revised document already contains tracked changes');
      });

      await and('no output file was written', async () => {
        let exists = true;
        try {
          await access(outputPath);
        } catch {
          exists = false;
        }
        expect(exists).toBe(false);
      });
    },
  );
});
