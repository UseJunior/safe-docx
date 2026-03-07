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

import { describe, expect, it } from 'vitest';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

describe('xmldom CharacterData nodeValue/data sync', () => {
  it('replaceData keeps nodeValue and data in sync', () => {
    const doc = new DOMParser().parseFromString('<r/>', 'text/xml');
    const text = doc.createTextNode('original');
    doc.documentElement!.appendChild(text);

    text.replaceData(0, text.length, 'updated');

    expect(text.nodeValue).toBe('updated');
    expect(text.data).toBe('updated');
    expect(new XMLSerializer().serializeToString(doc)).toContain('updated');
  });

  // This test is marked it.fails() to document the upstream bug in @xmldom/xmldom 0.8.x.
  // Direct nodeValue assignment only updates the instance property — `data` stays stale,
  // so XMLSerializer silently outputs the old text.
  //
  // Once the library implements nodeValue as a getter/setter on CharacterData.prototype
  // (or via Node.prototype dispatch), change this to a normal it() with the same assertions.
  //
  // Fix direction:
  //   Object.defineProperty(CharacterData.prototype, 'nodeValue', {
  //     get() { return this.data; },
  //     set(v) { const s = v == null ? '' : String(v); this.data = s; this.length = s.length; }
  //   });
  it.fails('direct nodeValue assignment updates nodeValue but NOT data or XMLSerializer output', () => {
    const doc = new DOMParser().parseFromString('<r/>', 'text/xml');
    const text = doc.createTextNode('original');
    doc.documentElement!.appendChild(text);

    text.nodeValue = 'updated';

    // nodeValue appears correct — the instance property was shadowed
    expect(text.nodeValue).toBe('updated');
    // data is stale — these fail in xmldom 0.8.x
    expect(text.data).toBe('updated');
    expect(new XMLSerializer().serializeToString(doc)).toContain('updated');
  });

  // Real-world impact: simulates the setLeafText path in our DOCX comparison engine
  // before the fix (Issue #35). The merged atom appeared correct in DOM traversal
  // (nodeValue read back 'hello world') but XMLSerializer silently wrote stale text.
  it.fails('merging atom text via nodeValue loses data on serialization', () => {
    const doc = new DOMParser().parseFromString('<w:t>hello </w:t>', 'text/xml');
    const textNode = doc.documentElement!.firstChild as CharacterData;

    textNode.nodeValue = 'hello world';

    // These fail — data and serialized output remain 'hello '
    expect(textNode.data).toBe('hello world');
    expect(new XMLSerializer().serializeToString(doc)).toContain('hello world');
  });
});
