# Change: Add Public Trust Surface and Generated System Card

## Why
Safe DOCX already has strong OpenSpec-to-test traceability and Allure evidence, but that trust signal is buried in repo internals. A public trust surface should expose this evidence in a readable, navigable format.

## What Changes
- Add a new `site/` directory for the public Safe DOCX site, built as a static Eleventy app and deployable on Vercel.
- Add a top-level trust route (`/trust/`) from the landing page.
- Add a generated system card page (`/trust/system-card/`) that is produced from existing traceability + Allure artifacts.
- Define a single-source generation flow so trust content is derived from code/test artifacts, not duplicated manually.

## Impact
- Affected specs: `website-trust-surface` (new capability)
- Affected code:
  - `site/**`
  - `scripts/generate_system_card.mjs`
  - root `package.json` scripts
