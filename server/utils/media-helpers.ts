import axios from 'axios';
import { log } from './logger';

/**
 * Fetch video thumbnail from various sources
 */
export async function fetchVideoThumbnail(videoUrl: string, res: any) {
  try {
    // Basic implementation for now - could be enhanced with FFmpeg or specific platform APIs
    log(`[Video Thumbnail Helper] Fetching thumbnail for: ${videoUrl}`, 'media');
    
    // Default fallback image if thumbnail cannot be generated
    const fallbackThumbnail = 'https://nplanner.ru/wp-content/uploads/2023/09/video-placeholder.png';
    
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      const videoId = videoUrl.includes('v=') 
        ? videoUrl.split('v=')[1].split('&')[0]
        : videoUrl.split('/').pop();
      return res.redirect(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
    }
    
    // For other platforms, we might need more complex logic
    // For now, redirect to fallback
    res.redirect(fallbackThumbnail);
  } catch (error) {
    log.error('Error in fetchVideoThumbnail:', error);
    res.status(404).send('Thumbnail not found');
  }
}

/**
 * Image proxy function to handle Telegram images and Video thumbnails
 */
export async function fetchAndProxyImage(url: string, res: any, options: { isRetry?: boolean; forceType?: string | null; isVideoThumbnail?: boolean } = {}) {
  try {
    if (options.isVideoThumbnail) {
      return await fetchVideoThumbnail(url, res);
    }
    
    let fixedUrl = url;
    if (url.includes('tgcnt.ru')) {
      try {
        fixedUrl = decodeURIComponent(url);
      } catch (e: any) {
        // AI-65. Молчание намеренное: ссылка просто не была закодирована, и
        // дальше идёт исходная. Отказа здесь нет.
      }
    }
    
    const isInstagram = url.includes('instagram.') || url.includes('fbcdn.net') || url.includes('cdninstagram.com') || options.forceType === 'instagram';
    
    if (isInstagram) {
      fixedUrl = url.includes('?') ? `${url}&_nocache=${Date.now()}` : `${url}?_nocache=${Date.now()}`;
    }
    
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };
    
    if (isInstagram) {
      headers['Referer'] = 'https://www.instagram.com/';
      headers['Origin'] = 'https://www.instagram.com';
    } else {
      headers['Referer'] = 'https://nplanner.ru/';
    }
    
    const response = await axios.get(fixedUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: headers,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
    });

    let contentType = response.headers['content-type'];
    const lowercasedUrl = fixedUrl.toLowerCase();
    if (lowercasedUrl.endsWith('.jpg') || lowercasedUrl.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (lowercasedUrl.endsWith('.png')) {
      contentType = 'image/png';
    } else if (lowercasedUrl.endsWith('.gif')) {
      contentType = 'image/gif';
    } else if (lowercasedUrl.endsWith('.webp')) {
      contentType = 'image/webp';
    } else if (lowercasedUrl.endsWith('.mp4')) {
      contentType = 'video/mp4';
    }

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    res.send(response.data);
  } catch (error: any) {
    log.error(`Error proxying media ${url}:`, error);
    res.status(404).send('Media not found');
  }
}

/**
 * Stream video from various sources
 */
export async function streamVideo(videoUrl: string, res: any, options: { 
  forceType?: string | null;
  range?: string | null;
  itemId?: string;
} = {}) {
  try {
    const isInstagram = videoUrl.includes('instagram.') || videoUrl.includes('fbcdn.net') || videoUrl.includes('cdninstagram.com') || options.forceType === 'instagram';
    
    let headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'video/webm,video/mp4,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
    };
    
    if (isInstagram) {
      headers['Referer'] = 'https://www.instagram.com/';
      headers['Origin'] = 'https://www.instagram.com';
      const separator = videoUrl.includes('?') ? '&' : '?';
      videoUrl = `${videoUrl}${separator}_nocache=${Date.now()}`;
    }
    
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (options.range) {
      const { data, headers: responseHeaders } = await axios.get(videoUrl, {
        headers: { ...headers, Range: options.range },
        responseType: 'arraybuffer',
        maxRedirects: 5
      });
      
      if (responseHeaders['content-range']) res.setHeader('Content-Range', responseHeaders['content-range']);
      if (responseHeaders['content-length']) res.setHeader('Content-Length', responseHeaders['content-length']);
      res.status(206);
      return res.end(data);
    }
    
    const response = await axios({
      method: 'get',
      url: videoUrl,
      responseType: 'stream',
      headers,
      maxRedirects: 5
    });
    
    response.data.pipe(res);
  } catch (error: any) {
    log.error(`Error streaming video: ${error}`);
    res.status(500).send('Error streaming video');
  }
}
