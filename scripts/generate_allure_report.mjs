#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIR = 'allure-report-repo';
const DEFAULT_GROUP_BY = 'epic,feature,suite,story';
const DEFAULT_SECURITY_PROFILE = 'strict';
const MERGED_RESULTS_DIR = '.allure-results-merged';
const LOCAL_ALLURE_BIN = path.join(ROOT, 'node_modules', '.bin', 'allure');
const BRAND_REPORT_NAME = 'SafeDocX Quality Report (Preview)';
const BRAND_THEME = 'light';
const BRAND_LOGO_FILE = 'safe-docx-mark.svg';
const BRAND_LOGO_SOURCE = path.join(ROOT, 'scripts', 'assets', BRAND_LOGO_FILE);
const SECURITY_PROFILES = new Set(['strict']);

function parseArgs(argv) {
  const parsed = {
    outputDir: DEFAULT_OUTPUT_DIR,
    groupBy: DEFAULT_GROUP_BY,
    securityProfile: DEFAULT_SECURITY_PROFILE,
    resultsDirs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--output' && argv[i + 1]) {
      parsed.outputDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      parsed.outputDir = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--group-by' && argv[i + 1]) {
      parsed.groupBy = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--group-by=')) {
      parsed.groupBy = arg.slice('--group-by='.length);
      continue;
    }

    if (arg === '--security-profile' && argv[i + 1]) {
      parsed.securityProfile = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }

    if (arg.startsWith('--security-profile=')) {
      parsed.securityProfile = arg.slice('--security-profile='.length).trim();
      continue;
    }

    if (arg === '--results-dir' && argv[i + 1]) {
      parsed.resultsDirs.push(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--results-dir=')) {
      parsed.resultsDirs.push(arg.slice('--results-dir='.length));
      continue;
    }

    if (arg === '--results-dirs' && argv[i + 1]) {
      parsed.resultsDirs.push(...argv[i + 1].split(','));
      i += 1;
      continue;
    }

    if (arg.startsWith('--results-dirs=')) {
      parsed.resultsDirs.push(...arg.slice('--results-dirs='.length).split(','));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!SECURITY_PROFILES.has(parsed.securityProfile)) {
    throw new Error(
      `Unsupported security profile '${parsed.securityProfile}'. Expected one of: ${Array.from(SECURITY_PROFILES).join(', ')}`,
    );
  }

  return parsed;
}

function hasResultFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return false;
  }
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json') || name.endsWith('.txt'));
  return files.length > 0;
}

function normalizeGroupBy(rawValue) {
  const parts = String(rawValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Grouping labels cannot be empty.');
  }

  return [...new Set(parts)];
}

function discoverResultsDirectories() {
  const packagesDir = path.join(ROOT, 'packages');
  const directories = [];

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(packagesDir, entry.name, 'allure-results');
    if (!hasResultFiles(candidate)) {
      continue;
    }

    directories.push(candidate);
  }

  return directories.sort();
}

function resolveResultsDirectories(rawDirs) {
  const normalized = [...new Set(
    (rawDirs ?? [])
      .map((value) => String(value).trim())
      .filter(Boolean)
      .map((value) => path.isAbsolute(value) ? value : path.resolve(ROOT, value)),
  )];

  for (const dir of normalized) {
    if (!hasResultFiles(dir)) {
      throw new Error(`Allure results directory is missing or empty: ${dir}`);
    }
  }

  return normalized.sort();
}

function shouldCopyResultFile(name) {
  return (
    name.endsWith('-result.json') ||
    name.endsWith('-container.json') ||
    name.includes('-attachment.') ||
    name === 'environment.properties' ||
    name === 'executor.json'
  );
}

