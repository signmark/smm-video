import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchVideoThumbnail, fetchAndProxyImage, streamVideo } from '../utils/media-helpers';

vi.mock('axios');

describe('media-helpers', () => {
    let mockRes: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRes = {
            redirect: vi.fn(),
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
            setHeader: vi.fn(),
            end: vi.fn(),
        };
    });

    describe('fetchVideoThumbnail', () => {
        it('should redirect to youtube thumbnail for youtube.com URL', async () => {
            await fetchVideoThumbnail('https://www.youtube.com/watch?v=dQw4w9WgXcQ', mockRes);
            expect(mockRes.redirect).toHaveBeenCalledWith('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
        });

        it('should redirect to youtube thumbnail for youtu.be URL', async () => {
            await fetchVideoThumbnail('https://youtu.be/dQw4w9WgXcQ', mockRes);
            expect(mockRes.redirect).toHaveBeenCalledWith('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
        });

        it('should redirect to fallback for unknown platform', async () => {
            await fetchVideoThumbnail('https://example.com/video.mp4', mockRes);
            expect(mockRes.redirect).toHaveBeenCalledWith('https://nplanner.ru/wp-content/uploads/2023/09/video-placeholder.png');
        });
    });

    describe('fetchAndProxyImage', () => {
        it('should proxy image correctly', async () => {
            const mockData = Buffer.from('fake-image-data');
            (axios.get as any).mockResolvedValue({
                data: mockData,
                headers: { 'content-type': 'image/jpeg' }
            });

            await fetchAndProxyImage('https://example.com/image.jpg', mockRes);

            expect(axios.get).toHaveBeenCalled();
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
            expect(mockRes.send).toHaveBeenCalledWith(mockData);
        });

        it('should handle isVideoThumbnail option', async () => {
            await fetchAndProxyImage('https://youtu.be/dQw4w9WgXcQ', mockRes, { isVideoThumbnail: true });
            expect(mockRes.redirect).toHaveBeenCalledWith('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
        });

        it('should handle instagram specificity', async () => {
            (axios.get as any).mockResolvedValue({
                data: Buffer.from('data'),
                headers: { 'content-type': 'image/jpeg' }
            });

            await fetchAndProxyImage('https://instagram.com/p/123', mockRes);

            const callArgs = (axios.get as any).mock.calls[0];
            expect(callArgs[0]).toContain('_nocache=');
            expect(callArgs[1].headers.Referer).toBe('https://www.instagram.com/');
        });

        it('should return 404 on axios error', async () => {
            (axios.get as any).mockRejectedValue(new Error('Network error'));
            await fetchAndProxyImage('https://example.com/fail.jpg', mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.send).toHaveBeenCalledWith('Media not found');
        });
    });

    describe('streamVideo', () => {
        it('should handle range request', async () => {
            const mockData = Buffer.from('video-chunk');
            (axios.get as any).mockResolvedValue({
                data: mockData,
                headers: {
                    'content-range': 'bytes 0-100/1000',
                    'content-length': '101'
                }
            });

            await streamVideo('https://example.com/video.mp4', mockRes, { range: 'bytes=0-100' });

            expect(mockRes.status).toHaveBeenCalledWith(206);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-100/1000');
            expect(mockRes.end).toHaveBeenCalledWith(mockData);
        });

        it('should handle streaming without range', async () => {
            const mockStream = {
                pipe: vi.fn()
            };
            (axios as any).mockResolvedValue({
                data: mockStream
            });

            await streamVideo('https://example.com/video.mp4', mockRes);

            expect(axios).toHaveBeenCalledWith(expect.objectContaining({ responseType: 'stream' }));
            expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
        });

        it('should return 500 on error', async () => {
            (axios as any).mockRejectedValue(new Error('Stream failed'));
            await streamVideo('https://example.com/error.mp4', mockRes);
            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.send).toHaveBeenCalledWith('Error streaming video');
        });
    });
});
