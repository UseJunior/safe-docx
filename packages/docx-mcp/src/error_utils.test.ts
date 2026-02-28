import { describe, expect } from 'vitest';
import { itAllure as it } from './testing/allure-test.js';
import { errorMessage, errorCode } from './error_utils.js';

describe('errorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('extracts message from object with message property', () => {
    expect(errorMessage({ message: 'oops' })).toBe('oops');
  });

  it('returns String(value) for string input', () => {
    expect(errorMessage('plain string')).toBe('plain string');
  });

  it('returns String(value) for null', () => {
    expect(errorMessage(null)).toBe('null');
  });

  it('returns String(value) for undefined', () => {
    expect(errorMessage(undefined)).toBe('undefined');
  });

  it('returns String(value) for number', () => {
    expect(errorMessage(42)).toBe('42');
  });

  it('ignores non-string message property', () => {
    expect(errorMessage({ message: 123 })).toBe('[object Object]');
  });

  it('handles Error subclass', () => {
    expect(errorMessage(new TypeError('bad type'))).toBe('bad type');
  });
});

describe('errorCode', () => {
  it('extracts string code from object', () => {
    expect(errorCode({ code: 'ENOENT' })).toBe('ENOENT');
  });

  it('extracts code from Error with code property', () => {
    const err = new Error('fail');
    (err as unknown as Record<string, unknown>).code = 'CUSTOM_CODE';
    expect(errorCode(err)).toBe('CUSTOM_CODE');
  });

  it('returns undefined for object without code', () => {
    expect(errorCode({ message: 'no code here' })).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(errorCode(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(errorCode(undefined)).toBeUndefined();
  });

  it('returns undefined for non-string code', () => {
    expect(errorCode({ code: 404 })).toBeUndefined();
  });

  it('returns undefined for primitive string', () => {
    expect(errorCode('just a string')).toBeUndefined();
  });
});
