# Plan: Fix xmldom Issue #42 — ProcessingInstruction trailing whitespace stripped (0.8.x backport)

> **Peer review**: Codex reviewed this plan. Key corrections applied below.
> Gemini was unable to read `node_modules/` (blocked by ignore patterns) and produced no usable output.

## Context

Issue #42 has been open since March 2020 (label: `help-wanted`, milestone: `before 1.0.0`).
It reports three problems with ProcessingInstruction nodes. We investigated:

| Reported problem | Status | Notes |
|---|---|---|
| `nodeName: undefined` | Already fixed | `dom.js:1209` sets `node.nodeName = target` — fixed post-2020, issue never closed |
| Trailing whitespace stripped from PI data | **Confirmed bug in 0.8.x** | Root cause below. Fixed on `master`/`0.9.x` as side-effect of PR #498, but NOT backported to `release-0.8.x` |
| XML declaration in `childNodes` | Out of scope | Maintainer flagged as needing backward-compat discussion |

**This PR targets `release-0.8.x`**, not `master`. The trailing whitespace fix landed in
`master`/`0.9.x` via PR #498 (merged 2023-07-10) as part of a 22k-line architectural rewrite
(DOCTYPE internal subset support). That rewrite replaced the regex-based `parseInstruction`
with a grammar-based `parseProcessingInstruction` — too large to backport wholesale.
This PR provides the minimal one-token regex fix for the still-maintained 0.8.x line.

We fix only the confirmed whitespace bug. We do not touch the XML declaration item.

---

## Root Cause

**File**: `lib/sax.js`, `parseInstruction` function — active parsing path in 0.8.x
(dispatched from main loop at line 156; `parseProcessingInstruction` is the master path)

```js
function parseInstruction(source, start, domBuilder) {
  var end = source.indexOf('?>', start);
  if (end) {
    var match = source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)\s*$/);
    //                                                                      ^^^^
    //           \s*$ strips trailing whitespace from PI data before match[2]
    if (match) {
      domBuilder.processingInstruction(match[1], match[2]);
      return end + 2;
    }
  }
}
```

`source.substring(start, end)` slices from `<?` up to (not including) `?>`.
So `$` anchors at the position immediately before `?>`.
`\s*$` greedily eats trailing whitespace from the PI data before it reaches `match[2]`.

