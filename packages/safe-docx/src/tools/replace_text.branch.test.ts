import { describe, expect } from 'vitest';
import { getParagraphRuns } from '@usejunior/docx-primitives';
import { itAllure as it } from '../testing/allure-test.js';
import { replaceText } from './replace_text.js';
import { readFile } from './read_file.js';
import {
  assertFailure,
  assertSuccess,
  openSession,
  registerCleanup,
} from '../testing/session-test-utils.js';
import { firstParaIdFromToon } from '../testing/docx_test_utils.js';

const test = it.epic('Document Editing').withLabels({ feature: 'Replace Text' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function makeDocXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`
  );
}

function runHasHighlight(run: Element): boolean {
  const rPr = run.getElementsByTagNameNS(W_NS, 'rPr').item(0);
  if (!rPr) return false;
  return !!rPr.getElementsByTagNameNS(W_NS, 'highlight').item(0);
}

describe('replace_text branch coverage', () => {
  registerCleanup();

  test('returns EDIT_ERROR for unbalanced non-definition tag variants', async () => {
    const opened = await openSession(['replace target text']);
    const paraId = firstParaIdFromToon(opened.content);

    const cases: Array<{ newString: string; expected: string }> = [
      { newString: '</header>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '<header>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '</RunInHeader>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '<RunInHeader>bad', expected: 'UNBALANCED_HEADER_TAGS' },
      { newString: '</highlighting>bad', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
      { newString: '<highlighting>bad', expected: 'UNBALANCED_HIGHLIGHT_TAGS' },
      { newString: '</b>bad', expected: 'UNBALANCED_BOLD_TAGS' },
      { newString: '<b>bad', expected: 'UNBALANCED_BOLD_TAGS' },
      { newString: '</i>bad', expected: 'UNBALANCED_ITALIC_TAGS' },
      { newString: '<i>bad', expected: 'UNBALANCED_ITALIC_TAGS' },
      { newString: '</u>bad', expected: 'UNBALANCED_UNDERLINE_TAGS' },
      { newString: '<u>bad', expected: 'UNBALANCED_UNDERLINE_TAGS' },
    ];

    for (const tc of cases) {
      const result = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: paraId,
        old_string: 'replace target text',
        new_string: tc.newString,
        instruction: tc.expected,
      });
      assertFailure(result, 'EDIT_ERROR', tc.newString);
      expect(result.error.message).toContain(tc.expected);
    }
  });

  test('returns deterministic tool errors for anchor/match failures', async () => {
    const opened = await openSession(['foo foo']);
    const paraId = firstParaIdFromToon(opened.content);

    const multiple = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'foo',
      new_string: 'bar',
      instruction: 'multiple match path',
    });
    assertFailure(multiple, 'MULTIPLE_MATCHES', 'multiple matches');

    const notFound = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'missing',
      new_string: 'bar',
      instruction: 'not found path',
    });
    assertFailure(notFound, 'TEXT_NOT_FOUND', 'text not found');

    const missingAnchor = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: 'jr_para_missing',
      old_string: 'foo foo',
      new_string: 'bar',
      instruction: 'missing anchor path',
    });
    assertFailure(missingAnchor, 'ANCHOR_NOT_FOUND', 'anchor missing');
  });

  test('distributes replacements across overlapping runs in non-markup mode', async () => {
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:t>Alpha </w:t></w:r>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>Beta</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'Alpha Beta',
      new_string: 'Gamma Delta',
      instruction: 'distributed replacement branch',
    });
    assertSuccess(edited, 'replace distributed parts');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const runs = getParagraphRuns(pEl!).filter((r) => r.text.length > 0);
    expect(runs.length).toBeGreaterThan(1);

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    assertSuccess(read, 'read distributed replacement');
    expect(String(read.content)).toContain('Gamma Delta');
  });

  test('clears highlighted placeholder styling when replacing likely field tokens', async () => {
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>[CLIENT]</w:t></w:r>` +
      `</w:p>`,
    );
    const opened = await openSession([], { xml });
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: '[CLIENT]',
      new_string: 'Acme Corp',
      instruction: 'clear placeholder highlighting',
    });
    assertSuccess(edited, 'replace highlighted placeholder');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(paraId);
    expect(pEl).toBeTruthy();
    const allRuns = Array.from(pEl!.getElementsByTagNameNS(W_NS, 'r'));
    const acmeRuns = allRuns.filter((r) => {
      const text = Array.from(r.getElementsByTagNameNS(W_NS, 't'))
        .map((t) => t.textContent ?? '')
        .join('');
      return text.includes('Acme');
    });
    expect(acmeRuns.length).toBeGreaterThan(0);
    expect(acmeRuns.some((r) => runHasHighlight(r))).toBe(false);
  });

  test('uses definition role-model formatting for explicit quoted term spans in plain replacements', async () => {
    const xml = makeDocXml(
      `<w:p>` +
        `<w:r><w:rPr><w:b/></w:rPr><w:t>"Company"</w:t></w:r>` +
        `<w:r><w:t> means the legal entity.</w:t></w:r>` +
      `</w:p>` +
      `<w:p><w:r><w:t>Term placeholder</w:t></w:r></w:p>`,
    );
    const opened = await openSession([], { xml });
    const targetId = opened.paraIds[1]!;

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: targetId,
      old_string: 'Term placeholder',
      new_string: 'The term "Service" means the services set out below.',
      instruction: 'explicit definition span branch',
    });
    assertSuccess(edited, 'replace with explicit definition span');

    const session = opened.mgr.getSession(opened.sessionId);
    const pEl = session.doc.getParagraphElementById(targetId);
    expect(pEl).toBeTruthy();
    const serviceRun = Array.from(pEl!.getElementsByTagNameNS(W_NS, 'r')).find((r) => {
      const text = Array.from(r.getElementsByTagNameNS(W_NS, 't'))
        .map((t) => t.textContent ?? '')
        .join('');
      return text.includes('Service');
    });
    expect(serviceRun).toBeTruthy();
    const hasBold = !!serviceRun!.getElementsByTagNameNS(W_NS, 'b').item(0);
    expect(hasBold).toBe(true);
  });

  test('applies balanced markup replacement path with header/highlighting tags', async () => {
    const opened = await openSession(['replace me']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string: 'replace me',
      new_string: '<header><u>Heading:</u></header> body <highlighting>text</highlighting>',
      instruction: 'hasMarkup branch',
    });
    assertSuccess(edited, 'replace with markup');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    assertSuccess(read, 'read markup replacement');
    expect(String(read.content)).toContain('Heading: body text');
  });

  test('normalizes semantic/formatting/hyperlink tags in old/new strings before replacing in default mode', async () => {
    const opened = await openSession(['"Original target"']);
    const paraId = firstParaIdFromToon(opened.content);

    const edited = await replaceText(opened.mgr, {
      session_id: opened.sessionId,
      target_paragraph_id: paraId,
      old_string:
        '<a href="https://example.test">' +
        '<highlighting><b><i><u><definition>Original target</definition></u></i></b></highlighting>' +
        '</a>',
      new_string: '<a href="https://example.test"><definition>Replaced target</definition></a>',
      instruction: 'strip semantic and hyperlink tags before replace',
    });
    assertSuccess(edited, 'replace after old/new normalization');

    const read = await readFile(opened.mgr, {
      session_id: opened.sessionId,
      node_ids: [paraId],
      format: 'simple',
    });
    assertSuccess(read, 'read normalized replacement');
    expect(String(read.content)).toContain('"Replaced target"');
    expect(String(read.content)).not.toContain('<a ');
  });

  test('accepts true/yes/on env values for legacy definition-tag mode', async () => {
    const previous = process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;

    try {
      for (const truthy of ['true', 'yes', 'on'] as const) {
        process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = truthy;

        const opened = await openSession(['Placeholder text']);
        const paraId = firstParaIdFromToon(opened.content);

        const edited = await replaceText(opened.mgr, {
          session_id: opened.sessionId,
          target_paragraph_id: paraId,
          old_string: 'Placeholder text',
          new_string: '<definition>Company</definition> means the legal entity.',
          instruction: `legacy truthy mode: ${truthy}`,
        });
        assertSuccess(edited, `replace in legacy truthy mode: ${truthy}`);

        const read = await readFile(opened.mgr, {
          session_id: opened.sessionId,
          node_ids: [paraId],
          format: 'simple',
        });
        assertSuccess(read, `read legacy truthy mode: ${truthy}`);
        expect(String(read.content)).toContain('"Company" means the legal entity.');
      }
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
      } else {
        process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = previous;
      }
    }
  });

  test('legacy definition mode surfaces definition tag parse errors', async () => {
    const previous = process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
    process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = '1';

    try {
      const opened = await openSession(['replace target text']);
      const paraId = firstParaIdFromToon(opened.content);

      const malformed = await replaceText(opened.mgr, {
        session_id: opened.sessionId,
        target_paragraph_id: paraId,
        old_string: 'replace target text',
        new_string: '<definition>unterminated',
        instruction: 'legacy definition parser error',
      });
      assertFailure(malformed, 'EDIT_ERROR', 'legacy malformed definition');
      expect(malformed.error.message).toContain('UNBALANCED_DEFINITION_TAGS');
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS;
      } else {
        process.env.SAFE_DOCX_ENABLE_LEGACY_DEFINITION_TAGS = previous;
      }
    }
  });
});
