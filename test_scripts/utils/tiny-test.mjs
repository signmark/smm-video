import axios from 'axios';
import crypto from 'crypto';

// Конфигурация
const config = {
  accessKey: process.env.BEGET_S3_ACCESS_KEY,
  secretKey: process.env.BEGET_S3_SECRET_KEY,
  bucket: process.env.BEGET_S3_BUCKET,
  endpoint: 's3.ru1.storage.beget.cloud'
};

// Создание подписи
function sign(str) {
  return crypto.createHmac('sha1', config.secretKey)
    .update(str, 'utf8').digest('base64');
}

// Тест бакета
async function testBucket() {
  const date = new Date().toUTCString();
  const path = `/${config.bucket}/`;
  const str = `HEAD\n\n\n${date}\n${path}`;
  const sig = sign(str);
  
  const url = `https://${config.endpoint}${path}`;
  const headers = {
    'Host': config.endpoint,
    'Date': date,
    'Authorization': `AWS ${config.accessKey}:${sig}`
  };
  
  try {
    console.log(`Тест HEAD ${url}`);
    const resp = await axios.head(url, { headers });
    console.log(`Успех! HTTP ${resp.status}`);
    return true;
  } catch (e) {
    console.error(`Ошибка: ${e.message}`);
    if (e.response) console.error(`HTTP ${e.response.status}`);
    return false;
  }
}

// Загрузка файла
async function uploadFile() {
  const text = `Тест ${Date.now()}`;
  const key = `test/file-${Date.now()}.txt`;
  const date = new Date().toUTCString();
  const path = `/${config.bucket}/${key}`;
  const str = `PUT\n\ntext/plain\n${date}\n${path}`;
  const sig = sign(str);
  
  const url = `https://${config.endpoint}${path}`;
  const headers = {
    'Host': config.endpoint,
    'Date': date,
    'Content-Type': 'text/plain',
    'Authorization': `AWS ${config.accessKey}:${sig}`
  };
  
  try {
    console.log(`Загрузка в ${url}`);
    const resp = await axios.put(url, text, { headers });
    console.log(`Успех! HTTP ${resp.status}`);
    return url;
  } catch (e) {
    console.error(`Ошибка: ${e.message}`);
    if (e.response) console.error(`HTTP ${e.response.status}`);
    return null;
  }
}

// Главная функция
async function main() {
  console.log(`Тестирование Beget S3: ${config.bucket}`);
  const ok = await testBucket();
  if (ok) await uploadFile();
}

main();