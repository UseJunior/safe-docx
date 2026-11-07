import { expect } from 'vitest';
import {
  NESTED_IF_DOCPROPERTY_FIELD_WITH_INSTRUCTION_RESULT,
  delInstrText,
  fldChar,
  instrText,
  resultText,
} from '../testing/ooxml-fixtures.js';
import {
  validateFieldStructure,
  validateStrictFieldStructure,
  collectFieldStructureIssues,
  FieldTracker,
} from './field-structure.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'Nested Field Structure Validation' })
  .conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.18' });

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function buildDoc(bodyXml: string): string {
  return `<w:document ${NS}><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;
}

test.conformance(
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.22' },
  { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.14' },
)('permits ordinary moved-source text while retaining deletion vocabulary checks', () => {
  const moved = `<w:moveFrom>${resultText('Moved text')}</w:moveFrom>`;
  expect(collectFieldStructureIssues(buildDoc(`<w:p>${moved}</w:p>`))).toEqual([]);
  for (const content of [resultText('Deleted text'), moved]) {
    expect(collectFieldStructureIssues(buildDoc(`<w:p><w:del>${content}</w:del></w:p>`))
      .map(issue => issue.code)).toContain('TEXT_INSIDE_DELETION');
  }
});

test(
  'Word nested-field instruction-result serialization is valid',
  async ({ given, when, then }: AllureBddContext) => {
    let xml = '';
    let leanPinned = false;
    let strict = false;

    await given('an IF field whose nested DOCPROPERTY result is serialized as instruction text', () => {
      xml = buildDoc(`<w:p>${NESTED_IF_DOCPROPERTY_FIELD_WITH_INSTRUCTION_RESULT}</w:p>`);
    });
    await when('the document is validated by both runtime predicates', () => {
      leanPinned = validateFieldStructure(xml);
      strict = validateStrictFieldStructure(xml);
    });
    await then('the outer pre-separator field keeps the nested result in a legal code region', () => {
      expect(leanPinned).toBe(true);
      expect(strict).toBe(true);
    });
  },
);

test(
  'deleted nested-field instruction text uses the outer field code region',
  async ({ given, when, then }: AllureBddContext) => {
    let xml = '';
    let ok = false;

    await given('deleted instruction text after an inner separator while the outer field is pre-separator', () => {
      xml = buildDoc(
        `<w:p>` +
          fldChar('begin') +
          instrText(' IF ', { preserve: true }) +
          fldChar('begin') +
          instrText(' DOCPROPERTY "SWDocID" ', { preserve: true }) +
          fldChar('separate') +
          `<w:del>${delInstrText('RLF1 23607329v.2', { preserve: true })}</w:del>` +
          fldChar('end') +
          instrText(' = "1" ', { preserve: true }) +
          fldChar('end') +
          `</w:p>`,
      );
    });
    await when('the document is validated', () => {
      ok = validateFieldStructure(xml);
    });
    await then('the deleted instruction text is accepted', () => {
      expect(ok).toBe(true);
    });
  },
);

test(
  'nested instruction text is rejected after every enclosing separator',
  async ({ given, when, then }: AllureBddContext) => {
    let xml = '';
    let ok = true;

    await given('instruction text after both the outer and inner fields have entered their result regions', () => {
      xml = buildDoc(
        `<w:p>` +
          fldChar('begin') +
          instrText(' OUTER ', { preserve: true }) +
          fldChar('separate') +
          fldChar('begin') +
          instrText(' INNER ', { preserve: true }) +
          fldChar('separate') +
          instrText('not a field instruction', { preserve: true }) +
          fldChar('end') +
          fldChar('end') +
          `</w:p>`,
      );
    });
    await when('the document is validated', () => {
      ok = validateFieldStructure(xml);
    });
    await then('the validator still rejects instruction text outside every open code region', () => {
      expect(ok).toBe(false);
    });
  },
);

test('FieldTracker tracks nested fields, code/result regions, and text visibility', () => {
  const tracker = new FieldTracker({ strict: true });
  expect(tracker.depth).toBe(0);
  expect(tracker.isInsideField).toBe(false);
  expect(tracker.isTextVisible()).toBe(true);

  // Begin outer field
  tracker.advanceFieldChar('begin');
  expect(tracker.depth).toBe(1);
  expect(tracker.isInsideFieldCode()).toBe(true);
  expect(tracker.isInsideFieldResult()).toBe(false);
  expect(tracker.isTextVisible()).toBe(false);

  // Begin nested inner field inside instruction
  tracker.advanceFieldChar('begin');
  expect(tracker.depth).toBe(2);
  expect(tracker.isInsideFieldCode()).toBe(true);
  expect(tracker.isTextVisible()).toBe(false);

  // Inner field separate & end
  tracker.advanceFieldChar('separate');
  expect(tracker.isInsideFieldCode()).toBe(true); // Outer is still in code!
  expect(tracker.isTextVisible()).toBe(false);

  tracker.advanceFieldChar('end');
  expect(tracker.depth).toBe(1);
  expect(tracker.isInsideFieldCode()).toBe(true);

  // Outer field separate
  tracker.advanceFieldChar('separate');
  expect(tracker.depth).toBe(1);
  expect(tracker.isInsideFieldCode()).toBe(false);
  expect(tracker.isInsideFieldResult()).toBe(true);
  expect(tracker.isTextVisible()).toBe(true);

  // Outer field end
  tracker.advanceFieldChar('end');
  expect(tracker.depth).toBe(0);
  expect(tracker.isInsideField).toBe(false);
  expect(tracker.isTextVisible()).toBe(true);
});

test('FieldTracker handles optional separators and recovers in tolerant mode', () => {
  const tolerantTracker = new FieldTracker({ strict: false });

  // Optional separator field (e.g. { PAGE })
  tolerantTracker.advanceFieldChar('begin');
  expect(tolerantTracker.depth).toBe(1);
  expect(tolerantTracker.isInsideFieldCode()).toBe(true);
  tolerantTracker.advanceFieldChar('end');
  expect(tolerantTracker.depth).toBe(0);
  expect(tolerantTracker.isTextVisible()).toBe(true);

  // Stray separate in tolerant mode
  tolerantTracker.advanceFieldChar('separate');
  expect(tolerantTracker.depth).toBe(0);

  // Stray end in tolerant mode
  tolerantTracker.advanceFieldChar('end');
  expect(tolerantTracker.depth).toBe(0);

  // Duplicate separate in tolerant mode
  tolerantTracker.advanceFieldChar('begin');
  tolerantTracker.advanceFieldChar('separate');
  expect(tolerantTracker.isInsideFieldResult()).toBe(true);
  tolerantTracker.advanceFieldChar('separate'); // Duplicate
  expect(tolerantTracker.isInsideFieldResult()).toBe(true);
  tolerantTracker.advanceFieldChar('end');
  expect(tolerantTracker.depth).toBe(0);
});

test('FieldTracker reports stray, duplicate, and unclosed markers in strict mode', () => {
  const issues: string[] = [];
  const strictTracker = new FieldTracker({
    strict: true,
    story: 'test-story',
    onIssue: (i) => issues.push(i.code),
  });

  strictTracker.advanceFieldChar('separate');
  expect(issues).toContain('FIELD_STRAY_SEPARATOR');

  strictTracker.advanceFieldChar('end');
  expect(issues).toContain('FIELD_STRAY_END');

  strictTracker.advanceFieldChar('begin');
  strictTracker.advanceFieldChar('separate');
  strictTracker.advanceFieldChar('separate');
  expect(issues).toContain('FIELD_DUPLICATE_SEPARATOR');

  strictTracker.advanceFieldChar('begin');
  strictTracker.finishStory();
  expect(issues).toContain('FIELD_UNCLOSED_DEPTH');

  strictTracker.reset();
  expect(strictTracker.depth).toBe(0);
});
