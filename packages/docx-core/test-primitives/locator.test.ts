import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './helpers/allure-test.js';
import { resolveLocator, type Locator } from '../src/primitives/locator.js';
import { buildCleanToRawOffsetMap, cleanToRawOffset, type DocumentViewNode } from '../src/primitives/document_view.js';
import { computeContentFingerprint } from '../src/primitives/content_fingerprint.js';

const TEST_FEATURE = 'add-deterministic-locator-primitive';
const test = testAllure.epic('DOCX Primitives').withLabels({ feature: TEST_FEATURE });

let bkCounter = 0;
function makeNode(overrides: Partial<DocumentViewNode> & { clean_text: string }): DocumentViewNode {
  bkCounter += 1;
  const id = overrides.id ?? `_bk_${String(bkCounter).padStart(12, '0')}`;
  const clean = overrides.clean_text;
  return {
    id,
    list_label: '',
    header: '',
    style: 'body',
    text: clean,
    clean_text: clean,
    raw_text: clean,
    tagged_text: clean,
    list_metadata: {
      list_level: -1,
      label_type: null,
      label_string: '',
      header_text: null,
      header_style: null,
      header_formatting: null,
      is_auto_numbered: false,
    },
    style_fingerprint: {
      list_level: -1,
      left_indent_pt: 0,
      first_line_indent_pt: 0,
      style_name: 'Body Text',
      alignment: 'LEFT',
    },
    paragraph_style_id: null,
    paragraph_style_name: 'Body Text',
    paragraph_alignment: 'LEFT',
    paragraph_indents_pt: { left: 0, first_line: 0 },
    numbering: { num_id: null, ilvl: null, is_auto_numbered: false },
    header_formatting: null,
    body_run_formatting: null,
    ...overrides,
  };
}

function headingNode(text: string, level: number | null, overrides: Partial<DocumentViewNode> = {}): DocumentViewNode {
  return makeNode({
    clean_text: text,
    heading: { text, source: 'word_style', level },
    ...overrides,
  });
}

describe('resolveLocator — primary resolution', () => {
  test.openspec('primary resolves exactly one span')(
    'Scenario: primary resolves exactly one span',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('a view with one paragraph containing the anchor once', async () => {
        view = [makeNode({ clean_text: 'The company [Insert Company Name] agrees.' })];
      });
      await when('a regex primary for the anchor is resolved', async () => {
        result = resolveLocator(view, { primary: { kind: 'regex', pattern: '\\[Insert Company Name\\]' } });
      });
      await then('it resolves to exactly that raw-offset span', async () => {
        expect(result.unresolved).toBe(false);
        expect(result.match).toEqual({ nodeId: view[0]!.id, start: 12, end: 33 });
      });
    },
  );

  test.openspec('zero matches is unresolved')(
    'Scenario: zero matches is unresolved',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('a view without the anchor', async () => {
        view = [makeNode({ clean_text: 'Nothing here.' })];
      });
      await when('a regex primary is resolved', async () => {
        result = resolveLocator(view, { primary: { kind: 'regex', pattern: '\\[Insert Company Name\\]' } });
      });
      await then('it is unresolved with a null match', async () => {
        expect(result.unresolved).toBe(true);
        expect(result.match).toBeNull();
      });
    },
  );

  test.openspec('multiple matches is unresolved, never a guess')(
    'Scenario: multiple matches is unresolved, never a guess',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('a view with the anchor twice', async () => {
        view = [makeNode({ clean_text: 'X [Y] and again [Y].' })];
      });
      await when('a regex primary is resolved', async () => {
        result = resolveLocator(view, { primary: { kind: 'regex', pattern: '\\[Y\\]' } });
      });
      await then('ambiguity is a drift signal: unresolved, no first-pick', async () => {
        expect(result.unresolved).toBe(true);
        expect(result.match).toBeNull();
      });
    },
  );

  test.openspec('resolution is reproducible')(
    'Scenario: resolution is reproducible',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      await given('a view with one anchor', async () => {
        view = [makeNode({ clean_text: 'a [Z] b' })];
      });
      await then('two resolutions are deep-equal', async () => {
        const loc: Locator = { primary: { kind: 'regex', pattern: '\\[Z\\]' } };
        expect(resolveLocator(view, loc)).toEqual(resolveLocator(view, loc));
      });
      void when;
    },
  );
});

