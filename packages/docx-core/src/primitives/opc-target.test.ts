import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import {
  OpcRelationshipTargetError,
  normalizeOpcRelationshipTarget,
} from './opc-target.js';

const test = testAllure
  .epic('Document Comparison')
  .withLabels({ feature: 'OPC Relationship Target Safety' });

describe('normalizeOpcRelationshipTarget', () => {
  test('normalizes package-relative and package-absolute internal targets', () => {
    expect(normalizeOpcRelationshipTarget({
      ownerPart: 'word/document.xml',
      target: './headers/../header1.xml',
    })).toEqual({ mode: 'Internal', target: 'word/header1.xml' });
    expect(normalizeOpcRelationshipTarget({
      ownerPart: 'word/document.xml',
      target: '/word/header1.xml',
      targetMode: 'Internal',
    })).toEqual({ mode: 'Internal', target: 'word/header1.xml' });
  });

  const unsafeTargets = [
    ['', 'empty_target'],
    ['header.xml?x=1', 'unsafe_target'],
    ['header.xml#x', 'unsafe_target'],
    ['header\u0001.xml', 'unsafe_target'],
    ['headers\\header.xml', 'unsafe_target'],
    ['https:header.xml', 'unsafe_target'],
    ['//server/header.xml', 'unsafe_target'],
    ['%2e%2e/header.xml', 'unsafe_target'],
    ['%252e%252e/header.xml', 'unsafe_target'],
    ['headers%2fheader.xml', 'unsafe_target'],
    ['headers%252fheader.xml', 'unsafe_target'],
    ['headers%5cheader.xml', 'unsafe_target'],
    ['/../../header.xml', 'package_escape'],
  ] as const;
  for (const [target, issue] of unsafeTargets) {
    test(`rejects unsafe internal target ${JSON.stringify(target)}`, () => {
      expect(() => normalizeOpcRelationshipTarget({
        ownerPart: 'word/document.xml',
        target,
      })).toThrowError(expect.objectContaining<Partial<OpcRelationshipTargetError>>({ issue }));
    });
  }

  test('classifies TargetMode exactly and gates external targets', () => {
    expect(() => normalizeOpcRelationshipTarget({
      ownerPart: 'word/document.xml',
      target: 'header.xml',
      targetMode: 'internal',
    })).toThrowError(expect.objectContaining<Partial<OpcRelationshipTargetError>>({
      issue: 'invalid_target_mode',
    }));
    expect(() => normalizeOpcRelationshipTarget({
      ownerPart: 'word/document.xml',
      target: 'https://example.test/header.xml',
      targetMode: 'External',
    })).toThrowError(expect.objectContaining<Partial<OpcRelationshipTargetError>>({
      issue: 'external_target_not_allowed',
    }));
    expect(normalizeOpcRelationshipTarget({
      ownerPart: 'word/document.xml',
      target: 'https://example.test/header.xml',
      targetMode: 'External',
      allowExternal: true,
    })).toEqual({
      mode: 'External',
      target: 'https://example.test/header.xml',
    });
  });
});
