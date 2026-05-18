const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Прокси настройки
const PROXY_HOST = '131.108.17.21';
const PROXY_PORT = 9271;
const PROXY_USERNAME = 'vf8Fe7';
const PROXY_PASSWORD = 'yk5xt2';
const PROXY_URL = `socks5://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

// Создаем прокси-агент
const proxyAgent = new HttpsProxyAgent(PROXY_URL);

// Простой HTTP запрос через прокси
const options = {
  hostname: 'httpbin.org',
  path: '/ip',
  method: 'GET',
  agent: proxyAgent
};

console.log(`Проверка прокси: ${PROXY_URL}`);
console.log(`Запрос к: http://${options.hostname}${options.path}`);

const req = http.request(options, (res) => {
  console.log(`Статус: ${res.statusCode}`);
  
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Ответ:');
    console.log(data);
  });
});

req.on('error', (error) => {
  console.error(`Ошибка: ${error.message}`);
  
  if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
    console.error('Проблема с подключением к прокси-серверу. Проверьте доступность и учетные данные.');
  }
});

req.end();