describe('resolveLocator — scope narrowing', () => {
  test.openspec('section narrows to its region')(
    'Scenario: section narrows to its region',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('two sections, each containing the same anchor', async () => {
        view = [
          headingNode('Section A', 1),
          makeNode({ clean_text: 'value [B] here' }),
          headingNode('Section B', 1),
          makeNode({ clean_text: 'value [B] here' }),
        ];
      });
      await when('the locator scopes to Section B', async () => {
        result = resolveLocator(view, {
          scope: [{ kind: 'section', headingText: 'Section B' }],
          primary: { kind: 'regex', pattern: '\\[B\\]' },
        });
      });
      await then('only the occurrence inside Section B is considered', async () => {
        expect(result.unresolved).toBe(false);
        expect(result.match?.nodeId).toBe(view[3]!.id);
      });
    },
  );

  test.openspec('repeated heading is unresolved')(
    'Scenario: repeated heading is unresolved',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('two headings with identical text', async () => {
        view = [headingNode('Dup', 1), makeNode({ clean_text: '[B]' }), headingNode('Dup', 1)];
      });
      await when('the locator scopes to that heading text', async () => {
        result = resolveLocator(view, {
          scope: [{ kind: 'section', headingText: 'Dup' }],
          primary: { kind: 'regex', pattern: '\\[B\\]' },
        });
      });
      await then('the ambiguous section is unresolved (no silent first-pick)', async () => {
        expect(result.unresolved).toBe(true);
      });
    },
  );
});

describe('resolveLocator — step kinds', () => {
  test.openspec('section is scope-only')(
    'Scenario: section is scope-only',
    async ({ given, when, then }: AllureBddContext) => {
      await given('a locator misusing section as primary', async () => {});
      await then('resolveLocator rejects it as invalid', async () => {
        const bad = { primary: { kind: 'section', headingText: 'X' } } as unknown as Locator;
        expect(() => resolveLocator([makeNode({ clean_text: 'x' })], bad)).toThrow(/primary/i);
      });
      void when;
    },
  );

  test.openspec('zero-length regex is unresolved')(
    'Scenario: zero-length regex is unresolved',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('a single paragraph', async () => {
        view = [makeNode({ clean_text: 'abc' })];
      });
      await when('a regex that can match empty is used', async () => {
        result = resolveLocator(view, { primary: { kind: 'regex', pattern: 'x?' } });
      });
      await then('it is unresolved and returns no zero-length span', async () => {
        expect(result.unresolved).toBe(true);
        expect(result.match).toBeNull();
      });
    },
  );

  test.openspec('contextual requires context before target')(
    'Scenario: contextual requires context before target',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('a node anchored by "by and among" with one corporation phrase', async () => {
        view = [
          makeNode({ clean_text: 'Recitals follow below.' }),
          makeNode({ clean_text: 'by and among NewCo, Inc., a Delaware corporation and the Investors' }),
        ];
      });
      await when('a contextual step requires the context then the target', async () => {
        result = resolveLocator(view, {
          primary: {
            kind: 'contextual',
            contextPattern: 'by and among',
            targetPattern: '[A-Z][\\w, .]+, a Delaware corporation',
          },
        });
      });
      await then('the target span after the context is returned', async () => {
        expect(result.unresolved).toBe(false);
        expect(result.match?.nodeId).toBe(view[1]!.id);
        const node = view[1]!;
        const raw = node.raw_text!;
        expect(raw.slice(result.match!.start, result.match!.end)).toBe('NewCo, Inc., a Delaware corporation');
      });
    },
  );

  test.openspec('fingerprint selects a whole node')(
    'Scenario: fingerprint selects a whole node',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      const target = 'The exact preamble sentence.';
      await given('a view with the target paragraph', async () => {
        view = [makeNode({ clean_text: 'other' }), makeNode({ clean_text: target })];
      });
      await when('a fingerprint primary for the target is resolved', async () => {
        result = resolveLocator(view, {
          primary: { kind: 'fingerprint', contentFingerprint: computeContentFingerprint(target) },
        });
      });
      await then('it spans the whole target node, no sub-span narrowing', async () => {
        expect(result.unresolved).toBe(false);
        expect(result.match).toEqual({ nodeId: view[1]!.id, start: 0, end: target.length });
      });
    },
  );
});

