#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const ICON_SOURCE = path.join(SCRIPT_DIR, 'assets', 'safe-docx-mark.svg');
const BRANDING_START = '<!-- safe-docx-branding:start -->';
const BRANDING_END = '<!-- safe-docx-branding:end -->';
const LEGACY_ICON_ID = '#4af8011a58a597dd8fd8c52187120c54';

function parseArgs(argv) {
  const out = { reportDirs: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--report-dir' && argv[i + 1]) {
      out.reportDirs.push(argv[++i]);
      continue;
    }
    if (arg.startsWith('--report-dir=')) {
      out.reportDirs.push(arg.slice('--report-dir='.length));
      continue;
    }
  }
  if (out.reportDirs.length === 0) {
    out.reportDirs = ['allure-report-repo'];
  }
  out.reportDirs = [...new Set(out.reportDirs)];
  return out;
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, value) {
  fs.writeFileSync(filePath, value, 'utf8');
}

function stripBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return text;
  const end = text.indexOf(endMarker, start);
  if (end === -1) return text;
  const removeUntil = end + endMarker.length;
  return `${text.slice(0, start)}${text.slice(removeUntil)}`;
}

function stripLegacyManualBranding(text) {
  let next = text;
  next = next.replace(
    /\s*<script>\s*\(\(\)\s*=>\s*\{[\s\S]*?const TARGET_ID = "#4af8011a58a597dd8fd8c52187120c54"[\s\S]*?\}\)\(\);\s*<\/script>\s*/g,
    '\n',
  );
  next = next.replace(
    /\s*<style>\s*:root[\s\S]*?svg\[data-brand-icon-patched="1"\]\s*\{[\s\S]*?\}\s*<\/style>\s*/g,
    '\n',
  );
  return next;
}

function upsertFaviconLinks(html, iconFileWithVersion) {
  let next = html
    .replace(/\s*<link rel="icon"[^>]*>\s*/g, '\n')
    .replace(/\s*<link rel="shortcut icon"[^>]*>\s*/g, '\n');

  const titleRe = /<title>[\s\S]*?<\/title>/;
  if (!titleRe.test(next)) return next;

  const insert = [
    '<title> SafeDocX Quality Report </title>',
    `    <link rel="icon" type="image/svg+xml" href="./${iconFileWithVersion}" />`,
    `    <link rel="shortcut icon" href="./${iconFileWithVersion}" />`,
  ].join('\n');

  next = next.replace(titleRe, insert);
  return next;
}

function updateAllureOptions(html, iconFileWithVersion) {
  const match = html.match(/window\.allureReportOptions\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!match) return html;

  let options;
  try {
    options = JSON.parse(match[1]);
  } catch {
    return html;
  }

  options.reportName = 'SafeDocX Quality Report (Preview)';
  options.logo = `./${iconFileWithVersion}`;
  options.theme = 'light';

  return html.replace(match[1], JSON.stringify(options));
}

