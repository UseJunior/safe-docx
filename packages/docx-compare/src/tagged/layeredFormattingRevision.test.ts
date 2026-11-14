/**
 * A formatting change on a run, paragraph mark or paragraph that already
 * carries a pending `w:rPrChange` / `w:pPrChange` (PRESERVE semantics: the
 * original's revisions stay and the comparison is layered on top) must leave
 * one schema-valid record per property element, never a record nested in or
 * beside another (#1461).
 *
 * Runs keep both layers losslessly: a deleted copy carries the original
 * `w:rPr` (its pending record included) and an inserted copy the revised
 * `w:rPr`. Rejecting only the comparison's revisions gives back the original
 * run, accepting them gives the revised run. Paragraph marks and paragraph
 * properties hold one record, so the original's pending record stays and
 * restores what the original itself rejects to.
 *
 * Each case checks Accept All against the revised document's accepted view
 * and Reject All against the original's rejected view, with docx-compare's
 * applier and with docx-core's `acceptChanges`/`rejectChanges`, plus the
 * emitted-document schema gate.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.31
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.30
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @see https://github.com/UseJunior/safe-docx/issues/1461
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect } from 'vitest';
import { acceptChanges, DocxArchive, OOXML, parseXml, rejectChanges, serializeXml } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Layered formatting revisions', severity: 'critical' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.31' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.30' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.29' },
  );

const W_NS = OOXML.W_NS;
const COMPARE_OPTIONS = { author: 'Comparison', date: new Date('2026-11-13T00:00:00.000Z') };
const LOAD_SENSITIVE_TIMEOUT_MS = 30_000;
const schemaScript = fileURLToPath(
  new URL('../../../../scripts/check_emitted_document_schema.mjs', import.meta.url),
);

const PRIOR_RUN = '<w:rPrChange w:id="71" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange>';
const REVISER_RUN = '<w:rPrChange w:id="81" w:author="Reviser" w:date="2026-11-02T00:00:00Z"><w:rPr><w:u w:val="single"/></w:rPr></w:rPrChange>';
const PRIOR_PARAGRAPH = '<w:pPrChange w:id="72" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:pPr/></w:pPrChange>';
const run = (text: string, rPr = ''): string => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (content: string, pPr = ''): string => `<w:p>${pPr}${content}</w:p>`;
const pageField = (rPr = ''): string =>
  `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r>${rPr}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
  `<w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r>${rPr}<w:t>1</w:t></w:r>` +
  `<w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`;

const isW = (node: Node | null | undefined, name: string): boolean =>
  !!node && node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === name;
const childrenOf = (element: Element): Element[] =>
  Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1);

/**
 * A property element, with its revision records when `withRecords` (author
 * and old-value snapshot; IDs and dates are not compared, since generated
 * IDs differ by construction).
 */
function describeElement(element: Element, withRecords: boolean): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => !['id', 'date', 'space'].includes(attribute.localName ?? '') &&
      !(attribute.localName ?? '').startsWith('rsid'))
    .map((attribute) => `${attribute.localName}=${attribute.value}`).sort().join(',');
  const children = childrenOf(element)
    .filter((child) => withRecords || !['rPrChange', 'pPrChange'].includes(child.localName))
    .map((child) => describeElement(child, withRecords)).join('');
  return `${element.localName}[${attributes}](${children})`;
}

/**
 * Every body paragraph as its paragraph properties and its content split
 * into segments of equal run properties, so a different run split reads the
 * same.
 */
