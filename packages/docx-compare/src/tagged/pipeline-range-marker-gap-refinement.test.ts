/**
 * A side-only bookmark or comment range inside a changed span must not stop
 * word-level refinement: the unchanged text after the boundary stays live
 * text, exactly as it does when the boundary is absent.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.4
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.14
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.5.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @see https://github.com/UseJunior/safe-docx/issues/1022
 */

import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { describe, expect } from 'vitest';
import { buildDocxFromBodyXml } from '../testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { compareDocumentsAtomizer } from './pipeline.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({
    feature: 'In-Place Reconstruction',
    story: 'Range Boundaries Inside Refined Run Gaps',
    severity: 'critical',
  })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.4.4' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.18' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.6.2' },
  );

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DATE = new Date('2026-07-28T12:00:00Z');

interface Boundary { start: string; end: string; after?: string }

const BOUNDARIES: Record<string, Boundary> = {
  none: { start: '', end: '' },
  bookmark: {
    start: '<w:bookmarkStart w:id="7" w:name="Clause"/>',
    end: '<w:bookmarkEnd w:id="7"/>',
  },
  'comment range': {
    start: '<w:commentRangeStart w:id="3"/>',
    end: '<w:commentRangeEnd w:id="3"/>',
  },
  'comment range with reference mark': {
    start: '<w:commentRangeStart w:id="3"/>',
    end: '<w:commentRangeEnd w:id="3"/>',
    after: '<w:r><w:commentReference w:id="3"/></w:r>',
  },
};

function bracketed(boundary: Boundary, prefix: string, middle: string, suffix: string): string {
  return '<w:p>' +
    `<w:r><w:t xml:space="preserve">${prefix}</w:t></w:r>` +
    boundary.start +
    `<w:r><w:t xml:space="preserve">${middle}</w:t></w:r>` +
    boundary.end + (boundary.after ?? '') +
    `<w:r><w:t xml:space="preserve">${suffix}</w:t></w:r>` +
    '</w:p>';
}

const plain = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function compare(originalBody: string, revisedBody: string): Promise<string> {
  const result = await compareDocumentsAtomizer(
    await buildDocxFromBodyXml(originalBody),
    await buildDocxFromBodyXml(revisedBody),
    { date: DATE },
  );
  expect(result.engine).toBe('tagged-tree');
  return (await DocxArchive.load(result.document)).getDocumentXml();
}

function body(xml: string): Element {
  return parseXml(xml).getElementsByTagNameNS(W_NS, 'body')[0]!;
}

/** Text of each revision wrapper, e.g. `del:beta gamma`, in document order. */
function textRevisions(xml: string): string[] {
  return Array.from(body(xml).getElementsByTagName('*'))
    .filter((element) => element.namespaceURI === W_NS && ['ins', 'del'].includes(element.localName))
    .map((wrapper) => `${wrapper.localName}:${wrapper.textContent ?? ''}`)
    .filter((entry) => !entry.endsWith(':'));
}

/**
 * Projection signature: paragraph text with range boundaries inlined, keyed by
 * bookmark name or comment id so serializer renumbering does not matter.
 */
function projection(xml: string): string {
  const out: string[] = [];
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      const name = element.localName;
      if (name === 't') out.push(element.textContent ?? '');
      else if (name === 'p' && out.length > 0) { out.push('¶'); visit(element); }
      else if (name === 'bookmarkStart') out.push(`[B:${element.getAttributeNS(W_NS, 'name') ?? element.getAttribute('w:name')}`);
      else if (name === 'bookmarkEnd') out.push('B]');
      else if (name === 'commentRangeStart') out.push('[C');
      else if (name === 'commentRangeEnd') out.push('C]');
      else if (name === 'commentReference') out.push('(ref)');
      else visit(element);
    }
  };
  visit(body(xml));
  return out.join('');
}