function resolveResultIdentity(result, fallback) {
  const candidates = [
    result?.historyId,
    result?.testCaseId,
    result?.fullName,
    result?.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return fallback;
}

function isNewerResultCandidate(next, current) {
  if (next.start !== current.start) {
    return next.start > current.start;
  }
  if (next.stop !== current.stop) {
    return next.stop > current.stop;
  }
  return next.mtimeMs > current.mtimeMs;
}

function collectAttachmentSources(node, accumulator) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectAttachmentSources(item, accumulator);
    }
    return;
  }

  if (Array.isArray(node.attachments)) {
    for (const attachment of node.attachments) {
      if (
        attachment
        && typeof attachment === 'object'
        && typeof attachment.source === 'string'
        && attachment.source.includes('-attachment.')
      ) {
        accumulator.add(attachment.source);
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      collectAttachmentSources(value, accumulator);
    }
  }
}

function pruneResultsDirectory(resultsDir) {
  const entries = fs.readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const resultFiles = entries.filter((name) => name.endsWith('-result.json'));
  if (resultFiles.length === 0) {
    return {
      dir: resultsDir,
      removedResults: 0,
      removedContainers: 0,
      removedAttachments: 0,
      keptResults: 0,
      parseFailures: 0,
    };
  }

  const bestByIdentity = new Map();
  const keepResultFiles = new Set();
  let parseFailures = 0;

  for (const fileName of resultFiles) {
    const filepath = path.join(resultsDir, fileName);
    let result;
    try {
      result = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
      // Keep malformed files to avoid destructive pruning when parsing fails.
      keepResultFiles.add(fileName);
      parseFailures += 1;
      continue;
    }

    const identity = resolveResultIdentity(result, fileName);
    const stat = fs.statSync(filepath);
    const candidate = {
      fileName,
      result,
      start: Number(result?.start) || 0,
      stop: Number(result?.stop) || 0,
      mtimeMs: stat.mtimeMs,
    };

    const current = bestByIdentity.get(identity);
    if (!current || isNewerResultCandidate(candidate, current)) {
      bestByIdentity.set(identity, candidate);
    }
  }

  for (const candidate of bestByIdentity.values()) {
    keepResultFiles.add(candidate.fileName);
  }

  let removedResults = 0;
  for (const fileName of resultFiles) {
    if (keepResultFiles.has(fileName)) {
      continue;
    }
    fs.rmSync(path.join(resultsDir, fileName), { force: true });
    removedResults += 1;
  }

  const keepContainerFiles = new Set();
  const attachmentSources = new Set();

  for (const fileName of keepResultFiles) {
    const filepath = path.join(resultsDir, fileName);
    try {
      const result = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      collectAttachmentSources(result, attachmentSources);

      const uuid = typeof result?.uuid === 'string' && result.uuid.trim().length > 0
        ? result.uuid.trim()
        : typeof result?.id === 'string' && result.id.trim().length > 0
          ? result.id.trim()
          : null;
      if (uuid) {
        keepContainerFiles.add(`${uuid}-container.json`);
      }
    } catch {
      // Ignore parse errors here: the result file remains and will still be copied.
    }
  }

  for (const containerName of keepContainerFiles) {
    const filepath = path.join(resultsDir, containerName);
    if (!fs.existsSync(filepath)) {
      continue;
    }
    try {
      const container = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      collectAttachmentSources(container, attachmentSources);
    } catch {
      // Keep malformed container files untouched.
    }
  }

  const containerFiles = entries.filter((name) => name.endsWith('-container.json'));
  let removedContainers = 0;
  if (parseFailures === 0) {
    for (const fileName of containerFiles) {
      if (keepContainerFiles.has(fileName)) {
        continue;
      }
      fs.rmSync(path.join(resultsDir, fileName), { force: true });
      removedContainers += 1;
    }
  }

  const attachmentFiles = entries.filter((name) => name.includes('-attachment.'));
  let removedAttachments = 0;
  for (const fileName of attachmentFiles) {
    if (attachmentSources.has(fileName)) {
      continue;
    }
    fs.rmSync(path.join(resultsDir, fileName), { force: true });
    removedAttachments += 1;
  }

  return {
    dir: resultsDir,
    removedResults,
    removedContainers,
    removedAttachments,
    keptResults: keepResultFiles.size,
    parseFailures,
  };
}

