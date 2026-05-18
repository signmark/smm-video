/**
 * Сервис генерации изображений через OpenAI gpt-image-2
 * Документация: https://platform.openai.com/docs/guides/images
 */
import axios from 'axios';

export interface GptImageOptions {
  prompt: string;
  apiKey: string;
  numImages?: number;         // 1–10
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  background?: 'transparent' | 'opaque' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
}

export interface GptImageResult {
  success: boolean;
  imageUrls: string[];  // постоянные S3 URL (или data: URL как fallback)
  error?: string;
}

async function uploadBase64ToS3(b64: string, format: string, index: number): Promise<string> {
  try {
    const { begetS3StorageAws } = await import('./beget-s3-storage-aws');
    const fileName = `images/generated/openai-${Date.now()}-${index}.${format}`;
    const buffer = Buffer.from(b64, 'base64');
    const uploadResult = await begetS3StorageAws.uploadFile({
      key: fileName,
      fileData: buffer,
      contentType: `image/${format}`,
    });
    if (uploadResult.success && uploadResult.url) {
      return uploadResult.url;
    }
  } catch (err) {
    console.warn('[openai-image] S3 upload failed, using data URL fallback:', err);
  }
  return `data:image/${format};base64,${b64}`;
}

export async function generateWithGptImage(options: GptImageOptions): Promise<GptImageResult> {
  const {
    prompt,
    apiKey,
    numImages = 1,
    size = '1024x1024',
    quality = 'medium',
    background = 'auto',
    outputFormat = 'png',
  } = options;

  try {
    const body: Record<string, any> = {
      model: 'gpt-image-2',
      prompt,
      n: Math.min(Math.max(numImages, 1), 10),
      size,
      quality,
      background,
      output_format: outputFormat,
    };

    console.log(`[openai-image] Запрос gpt-image-2: n=${body.n}, size=${size}, quality=${quality}`);

    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      body,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 180_000,
      }
    );

    const data = response.data?.data as Array<{ b64_json?: string; url?: string }>;
    if (!data || data.length === 0) {
      return { success: false, imageUrls: [], error: 'Пустой ответ от OpenAI' };
    }

    // Параллельно загружаем все изображения на S3
    const imageUrls = await Promise.all(
      data.map(async (item, i) => {
        if (item.url) return item.url;
        if (item.b64_json) return uploadBase64ToS3(item.b64_json, outputFormat, i);
        return '';
      })
    );

    const filtered = imageUrls.filter(Boolean);
    console.log(`[openai-image] ✅ Сгенерировано ${filtered.length} изображений`);

    return { success: true, imageUrls: filtered };
  } catch (err: any) {
    const detail =
      err.response?.data?.error?.message ||
      err.message ||
      'Неизвестная ошибка OpenAI';
    console.error('[openai-image] ❌ Ошибка:', detail);
    return { success: false, imageUrls: [], error: detail };
  }
}
