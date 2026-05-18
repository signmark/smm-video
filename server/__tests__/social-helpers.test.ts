import { describe, it, expect, vi } from 'vitest';
import { normalizeInstagramUrl, delay } from '../utils/social-helpers';

describe('social-helpers', () => {
    describe('normalizeInstagramUrl', () => {
        it('should normalize standard instagram URL', () => {
            expect(normalizeInstagramUrl('https://www.instagram.com/username/')).toBe('https://instagram.com/username');
        });

        it('should normalize URL with @ symbol', () => {
            expect(normalizeInstagramUrl('https://instagram.com/@username')).toBe('https://instagram.com/username');
        });

        it('should handle URL with query parameters', () => {
            expect(normalizeInstagramUrl('https://instagram.com/username?igshid=123')).toBe('https://instagram.com/username');
        });

        it('should handle just the username with @', () => {
            // Note: current implementation might return empty or incorrect if it doesn't match the regex
            // Checking actual implementation: url.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '')
            // If url is just "@username", it won't match the regex, so "@username" stays.
            // Then startsWith('@') removes @. Result: "username" -> "https://instagram.com/username"
            expect(normalizeInstagramUrl('@username')).toBe('https://instagram.com/username');
        });

        it('should return empty string for empty input', () => {
            expect(normalizeInstagramUrl('')).toBe('');
        });

        it('should handle URL with trailing slash after username', () => {
            expect(normalizeInstagramUrl('https://www.instagram.com/username/')).toBe('https://instagram.com/username');
        });

        it('should handle edge cases and return original on error', () => {
            // Since normalizeInstagramUrl doesn't really throw unless url is null/undefined in some environments
            // But we can test it returns empty if nothing remains
            expect(normalizeInstagramUrl('https://instagram.com/')).toBe('');
        });
    });

    describe('delay', () => {
        it('should delay execution', async () => {
            vi.useFakeTimers();
            const promise = delay(1000);

            vi.advanceTimersByTime(1000);

            await expect(promise).resolves.toBeUndefined();
            vi.useRealTimers();
        });
    });
});
