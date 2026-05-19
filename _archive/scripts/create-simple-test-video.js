import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('🎬 Создаю простейшее тестовое видео...');

// Создаем тестовое видео с нуля
const videoPath = '/tmp/simple_test.mp4';

const ffmpegCmd = `ffmpeg -f lavfi -i testsrc=duration=3:size=1080x1920:rate=24 ` +
  `-f lavfi -i sine=frequency=800:duration=3 ` +
  `-c:v libx264 -profile:v baseline -level:v 3.0 -pix_fmt yuv420p ` +
  `-crf 30 -maxrate 1000k -bufsize 2000k ` +
  `-c:a aac -b:a 64k -ar 44100 -ac 2 ` +
  `-movflags +faststart -t 3 -y ${videoPath}`;

try {
  execSync(ffmpegCmd, { stdio: 'pipe' });
  
  if (fs.existsSync(videoPath)) {
    const stats = fs.statSync(videoPath);
    console.log(`✅ Создано видео: ${videoPath}`);
    console.log(`📊 Размер: ${Math.round(stats.size / 1024)}KB`);
    
    // Обновляем контент через реальный конвертер
    const updateCmd = `curl -s -X POST http://localhost:5000/api/real-video-converter/convert ` +
      `-H "Content-Type: application/json" ` +
      `-d '{"localPath": "${videoPath}", "forceConvert": true, "contentId": "7fdcd858-0d14-4cd2-8950-5c8b31f29fea"}'`;
    
    console.log('🔄 Обновляем контент через конвертер...');
    const result = execSync(updateCmd, { encoding: 'utf8' });
    
    try {
      const parsed = JSON.parse(result);
      if (parsed.success) {
        console.log('✅ Контент успешно обновлен простым видео!');
        console.log(`📹 URL: ${parsed.convertedUrl}`);
      } else {
        console.log('❌ Ошибка обновления:', parsed.error || 'Неизвестная ошибка');
      }
    } catch (e) {
      console.log('🔄 Ответ сервера:', result);
    }
    
  } else {
    console.log('❌ Видео не создано');
  }
} catch (error) {
  console.log('❌ Ошибка создания видео:', error.message);
}