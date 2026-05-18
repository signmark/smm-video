/**
 * Simple S3 upload service for video-app.
 * Uploads a local file to Beget S3 and returns the public URL.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';

export interface S3UploadResult {
  url: string;
  key: string;
}

function buildClient(): { client: S3Client; bucket: string; endpoint: string } {
  const accessKey = process.env.BEGET_S3_ACCESS_KEY;
  const secretKey = process.env.BEGET_S3_SECRET_KEY;
  const bucket = process.env.BEGET_S3_BUCKET;
  const endpoint = process.env.BEGET_S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud';
  const region = process.env.BEGET_S3_REGION || 'ru-1';

  if (!accessKey || !secretKey || !bucket) {
    throw new Error('S3 credentials not configured (BEGET_S3_ACCESS_KEY / BEGET_S3_SECRET_KEY / BEGET_S3_BUCKET)');
  }

  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });

  return { client, bucket, endpoint };
}

function getPublicUrl(bucket: string, endpoint: string, key: string): string {
  // Convert https://s3.ru1.storage.beget.cloud → bucket.s3.ru1.storage.beget.cloud
  const endpointHost = endpoint.replace(/^https?:\/\//, '');
  return `https://${bucket}.${endpointHost}/${key}`;
}

export async function uploadVideoToS3(localPath: string, projectId: string): Promise<S3UploadResult> {
  const { client, bucket, endpoint } = buildClient();

  const key = `video-app/videos/${projectId}.mp4`;
  const fileBuffer = fs.readFileSync(localPath);

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: 'video/mp4',
    ACL: 'public-read' as any,
  }));

  const url = getPublicUrl(bucket, endpoint, key);
  return { url, key };
}
