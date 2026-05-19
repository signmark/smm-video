const axios = require('axios');

const extractContactsTest = async () => {
  // Создаем тестовый HTML с контактами
  const testHTML = `
    <html>
      <head><title>Тестовая компания</title></head>
      <body>
        <h1>Тестовая компания</h1>
        <p>Наша компания делает отличные сайты</p>
        <div class="contacts">
          <h2>Контакты</h2>
          <p>Телефон: +7 (495) 123-45-67</p>
          <p>Email: info@test.com</p>
          <p>Адрес: Москва, ул. Тестовая, 123</p>
        </div>
        <footer>
          <p>Связаться с нами: 8-800-555-35-35 или support@test.ru</p>
        </footer>
      </body>
    </html>
  `;

  console.log('📄 Тестовый HTML:');
  console.log(testHTML);
  console.log('\n' + '='.repeat(50) + '\n');

  // Симулируем извлечение контактов
  console.log('🔍 Начинаем извлечение контактов...');
  
  // Извлекаем телефоны
  const phoneRegex = /(?:\+7|8)[\s\-\(\)]?\d{1,4}[\s\-\(\)]?\d{1,4}[\s\-\(\)]?\d{2,4}[\s\-\(\)]?\d{2,4}/g;
  const phones = testHTML.match(phoneRegex) || [];
  
  // Извлекаем email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = testHTML.match(emailRegex) || [];
  
  console.log('📞 Найденные телефоны:', phones);
  console.log('📧 Найденные email:', emails);
  
  if (phones.length > 0 || emails.length > 0) {
    console.log('✅ КОНТАКТЫ НАЙДЕНЫ!');
  } else {
    console.log('❌ Контакты не найдены');
  }
};

extractContactsTest().catch(console.error);