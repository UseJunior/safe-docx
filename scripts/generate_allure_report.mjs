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

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!SECURITY_PROFILES.has(parsed.securityProfile)) {
    throw new Error(
      `Unsupported security profile '${parsed.securityProfile}'. Expected one of: ${Array.from(SECURITY_PROFILES).join(', ')}`,
    );
  }

  return parsed;
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
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      continue;
    }

    const files = fs.readdirSync(candidate).filter((name) => name.endsWith('.json') || name.endsWith('.txt'));
    if (files.length === 0) {
      continue;
    }

    directories.push(candidate);
  }

  return directories.sort();
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
  const { outputDir, groupBy, securityProfile } = parseArgs(process.argv.slice(2));
  const grouping = normalizeGroupBy(groupBy);
  const resultsDirs = discoverResultsDirectories();

  if (resultsDirs.length === 0) {
    throw new Error('No non-empty allure-results directories found under packages/.');
  }
  if (!fs.existsSync(BRAND_LOGO_SOURCE)) {
    throw new Error(`Missing logo asset: ${BRAND_LOGO_SOURCE}`);
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
