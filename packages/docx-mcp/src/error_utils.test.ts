import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from './testing/allure-test.js';
import { errorMessage, errorCode } from './error_utils.js';

const test = testAllure.epic('Document Editing').withLabels({ feature: 'Error Utils' });

describe('errorMessage', () => {
  test('extracts message from Error instance', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('an Error instance with message "boom"', () => {});
    when('errorMessage is called', () => { result = errorMessage(new Error('boom')); });
    then('it returns "boom"', () => { expect(result).toBe('boom'); });
  });

  test('extracts message from object with message property', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('an object with message property "oops"', () => {});
    when('errorMessage is called', () => { result = errorMessage({ message: 'oops' }); });
    then('it returns "oops"', () => { expect(result).toBe('oops'); });
  });

  test('returns String(value) for string input', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('a plain string input', () => {});
    when('errorMessage is called', () => { result = errorMessage('plain string'); });
    then('it returns the string as-is', () => { expect(result).toBe('plain string'); });
  });

  test('returns String(value) for null', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('a null input', () => {});
    when('errorMessage is called', () => { result = errorMessage(null); });
    then('it returns "null"', () => { expect(result).toBe('null'); });
  });

  test('returns String(value) for undefined', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('an undefined input', () => {});
    when('errorMessage is called', () => { result = errorMessage(undefined); });
    then('it returns "undefined"', () => { expect(result).toBe('undefined'); });
  });

  test('returns String(value) for number', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('a numeric input of 42', () => {});
    when('errorMessage is called', () => { result = errorMessage(42); });
    then('it returns "42"', () => { expect(result).toBe('42'); });
  });

  test('ignores non-string message property', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('an object with a non-string message property', () => {});
    when('errorMessage is called', () => { result = errorMessage({ message: 123 }); });
    then('it returns "[object Object]"', () => { expect(result).toBe('[object Object]'); });
  });

  test('handles Error subclass', async ({ given, when, then }: AllureBddContext) => {
    let result: string;
    given('a TypeError instance', () => {});
    when('errorMessage is called', () => { result = errorMessage(new TypeError('bad type')); });
    then('it returns the error message', () => { expect(result).toBe('bad type'); });
  });
});

describe('errorCode', () => {
  test('extracts string code from object', async ({ given, when, then }: AllureBddContext) => {
    let result: string | undefined;
    given('an object with code "ENOENT"', () => {});
    when('errorCode is called', () => { result = errorCode({ code: 'ENOENT' }); });
    then('it returns "ENOENT"', () => { expect(result).toBe('ENOENT'); });
  });

  test('extracts code from Error with code property', async ({ given, when, then }: AllureBddContext) => {
    let result: string | undefined;
    let err: Error;
    given('an Error with a custom code property', () => {
      err = new Error('fail');
      (err as unknown as Record<string, unknown>).code = 'CUSTOM_CODE';
    });
    when('errorCode is called', () => { result = errorCode(err); });
    then('it returns the custom code', () => { expect(result).toBe('CUSTOM_CODE'); });
  });

  test('returns undefined for object without code', async ({ given, when, then }: AllureBddContext) => {
    let result: string | undefined;
    given('an object without a code property', () => {});
    when('errorCode is called', () => { result = errorCode({ message: 'no code here' }); });
    then('it returns undefined', () => { expect(result).toBeUndefined(); });
  });

  test('returns undefined for null', async ({ given, when, then }: AllureBddContext) => {
    let result: string | undefined;
    given('a null input', () => {});
    when('errorCode is called', () => { result = errorCode(null); });
    then('it returns undefined', () => { expect(result).toBeUndefined(); });
  });

  test('returns undefined for undefined', async ({ given, when, then }: AllureBddContext) => {
    let result: string | undefined;
    given('an undefined input', () => {});
    when('errorCode is called', () => { result = errorCode(undefined); });
    then('it returns undefined', () => { expect(result).toBeUndefined(); });
  });

  test('returns undefined for non-string code', async ({ given, when, then }: AllureBddContext) => {
    let result: string | undefined;
    given('an object with a numeric code property', () => {});
    when('errorCode is called', () => { result = errorCode({ code: 404 }); });
    then('it returns undefined', () => { expect(result).toBeUndefined(); });
  });

  test('returns undefined for primitive string', async ({ given, when, then }: AllureBddContext) => {
    let result: string | undefined;
    given('a primitive string input', () => {});
    when('errorCode is called', () => { result = errorCode('just a string'); });
    then('it returns undefined', () => { expect(result).toBeUndefined(); });
  });
});
