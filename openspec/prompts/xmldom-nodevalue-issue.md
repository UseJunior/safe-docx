# GitHub Issue: CharacterData — setting `nodeValue` directly does not update `data`, causing silent data loss in XMLSerializer

> **Target repo**: https://github.com/xmldom/xmldom/issues/new
> **Version**: @xmldom/xmldom 0.8.11

---

## Bug

Direct `node.nodeValue = text` on a `CharacterData` node does not update `node.data`.
Since `XMLSerializer` reads `node.data` (not `nodeValue`) when serializing `TEXT_NODE`s,
mutations via direct `nodeValue` assignment are silently lost in output XML.

```
//  text.nodeValue = 'world'
//
//  Before fix (current):                  After fix (expected):
//  [instance]  nodeValue = "world"        [prototype] get nodeValue() { return this.data }
//  [prototype] data      = "hello"        [prototype] set nodeValue(v) { this.data = v; ... }
//  XMLSerializer reads data → "hello" ✗   XMLSerializer reads data → "world" ✓
```

## Reproduction

```js
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const doc = new DOMParser().parseFromString('<root/>', 'text/xml');
const text = doc.createTextNode('hello');
doc.documentElement.appendChild(text);

text.nodeValue = 'world';

console.log(text.nodeValue);                               // 'world'  ✓
console.log(text.data);                                    // 'hello'  ✗  (stale)
console.log(new XMLSerializer().serializeToString(doc));   // <root>hello</root>  ✗
```

Root cause in `lib/dom.js`:

- **Line 468**: `Node.prototype` declares `nodeValue: null` — plain data property, no setter
- **Line 1372**: `CharacterData.prototype` declares `data: ''` — entirely separate plain property
- They are independent. A direct `nodeValue =` assignment shadows `Node.prototype.nodeValue`
  on the instance but never touches `data`.

All mutation methods already do the right thing:

```js
// line 1379 (appendData):  this.nodeValue = this.data = text;
// line 1396 (replaceData): this.nodeValue = this.data = text;
// line 1410 (splitText):   this.data = this.nodeValue = text;
// line 1840 (textContent setter): this.data = data; this.nodeValue = data;
```

The gap is only when callers assign `nodeValue` directly, bypassing these methods.

## Spec

[WHATWG DOM Living Standard §4.10](https://dom.spec.whatwg.org/#interface-characterdata):
for `CharacterData` nodes, `nodeValue` getter/setter must be equivalent to `data`.
All browsers comply. This is a conformance gap.

Related: [#42](https://github.com/xmldom/xmldom/issues/42) (PI `nodeValue`/`data` desync in a sibling node type — same architectural
weakness, different class hierarchy branch).

## Fix Direction

Implementing `nodeValue` as an accessor on the affected prototypes closes the gap.
Three node types are affected (verified from `_extends` calls in `lib/dom.js`):

```js
// CharacterData — covers Text, Comment, CDATASection
Object.defineProperty(CharacterData.prototype, 'nodeValue', {
  get() { return this.data; },
  set(v) {
    const s = v == null ? '' : String(v);
    this.data = s;
    this.length = s.length;
  },
});

// ProcessingInstruction — extends Node directly, not CharacterData
Object.defineProperty(ProcessingInstruction.prototype, 'nodeValue', {
  get() { return this.data; },
  set(v) {
    const s = v == null ? '' : String(v);
    this.data = s;
    this.length = s.length;
  },
});

// Attr — nodeValue ↔ value per WHATWG spec
Object.defineProperty(Attr.prototype, 'nodeValue', {
  get() { return this.value; },
  set(v) { this.value = v == null ? '' : String(v); },
});
```

> **Note**: jsdom implements this as a single `Node.prototype.nodeValue` getter/setter
> that dispatches by `nodeType` — a cleaner long-term model. The targeted approach above
> minimises review burden; happy to refactor if preferred.

**Workaround** until fixed: use `replaceData(0, node.length, newText)` instead of
direct `nodeValue` assignment.

---

*Encountered while building a DOCX XML comparison engine on top of xmldom (we contributed
[PR #960](https://github.com/xmldom/xmldom/pull/960)). Happy to open a companion PR with the fix and tests if helpful.*
