import { describe, expect } from 'vitest';
import { MCP_TOOLS } from '../server.js';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';

describe('MCP tool surface naming', () => {
  const test = testAllure.epic('Document Editing').withLabels({ feature: 'MCP tool surface' });

  test('exposes canonical edit tools and removes deprecated names', async ({ given, when, then }: AllureBddContext) => {
    let toolNames: Set<string>;

    await given('the MCP_TOOLS registry is loaded', () => {
      toolNames = new Set<string>(MCP_TOOLS.map((tool) => tool.name));
    });

    await when('the tool name set is inspected', () => {
      // no additional action needed
    });

    await then('canonical tools are present and deprecated names are absent', () => {
      expect(toolNames.has('replace_text')).toBe(true);
      expect(toolNames.has('insert_paragraph')).toBe(true);
      expect(toolNames.has('has_tracked_changes')).toBe(true);
      expect(toolNames.has('open_document')).toBe(false);
      expect(toolNames.has('smart_edit')).toBe(false);
      expect(toolNames.has('smart_insert')).toBe(false);
    });
  });
});