function formattingView(xml: string, withRecords = false): string[] {
  const body = parseXml(xml).getElementsByTagNameNS(W_NS, 'body')[0]!;
  return Array.from(body.getElementsByTagNameNS(W_NS, 'p')).map((p) => {
    const pPr = childrenOf(p).find((child) => isW(child, 'pPr'));
    const segments: Array<[string, string]> = [];
    for (const r of Array.from(p.getElementsByTagNameNS(W_NS, 'r'))) {
      const rPr = childrenOf(r).find((child) => isW(child, 'rPr'));
      const signature = rPr ? childrenOf(rPr)
        .filter((child) => withRecords || child.localName !== 'rPrChange')
        .map((child) => describeElement(child, withRecords)).join('') : '';
      let content = '';
      for (const child of childrenOf(r)) {
        if (isW(child, 't') || isW(child, 'delText') || isW(child, 'instrText')) content += child.textContent ?? '';
        else if (isW(child, 'fldChar')) content += `{${child.getAttributeNS(W_NS, 'fldCharType')}}`;
      }
      if (!content) continue;
      const last = segments[segments.length - 1];
      if (last && last[0] === signature) last[1] += content;
      else segments.push([signature, content]);
    }
    const pPrSignature = pPr ? childrenOf(pPr)
      .filter((child) => withRecords || child.localName !== 'pPrChange')
      .map((child) => describeElement(child, withRecords)).join('') : '';
    return [pPrSignature, ...segments.map(([rPr, content]) => `<${rPr}>${content}`)].join('|');
  });
}

const documentXml = async (buffer: Buffer): Promise<string> => (await DocxArchive.load(buffer)).getDocumentXml();

type Applier = 'ast' | 'core';
function project(xml: string, projection: 'accept' | 'reject', applier: Applier): string {
  if (applier === 'ast') return projection === 'accept' ? acceptAllChanges(xml) : rejectAllChanges(xml);
  const document = parseXml(xml);
  if (projection === 'accept') acceptChanges(document);
  else rejectChanges(document);
  return serializeXml(document);
}

/** Resolve only this comparison's revisions with docx-core's selective applier. */
function projectComparisonLayer(xml: string, projection: 'accept' | 'reject'): string {
  const document = parseXml(xml);
  const filter = (element: Element): boolean => element.getAttributeNS(W_NS, 'author') === COMPARE_OPTIONS.author;
  if (projection === 'accept') acceptChanges(document, { filter });
  else rejectChanges(document, { filter });
  return serializeXml(document);
}

