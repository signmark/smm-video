/**
 * AI-59: Bookmark result parsing — reads from envelope, not top level.
 *
 * Bug (AI-52): PATCH /api/campaign-trends/:id/bookmark returns
 * { success, data: { id, is_bookmarked } }, but client read is_bookmarked
 * from the envelope itself → undefined → toast always said "removed",
 * cache updated with undefined, list never refreshed.
 *
 * This test verifies readBookmarkResult correctly unwraps the envelope.
 *
 * Red-before proof: changing readBookmarkResult to read from envelope
 * directly (payload.is_bookmarked) makes tests fail.
 */

import { describe, it, expect } from 'vitest';
import { readBookmarkResult, hasBookmarkState } from '@/lib/bookmark-result';

describe('readBookmarkResult', () => {
  it('reads isBookmarked from inside the data envelope', () => {
    const response = {
      success: true,
      data: { id: 'trend-1', is_bookmarked: true },
    };
    const result = readBookmarkResult(response);
    expect(result.isBookmarked).toBe(true);
    expect(result.id).toBe('trend-1');
  });

  it('reads removal correctly from envelope', () => {
    const response = {
      success: true,
      data: { id: 'trend-1', is_bookmarked: false },
    };
    const result = readBookmarkResult(response);
    expect(result.isBookmarked).toBe(false);
    expect(result.id).toBe('trend-1');
  });

  it('handles flat response (no envelope)', () => {
    const flat = { id: 'trend-x', is_bookmarked: true };
    const result = readBookmarkResult(flat);
    expect(result.isBookmarked).toBe(true);
    expect(result.id).toBe('trend-x');
  });

  it('handles camelCase field name', () => {
    const response = {
      success: true,
      data: { id: 'trend-2', isBookmarked: true },
    };
    const result = readBookmarkResult(response);
    expect(result.isBookmarked).toBe(true);
  });

  it('returns false for non-boolean values (not "no" but "server didn\'t say")', () => {
    // Missing field entirely
    expect(readBookmarkResult({ success: true, data: {} }).isBookmarked).toBe(false);
    // String instead of boolean
    expect(readBookmarkResult({ success: true, data: { is_bookmarked: 'true' } }).isBookmarked).toBe(false);
    // null
    expect(readBookmarkResult({ success: true, data: { is_bookmarked: null } }).isBookmarked).toBe(false);
  });

  it('handles null/undefined/empty input without throwing', () => {
    expect(() => readBookmarkResult(null)).not.toThrow();
    expect(() => readBookmarkResult(undefined)).not.toThrow();
    expect(() => readBookmarkResult({})).not.toThrow();
    expect(readBookmarkResult(null).isBookmarked).toBe(false);
  });
});

describe('hasBookmarkState', () => {
  it('returns true when server provided a boolean bookmark state', () => {
    expect(hasBookmarkState({ success: true, data: { is_bookmarked: true } })).toBe(true);
    expect(hasBookmarkState({ success: true, data: { is_bookmarked: false } })).toBe(true);
  });

  it('returns false when server did not provide bookmark state', () => {
    expect(hasBookmarkState({ success: true, data: {} })).toBe(false);
    expect(hasBookmarkState({})).toBe(false);
    expect(hasBookmarkState(null)).toBe(false);
  });
});
