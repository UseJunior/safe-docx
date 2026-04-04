#!/usr/bin/env node
// check_gemini_extension_manifest.mjs — Validate gemini-extension.json contract

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function readJson(relPath) {
  const abs = join(ROOT, relPath);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

let ok = true;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  ok = false;
}

// ── Load manifest ──────────────────────────────────────────────────────

const manifest = readJson('gemini-extension.json');

// ── Required top-level fields ──────────────────────────────────────────

const REQUIRED_FIELDS = ['name', 'version', 'description', 'contextFileName', 'entrypoint', 'mcpServers'];
for (const field of REQUIRED_FIELDS) {
  if (!(field in manifest)) {
    fail(`Missing required top-level field: "${field}"`);
  }
}

// ── contextFileName must be exactly "GEMINI.md" ────────────────────────

if (manifest.contextFileName !== 'GEMINI.md') {
  fail(`contextFileName must be "GEMINI.md", got "${manifest.contextFileName}"`);
}

// ── entrypoint must be exactly "GEMINI.md" ─────────────────────────────

if (manifest.entrypoint !== 'GEMINI.md') {
  fail(`entrypoint must be "GEMINI.md", got "${manifest.entrypoint}"`);
}

// ── GEMINI.md must exist at repo root ──────────────────────────────────

if (!existsSync(join(ROOT, 'GEMINI.md'))) {
  fail('GEMINI.md file does not exist at repo root');
}

// ── Version must match packages/safe-docx/package.json ─────────────────

const safePkg = readJson('packages/safe-docx/package.json');
if (manifest.version !== safePkg.version) {
  fail(`version "${manifest.version}" does not match packages/safe-docx/package.json version "${safePkg.version}"`);
}

// ── mcpServers["safe-docx"] must exist ─────────────────────────────────

const server = manifest.mcpServers?.['safe-docx'];
if (!server) {
  fail('mcpServers["safe-docx"] is missing');
} else {
  // ── command must be "npx" ────────────────────────────────────────────

  if (server.command !== 'npx') {
    fail(`mcpServers["safe-docx"].command must be "npx", got "${server.command}"`);
  }

  // ── args must be exactly ["-y", "@usejunior/safe-docx"] ──────────────

  const expectedArgs = JSON.stringify(['-y', '@usejunior/safe-docx']);
  const actualArgs = JSON.stringify(server.args);
  if (actualArgs !== expectedArgs) {
    fail(`mcpServers["safe-docx"].args must be ${expectedArgs}, got ${actualArgs}`);
  }

  // ── cwd must NOT be set ──────────────────────────────────────────────

  if ('cwd' in server) {
    fail('mcpServers["safe-docx"].cwd must not be set');
  }
}

// ── Result ─────────────────────────────────────────────────────────────

if (ok) {
  console.log('gemini-extension.json: all checks passed');
  process.exit(0);
} else {
  process.exit(1);
}