async function assertSchema(buffer: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdx-1461-'));
  try {
    const path = join(directory, 'compared.docx');
    await writeFile(path, buffer);
    const check = spawnSync(process.execPath, [schemaScript, path], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** No change record nested in another; at most one per property element. */
function expectSingleRecords(xml: string): void {
  const document = parseXml(xml);
  for (const name of ['rPrChange', 'pPrChange']) {
    for (const record of Array.from(document.getElementsByTagNameNS(W_NS, name))) {
      expect(record.getElementsByTagNameNS(W_NS, 'rPrChange')).toHaveLength(0);
      expect(record.getElementsByTagNameNS(W_NS, 'pPrChange')).toHaveLength(0);
      expect(childrenOf(record.parentNode as Element).filter((child) => isW(child, name))).toHaveLength(1);
    }
  }
}

async function compareBodies(originalBody: string, revisedBody: string) {
  const original = await buildDocxFromBodyXml(originalBody);
  const revised = await buildDocxFromBodyXml(revisedBody);
  const result = await compareDocumentsAtomizer(original, revised, COMPARE_OPTIONS);
  return {
    original,
    revised,
    result,
    originalXml: await documentXml(original),
    revisedXml: await documentXml(revised),
    comparedXml: await documentXml(result.document),
  };
}

type Compared = Awaited<ReturnType<typeof compareBodies>>;

async function expectFaithfulProjections({ then }: Pick<AllureBddContext, 'then'>, compared: Compared): Promise<void> {
  await then('the compared package passes the emitted-document schema gate with one record per property element', async () => {
    expectSingleRecords(compared.comparedXml);
    await assertSchema(compared.result.document);
  });
  await then('Accept All shows the revised accepted view and Reject All the original rejected view, with both appliers', () => {
    expect(compared.result.unrepresentedChanges).toBeUndefined();
    for (const applier of ['ast', 'core'] as const) {
      const accepted = formattingView(project(compared.comparedXml, 'accept', applier));
      const rejected = formattingView(project(compared.comparedXml, 'reject', applier));
      expect(accepted).toEqual(formattingView(project(compared.revisedXml, 'accept', applier)));
      expect(rejected).toEqual(formattingView(project(compared.originalXml, 'reject', applier)));
      expect(accepted).not.toEqual(rejected);
    }
  });
}

describe('formatting change on a run that already carries a pending w:rPrChange (#1461)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const losslessCases: ReadonlyArray<{ name: string; original: string; revised: string }> = [
    {
      name: 'the revised run keeps the pending record and adds bold',
      original: paragraph(run('Hello world', `<w:rPr>${PRIOR_RUN}</w:rPr>`)),
      revised: paragraph(run('Hello world', `<w:rPr><w:b/>${PRIOR_RUN}</w:rPr>`)),
    },
    {
      name: 'the revised run has accepted the pending record and adds bold',
      original: paragraph(run('Hello world', `<w:rPr>${PRIOR_RUN}</w:rPr>`)),
      revised: paragraph(run('Hello world', '<w:rPr><w:b/></w:rPr>')),
    },
    {
      name: 'bold is added to the second word of a run with a pending record',
      original: paragraph(run('Hello world', `<w:rPr>${PRIOR_RUN}</w:rPr>`)),
      revised: paragraph(run('Hello ', `<w:rPr>${PRIOR_RUN}</w:rPr>`) + run('world', `<w:rPr><w:b/>${PRIOR_RUN}</w:rPr>`)),
    },
    {
      name: 'only the revised run carries a pending record of its own',
      original: paragraph(run('Hello world', '<w:rPr><w:i/></w:rPr>')),
      revised: paragraph(run('Hello world', `<w:rPr><w:b/>${REVISER_RUN}</w:rPr>`)),
    },
    {
      name: 'a run inside a hyperlink keeps the pending record and adds bold',
      original: paragraph(`<w:hyperlink w:anchor="target">${run('Hello world', `<w:rPr>${PRIOR_RUN}</w:rPr>`)}</w:hyperlink>`) +
        paragraph('<w:bookmarkStart w:id="1" w:name="target"/>' + run('Target') + '<w:bookmarkEnd w:id="1"/>'),
      revised: paragraph(`<w:hyperlink w:anchor="target">${run('Hello world', `<w:rPr><w:b/>${PRIOR_RUN}</w:rPr>`)}</w:hyperlink>`) +
        paragraph('<w:bookmarkStart w:id="1" w:name="target"/>' + run('Target') + '<w:bookmarkEnd w:id="1"/>'),
    },
  ];
  for (const layered of losslessCases) {
    test(`keeps both layers when ${layered.name}`, async ({ given, when, then }: AllureBddContext) => {
      await given(layered.name, () => undefined);
      const compared = await when('the pair is compared', () => compareBodies(layered.original, layered.revised));
      await expectFaithfulProjections({ then }, compared);
      await then('the run is a deleted copy with the original properties and an inserted copy with the revised ones', () => {
        const document = parseXml(compared.comparedXml);
        const deleted = Array.from(document.getElementsByTagNameNS(W_NS, 'del'));
        const inserted = Array.from(document.getElementsByTagNameNS(W_NS, 'ins'));
        expect(deleted.length).toBeGreaterThan(0);
        expect(inserted.length).toBeGreaterThan(0);
        for (const wrapper of [...deleted, ...inserted]) {
          expect(wrapper.getAttributeNS(W_NS, 'author')).toBe(COMPARE_OPTIONS.author);
        }
      });
      await then('rejecting only the comparison gives the original document, pending record included; accepting it gives the revised one', () => {
        expect(formattingView(projectComparisonLayer(compared.comparedXml, 'reject'), true))
          .toEqual(formattingView(compared.originalXml, true));
        expect(formattingView(projectComparisonLayer(compared.comparedXml, 'accept'), true))
          .toEqual(formattingView(compared.revisedXml, true));
      });
    });
  }

  test('keeps the original record when the run cannot be repeated (a field character run)', async ({ given, when, then }: AllureBddContext) => {
    await given('a page field whose runs carry a pending record; the revision makes them bold', () => undefined);
    const compared = await when('the pair is compared', () => compareBodies(
      paragraph(run('Page ') + pageField(`<w:rPr>${PRIOR_RUN}</w:rPr>`)),
      paragraph(run('Page ') + pageField(`<w:rPr><w:b/>${PRIOR_RUN}</w:rPr>`)),
    ));
    await expectFaithfulProjections({ then }, compared);
    await then('each field run keeps the original pending record and no comparison record', () => {
      const document = parseXml(compared.comparedXml);
      const records = Array.from(document.getElementsByTagNameNS(W_NS, 'rPrChange'));
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) expect(record.getAttributeNS(W_NS, 'author')).toBe('Prior');
    });
  });
});

