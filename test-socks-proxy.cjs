const http = require('http');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Прокси настройки
const PROXY_HOST = '131.108.17.21';
const PROXY_PORT = 9271;
const PROXY_USERNAME = 'vf8Fe7';
const PROXY_PASSWORD = 'yk5xt2';

// Создаем прокси-агент для SOCKS
const proxyUrl = `socks5://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

const proxyAgent = new SocksProxyAgent(proxyUrl);

// Простой HTTP запрос через прокси
const options = {
  hostname: 'httpbin.org',
  path: '/ip',
  method: 'GET',
  agent: proxyAgent
};

console.log(`Проверка SOCKS5 прокси: ${PROXY_HOST}:${PROXY_PORT}`);
console.log(`Пользователь: ${PROXY_USERNAME}`);
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
    console.log('Тест успешно пройден!'); 
  });
});

req.on('error', (error) => {
  console.error(`Ошибка: ${error.message}`);
  
  if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
    console.error('Проблема с подключением к прокси-серверу.');  
    console.error(`Проверьте прокси: ${PROXY_HOST}:${PROXY_PORT}`);  
    console.error('Убедитесь, что прокси-сервер доступен и учетные данные верны.');  
  }
});

req.end();