describe('range boundaries inside a refined run gap (#1022)', () => {
  const kinds = Object.keys(BOUNDARIES).filter((kind) => kind !== 'none');

  for (const kind of kinds) {
    test(`deleted span with a ${kind} keeps the unchanged suffix live`, async ({
      given, when, then, and,
    }: AllureBddContext) => {
      const boundary = BOUNDARIES[kind]!;
      const originalBody = await given(`"alpha [beta gamma] omega" with a ${kind} around the deleted words`, () =>
        bracketed(boundary, 'alpha ', 'beta gamma', ' omega'));
      const revisedBody = plain('alpha new omega');

      const [xml, baseline] = await when('it and the boundary-free paragraph are compared to "alpha new omega"', async () => [
        await compare(originalBody, revisedBody),
        await compare(bracketed(BOUNDARIES.none!, 'alpha ', 'beta gamma', ' omega'), revisedBody),
      ]);

      await then('the text revisions match the boundary-free comparison', () => {
        expect(textRevisions(baseline)).toEqual(['del:beta gamma', 'ins:new']);
        expect(textRevisions(xml)).toEqual(textRevisions(baseline));
      });

      await and('the unchanged suffix is in no w:ins or w:del', () => {
        for (const entry of textRevisions(xml)) expect(entry).not.toContain('omega');
      });

      await and('Reject All restores the boundaries in place and Accept All drops them', () => {
        expect(projection(rejectAllChanges(xml))).toBe(projection(`<w:document xmlns:w="${W_NS}"><w:body>${originalBody}</w:body></w:document>`));
        expect(projection(acceptAllChanges(xml))).toBe('alpha new omega');
      });
    });
  }

  test('an inserted bookmark around inserted words keeps the unchanged suffix live', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const originalBody = await given('"alpha beta gamma omega" in one run', () =>
      plain('alpha beta gamma omega'));
    const revisedBody = bracketed(BOUNDARIES.bookmark!, 'alpha ', 'new', ' omega');
    const xml = await when('it is compared to "alpha [new] omega" with a new bookmark', () =>
      compare(originalBody, revisedBody));

    await then('only the replaced words are revised', () => {
      expect(textRevisions(xml)).toEqual(['del:beta gamma', 'ins:new']);
    });
    await and('Accept All keeps the new bookmark around the inserted word', () => {
      expect(projection(acceptAllChanges(xml))).toBe('alpha [B:ClausenewB] omega');
      expect(projection(rejectAllChanges(xml))).toBe('alpha beta gamma omega');
    });
  });

  test('a bookmark whose span keeps a common word stays between the same characters', async ({
    given, when, then,
  }: AllureBddContext) => {
    const originalBody = await given('"alpha [beta gamma] omega" with a bookmark', () =>
      bracketed(BOUNDARIES.bookmark!, 'alpha ', 'beta gamma', ' omega'));
    const xml = await when('it is compared to "alpha beta delta omega"', () =>
      compare(originalBody, plain('alpha beta delta omega')));

    await then('only "gamma" is replaced and both projections keep their boundaries', () => {
      expect(textRevisions(xml)).toEqual(['del:gamma', 'ins:delta']);
      expect(projection(rejectAllChanges(xml))).toBe('alpha [B:Clausebeta gammaB] omega');
      expect(projection(acceptAllChanges(xml))).toBe('alpha beta delta omega');
    });
  });

  test('a bookmark boundary inside a word falls back without corrupting projections', async ({
    given, when, then,
  }: AllureBddContext) => {
    const originalBody = await given('a bookmark that starts inside the word "beta"', () =>
      bracketed(BOUNDARIES.bookmark!, 'alpha be', 'ta gamma', ' omega'));
    const xml = await when('it is compared to "alpha new omega"', () =>
      compare(originalBody, plain('alpha new omega')));

    await then('Reject All keeps the boundary between the same characters', () => {
      expect(projection(rejectAllChanges(xml))).toBe('alpha be[B:Clauseta gammaB] omega');
      expect(projection(acceptAllChanges(xml))).toBe('alpha new omega');
    });
  });

  test('whole-paragraph deletion still hoists the bookmark outside its content wrappers', async ({
    given, when, then, and,
  }: AllureBddContext) => {
    const deleted = bracketed(BOUNDARIES.bookmark!, 'alpha ', 'beta gamma', ' omega');
    const originalBody = await given('a kept paragraph and a bookmarked paragraph', () =>
      plain('keep') + deleted);
    const xml = await when('the bookmarked paragraph is deleted', () =>
      compare(originalBody, plain('keep')));

    const paragraph = body(xml).getElementsByTagNameNS(W_NS, 'p')[1]!;
    await then('the bookmark boundaries are direct paragraph children between deleted runs', () => {
      const children = Array.from(paragraph.childNodes)
        .filter((node): node is Element => node.nodeType === 1)
        .map((element) => element.localName);
      expect(children).toEqual(['pPr', 'del', 'bookmarkStart', 'del', 'bookmarkEnd', 'del']);
    });
    await and('Reject All restores the paragraph and Accept All removes it', () => {
      expect(projection(rejectAllChanges(xml))).toBe('keep¶alpha [B:Clausebeta gammaB] omega');
      expect(projection(acceptAllChanges(xml))).toBe('keep');
    });
  });
});
