import axios from 'axios';
import crypto from 'crypto';

const ACCESS_KEY = process.env.BEGET_S3_ACCESS_KEY;
const SECRET_KEY = process.env.BEGET_S3_SECRET_KEY;
const BUCKET = process.env.BEGET_S3_BUCKET;

async function uploadText() {
  console.log('=== Тест прямой загрузки файла в Beget S3 ===');
  console.log('Ключ доступа:', ACCESS_KEY);
  console.log('Секретный ключ:', SECRET_KEY ? '***' + SECRET_KEY.substring(SECRET_KEY.length - 4) : 'не задан');
  console.log('Бакет:', BUCKET);
  
  // Подготовка данных
  const text = `Тестовый текст с меткой времени: ${new Date().toISOString()}`;
  const key = `test-direct/file-${Date.now()}.txt`;
  const url = `https://s3.ru1.storage.beget.cloud/${BUCKET}/${key}`;
  
  // Формирование подписи
  const date = new Date().toUTCString();
  const stringToSign = `PUT\n\ntext/plain\n${date}\n/${BUCKET}/${key}`;
  
  const hmac = crypto.createHmac('sha1', SECRET_KEY);
  const signature = hmac.update(Buffer.from(stringToSign, 'utf-8')).digest('base64');
  
  const headers = {
    'Date': date,
    'Authorization': `AWS ${ACCESS_KEY}:${signature}`,
    'Content-Type': 'text/plain'
  };
  
  console.log('\nURL загрузки:', url);
  console.log('Метод: PUT');
  console.log('Строка для подписи:', stringToSign);
  console.log('Размер текста:', text.length, 'байт');
  
  try {
    console.log('\nОтправка запроса...');
    const response = await axios.put(url, text, { headers });
    
    console.log('Успех! Статус:', response.status);
    console.log('Заголовки ответа:', response.headers);
    console.log('\nФайл загружен и доступен по URL:', url);
    
    return url;
  } catch (error) {
    console.error('\nОшибка загрузки:', error.message);
    if (error.response) {
      console.error('Статус ошибки:', error.response.status);
      console.error('Заголовки ошибки:', error.response.headers);
    }
    return null;
  }
}

uploadText();