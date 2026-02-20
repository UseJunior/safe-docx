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

The build pipeline regenerates `src/trust/system-card.md` from OpenSpec traceability and Allure artifacts before rendering.
