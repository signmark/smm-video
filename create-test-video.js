#!/usr/bin/env node

/**
 * Создает тестовое видео и загружает его для проверки прокси
 */

import fs from 'fs';
import { execSync } from 'child_process';

async function createTestVideo() {
  try {
    console.log('🎬 Создаем тестовое видео...');
    
    // Создаем простое тестовое видео с помощью FFmpeg
    const outputPath = './test-video.mp4';
    
    // Команда для создания простого тестового видео (цветной квадрат, 3 секунды)
    const ffmpegCmd = `ffmpeg -f lavfi -i "color=red:size=1080x1920:duration=3:rate=30" -c:v libx264 -pix_fmt yuv420p -y "${outputPath}"`;
    
    console.log('📹 Выполняем FFmpeg команду...');
    execSync(ffmpegCmd, { stdio: 'ignore' });
    
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`✅ Тестовое видео создано: ${outputPath}`);
      console.log(`📊 Размер: ${(stats.size / 1024).toFixed(1)} KB`);
      return outputPath;
    } else {
      throw new Error('Файл не был создан');
    }
  } catch (error) {
    console.error(`❌ Ошибка создания видео: ${error.message}`);
    return null;
  }
}

async function uploadAndTestVideo(videoPath) {
  try {
    console.log('\n📤 Загружаем видео и тестируем прокси...');
    
    const response = await fetch('http://localhost:5000/api/test/instagram-upload-and-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ videoPath })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Видео загружено: ${result.data.uploadUrl}`);
      console.log(`🔍 S3 ключ: ${result.data.uploadKey}`);
      
      // Получаем имя файла для прокси
      const fileName = result.data.uploadKey.split('/').pop();
      console.log(`\n🧪 Тестируем прокси для файла: ${fileName}`);
      
      // Тестируем прокси
      const proxyUrl = `http://localhost:5000/api/instagram-video-proxy/${fileName}`;
      const proxyResponse = await fetch(proxyUrl, { method: 'HEAD' });
      
      console.log(`📊 Прокси статус: ${proxyResponse.status}`);
      console.log(`📋 Заголовки прокси:`);
      console.log(`  Content-Type: ${proxyResponse.headers.get('content-type')}`);
      console.log(`  Accept-Ranges: ${proxyResponse.headers.get('accept-ranges')}`);
      console.log(`  Content-Length: ${proxyResponse.headers.get('content-length')}`);
      
      if (proxyResponse.headers.get('accept-ranges') === 'bytes') {
        console.log('\n🎉 ПРОКСИ РАБОТАЕТ! Instagram должен принимать этот URL');
        return proxyUrl;
      } else {
        console.log('\n❌ Прокси не возвращает Accept-Ranges: bytes');
      }
    } else {
      console.error(`❌ Ошибка загрузки: ${result.error}`);
    }
  } catch (error) {
    console.error(`❌ Ошибка тестирования: ${error.message}`);
  }
  
  return null;
}

async function main() {
  console.log('🚀 СОЗДАНИЕ И ТЕСТИРОВАНИЕ ПРОКСИ');
  console.log('='.repeat(50));
  
  // 1. Создаем тестовое видео
  const videoPath = await createTestVideo();
  
  if (!videoPath) {
    console.error('💥 Не удалось создать тестовое видео');
    return;
  }
  
  // 2. Загружаем и тестируем прокси
  const proxyUrl = await uploadAndTestVideo(videoPath);
  
  if (proxyUrl) {
    console.log('\n🎯 РЕЗУЛЬТАТ:');
    console.log(`Прокси URL для Instagram: ${proxyUrl}`);
    console.log('✅ Этот URL можно использовать в Instagram Graph API');
  }
  
  // Удаляем временный файл
  if (fs.existsSync(videoPath)) {
    fs.unlinkSync(videoPath);
    console.log('\n🗑️ Временный файл удален');
  }
}

main().catch(console.error);