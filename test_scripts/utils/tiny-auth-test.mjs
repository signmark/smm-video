import axios from 'axios';
import crypto from 'crypto';

const ACCESS_KEY = process.env.BEGET_S3_ACCESS_KEY;
const SECRET_KEY = process.env.BEGET_S3_SECRET_KEY;
const BUCKET = process.env.BEGET_S3_BUCKET;
const ENDPOINT = 's3.ru1.storage.beget.cloud';

async function testAuth() {
  console.log('=== Тест прямой авторизации в Beget S3 ===');
  console.log('Ключ доступа:', ACCESS_KEY);
  console.log('Секретный ключ:', SECRET_KEY ? '***' + SECRET_KEY.substring(SECRET_KEY.length - 4) : 'не задан');
  console.log('Бакет:', BUCKET);
  
  const url = `https://${ENDPOINT}/${BUCKET}`;
  const date = new Date().toUTCString();
  
  // Важно: убедимся, что строка для подписи содержит правильный формат (без двойных слешей)
  const stringToSign = `HEAD\n\n\n${date}\n/${BUCKET}/`;
  
  const hmac = crypto.createHmac('sha1', SECRET_KEY);
  const signature = hmac.update(Buffer.from(stringToSign, 'utf-8')).digest('base64');
  
  const headers = {
    'Date': date,
    'Authorization': `AWS ${ACCESS_KEY}:${signature}`,
    'Host': ENDPOINT
  };
  
  console.log('\nURL запроса:', url);
  console.log('Метод: HEAD');
  console.log('Строка для подписи:', stringToSign.replace(/\n/g, '\\n'));
  console.log('Заголовок Date:', date);
  console.log('Подпись:', signature);
  
  try {
    const response = await axios.head(url, { headers });
    console.log('\nУспех! Статус:', response.status);
    console.log('Заголовки ответа:', response.headers);
    return true;
  } catch (error) {
    console.error('\nОшибка:', error.message);
    if (error.response) {
      console.error('Статус ошибки:', error.response.status);
      console.error('Заголовки ошибки:', error.response.headers);
      if (error.response.data) {
        console.error('Тело ошибки:', error.response.data);
      }
    }
    return false;
  }
}

testAuth();