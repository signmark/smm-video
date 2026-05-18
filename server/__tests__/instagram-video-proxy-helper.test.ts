import { describe, it, expect, vi } from 'vitest';
import { convertS3UrlToInstagramProxy, shouldUseProxyForInstagram, getInstagramCompatibleVideoUrl } from '../utils/instagram-video-proxy-helper';

vi.mock('./logger', () => ({
    log: vi.fn()
}));

describe('instagram-video-proxy-helper', () => {
    describe('convertS3UrlToInstagramProxy', () => {
        it('should convert S3 URL to proxy URL', () => {
            const s3Url = 'https://storage.beget.cloud/bucket/video.mp4';
            const proxyUrl = convertS3UrlToInstagramProxy(s3Url);
            expect(proxyUrl).toContain('/api/instagram-video-proxy/video.mp4');
        });

        it('should return original URL on error', () => {
            const result = convertS3UrlToInstagramProxy('not-a-url');
            expect(result).toBe('not-a-url');
        });
    });

    describe('shouldUseProxyForInstagram', () => {
        it('should return true for beget domains', () => {
            expect(shouldUseProxyForInstagram('https://mybucket.beget.tech/file.mp4')).toBe(true);
            expect(shouldUseProxyForInstagram('https://storage.beget.cloud/file.mp4')).toBe(true);
        });

        it('should return false for other domains', () => {
            expect(shouldUseProxyForInstagram('https://example.com/file.mp4')).toBe(false);
        });

        it('should handle invalid URLs', () => {
            expect(shouldUseProxyForInstagram('invalid-url')).toBe(false);
        });
    });

    describe('getInstagramCompatibleVideoUrl', () => {
        it('should return proxy URL if needed', () => {
            const s3Url = 'https://storage.beget.cloud/bucket/video.mp4';
            expect(getInstagramCompatibleVideoUrl(s3Url)).toContain('/api/instagram-video-proxy/video.mp4');
        });

        it('should return original URL if proxy not needed', () => {
            const url = 'https://example.com/video.mp4';
            expect(getInstagramCompatibleVideoUrl(url)).toBe(url);
        });
    });
});
