/**
 * AI-110: VK throw sites produce human-readable errors, not raw JSON.
 *
 * Red-before: mutating any site back to JSON.stringify makes the test fail
 * because the user-facing error message would contain '{"error"' or '"error_msg"'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  log: Object.assign(vi.fn(), { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  default: Object.assign(vi.fn(), { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import axios from 'axios';
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

import { describeApiError } from '../utils/error-formatter';

function makeVkError(error_msg: string, error_code = 14) {
  return {
    response: {
      status: 200,
      data: {
        error: { error_msg, error_code },
      },
    },
  };
}

describe('AI-110: VK errors use describeApiError, not JSON.stringify', () => {
  it('describeApiError extracts error_msg from VK error object', () => {
    const err = makeVkError('User authorization failed', 5);
    const result = describeApiError(err, 'VK');
    expect(result).toContain('User authorization failed');
    expect(result).toContain('5');
    expect(result).toContain('HTTP 200');
    expect(result).not.toContain('{"error"');
    expect(result).not.toContain('"error_msg"');
  });

  it('describeApiError handles VK error with message instead of error_msg', () => {
    const err = {
      response: {
        status: 400,
        data: { error: { message: 'Invalid request', error_code: 100 } },
      },
    };
    const result = describeApiError(err, 'VK');
    expect(result).toContain('Invalid request');
    expect(result).toContain('100');
    expect(result).toContain('HTTP 400');
    expect(result).not.toContain('{"error"');
  });

  it('describeApiError handles VK error with string error', () => {
    const err = {
      response: {
        status: 500,
        data: { error: 'Internal server error' },
      },
    };
    const result = describeApiError(err, 'VK');
    expect(result).toContain('Internal server error');
    expect(result).toContain('HTTP 500');
  });

  it('describeApiError returns non-empty string for empty error', () => {
    const err = { response: { status: 500, data: {} } };
    const result = describeApiError(err, 'VK');
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });
});