Per the XML spec [§2.6](https://www.w3.org/TR/xml/#sec-pi): PI data is everything between the
mandatory separator whitespace after the PI target and the closing `?>`.
Trailing whitespace is part of the data content.

**Aside — `if (end)` latent bug (out of scope for this PR)**:
`source.indexOf()` returns `-1` when not found. In JavaScript, `-1` is truthy, so `if (end)`
does NOT correctly guard the not-found case. This is a separate latent malformed-input
concern in 0.8.x — worth a follow-up issue, but kept out of this PR to stay focused.

**Fix** — remove only `\s*` before `$`; preserve `*?` quantifier to keep the diff minimal:

```js
var match = source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)$/);
```

---

## What We'll Build

### Step 1: Fork and clone, target `release-0.8.x`

```bash
gh repo fork xmldom/xmldom --clone
cd xmldom
git fetch origin release-0.8.x
git checkout -b fix/42-pi-trailing-whitespace origin/release-0.8.x
```

### Step 2: Fix `lib/sax.js`

Remove only `\s*` before `$`; keep `*?` to minimise diff:

```diff
-    var match = source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)\s*$/);
+    var match = source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)$/);
```

### Step 3: Add tests

`release-0.8.x` has no `test/dom/processing-instruction.test.js`, so create it.
Match the 0.8.x test style (CJS, Jest globals injected, tab-indented, `test()` not `it()`).
Assert PI identity (`nodeType` + `target`) before asserting `data` so future declaration
handling changes don't silently invalidate test intent.

```js
'use strict';

const { DOMParser } = require('../../lib');
const { MIME_TYPE } = require('../../lib/conventions');
const { Node } = require('../../lib/dom');

describe('ProcessingInstruction', () => {
	test('preserves trailing space in PI data when parsed from string', () => {
		const doc = new DOMParser().parseFromString(
			'<?xml-stylesheet href="mycss.css" type="text/css" ?><xml/>',
			MIME_TYPE.XML_TEXT
		);
		const pi = doc.firstChild;

		expect(pi.nodeType).toBe(Node.PROCESSING_INSTRUCTION_NODE);
		expect(pi.target).toBe('xml-stylesheet');
		expect(pi.data).toBe('href="mycss.css" type="text/css" ');
	});

	test('preserves trailing newline in PI data when parsed from string', () => {
		const doc = new DOMParser().parseFromString(
			'<?xml-stylesheet href="mycss.css"\n?><xml/>',
			MIME_TYPE.XML_TEXT
		);
		const pi = doc.firstChild;

		expect(pi.nodeType).toBe(Node.PROCESSING_INSTRUCTION_NODE);
		expect(pi.target).toBe('xml-stylesheet');
		expect(pi.data).toBe('href="mycss.css"\n');
	});
});
```

### Step 4: Run their test suite and linter

```bash
npm test        # must pass
npm run lint    # must be clean
npm run format  # must be clean (Prettier)
```

### Step 5: Open PR against `release-0.8.x`

**Title**: `fix: preserve trailing whitespace in ProcessingInstruction data (0.8.x)`

**PR body**:

---

**Target branch**: `release-0.8.x`

**Why now**: This fix is already present on `master`/`0.9.x` (as a side-effect of the
large PR #498 rewrite). This PR backports the behaviour to the maintained 0.8.x line
with a minimal, non-breaking one-token regex change.

### Approach

The XML spec ([§2.6](https://www.w3.org/TR/xml/#sec-pi)) defines PI data as everything
between the mandatory separator whitespace after the PI target and the closing `?>`.
Trailing whitespace is part of the data.

`parseInstruction` in `lib/sax.js` (the active parser in 0.8.x) uses a regex with `\s*$`
that strips trailing whitespace from PI data before passing it to
`domBuilder.processingInstruction`:

```js
// before — \s*$ strips trailing whitespace
source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)\s*$/)

// after — data content extends to the ?> boundary
source.substring(start, end).match(/^<\?(\S*)\s*([\s\S]*?)$/)
```

`source.substring(start, end)` already excludes the `?>` terminator
(`end = source.indexOf('?>', start)`), so `$` anchors at the character
immediately before `?>`. Removing `\s*` preserves all whitespace inside the PI boundary.

This matches the behaviour of `sax-js` and `libexpat`, both of which preserve trailing
PI whitespace (stripping only the mandatory separator whitespace before the data).

### Scope

The other problems reported in #42:
- **`nodeName: undefined`** — already fixed; `dom.js:1209` sets `node.nodeName = target`.
- **XML declaration in `childNodes`** — architectural, backward-compat discussion
  ongoing per maintainer comment. Not touched here.

### Changes

| File | Change |
|------|--------|
| `lib/sax.js` | Remove `\s*` from `parseInstruction` regex — one token |
| `test/dom/processing-instruction.test.js` | New file: 2 tests for trailing space and newline |

### Checklist

- [ ] Change is non-breaking (no consumer can depend on trailing PI whitespace being stripped)
- [ ] Tests assert PI identity (`nodeType` + `target`) before asserting `data`
- [ ] `npm test` — all tests pass
- [ ] `npm run lint` — clean
- [ ] `npm run format` — clean

Addresses the trailing-whitespace sub-issue from #42, backporting #498 behaviour to 0.8.x.

---

## Confidence Notes (updated after Codex peer review)

- **High**: Root cause confirmed locally (`node_modules/@xmldom/xmldom/lib/sax.js:600`)
- **High**: `parseInstruction` is the active 0.8.x path (line 156 dispatch confirmed)
- **High**: Fix is a single regex token — no other behaviour affected
- **High**: This is a backport to `release-0.8.x`; master already has the fix via PR #498
- **High**: `if (end)` truthiness note corrected — `-1` is truthy in JS; latent separate bug
- **High**: `doc.firstChild` is valid for our test XML — confirmed, and now guarded by `target` assertion
- **High**: `sax-js` and `libexpat` both preserve trailing PI whitespace — no ecosystem precedent for stripping
- **Medium**: `release-0.8.x` test directory has no `processing-instruction.test.js` — creating new file
- **Medium**: Whether maintainer accepts 0.8.x backport PRs — branch updated 2025-08-17 so actively maintained
- **Low**: Keep `*?` (non-greedy) to minimise diff noise — functionally identical to `*` here
