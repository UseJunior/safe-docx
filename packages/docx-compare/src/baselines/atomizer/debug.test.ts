/**
 * Regression tests for the comparison debug logger (issue #820).
 *
 * The comparison library runs inside the safe-docx MCP server, which speaks
 * newline-delimited JSON-RPC over stdio: anything a library writes to stdout
 * corrupts the protocol stream. Issue #783 was an unconditional atomizer emit;
 * issue #820 found that the opt-in DOCX_COMPARISON_DEBUG diagnostics still
 * went through console.log — so a user enabling the variable documented in
 * debug.ts's own header broke their MCP session. These tests pin ALL logger
 * output (debug, warn, error) to stderr-backed console methods and would fail
 * if any level were routed back to console.log.
 */
import { describe, expect, vi, afterEach } from 'vitest';
import { testAllure, type AllureBddContext } from '../../testing/allure-test.js';
import { debug, warn, error } from './debug.js';

const test = testAllure.epic('Document Comparison').withLabels({
  feature: 'Comparison Debug Logger Stream Routing',
});

function spyOnConsole() {
  return {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

describe('comparison debug logger stream routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test('enabled debug diagnostics go to stderr, never stdout', async ({ given, when, then }: AllureBddContext) => {
    let spies: ReturnType<typeof spyOnConsole>;

    await given('DOCX_COMPARISON_DEBUG is enabled', () => {
      vi.stubEnv('DOCX_COMPARISON_DEBUG', '1');
      spies = spyOnConsole();
    });

    await when('a debug message is logged with and without data', () => {
      debug('hierarchicalLcs', '54 original groups (24 empty)');
      debug('hierarchicalLcs', 'alignment detail', { groups: 54 });
    });

    await then('both emits use console.error and console.log is untouched', () => {
      expect(spies.error).toHaveBeenCalledTimes(2);
      expect(spies.error.mock.calls[0]![0]).toContain('[DEBUG] [hierarchicalLcs] 54 original groups (24 empty)');
      expect(spies.error.mock.calls[1]![1]).toEqual({ groups: 54 });
      expect(spies.log).not.toHaveBeenCalled();
    });
  });

  test('disabled debug emits nothing on any stream', async ({ given, when, then }: AllureBddContext) => {
    let spies: ReturnType<typeof spyOnConsole>;

    await given('DOCX_COMPARISON_DEBUG is unset', () => {
      vi.stubEnv('DOCX_COMPARISON_DEBUG', '');
      spies = spyOnConsole();
    });

    await when('a debug message is logged', () => {
      debug('hierarchicalLcs', 'should be suppressed');
    });

    await then('no console method is called', () => {
      expect(spies.log).not.toHaveBeenCalled();
      expect(spies.warn).not.toHaveBeenCalled();
      expect(spies.error).not.toHaveBeenCalled();
    });
  });

  test('module filtering still gates debug output', async ({ given, when, then }: AllureBddContext) => {
    let spies: ReturnType<typeof spyOnConsole>;

    await given('DOCX_COMPARISON_DEBUG names one module', () => {
      vi.stubEnv('DOCX_COMPARISON_DEBUG', 'atomLcs');
      spies = spyOnConsole();
    });

    await when('two modules log debug messages', () => {
      debug('atomLcs', 'enabled module');
      debug('hierarchicalLcs', 'disabled module');
    });

    await then('only the named module reaches stderr', () => {
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.error.mock.calls[0]![0]).toContain('[atomLcs] enabled module');
      expect(spies.log).not.toHaveBeenCalled();
    });
  });

  test('warn and error levels keep their stderr-backed streams', async ({ given, when, then }: AllureBddContext) => {
    let spies: ReturnType<typeof spyOnConsole>;

    await given('console spies with debug disabled', () => {
      vi.stubEnv('DOCX_COMPARISON_DEBUG', '');
      spies = spyOnConsole();
    });

    await when('warn and error messages are logged', () => {
      warn('inPlaceModifier', 'target paragraph is null', { atom: 3 });
      error('documentReconstructor', 'reconstruction failed');
    });

    await then('warn uses console.warn, error uses console.error, and stdout stays clean', () => {
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.warn.mock.calls[0]![0]).toContain('[WARN] [inPlaceModifier] target paragraph is null');
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.error.mock.calls[0]![0]).toContain('[ERROR] [documentReconstructor] reconstruction failed');
      expect(spies.log).not.toHaveBeenCalled();
    });
  });
});