function makeBrandingBlock(iconFileWithVersion) {
  return `
${BRANDING_START}
    <script>
      (() => {
        const ICON_URL = "./${iconFileWithVersion}";
        const LEGACY_ICON_ID = "${LEGACY_ICON_ID}";

        const patchSvgWithBrand = (svg) => {
          if (!svg) return;
          if (svg.dataset.brandIconPatched === "1") return;
          svg.dataset.brandIconPatched = "1";
          svg.style.background = \`url("\${ICON_URL}") center / contain no-repeat\`;
          const useEl = svg.querySelector("use");
          if (useEl) {
            useEl.setAttribute("href", "#");
            useEl.setAttribute("xlink:href", "#");
            useEl.style.display = "none";
          }
        };

        const patchReportIcons = () => {
          const legacySelectors = [
            \`use[href="\${LEGACY_ICON_ID}"]\`,
            \`use[xlink\\\\:href="\${LEGACY_ICON_ID}"]\`,
          ];
          document.querySelectorAll(legacySelectors.join(",")).forEach((useEl) => {
            if (useEl.closest(".fma_u1MG")) return;
            patchSvgWithBrand(useEl.closest("svg"));
          });

          document.querySelectorAll("button, [role='menuitem']").forEach((el) => {
            if (!/SafeDocX/.test(el.textContent || "")) return;
            patchSvgWithBrand(el.querySelector("svg"));
          });
        };

        const patchLastUpdatedLabel = () => {
          document.querySelectorAll("span").forEach((el) => {
            if (el.dataset.lastUpdatedPatched === "1") return;
            const versionChild = Array.from(el.children).find((child) =>
              child.tagName === "SPAN" && /Ver:\\s*\\d+\\.\\d+\\.\\d+/.test(child.textContent || "")
            );
            if (!versionChild) return;
            const firstNode = el.childNodes[0];
            if (!firstNode || firstNode.nodeType !== Node.TEXT_NODE) return;
            const currentText = firstNode.textContent || "";
            if (/Last Updated:/.test(currentText)) {
              el.dataset.lastUpdatedPatched = "1";
              return;
            }
            firstNode.textContent = \`Last Updated: \${currentText.trim()}\`;
            el.dataset.lastUpdatedPatched = "1";
          });
        };

        const hideThemeToggle = () => {
          document.querySelectorAll("button").forEach((btn) => {
            const label = (btn.getAttribute("aria-label") || "").toLowerCase();
            if (/theme|dark|light/.test(label)) {
              btn.style.display = "none";
            }
          });
        };

        const runPatches = () => {
          patchReportIcons();
          patchLastUpdatedLabel();
          hideThemeToggle();
        };

        const observer = new MutationObserver(() => runPatches());
        observer.observe(document.documentElement, { childList: true, subtree: true });

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", runPatches);
        } else {
          runPatches();
        }
      })();
    </script>
    <style>
      :root,
      :root:not([data-theme=dark]),
      :root[data-theme=light] {
        --on-border-primary: rgba(5, 28, 73, 0.26);
        --on-border-muted: rgba(5, 28, 73, 0.14);
        --bg-base-secondary: #ddccba !important;
        --bg-base-neutral: #ddccba !important;
        --bg-base-primary: #fffaf3 !important;
      }

      body {
        background:
          radial-gradient(1200px 700px at 80% -20%, rgba(212, 115, 84, 0.24), rgba(246, 243, 238, 0)),
          radial-gradient(900px 540px at 5% 5%, rgba(204, 149, 70, 0.19), rgba(246, 243, 238, 0)),
          #ddccba !important;
      }

      html,
      body,
      #app,
      .P1qG0zXS,
      .q6NnC3sf,
      .s5e3ntNr,
      .X1bxR0kX {
        background-color: #ddccba !important;
      }

      #app,
      #app .X1bxR0kX,
      #app .q6NnC3sf,
      #app .s5e3ntNr,
      #app .OyL7dy7N,
      #app .t22uAI7s,
      #app .sgMxjSNq {
        --bg-base-secondary: #ddccba !important;
        --bg-base-neutral: #ddccba !important;
        --bg-base-primary: #fffaf3 !important;
        background-color: #ddccba !important;
      }

      div:has(> img[src*="${iconFileWithVersion}"]) {
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        padding: 0 !important;
      }

      img[src*="${iconFileWithVersion}"] {
        object-fit: contain !important;
      }

      .fma_u1MG svg,
      .fma_u1MG .styles_logo__jHlBl {
        display: none !important;
      }

      /* Keep dark mode disabled in branded report */
      button[aria-label*="theme" i],
      button[aria-label*="dark" i],
      button[aria-label*="light" i] {
        display: none !important;
      }

      /* Unify code block palette for markdown blocks and JSON attachment blocks */
      pre,
      pre code,
      pre[data-testid="code-attachment-content"],
      pre[data-testid="code-attachment-content"] code,
      pre[class*="language-"],
      pre[class*="language-"] code {
        background: #f6efe3 !important;
        color: #2f2a24 !important;
      }

      /* Fallback in case runtime patch hasn't executed yet */
      use[href="${LEGACY_ICON_ID}"],
      use[xlink\\:href="${LEGACY_ICON_ID}"] {
        display: none !important;
      }

      svg[data-brand-icon-patched="1"] {
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;
        min-height: 28px !important;
        background-size: 100% 100% !important;
      }
    </style>
${BRANDING_END}
`.trim();
}

function patchReportJs(reportDir) {
  const names = fs.readdirSync(reportDir);
  for (const fileName of names) {
    if (!/\.app-.*\.js$/.test(fileName)) continue;
    const filePath = path.join(reportDir, fileName);
    const raw = readUtf8(filePath);
    const patched = raw.replace(/"sections":\{"report":"Report"/g, '"sections":{"report":"SafeDocX"');
    if (patched !== raw) {
      writeUtf8(filePath, patched);
    }
  }
}

function patchReportIndex(reportDir, iconFileWithVersion) {
  const indexPath = path.join(reportDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing report index: ${indexPath}`);
  }

  let html = readUtf8(indexPath);
  html = upsertFaviconLinks(html, iconFileWithVersion);
  html = updateAllureOptions(html, iconFileWithVersion);
  html = stripBlock(html, BRANDING_START, BRANDING_END);
  html = stripLegacyManualBranding(html);

  const brandingBlock = makeBrandingBlock(iconFileWithVersion);
  if (!html.includes('</head>')) {
    throw new Error(`Invalid report index (missing </head>): ${indexPath}`);
  }
  html = html.replace('</head>', `${brandingBlock}\n</head>`);
  writeUtf8(indexPath, html);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Report directory not found: ${dirPath}`);
  }
}

function brandReport(reportDirArg) {
  const reportDir = path.resolve(ROOT, reportDirArg);
  ensureDir(reportDir);

  const iconBuffer = fs.readFileSync(ICON_SOURCE);
  const iconHash = crypto.createHash('sha1').update(iconBuffer).digest('hex').slice(0, 8);
  const iconFileName = 'safe-docx-mark.svg';
  const iconVersioned = `${iconFileName}?v=${iconHash}`;

  fs.copyFileSync(ICON_SOURCE, path.join(reportDir, iconFileName));
  patchReportIndex(reportDir, iconVersioned);
  patchReportJs(reportDir);
}

function main() {
  if (!fs.existsSync(ICON_SOURCE)) {
    throw new Error(`Missing icon asset: ${ICON_SOURCE}`);
  }

  const { reportDirs } = parseArgs(process.argv);
  for (const reportDir of reportDirs) {
    brandReport(reportDir);
    process.stdout.write(`Branded Allure report: ${reportDir}\n`);
  }
}

main();
