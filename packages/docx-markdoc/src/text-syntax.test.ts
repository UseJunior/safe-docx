import { describe, expect } from 'vitest';
import { itAllure as it } from '../../docx-core/src/testing/allure-test.js';
import { buildSyntheticDocx } from '@usejunior/docx-core';
import { importDocxToMarkdoc } from './import.js';
import { requireMarkdoc, parseMarkdoc } from './markdoc.js';

const header = `{% source sha256="${'a'.repeat(64)}" paragraphs=1 /%}\n`;
const attributes = 'id="_bk_1" fingerprint="sha256:nfkc:x" style="Normal" operation="edit" format="inherit-source-paragraph"';
const change = (after: string) => `${header}{% change ${attributes} %}\n{% before %}\nOriginal\n{% /before %}\n{% after %}\n${after}\n{% /after %}\n{% /change %}`;

describe('lossless plain-text authoring syntax', () => {
  it('rejects rich Markdown, multiple blocks, nested state tags, and text outside states', () => {
    for (const after of ['**Bold**', '[Label](https://example.com)', 'First\n\nSecond', '{% before %}Hidden{% /before %}', '- item', '> quote', '```\ncode\n```']) {
      expect(parseMarkdoc(change(after)).valid, after).toBe(false);
    }
    expect(parseMarkdoc(change('Revised').replace('{% before %}', 'Lost text\n{% before %}')).valid).toBe(false);
  });

  it('keeps escaped Markdown and explicit inline formatting', () => {
    expect(requireMarkdoc(change('\\*\\*Literal\\*\\*')).scaffold[0]!.revisedText).toBe('**Literal**');
    expect(requireMarkdoc(change('{% run-format underline="single" %}Revised{% /run-format %}')).scaffold[0]!.revisedText).toBe('Revised');
  });

  it('imports Markdown-looking source paragraphs without losing their text', async () => {
    const paragraphs = ['- item', '+ item', '1) item', '1. item', '---', '----', '-----', String.raw`\---`, String.raw`\\---`, String.raw`C:\drafts\file.docx`, '~~~', 'a ~~b~~ c', '**literal**', '[label](destination)'];
    const imported = await importDocxToMarkdoc(await buildSyntheticDocx({ paragraphs }));
    expect(requireMarkdoc(imported.markdoc).scaffold.map((p) => p.originalText)).toEqual(paragraphs);
  });
});
