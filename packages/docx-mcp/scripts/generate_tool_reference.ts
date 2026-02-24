import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAFE_DOCX_MCP_TOOLS } from '../src/tool_catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const outputPath = path.join(packageRoot, 'docs', 'tool-reference.generated.md');

type JsonSchema = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function getTypeLabel(schema: JsonSchema): string {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;
  if (enumValues && enumValues.length > 0) {
    return `enum(${enumValues.map((v) => JSON.stringify(v)).join(', ')})`;
  }
  const typeValue = typeof schema.type === 'string' ? schema.type : null;
  if (typeValue === 'array') {
    const items = asObject(schema.items);
    const itemType = items ? getTypeLabel(items) : 'unknown';
    return `array<${itemType}>`;
  }
  if (typeValue === 'object') {
    return 'object';
  }
  return typeValue ?? 'unknown';
}

function renderToolSection(tool: {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
}): string {
  const inputSchema = asObject(tool.inputSchema) ?? {};
  const properties = asObject(inputSchema.properties) ?? {};
  const required = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((v): v is string => typeof v === 'string')
      : [],
  );

  const rows = Object.entries(properties).map(([name, rawSchema]) => {
    const schema = asObject(rawSchema) ?? {};
    const description = typeof schema.description === 'string' ? schema.description : '';
    return `| \`${name}\` | \`${getTypeLabel(schema)}\` | ${required.has(name) ? 'yes' : 'no'} | ${description} |`;
  });

  const table =
    rows.length > 0
      ? ['| Field | Type | Required | Notes |', '| --- | --- | --- | --- |', ...rows].join('\n')
      : '_No input fields._';

  return [
    `## \`${tool.name}\``,
    '',
    tool.description,
    '',
    `- readOnly: \`${tool.annotations.readOnlyHint}\``,
    `- destructive: \`${tool.annotations.destructiveHint}\``,
    '',
    table,
    '',
  ].join('\n');
}

function renderDocument(): string {
  const sections = SAFE_DOCX_MCP_TOOLS.map((tool) => renderToolSection(tool));
  return [
    '# Safe Docx Tool Reference (Generated)',
    '',
    'This file is generated from `src/tool_catalog.ts`.',
    'Do not edit manually. Regenerate with:',
    '',
    '`npm run docs:generate:tools -w @usejunior/safe-docx`',
    '',
    sections.join('\n'),
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, renderDocument(), 'utf8');
  console.log(`Wrote ${path.relative(packageRoot, outputPath)}`);
}

main().catch((err) => {
  console.error('Failed to generate tool reference:', err);
  process.exit(1);
});
