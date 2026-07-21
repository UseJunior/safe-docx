import { describe, expect } from 'vitest';
import {
  DocxDocument,
  DocxZip,
  buildRPrChangeElement,
  createRevisionContext,
  createZipBuffer,
  parseXml,
  replaceParagraphTextRange,
  validateAiRevisions,
} from '../src/index.js';
import { buildDocxFromBodyXml } from '../src/testing/ooxml-fixtures.js';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { revisionEvidence, revisionEvidenceCases } from '../src/testing/revision-evidence.js';

const TEST_FEATURE = 'add-ai-revision-validator';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AI = 'SafeDocX AI';

const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

function doc(bodyXml: string): Document {
  return parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${bodyXml}</w:body></w:document>`,
  );
}

async function validateBody(bodyXml: string, touched?: Parameters<typeof validateAiRevisions>[0]['touched']) {
  return validateAiRevisions({
    aiAuthor: AI,
    stories: [{ part: 'word/document.xml', doc: doc(bodyXml) }],
    touched,
  });
}

function minimalPackageFiles(extra: Record<string, string>) {
  return {
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
    'word/document.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`,
    ...extra,
  };
}

describe('validateAiRevisions', () => {
  test.openspec('valid AI revision markup passes')('Scenario: valid AI revision markup passes', async ({ when, then }: AllureBddContext) => {
    const ctx = createRevisionContext({ author: AI, date: '2026-01-01T00:00:00Z' });
    const d = doc('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
    const p = d.getElementsByTagNameNS(W_NS, 'p').item(0) as Element;
    replaceParagraphTextRange(p, 6, 11, 'there', ctx);
    const rPr = parseXml(`<w:rPr xmlns:w="${W_NS}"><w:b/></w:rPr>`).documentElement;
    const rPrChange = buildRPrChangeElement(rPr, ctx);
    (p.firstChild as Element).appendChild(rPrChange);

    const result = await when('AI revision validation runs on emitter output', () =>
      validateAiRevisions({ aiAuthor: AI, stories: [{ part: 'word/document.xml', doc: d }] }),
    );

    await then('no errors are returned', () => {
      expect(result.errors).toEqual([]);
    });
  });

  test.openspec('malformed AI revision metadata fails')('Scenario: malformed AI revision metadata fails', async ({ when, then }: AllureBddContext) => {
    const result = await when('AI-touched malformed metadata is validated', () =>
      validateBody(`<w:p><w:ins w:id="x" w:date="not-a-date"><w:r><w:t>Bad</w:t></w:r></w:ins></w:p>`, { revisionIds: ['x'] }),
    );

    await then('hard validation errors identify malformed metadata', () => {
      expect(result.errors.map((e) => e.code)).toEqual(
        expect.arrayContaining(['REVISION_METADATA_MISSING', 'REVISION_ID_INVALID', 'REVISION_DATE_INVALID']),
      );
    });
  });

  test.openspec('malformed foreign revision metadata warns')('Scenario: malformed foreign revision metadata warns', async ({ when, then }: AllureBddContext) => {
    const result = await when('foreign malformed metadata is validated', () =>
      validateBody(`<w:p><w:del w:id="abc" w:author="Human" w:date="bad"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p>`),
    );

    await then('warnings are reported without hard errors', () => {
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.map((w) => w.code)).toEqual(
        expect.arrayContaining(['REVISION_ID_INVALID', 'REVISION_DATE_INVALID']),
      );
    });
  });

  test.openspec('AI revision IDs are unique across story parts')('Scenario: AI revision IDs are unique across story parts', async ({ when, then }: AllureBddContext) => {
    const result = await when('two story parts reuse an AI revision id', () =>
      validateAiRevisions({
        aiAuthor: AI,
        stories: [
          { part: 'word/document.xml', doc: doc(`<w:p><w:ins w:id="7" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>A</w:t></w:r></w:ins></w:p>`) },
          { part: 'word/comments.xml', doc: doc(`<w:p><w:ins w:id="7" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>B</w:t></w:r></w:ins></w:p>`) },
        ],
      }),
    );

    await then('a duplicate AI id error is returned', () => {
      expect(result.errors.some((e) => e.code === 'AI_REVISION_ID_DUPLICATE')).toBe(true);
    });
  });

  test.openspec('paired range markers are balanced')('Scenario: paired range markers are balanced', async ({ when, then }: AllureBddContext) => {
    const result = await when('an AI-touched comment range start has no end', () =>
      validateBody('<w:p><w:commentRangeStart w:id="3"/><w:r><w:t>Span</w:t></w:r></w:p>', { rangeIds: ['3'] }),
    );

    await then('the unbalanced pair is a hard error', () => {
      expect(result.errors.some((e) => e.code === 'RANGE_PAIR_UNBALANCED')).toBe(true);
    });
  });

  test.openspec('field structure remains valid')('Scenario: field structure remains valid', async ({ when, then }: AllureBddContext) => {
    const result = await when('invalid deleted field code text is validated', () =>
      validateBody(
        `<w:p>` +
        `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:del w:id="9" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:t> PAGE </w:t></w:r></w:del>` +
        `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
        `</w:p>`,
      ),
    );

    await then('field/text placement errors are reported', () => {
      expect(result.errors.map((e) => e.code)).toContain('TEXT_INSIDE_DELETION');
    });
  });

  test.openspec('tracked-change placement rules are enforced')('Scenario: tracked-change placement rules are enforced', async ({ when, then }: AllureBddContext) => {
    const result = await when('structural tracked changes appear under invalid parents', () =>
      validateBody(`<w:p><w:cellIns w:id="10" w:author="${AI}" w:date="2026-01-01T00:00:00Z"/></w:p>`),
    );

    await then('placement errors are returned', () => {
      expect(result.errors.some((e) => e.code === 'REVISION_PLACEMENT_INVALID')).toBe(true);
    });
  });

  test
    .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5' })(
      '[ADV-NUMBERING-PLACEMENT-01] accepts numberingChange only under schema-valid Word parents',
      async ({ when, then, and }: AllureBddContext) => {
        const metadata = `w:id="17" w:author="${AI}" w:date="2026-01-01T00:00:00Z"`;
        const valid = await when('numbering changes are validated under numPr and fldChar', () =>
          validateBody(
            `<w:p><w:pPr><w:numPr><w:numberingChange ${metadata}/></w:numPr></w:pPr>` +
            `<w:r><w:fldChar w:fldCharType="begin"><w:numberingChange w:id="18" w:author="${AI}" w:date="2026-01-01T00:00:00Z"/></w:fldChar></w:r></w:p>`,
          ),
        );
        const invalid = await validateBody(
          `<w:p><w:pPr><w:numberingChange ${metadata}/></w:pPr>` +
          `<x:numPr xmlns:x="urn:not-word"><w:numberingChange w:id="18" w:author="${AI}" w:date="2026-01-01T00:00:00Z"/></x:numPr></w:p>`,
        );

        await then('both schema-valid placements avoid placement diagnostics', () => {
          expect(valid.errors.filter((error) => error.code === 'REVISION_PLACEMENT_INVALID')).toEqual([]);
        });
        await and('legacy and wrong-namespace lookalike parents are rejected', () => {
          expect(invalid.errors.filter((error) => error.code === 'REVISION_PLACEMENT_INVALID')).toHaveLength(2);
        });
        const source = doc(`<w:p><w:pPr><w:numPr><w:numberingChange ${metadata}/></w:numPr></w:pPr></w:p>`);
        revisionEvidence('ADV-NUMBERING-PLACEMENT-01', revisionEvidenceCases({
          elements: ['numberingChange'], operations: ['validate'], story: 'main',
          fixture: () => ({ target: source.getElementsByTagNameNS(W_NS, 'numberingChange').item(0) as Element | null, valid, invalid }),
          targetPresent: (fixture) => fixture.target !== null,
          observable: (fixture) => fixture.valid.errors.every((error) => error.code !== 'REVISION_PLACEMENT_INVALID') && fixture.invalid.errors.filter((error) => error.code === 'REVISION_PLACEMENT_INVALID').length === 2,
          removeTarget: (fixture) => ({ ...fixture, target: null }),
        }));
      },
    );

  test.openspec('relationship targets resolve to package parts')('Scenario: relationship targets resolve to package parts', async ({ when, then }: AllureBddContext) => {
    const buffer = await createZipBuffer(minimalPackageFiles({
      'word/_rels/document.xml.rels':
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="missing-comments.xml"/>` +
        `</Relationships>`,
    }));
    const zip = await DocxZip.load(buffer);

    const result = await when('an AI-touched relationship points to a missing part', () =>
      validateAiRevisions({
        aiAuthor: AI,
        stories: [{ part: 'word/document.xml', doc: doc('<w:p/>') }],
        packageZip: zip,
        touched: { relationshipParts: ['word/_rels/document.xml.rels'] },
      }),
    );

    await then('the missing relationship target is a hard error', () => {
      expect(result.errors.some((e) => e.code === 'RELATIONSHIP_TARGET_MISSING')).toBe(true);
    });
  });

  test.openspec('external relationship targets are exempt')('Scenario: external relationship targets are exempt', async ({ when, then }: AllureBddContext) => {
    const buffer = await createZipBuffer(minimalPackageFiles({
      'word/_rels/document.xml.rels':
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="External"/>` +
        `</Relationships>`,
    }));
    const zip = await DocxZip.load(buffer);

    const result = await when('an external relationship target is validated', () =>
      validateAiRevisions({
        aiAuthor: AI,
        stories: [{ part: 'word/document.xml', doc: doc('<w:p/>') }],
        packageZip: zip,
        touched: { relationshipParts: ['word/_rels/document.xml.rels'] },
      }),
    );

    await then('no missing package part error is returned', () => {
      expect(result.errors).toEqual([]);
    });
  });

  test.openspec('created side parts are registered')('Scenario: created side parts are registered', async ({ when, then }: AllureBddContext) => {
    const buffer = await createZipBuffer(minimalPackageFiles({
      'word/comments.xml': `<w:comments xmlns:w="${W_NS}"/>`,
    }));
    const docx = await DocxDocument.load(buffer);

    const result = await when('an AI-created side part lacks a content type override', () =>
      docx.validateAiRevisions(AI, { sideParts: ['word/comments.xml'] }),
    );

    await then('the missing content type registration is a hard error', () => {
      expect(result.errors.some((e) => e.code === 'SIDE_PART_CONTENT_TYPE_MISSING')).toBe(true);
    });
  });

  test('w:date must be xsd:dateTime, not merely JS-parseable', async () => {
    const result = await validateBody(
      `<w:p><w:ins w:id="30" w:author="${AI}" w:date="04 Dec 1995 00:12:00 GMT"><w:r><w:t>X</w:t></w:r></w:ins>` +
      `<w:ins w:id="31" w:author="${AI}" w:date="2026"><w:r><w:t>Y</w:t></w:r></w:ins></w:p>`,
    );
    expect(result.errors.filter((e) => e.code === 'REVISION_DATE_INVALID')).toHaveLength(2);
  });

  test('AI-touched range markers require integer w:id', async () => {
    const result = await validateBody(
      `<w:p><w:commentRangeStart w:id="abc"/><w:r><w:t>Span</w:t></w:r><w:commentRangeEnd w:id="abc"/></w:p>`,
      { rangeIds: ['abc'] },
    );
    expect(result.errors.some((e) => e.code === 'RANGE_MARKER_ID_INVALID')).toBe(true);
  });

  test('range-end milestones require only w:id, not author/date', async () => {
    const result = await validateBody(
      `<w:p>` +
      `<w:moveFromRangeStart w:id="21" w:author="${AI}" w:date="2026-01-01T00:00:00Z" w:name="move1"/>` +
      `<w:moveFrom w:id="22" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Moved</w:delText></w:r></w:moveFrom>` +
      `<w:moveFromRangeEnd w:id="21"/>` +
      `</w:p>`,
      { revisionIds: ['21', '22'] },
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((w) => w.element === 'w:moveFromRangeEnd')).toEqual([]);
  });

  test('DocxDocument.validateAiRevisions walks supported side-story parts', async () => {
    const buffer = await buildDocxFromBodyXml(
      `<w:p><w:ins w:id="1" w:author="${AI}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Main</w:t></w:r></w:ins></w:p>`,
    );
    const docx = await DocxDocument.load(buffer);
    const result = await docx.validateAiRevisions(AI);
    expect(result.errors).toEqual([]);
  });
});