describe('resolveLocator — assertions', () => {
  test.openspec('span assertion must equal primary span')(
    'Scenario: span assertion must equal primary span',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('a paragraph with two different anchors', async () => {
        view = [makeNode({ clean_text: 'a [Q] b [R] c' })];
      });
      await when('the assertion targets a different anchor than primary', async () => {
        result = resolveLocator(view, {
          primary: { kind: 'regex', pattern: '\\[Q\\]' },
          assertions: [{ kind: 'regex', pattern: '\\[R\\]' }],
        });
      });
      await then('the assertion result is not ok', async () => {
        expect(result.assertionResults[0]!.ok).toBe(false);
      });
    },
  );

  test.openspec('fingerprint assertion matches node identity only')(
    'Scenario: fingerprint assertion matches node identity only',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      const target = 'a [Q] b';
      await given('a single paragraph resolved by a sub-span primary', async () => {
        view = [makeNode({ clean_text: target })];
      });
      await when('a fingerprint assertion names the same node', async () => {
        result = resolveLocator(view, {
          primary: { kind: 'regex', pattern: '\\[Q\\]' },
          assertions: [{ kind: 'fingerprint', contentFingerprint: computeContentFingerprint(target) }],
        });
      });
      await then('it passes on node-id match (not span equality)', async () => {
        expect(result.assertionResults[0]!).toMatchObject({ ok: true, kind: 'fingerprint' });
      });
    },
  );

  test.openspec('failed assertion does not change the match')(
    'Scenario: failed assertion does not change the match',
    async ({ given, when, then }: AllureBddContext) => {
      let view: DocumentViewNode[] = [];
      let result: ReturnType<typeof resolveLocator>;
      await given('a resolvable primary and a failing assertion', async () => {
        view = [makeNode({ clean_text: 'a [Q] b [R] c' })];
      });
      await when('resolveLocator runs', async () => {
        result = resolveLocator(view, {
          primary: { kind: 'regex', pattern: '\\[Q\\]' },
          assertions: [{ kind: 'regex', pattern: '\\[R\\]' }],
        });
      });
      await then('match is still the primary span and the failure is reported', async () => {
        expect(result.match).toEqual({ nodeId: view[0]!.id, start: 2, end: 5 });
        expect(result.assertionResults[0]!.ok).toBe(false);
      });
    },
  );
});

describe('clean_text → raw offset map', () => {
  test.openspec('leading trim is mapped')(
    'Scenario: leading trim is mapped',
    async ({ then }: AllureBddContext) => {
      await then('clean offset 0 maps past the trimmed prefix', async () => {
        const node = makeNode({ clean_text: '[X] rest', raw_text: '   [X] rest' });
        const map = buildCleanToRawOffsetMap(node);
        expect(map[0]).toBe(3);
        expect(cleanToRawOffset(node, 3)).toBe(6);
      });
    },
  );

  test.openspec('stripped list label is mapped')(
    'Scenario: stripped list label is mapped',
    async ({ then }: AllureBddContext) => {
      await then('clean offset 0 maps past the stripped label', async () => {
        const node = makeNode({ clean_text: 'Body text', raw_text: '1. Body text' });
        expect(buildCleanToRawOffsetMap(node)[0]).toBe(3);
      });
    },
  );

  test.openspec('identity when clean equals raw')(
    'Scenario: identity when clean equals raw',
    async ({ then }: AllureBddContext) => {
      await then('every offset is identity', async () => {
        const node = makeNode({ clean_text: 'hello', raw_text: 'hello' });
        expect(buildCleanToRawOffsetMap(node)).toEqual([0, 1, 2, 3, 4, 5]);
      });
    },
  );

  // Bonus coverage beyond the spec scenarios: interior CR/LF and the
  // identity fallback when raw_text is absent.
  test('interior CR/LF offsets shift; missing raw_text falls back to identity', async ({ then }: AllureBddContext) => {
    await then('CR/LF mapping and fallback both hold', async () => {
      const crlf = makeNode({ clean_text: 'Foo[X] bar', raw_text: 'Foo\n[X] bar' });
      const map = buildCleanToRawOffsetMap(crlf);
      expect(map[3]).toBe(4);
      expect(map[6]).toBe(7);

      const noRaw = makeNode({ clean_text: 'abcd' });
      delete (noRaw as { raw_text?: string }).raw_text;
      expect(buildCleanToRawOffsetMap(noRaw)).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