function mergeResultsDirectories(resultsDirs) {
  const mergedDir = path.join(ROOT, MERGED_RESULTS_DIR);
  fs.rmSync(mergedDir, { recursive: true, force: true });
  fs.mkdirSync(mergedDir, { recursive: true });

  for (const dir of resultsDirs) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !shouldCopyResultFile(entry.name)) {
        continue;
      }

      const srcPath = path.join(dir, entry.name);
      const destPath = path.join(mergedDir, entry.name);

      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        continue;
      }

      const srcBytes = fs.readFileSync(srcPath);
      const destBytes = fs.readFileSync(destPath);
      if (!srcBytes.equals(destBytes)) {
        throw new Error(
          `Allure results collision for '${entry.name}'. Re-run package tests to refresh UUID-based filenames.`,
        );
      }
    }
  }

  return mergedDir;
}

function runCommand(command, args) {
  const resolvedCommand =
    command === 'allure' && fs.existsSync(LOCAL_ALLURE_BIN) ? LOCAL_ALLURE_BIN : command;
  execFileSync(resolvedCommand, args, {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function main() {
  const { outputDir, groupBy, securityProfile, resultsDirs: requestedResultsDirs } = parseArgs(process.argv.slice(2));
  const grouping = normalizeGroupBy(groupBy);
  const resultsDirs = requestedResultsDirs.length > 0
    ? resolveResultsDirectories(requestedResultsDirs)
    : discoverResultsDirectories();

  if (resultsDirs.length === 0) {
    throw new Error('No non-empty allure-results directories found under packages/.');
  }
  if (!fs.existsSync(BRAND_LOGO_SOURCE)) {
    throw new Error(`Missing logo asset: ${BRAND_LOGO_SOURCE}`);
  }

  const pruneSummary = resultsDirs.map((resultsDir) => pruneResultsDirectory(resultsDir));
  const removedTotal = pruneSummary.reduce(
    (sum, item) => sum + item.removedResults + item.removedContainers + item.removedAttachments,
    0,
  );
  if (removedTotal > 0) {
    const details = pruneSummary
      .filter((item) => item.removedResults > 0 || item.removedContainers > 0 || item.removedAttachments > 0)
      .map((item) => {
        const relativeDir = path.relative(ROOT, item.dir);
        return `${relativeDir}: -${item.removedResults} result, -${item.removedContainers} container, -${item.removedAttachments} attachment`;
      })
      .join('; ');
    console.log(`Pruned stale Allure artifacts before merge (${removedTotal} files). ${details}`);
  }

  const mergedResultsDir = mergeResultsDirectories(resultsDirs);
  const outputPath = path.join(ROOT, outputDir);
  fs.rmSync(outputPath, { recursive: true, force: true });

  const allureArgs = [
    'awesome',
    path.relative(ROOT, mergedResultsDir),
    '--output',
    outputDir,
    '--report-name',
    BRAND_REPORT_NAME,
    '--theme',
    BRAND_THEME,
    '--logo',
    `./${BRAND_LOGO_FILE}`,
    '--group-by',
    grouping.join(','),
  ];

  runCommand('allure', allureArgs);
  fs.copyFileSync(BRAND_LOGO_SOURCE, path.join(outputPath, BRAND_LOGO_FILE));
  runCommand('node', [
    'scripts/brand_allure_report.mjs',
    '--report-dir',
    outputDir,
    '--ux-only',
    '--security-profile',
    securityProfile,
  ]);

  console.log(
    `Generated Allure report at ${outputDir} grouped by ${grouping.join(' > ')} (security profile: ${securityProfile})`,
  );
}

main();