describe('formatting change on a paragraph mark or paragraph that already carries a pending record (#1461)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const singleRecordCases: ReadonlyArray<{ name: string; original: string; revised: string; record: string; author: string }> = [
    {
      name: 'the paragraph mark keeps its pending w:rPrChange and adds bold',
      original: paragraph(run('Hello'), `<w:pPr><w:rPr>${PRIOR_RUN}</w:rPr></w:pPr>`),
      revised: paragraph(run('Hello'), `<w:pPr><w:rPr><w:b/>${PRIOR_RUN}</w:rPr></w:pPr>`),
      record: 'rPrChange',
      author: 'Prior',
    },
    {
      name: 'the revised paragraph mark has accepted its pending w:rPrChange and adds bold',
      original: paragraph(run('Hello'), `<w:pPr><w:rPr>${PRIOR_RUN}</w:rPr></w:pPr>`),
      revised: paragraph(run('Hello'), '<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>'),
      record: 'rPrChange',
      author: 'Prior',
    },
    {
      name: 'only the revised paragraph mark carries a pending w:rPrChange',
      original: paragraph(run('Hello'), '<w:pPr><w:rPr><w:i/></w:rPr></w:pPr>'),
      revised: paragraph(run('Hello'), `<w:pPr><w:rPr><w:b/>${REVISER_RUN}</w:rPr></w:pPr>`),
      record: 'rPrChange',
      author: 'Comparison',
    },
    {
      name: 'the paragraph keeps its pending w:pPrChange and changes alignment',
      original: paragraph(run('Hello'), `<w:pPr><w:jc w:val="right"/>${PRIOR_PARAGRAPH}</w:pPr>`),
      revised: paragraph(run('Hello'), `<w:pPr><w:jc w:val="center"/>${PRIOR_PARAGRAPH}</w:pPr>`),
      record: 'pPrChange',
      author: 'Prior',
    },
    {
      name: 'the revised paragraph has accepted its pending w:pPrChange and changes alignment',
      original: paragraph(run('Hello'), `<w:pPr><w:jc w:val="right"/>${PRIOR_PARAGRAPH}</w:pPr>`),
      revised: paragraph(run('Hello'), '<w:pPr><w:jc w:val="center"/></w:pPr>'),
      record: 'pPrChange',
      author: 'Prior',
    },
  ];
  for (const layered of singleRecordCases) {
    test(`keeps one record when ${layered.name}`, async ({ given, when, then }: AllureBddContext) => {
      await given(layered.name, () => undefined);
      const compared = await when('the pair is compared', () => compareBodies(layered.original, layered.revised));
      await expectFaithfulProjections({ then }, compared);
      await then(`the ${layered.record} record is the ${layered.author} one`, () => {
        const records = Array.from(parseXml(compared.comparedXml).getElementsByTagNameNS(W_NS, layered.record));
        expect(records.map((record) => record.getAttributeNS(W_NS, 'author'))).toEqual([layered.author]);
      });
    });
  }
});

/**
 * A paragraph that gains or loses its section break is split: it keeps the
 * revised mark (inserted) and an empty boundary paragraph after it keeps the
 * original mark (deleted). The original's pending `w:pPrChange` or
 * paragraph-mark `w:rPrChange` must survive on the paragraph that Reject All
 * resolves to, so Reject All still gives the original's rejected view (#1465).
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.29
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.30
 * @conformance ECMA-376 edition 5, Part 1 § 17.6.18
 * @see https://github.com/UseJunior/safe-docx/issues/1465
 */
