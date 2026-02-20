import { describe, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { testAllure } from './testing/allure-test.js';

const TEST_FEATURE = 'add-multi-platform-mcp-discovery';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

describe('OpenSpec traceability: add-multi-platform-mcp-discovery', () => {
  const test = testAllure.epic('OpenSpec Traceability').withLabels({ feature: TEST_FEATURE });

  test.openspec('Gemini CLI discovers SafeDocX via extension manifest')(
    'Scenario: Gemini CLI discovers SafeDocX via extension manifest',
    async () => {
      const manifestPath = path.join(REPO_ROOT, 'gemini-extension.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.mcpServers).toBeDefined();
      expect(manifest.mcpServers['safe-docx']).toBeDefined();
      expect(manifest.mcpServers['safe-docx'].command).toBe('npx');
      expect(manifest.mcpServers['safe-docx'].args).toContain('@usejunior/safe-docx');
    },
  );

  test.openspec('Extension manifest is valid JSON with required fields')(
    'Scenario: Extension manifest is valid JSON with required fields',
    async () => {
      const manifestPath = path.join(REPO_ROOT, 'gemini-extension.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      expect(manifest.name).toBe('safe-docx');
      expect(manifest.version).toBeDefined();
      expect(manifest.description).toBeDefined();
      expect(manifest.mcpServers).toBeDefined();

      const server = manifest.mcpServers['safe-docx'];
      expect(server.command).toBeDefined();
      expect(server.args).toBeDefined();
    },
  );

  test.openspec('AI agent configures SafeDocX from install guide')(
    'Scenario: AI agent configures SafeDocX from install guide',
    async () => {
      const installGuidePath = path.join(REPO_ROOT, 'packages', 'safe-docx', 'llms-install.md');
      expect(fs.existsSync(installGuidePath)).toBe(true);

      const content = fs.readFileSync(installGuidePath, 'utf-8');
      expect(content).toContain('npx');
      expect(content).toContain('@usejunior/safe-docx');
      expect(content).toContain('Claude Desktop');
      expect(content).toContain('Claude Code');
      expect(content).toContain('Gemini CLI');
      expect(content).toContain('Cline');
      expect(content).toContain('Generic MCP Client');
    },
  );

  test.openspec('Gemini model reads context file for tool guidance')(
    'Scenario: Gemini model reads context file for tool guidance',
    async () => {
      const geminiMdPath = path.join(REPO_ROOT, 'GEMINI.md');
      expect(fs.existsSync(geminiMdPath)).toBe(true);

      const content = fs.readFileSync(geminiMdPath, 'utf-8');
      expect(content).toContain('read_file');
      expect(content).toContain('smart_edit');
      expect(content).toContain('download');
      expect(content).toContain('local');
      expect(content).toContain('Trust Boundary');
    },
  );
});
