#!/usr/bin/env node

/**
 * Тестовый скрипт для проверки конвертера с Main профилем
 * Использует найденные рабочие параметры для Instagram Stories
 */

const { execSync } = require('child_process');
const fs = require('fs');

function convertVideoToMainProfile(inputPath, outputPath) {
  // Рабочие параметры H.264 Main профиль для Instagram Stories
  const ffmpegCommand = [
    'ffmpeg',
    '-i', `"${inputPath}"`,
    '-vf', '"scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30"',
    '-c:v', 'libx264',
    '-profile:v', 'main',          // MAIN профиль (протестировано - работает!)
    '-level', '4.0',               // Level 4.0 (стандартный)
    '-pix_fmt', 'yuv420p',         // YUV420p обязательно
    '-b:v', '3M',                  // 3 Мбит/с видео битрейт
    '-maxrate', '4M',              // Максимум 4 Мбит/с
    '-bufsize', '8M',              // Буфер 8M
    '-c:a', 'aac',                 // AAC аудио
    '-ar', '44100',                // 44.1 kHz частота
    '-ac', '2',                    // 2 канала стерео
    '-b:a', '128k',                // 128 кбит/с аудио
    '-movflags', '+faststart',     // Web-оптимизация
    '-f', 'mp4',                   // MP4 контейнер
    '-y', `"${outputPath}"`        // Перезапись
  ].join(' ');

  console.log('🔧 Конвертирую с Main профилем...');
  console.log('Команда:', ffmpegCommand);
  
  try {
    execSync(ffmpegCommand, { stdio: 'inherit' });
    console.log('✅ Конвертация завершена');
    
    // Проверяем результат
    const probeCommand = `ffprobe -hide_banner -show_streams -show_format "${outputPath}" 2>/dev/null | grep -E "(profile|level|codec_name|pix_fmt|width|height|r_frame_rate)"`;
    console.log('\n=== ПАРАМЕТРЫ КОНВЕРТИРОВАННОГО ВИДЕО ===');
    execSync(probeCommand, { stdio: 'inherit' });
    
  } catch (error) {
    console.error('❌ Ошибка конвертации:', error.message);
  }
}

// Пример использования
if (require.main === module) {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3] || 'output_main_profile.mp4';
  
  if (!inputFile) {
    console.log('Использование: node test-main-profile-converter.js <input.mp4> [output.mp4]');
    console.log('Пример: node test-main-profile-converter.js video.mp4 instagram_ready.mp4');
    process.exit(1);
  }
  
  if (!fs.existsSync(inputFile)) {
    console.error('❌ Входной файл не найден:', inputFile);
    process.exit(1);
  }
  
  convertVideoToMainProfile(inputFile, outputFile);
}

module.exports = { convertVideoToMainProfile };