describe('section break gained or lost on a paragraph that carries a pending record (#1465)', { timeout: LOAD_SENSITIVE_TIMEOUT_MS }, () => {
  const SECTION = '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>';
  const PRIOR_MARK = `<w:rPr><w:b/>${PRIOR_RUN}</w:rPr>`;
  const PRIOR_PPR = `<w:jc w:val="right"/>${PRIOR_PARAGRAPH}`;
  const PRIOR_INDENT = '<w:pPrChange w:id="73" w:author="Prior" w:date="2026-11-01T00:00:00Z"><w:pPr><w:ind w:left="720"/></w:pPr></w:pPrChange>';
  const body = (first: string): string => first + paragraph(run('After the break'));
  const sectionCases: ReadonlyArray<{ name: string; original: string; revised: string }> = [
    {
      name: 'a paragraph with a pending w:pPrChange gains a section break',
      original: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}</w:pPr>`)),
      revised: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}${SECTION}</w:pPr>`)),
    },
    {
      name: 'a paragraph with a pending w:pPrChange loses its section break',
      original: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}${SECTION}</w:pPr>`)),
      revised: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}</w:pPr>`)),
    },
    {
      name: 'a paragraph whose mark has a pending w:rPrChange gains a section break',
      original: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_MARK}</w:pPr>`)),
      revised: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_MARK}${SECTION}</w:pPr>`)),
    },
    {
      name: 'a paragraph whose mark has a pending w:rPrChange loses its section break',
      original: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_MARK}${SECTION}</w:pPr>`)),
      revised: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_MARK}</w:pPr>`)),
    },
    {
      name: 'a paragraph with both pending records gains a section break and changes alignment',
      original: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}${PRIOR_MARK}</w:pPr>`)),
      revised: body(paragraph(run('Hello'), `<w:pPr><w:jc w:val="center"/>${PRIOR_PARAGRAPH}<w:rPr><w:i/>${PRIOR_RUN}</w:rPr>${SECTION}</w:pPr>`)),
    },
    {
      name: 'a paragraph with both pending records loses its section break; the revised has accepted them',
      original: body(paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}${PRIOR_MARK}${SECTION}</w:pPr>`)),
      revised: body(paragraph(run('Hello'), '<w:pPr><w:jc w:val="right"/><w:rPr><w:b/></w:rPr></w:pPr>')),
    },
    {
      name: 'the last body paragraph, with a pending w:pPrChange, gains a section break before the final section',
      original: paragraph(run('Before')) + paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}</w:pPr>`),
      revised: paragraph(run('Before')) + paragraph(run('Hello'), `<w:pPr>${PRIOR_PPR}${SECTION}</w:pPr>`),
    },
    {
      name: 'a paragraph whose pending w:pPrChange restores indentation loses its section break and changes alignment',
      original: body(paragraph(run('Hello'), `<w:pPr><w:jc w:val="right"/>${PRIOR_INDENT}${SECTION}</w:pPr>`)),
      revised: body(paragraph(run('Hello'), `<w:pPr><w:jc w:val="center"/>${PRIOR_INDENT}</w:pPr>`)),
    },
  ];
  const sectionTest = test.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.6.18' });
  for (const layered of sectionCases) {
    sectionTest(`keeps the original record when ${layered.name}`, async ({ given, when, then }: AllureBddContext) => {
      await given(layered.name, () => undefined);
      const compared = await when('the pair is compared', () => compareBodies(layered.original, layered.revised));
      await expectFaithfulProjections({ then }, compared);
      await then('the section count follows each side on Accept All and Reject All', () => {
        const sections = (xml: string): number => parseXml(xml).getElementsByTagNameNS(W_NS, 'sectPr').length;
        for (const applier of ['ast', 'core'] as const) {
          expect(sections(project(compared.comparedXml, 'accept', applier))).toBe(sections(compared.revisedXml));
          expect(sections(project(compared.comparedXml, 'reject', applier))).toBe(sections(compared.originalXml));
        }
      });
    });
  }
});
