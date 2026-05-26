#!/usr/bin/env node
// generate_tests_corpus_schema.mjs
//
// Generates the checked-in root `tests-corpus.schema.json` artifact used by
// `scripts/build_tests_corpus.mjs`. The narrative tag bounds here are
// character-length constraints for JSON Schema consumers; word-count
// enforcement remains in `@usejunior/test-narrative` via `validateTags`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANONICAL_SECTION_ORDER,
  rejectedAliases,
  tagDefinitions,
} from '../packages/test-narrative/dist/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_SCHEMA = path.join(REPO_ROOT, 'tests-corpus.schema.json');

const TAG_VALUE_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 5000,
};

function sortedObjectEntries(object) {
  return Object.entries(object).sort(([a], [b]) => a.localeCompare(b));
}

export function buildTestsCorpusSchema() {
  const narrativeProperties = Object.fromEntries(
    sortedObjectEntries(tagDefinitions).map(([tagName]) => [tagName, TAG_VALUE_SCHEMA]),
  );

  const rejectedAliasProperties = Object.fromEntries(
    rejectedAliases.map((alias) => [alias, false]),
  );

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://safedocx.com/tests-corpus.schema.json',
    title: 'safe-docx tests corpus',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'generatedAt', 'safeDocxCommit', 'entries'],
    properties: {
      schemaVersion: { const: '1.0.0' },
      generatedAt: { type: 'string', format: 'date-time' },
      safeDocxCommit: {
        type: 'string',
        minLength: 7,
        maxLength: 40,
        pattern: '^[0-9a-f]+$',
      },
      entries: {
        type: 'array',
        items: { $ref: '#/$defs/CorpusEntry' },
      },
    },
    $defs: {
      CorpusEntry: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'package',
          'scenarioName',
          'sourceRef',
          'sections',
          'narrative',
          'scenario',
          'results',
          'conformanceClaims',
        ],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
          },
          package: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
          },
          scenarioName: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
          },
          sourceRef: { $ref: '#/$defs/SourceRef' },
          sections: {
            type: 'array',
            items: { $ref: '#/$defs/SectionIdentifier' },
            uniqueItems: true,
          },
          narrative: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ...narrativeProperties,
              ...rejectedAliasProperties,
            },
          },
          scenario: {
            type: 'object',
            additionalProperties: false,
            required: ['bddSteps', 'fixtures', 'expectArgs'],
            properties: {
              bddSteps: {
                type: 'array',
                items: { $ref: '#/$defs/BddStep' },
              },
              fixtures: {
                type: 'array',
                items: { $ref: '#/$defs/FixtureEvidence' },
              },
              expectArgs: {
                type: 'array',
                items: { $ref: '#/$defs/ExpectArgEvidence' },
              },
            },
          },
          results: { $ref: '#/$defs/TestResult' },
          conformanceClaims: {
            type: 'array',
            items: { $ref: '#/$defs/ConformanceClaim' },
          },
        },
      },
      SourceRef: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'line'],
        properties: {
          path: {
            type: 'string',
            minLength: 1,
            maxLength: 1000,
          },
          line: {
            type: 'integer',
            minimum: 1,
          },
        },
      },
      EvidenceValue: {
        oneOf: [
          { $ref: '#/$defs/LiteralEvidence' },
          { $ref: '#/$defs/UnresolvedEvidence' },
        ],
      },
      LiteralEvidence: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'value'],
        properties: {
          kind: { const: 'literal' },
          value: {},
        },
      },
      UnresolvedEvidence: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'sourceText', 'sourceRef'],
        properties: {
          kind: { const: 'unresolved' },
          sourceText: {
            type: 'string',
            minLength: 1,
            maxLength: 20000,
          },
          sourceRef: { $ref: '#/$defs/SourceRef' },
        },
      },
      BddStep: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'value', 'sourceRef'],
        properties: {
          keyword: {
            enum: ['given', 'when', 'then', 'and'],
          },
          value: { $ref: '#/$defs/EvidenceValue' },
          sourceRef: { $ref: '#/$defs/SourceRef' },
        },
      },
      FixtureEvidence: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value', 'sourceRef'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
          },
          value: { $ref: '#/$defs/EvidenceValue' },
          sourceRef: { $ref: '#/$defs/SourceRef' },
        },
      },
      ExpectArgEvidence: {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'sourceText', 'sourceRef'],
        properties: {
          value: { $ref: '#/$defs/EvidenceValue' },
          sourceText: {
            type: 'string',
            minLength: 1,
            maxLength: 20000,
          },
          sourceRef: { $ref: '#/$defs/SourceRef' },
        },
      },
      TestResult: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'status', 'labels'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
          },
          status: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
          },
          labels: {
            type: 'array',
            items: { $ref: '#/$defs/AllureLabel' },
          },
        },
      },
      AllureLabel: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
          },
          value: {
            type: 'string',
            minLength: 1,
            maxLength: 1000,
          },
        },
      },
      ConformanceClaim: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'spec', 'edition', 'part', 'section', 'title', 'text'],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
          },
          spec: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
          },
          edition: {
            type: 'integer',
            minimum: 1,
          },
          part: {
            type: 'integer',
            minimum: 1,
          },
          section: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
          },
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
          },
          text: {
            type: 'string',
            minLength: 1,
            maxLength: 20000,
          },
        },
      },
      SectionIdentifier: {
        enum: [...CANONICAL_SECTION_ORDER],
      },
    },
  };
}

export function renderTestsCorpusSchema() {
  return `${JSON.stringify(buildTestsCorpusSchema(), null, 2)}\n`;
}

export function writeTestsCorpusSchema() {
  const next = renderTestsCorpusSchema();
  fs.writeFileSync(OUT_SCHEMA, next);
  return OUT_SCHEMA;
}

function main() {
  writeTestsCorpusSchema();
  console.log(`generate_tests_corpus_schema: wrote ${path.relative(REPO_ROOT, OUT_SCHEMA)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
