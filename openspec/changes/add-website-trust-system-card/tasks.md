## 1. Specification
- [x] 1.1 Add `website-trust-surface` OpenSpec delta for site + system card behavior.

## 2. Implementation
- [x] 2.1 Add `site/` Eleventy app scaffold (layout, landing page, trust index, Vercel config).
- [x] 2.2 Add generated system card page under `site/src/trust/system-card.md`.
- [x] 2.3 Add generation script that rebuilds traceability matrices and summarizes Allure outcomes.
- [x] 2.4 Wire npm scripts to build the system card and site in a deterministic order.

## 3. Validation
- [x] 3.1 Run system card generation and verify markdown is produced.
- [x] 3.2 Build the site and verify trust pages are rendered.
- [x] 3.3 Validate the OpenSpec change (`openspec validate add-website-trust-system-card --strict`).
