# Change: Portable DOCX editing and comparison runtime

## Why
Browser and sandbox consumers cannot import the current package entry points because they reach Node built-ins. Stable hashes and bookmark identities must survive the runtime change.

## What Changes
- Share synchronous JavaScript SHA-256 and legacy SHA-1 digests and POSIX package-path helpers.
- Separate Node oracles and filesystem schema capture behind conditional Node entry points and explicit `/node` exports.
- Run a browser bundle with no Node globals and prohibit Node built-ins in its full import graph.

## Impact
- Affected specs: docx-primitives (portable execution also exercises docx-comparison).
- Affected code: core/compare runtime imports, archives, package exports, CI.
- Approved scope: owner requested implementation and shipping in issue #1538.
