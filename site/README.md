# Safe DOCX Site

Static site for Safe DOCX built with Eleventy and deployable on Vercel.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The Vercel deployment serves an unlisted browser comparison prototype at
`/labs/docx-compare` and redirects other routes. Run
`npm run build:prototype` from this directory to build just that deployment.
It bundles the portable engine from this checkout into a Web Worker and places
the static files in `_site`.

`npm run test:prototype` verifies the built sample flow, local file selection,
both revision projections, and refusal of a known incomplete pair in Chromium.
First build the comparison workspace and prototype, then install Chromium with
`npx playwright install chromium`. The required workspace test runs this smoke
before merge. The production deployment workflow runs the same smoke against
the live route after Vercel reports a successful production deployment.
