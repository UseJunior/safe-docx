/**
 * Upstream bug report: @xmldom/xmldom CharacterData nodeValue/data desync
 *
 * In @xmldom/xmldom, `CharacterData` stores text in two separate plain
 * properties: `data` (read by XMLSerializer) and `nodeValue` (read by the
 * `textContent` getter). All built-in mutation methods (appendData,
 * replaceData, splitText, textContent setter) keep them in sync via:
 *   `this.nodeValue = this.data = text`
 *
 * However, a direct `node.nodeValue = text` assignment is NOT intercepted —
 * it only updates the instance property, leaving `data` stale. Since
 * XMLSerializer reads `node.data`, mutations via direct nodeValue assignment
 * are silently lost in serialized output.
 *
 * WHATWG DOM Living Standard §4.10: for CharacterData nodes, `nodeValue`
 * getter/setter must be equivalent to `data`.
 *
 * This caused a silent data-loss bug in our DOCX comparison engine (Issue #35).
 * The fix was to use `replaceData()` instead of direct `nodeValue` assignment
 * in `setLeafText()` (packages/docx-core/src/primitives/dom-helpers.ts).
 *
 * These tests document the bug for filing upstream at:
 * https://github.com/xmldom/xmldom/issues
 *
 * Filed as companion to our merged PR #960 (ParentNode.children getter).
 */

import { describe, expect } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { testAllure } from './testing/allure-test.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'xmldom CharacterData Sync' });

describe('xmldom CharacterData nodeValue/data sync', () => {
  test('replaceData keeps nodeValue and data in sync', () => {
    const doc = new DOMParser().parseFromString('<r/>', 'text/xml');
    const text = doc.createTextNode('original');
    doc.documentElement!.appendChild(text);

    text.replaceData(0, text.length, 'updated');

    expect(text.nodeValue).toBe('updated');
    expect(text.data).toBe('updated');
    expect(new XMLSerializer().serializeToString(doc)).toContain('updated');
  });

  test('direct nodeValue assignment keeps data and XMLSerializer output in sync', () => {
    const doc = new DOMParser().parseFromString('<r/>', 'text/xml');
    const text = doc.createTextNode('original');
    doc.documentElement!.appendChild(text);

    text.nodeValue = 'updated';

    expect(text.nodeValue).toBe('updated');
    expect(text.data).toBe('updated');
    expect(new XMLSerializer().serializeToString(doc)).toContain('updated');
  });

  test('merging atom text via nodeValue preserves serialized data', () => {
    const doc = new DOMParser().parseFromString(
      '<w:t xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">hello </w:t>',
      'text/xml',
    );
    const textNode = doc.documentElement!.firstChild as unknown as CharacterData;

    textNode.nodeValue = 'hello world';

    expect(textNode.data).toBe('hello world');
    expect(new XMLSerializer().serializeToString(doc)).toContain('hello world');
  });
});
