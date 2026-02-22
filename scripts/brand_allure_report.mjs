#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const ICON_SOURCE = path.join(SCRIPT_DIR, 'assets', 'safe-docx-mark.svg');
const BRANDING_TEMPLATE_DIR = path.join(SCRIPT_DIR, 'branding');
const RUNTIME_TEMPLATE_PATH = path.join(BRANDING_TEMPLATE_DIR, 'runtime.template.js');
const THEME_TEMPLATE_PATH = path.join(BRANDING_TEMPLATE_DIR, 'theme.template.css');
const BRANDING_START = '<!-- safe-docx-branding:start -->';
const BRANDING_END = '<!-- safe-docx-branding:end -->';
const LEGACY_ICON_ID = '#4af8011a58a597dd8fd8c52187120c54';
const BRANDING_CONFIG = Object.freeze({
  reportSectionLabel: 'SafeDocX',
  reportName: 'SafeDocX Quality Report (Preview)',
  iconFileName: 'safe-docx-mark.svg',
});

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
    out.reportDirs = ['allure-report-pilot'];
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

  options.reportName = BRANDING_CONFIG.reportName;
  options.logo = `./${iconFileWithVersion}`;
  options.theme = 'light';

  return html.replace(match[1], JSON.stringify(options));
}

let cachedBrandingTemplates = null;

function loadBrandingTemplates() {
  if (cachedBrandingTemplates) {
    return cachedBrandingTemplates;
  }

  cachedBrandingTemplates = {
    runtime: readUtf8(RUNTIME_TEMPLATE_PATH).trim(),
    theme: readUtf8(THEME_TEMPLATE_PATH).trim(),
  };
  return cachedBrandingTemplates;
}

function renderTemplate(template, replacements) {
  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.replaceAll(token, value);
  }
  return output;
}

function indentBlock(text, spaces) {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

function makeBrandingBlock(iconFileWithVersion) {
  const templates = loadBrandingTemplates();
  const runtime = renderTemplate(templates.runtime, {
    '__ICON_URL_JSON__': JSON.stringify(`./${iconFileWithVersion}`),
    '__LEGACY_ICON_ID_JSON__': JSON.stringify(LEGACY_ICON_ID),
  });
  const theme = renderTemplate(templates.theme, {
    '__ICON_FILE_WITH_VERSION__': iconFileWithVersion,
    '__LEGACY_ICON_ID__': LEGACY_ICON_ID,
  });

  return [
    BRANDING_START,
    '    <script>',
    indentBlock(runtime, 6),
    '    </script>',
    '    <style>',
    indentBlock(theme, 6),
    '    </style>',
    BRANDING_END,
  ].join('\n');
}
// Declarative JS bundle patch list to keep downstream Allure tweaks explicit and reorderable.
const REPORT_JS_PATCHES = [
  {
    id: 'rename-report-section',
    kind: 'regexReplaceAll',
    find: /"sections":\{"report":"Report"/g,
    replacement: `"sections":{"report":"${BRANDING_CONFIG.reportSectionLabel}"`,
  },
  {
    id: 'inline-preview-for-rich-attachments',
    kind: 'replaceOnceIfPresentAndMissing',
    needle: 'children:V2(Rw,{item:e,i18n:{imageDiff:e=>i(`imageDiff.${e}`)}})',
    replacement:
      'children:V2(Rw,{item:e,previewable:"html"===s||"svg"===s||"image"===s,i18n:{imageDiff:e=>i(`imageDiff.${e}`)}})',
    skipIfContains: 'previewable:"html"===s||"svg"===s||"image"===s',
  },
  {
    id: 'html-fallback-renderer',
    kind: 'replaceOnceIfPresentAndMissing',
    needle: 'const p=Nw[u];return p?Tc(p,{attachment:s.value,item:t,i18n:h}):null',
    replacement: 'const p="html"===u&&Ow.html?Ow.html:Nw[u];return p?Tc(p,{attachment:s.value,item:t,i18n:h}):null',
    skipIfContains: '"html"===u&&Ow.html?Ow.html:Nw[u]',
  },
  {
    id: 'disable-html-sanitizer',
    kind: 'replaceOnceIfPresentAndMissing',
    needle: 'i=r.length>0?(e=>Wy.sanitize(e,void 0))(r):""',
    replacement: 'i=r.length>0?r:""',
    skipIfContains: 'i=r.length>0?r:""',
  },
  {
    id: 'iframe-sandbox-open-links',
    kind: 'replaceAllIfPresentAndMissing',
    needle: 'sandbox:"allow-same-origin"',
    replacement:
      'sandbox:"allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-downloads"',
    skipIfContains: 'allow-popups-to-escape-sandbox',
  },
];

function applyReportJsPatch(source, patch) {
  if (patch.skipIfContains && source.includes(patch.skipIfContains)) {
    return source;
  }

  if (patch.kind === 'regexReplaceAll') {
    return source.replace(patch.find, patch.replacement);
  }

  if (!source.includes(patch.needle)) {
    return source;
  }

  if (patch.kind === 'replaceOnceIfPresentAndMissing') {
    return source.replace(patch.needle, patch.replacement);
  }

  if (patch.kind === 'replaceAllIfPresentAndMissing') {
    return source.replaceAll(patch.needle, patch.replacement);
  }

  throw new Error(`Unknown report JS patch kind: ${patch.kind}`);
}

function applyReportJsPatches(source) {
  return REPORT_JS_PATCHES.reduce((next, patch) => applyReportJsPatch(next, patch), source);
}

function patchReportJs(reportDir) {
  const names = fs.readdirSync(reportDir);
  for (const fileName of names) {
    if (!/(^|\.)app-.*\.js$/.test(fileName)) continue;
    const filePath = path.join(reportDir, fileName);
    const raw = readUtf8(filePath);
    const patched = applyReportJsPatches(raw);
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
  const iconFileName = BRANDING_CONFIG.iconFileName;
  const iconVersioned = `${iconFileName}?v=${iconHash}`;

  fs.copyFileSync(ICON_SOURCE, path.join(reportDir, iconFileName));
  patchReportIndex(reportDir, iconVersioned);
  patchReportJs(reportDir);
}

function main() {
  const requiredAssets = [ICON_SOURCE, RUNTIME_TEMPLATE_PATH, THEME_TEMPLATE_PATH];
  for (const assetPath of requiredAssets) {
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Missing branding asset: ${assetPath}`);
    }
  }

  const { reportDirs } = parseArgs(process.argv);
  for (const reportDir of reportDirs) {
    brandReport(reportDir);
    process.stdout.write(`Branded Allure report: ${reportDir}\n`);
  }
}

main();
