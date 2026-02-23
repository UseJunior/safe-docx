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
const SECURITY_PROFILES = Object.freeze({
  strict: Object.freeze({
    id: 'strict',
    sandboxValue: 'allow-same-origin',
  }),
});
const DEFAULT_SECURITY_PROFILE = 'strict';

function parseArgs(argv) {
  const out = { reportDirs: [], uxOnly: false, securityProfile: DEFAULT_SECURITY_PROFILE };
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
    if (arg === '--ux-only') {
      out.uxOnly = true;
      continue;
    }
    if (arg === '--security-profile' && argv[i + 1]) {
      out.securityProfile = String(argv[++i]).trim();
      continue;
    }
    if (arg.startsWith('--security-profile=')) {
      out.securityProfile = arg.slice('--security-profile='.length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
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

function resolveSecurityProfile(profileName) {
  const normalized = String(profileName || '').trim().toLowerCase();
  const profile = SECURITY_PROFILES[normalized];
  if (!profile) {
    const available = Object.keys(SECURITY_PROFILES).join(', ');
    throw new Error(`Unknown security profile '${profileName}'. Expected one of: ${available}`);
  }
  return profile;
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

function buildReportJsPatches(securityProfile) {
  const SANITIZED_HTML_RENDERER = 'i=r.length>0?(e=>Wy.sanitize(e,void 0))(r):""';
  const SANITIZED_HTML_RENDERER_ALLOWLIST =
    'i=r.length>0?(e=>Wy.sanitize(e,{WHOLE_DOCUMENT:!0,USE_PROFILES:{html:!0},ADD_TAGS:["html","head","body","style"],ADD_ATTR:["class","style","title"],FORBID_TAGS:["script","iframe","object","embed","form","input","button","textarea","select","option","meta","base","link"]}))(r):""';
  const UNSANITIZED_HTML_RENDERER = 'i=r.length>0?r:""';

  const patches = [
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
      replacement:
        'const p="html"===u&&Ow.html?Ow.html:Nw[u];return p?Tc(p,{attachment:s.value,item:t,i18n:h}):null',
      skipIfContains: '"html"===u&&Ow.html?Ow.html:Nw[u]',
    },
    {
      id: 'sandbox-normalization',
      kind: 'regexReplaceAll',
      find: /sandbox:"allow-same-origin(?: [^"]*)?"/g,
      replacement: `sandbox:"${securityProfile.sandboxValue}"`,
    },
    {
      id: 'enable-html-sanitizer-allowlist',
      kind: 'replaceAll',
      needle: UNSANITIZED_HTML_RENDERER,
      replacement: SANITIZED_HTML_RENDERER_ALLOWLIST,
    },
    {
      id: 'normalize-html-sanitizer-to-allowlist',
      kind: 'replaceAll',
      needle: SANITIZED_HTML_RENDERER,
      replacement: SANITIZED_HTML_RENDERER_ALLOWLIST,
    },
  ];

  return patches;
}

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

  if (patch.kind === 'replaceAll') {
    return source.replaceAll(patch.needle, patch.replacement);
  }

  throw new Error(`Unknown report JS patch kind: ${patch.kind}`);
}

function applyReportJsPatches(source, patches) {
  return patches.reduce((next, patch) => applyReportJsPatch(next, patch), source);
}

function patchReportJs(reportDir, securityProfile) {
  const patches = buildReportJsPatches(securityProfile);
  const names = fs.readdirSync(reportDir);
  for (const fileName of names) {
    if (!/(^|\.)app-.*\.js$/.test(fileName)) continue;
    const filePath = path.join(reportDir, fileName);
    const raw = readUtf8(filePath);
    const patched = applyReportJsPatches(raw, patches);
    if (patched !== raw) {
      writeUtf8(filePath, patched);
    }
  }
}

function patchReportIndex(reportDir, iconFileWithVersion, options) {
  const indexPath = path.join(reportDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing report index: ${indexPath}`);
  }

  let html = readUtf8(indexPath);
  // Always replace the favicon (even in ux-only mode) so the browser tab
  // shows the SafeDocX mark instead of the default Allure logo.
  html = upsertFaviconLinks(html, iconFileWithVersion);
  if (options.applyIdentityBranding) {
    html = updateAllureOptions(html, iconFileWithVersion);
  }
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

function brandReport(reportDirArg, options) {
  const reportDir = path.resolve(ROOT, reportDirArg);
  ensureDir(reportDir);

  const iconFileName = BRANDING_CONFIG.iconFileName;
  const targetIconPath = path.join(reportDir, iconFileName);
  let iconVersioned = iconFileName;

  if (options.applyIdentityBranding) {
    const iconBuffer = fs.readFileSync(ICON_SOURCE);
    const iconHash = crypto.createHash('sha1').update(iconBuffer).digest('hex').slice(0, 8);
    iconVersioned = `${iconFileName}?v=${iconHash}`;
  }

  if (options.applyIdentityBranding || !fs.existsSync(targetIconPath)) {
    fs.copyFileSync(ICON_SOURCE, targetIconPath);
  }

  patchReportIndex(reportDir, iconVersioned, options);
  patchReportJs(reportDir, options.securityProfile);
}

function main() {
  const requiredAssets = [ICON_SOURCE, RUNTIME_TEMPLATE_PATH, THEME_TEMPLATE_PATH];
  for (const assetPath of requiredAssets) {
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Missing branding asset: ${assetPath}`);
    }
  }

  const { reportDirs, uxOnly, securityProfile: securityProfileName } = parseArgs(process.argv);
  const securityProfile = resolveSecurityProfile(securityProfileName);
  const options = {
    applyIdentityBranding: !uxOnly,
    securityProfile,
  };

  for (const reportDir of reportDirs) {
    brandReport(reportDir, options);
    const modeLabel = options.applyIdentityBranding ? 'full' : 'ux-only';
    process.stdout.write(
      `Branded Allure report (${modeLabel}, security=${securityProfile.id}): ${reportDir}\n`,
    );
  }
}

main();
