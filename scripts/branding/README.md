# Allure Branding Templates

This folder holds the template assets used by `scripts/brand_allure_report.mjs`.

## Files

- `runtime.template.js`: Runtime UI behavior patch script injected into report `index.html`.
- `theme.template.css`: Theme/style overrides injected into report `index.html`.

## Template Tokens

`brand_allure_report.mjs` replaces the following tokens before injection:

- `runtime.template.js`
  - `__ICON_URL_JSON__`
  - `__LEGACY_ICON_ID_JSON__`
- `theme.template.css`
  - `__ICON_FILE_WITH_VERSION__`
  - `__LEGACY_ICON_ID__`

## Where to change behavior

- Branding identity values (name/section/icon filename): `scripts/brand_allure_report.mjs` (`BRANDING_CONFIG`).
- JS bundle patch behavior: `scripts/brand_allure_report.mjs` (`buildReportJsPatches`).
- Runtime DOM behavior hooks: `runtime.template.js` (`UI_PATCHES`).
- Style/theme behavior: `theme.template.css`.

## Security Profiles

`brand_allure_report.mjs` supports security profiles for HTML attachment rendering and iframe sandbox behavior:

- `strict`: keep default iframe sandbox (`allow-same-origin`) and keep sanitizer enabled.

Sanitized mode (`strict`) uses an explicit DOMPurify HTML allowlist profile:

- `USE_PROFILES: { html: true }`
- `WHOLE_DOCUMENT: true` so attachment `<head><style>...</style></head>` survives sanitization
- `ADD_TAGS: ["html", "head", "body", "style"]` to keep document wrapper + trusted formatting style blocks
- `ADD_ATTR: ["class"]` for syntax/highlight class hooks
- explicit `FORBID_TAGS` for active/interactive elements (scripts, forms, embeds, etc.)

Use with:

```bash
node scripts/brand_allure_report.mjs --report-dir allure-report-repo --ux-only --security-profile strict
```

`scripts/generate_allure_report.mjs` now applies native Allure branding flags (`--logo`, `--theme`, `--report-name`, `--group-by`) and then runs `brand_allure_report.mjs` in `--ux-only` mode for DOM/UI enhancements.

## Reuse strategy

For another repo or a future Allure plugin, keep this folder as the source of truth and move only orchestration code (`brand_allure_report.mjs`) to the host project.
