import { describe, it, expect, vi } from 'vitest';
import { mapGoogleError, calculateBackoffDelay, ERROR_MAP, withRetry } from '../errors.js';
import { GoogleApiError } from '../api-client.js';

const noopSleep = async () => {};

describe('Error Mapping', () => {
  describe('mapGoogleError', () => {
    it('maps 429 to RATE_LIMIT', () => {
      const result = mapGoogleError({ code: 429, message: 'Rate limit exceeded' });
      expect(result.code).toBe('RATE_LIMIT');
      expect(result.mapping?.retry.retriable).toBe(true);
      expect(result.mapping?.sessionAction).toBe('valid');
    });

    it('maps 403 to PERMISSION_DENIED', () => {
      const result = mapGoogleError({ code: 403, message: 'Forbidden' });
      expect(result.code).toBe('PERMISSION_DENIED');
      expect(result.mapping?.retry.retriable).toBe(false);
      expect(result.mapping?.sessionAction).toBe('invalidated');
    });

    it('maps 404 to NOT_FOUND', () => {
      const result = mapGoogleError({ code: 404, message: 'Not found' });
      expect(result.code).toBe('NOT_FOUND');
      expect(result.mapping?.retry.retriable).toBe(false);
      expect(result.mapping?.sessionAction).toBe('invalidated');
    });

    it('maps 400 to INVALID_REQUEST', () => {
      const result = mapGoogleError({ code: 400, message: 'Bad request' });
      expect(result.code).toBe('INVALID_REQUEST');
      expect(result.mapping?.retry.retriable).toBe(false);
    });

    it('maps 409 to REVISION_CONFLICT', () => {
      const result = mapGoogleError({ code: 409, message: 'Conflict' });
      expect(result.code).toBe('REVISION_CONFLICT');
      expect(result.mapping?.retry.retriable).toBe(true);
      expect(result.mapping?.sessionAction).toBe('cache_invalidated');
    });

    it('maps 500 to SERVER_ERROR', () => {
      const result = mapGoogleError({ code: 500, message: 'Internal error' });
      expect(result.code).toBe('SERVER_ERROR');
      expect(result.mapping?.retry.retriable).toBe(true);
    });

    it('maps 503 to SERVER_ERROR', () => {
      const result = mapGoogleError({ code: 503, message: 'Service unavailable' });
      expect(result.code).toBe('SERVER_ERROR');
    });

    it('maps unknown errors to EDIT_ERROR', () => {
      const result = mapGoogleError({ code: 418, message: "I'm a teapot" });
      expect(result.code).toBe('EDIT_ERROR');
      expect(result.mapping).toBeNull();
    });

    it('handles Error instances', () => {
      const result = mapGoogleError(new Error('Something broke'));
      expect(result.message).toBe('Something broke');
    });

    it('handles string errors', () => {
      const result = mapGoogleError('raw error string');
      expect(result.message).toBe('raw error string');
    });

    it('extracts code from response.status', () => {
      const result = mapGoogleError({ response: { status: 429 } });
      expect(result.code).toBe('RATE_LIMIT');
    });

    it('works with GoogleApiError', () => {
      const err = new GoogleApiError(429, 'Rate limited');
      const result = mapGoogleError(err);
      expect(result.code).toBe('RATE_LIMIT');
      expect(result.mapping?.retry.retriable).toBe(true);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('returns base delay for attempt 0', () => {
      const strategy = ERROR_MAP[429].retry;
      const delay = calculateBackoffDelay(0, { ...strategy, useJitter: false });
      expect(delay).toBe(1000);
    });

    it('doubles delay on each attempt', () => {
      const strategy = { ...ERROR_MAP[429].retry, useJitter: false };
      expect(calculateBackoffDelay(1, strategy)).toBe(2000);
      expect(calculateBackoffDelay(2, strategy)).toBe(4000);
      expect(calculateBackoffDelay(3, strategy)).toBe(8000);
    });

    it('caps at maxDelayMs', () => {
      const strategy = { ...ERROR_MAP[429].retry, useJitter: false };
      const delay = calculateBackoffDelay(20, strategy); // Would be huge without cap
      expect(delay).toBe(60000);
    });

    it('adds jitter when enabled (delay <= base)', () => {
      const strategy = ERROR_MAP[429].retry;
      const delays = Array.from({ length: 100 }, () => calculateBackoffDelay(0, strategy));
      const allSame = delays.every(d => d === delays[0]);
      expect(allSame).toBe(false); // With jitter, not all should be the same
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(500); // 0.5 * 1000
        expect(d).toBeLessThanOrEqual(1000); // 1.0 * 1000
      }
    });
  });

  describe('ERROR_MAP completeness', () => {
    it('has entries for all documented HTTP codes', () => {
      expect(ERROR_MAP[429]).toBeDefined();
      expect(ERROR_MAP[403]).toBeDefined();
      expect(ERROR_MAP[404]).toBeDefined();
      expect(ERROR_MAP[400]).toBeDefined();
      expect(ERROR_MAP[409]).toBeDefined();
      expect(ERROR_MAP[500]).toBeDefined();
      expect(ERROR_MAP[503]).toBeDefined();
    });

    it('all retriable entries have positive retry counts', () => {
      for (const entry of Object.values(ERROR_MAP)) {
        if (entry.retry.retriable) {
          expect(entry.retry.maxRetries).toBeGreaterThan(0);
          expect(entry.retry.baseDelayMs).toBeGreaterThan(0);
        }
      }
    });

    it('all non-retriable entries have zero retry counts', () => {
      for (const entry of Object.values(ERROR_MAP)) {
        if (!entry.retry.retriable) {
          expect(entry.retry.maxRetries).toBe(0);
        }
      }
    });
  });

  describe('withRetry per-status maxRetries', () => {
    it('uses ERROR_MAP maxRetries for 429 (5 retries)', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        throw new GoogleApiError(429, 'Rate limited');
      });

      await expect(withRetry(fn, { _sleepFn: noopSleep })).rejects.toThrow('Rate limited');
      // 429 allows 5 retries → 6 total attempts (0..5)
      expect(attempts).toBe(6);
    });

    it('uses ERROR_MAP maxRetries for 409 (3 retries)', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        throw new GoogleApiError(409, 'Conflict');
      });

      await expect(withRetry(fn, { _sleepFn: noopSleep })).rejects.toThrow('Conflict');
      // 409 allows 3 retries → 4 total attempts (0..3)
      expect(attempts).toBe(4);
    });

    it('respects Retry-After header as delay floor', async () => {
      const sleepDelays: number[] = [];
      const trackingSleep = async (ms: number) => { sleepDelays.push(ms); };

      let attempts = 0;
      const headers = new Headers({ 'retry-after': '10' });
      const fn = vi.fn(async () => {
        attempts++;
        throw new GoogleApiError(429, 'Rate limited', undefined, headers);
      });

      await expect(withRetry(fn, { _sleepFn: trackingSleep })).rejects.toThrow('Rate limited');
      expect(attempts).toBe(6); // 429 → 5 retries → 6 attempts
      // Retry-After: 10 = 10000ms. First retry backoff is 1000ms * jitter,
      // so Retry-After (10000ms) should be used as floor for early attempts
      for (const delay of sleepDelays.slice(0, 3)) {
        expect(delay).toBeGreaterThanOrEqual(10000);
      }
    });
  });
});
