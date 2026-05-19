/**
 * Прямой тест доступа к Vertex AI API
 */

async function testDirectVertexAI() {
  try {
    console.log('=== Прямой тест Vertex AI ===');
    
    // Прямой запрос к Vertex AI с правильным проектом
    const projectId = 'gen-lang-client-0762407615';
    const location = 'us-central1';
    const model = 'gemini-1.5-flash'; // Используем доступную модель
    
    // Получаем access token через OAuth
    const { GoogleAuth } = await import('google-auth-library');
    
    const credentials = {
      "type": "service_account",
      "project_id": "gen-lang-client-0762407615",
      "private_key_id": "1d404280ad34bf873985b4c7556172af935276e5",
      "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCVshXPNJ1EVrS1\naq8oKgns3BtpXHDdxHrvmCXkBbJ2iXseaJKmoTZXfhetYhhpIrMUY27SMc1Ay6Qy\nDba9YWczUQjUR3W9Nk6DIIuuBmOq77u6aOTn42HOFoSlnXeozCX5rMVTKQxaAV1g\nX3CKCoJjtySNSl8pZi2z/I9wuimv3S84xQvGAg95OZijZ3cvLbd/yyM2WeMnYoAG\nQ7G9OhzZ9utp74SDqMR7++Fdp5HpflSMG7sCYc1eI4jDdN0+0PI0RdWoJHIZD2Tn\nsdfg4a5mabvQwsVE8lJxAqS/M/deoLCza8qPul5iGFE/ZNMKVcFnAhDCwiMXvWkY\ncwWk1K/vAgMBAAECggEAG2oLuHCoRHWkjnzFKxPX0XrVwkvdl5997BbvCX1Jm4+9\n7mm0QbPQYeGDsIsAcXCbXyZ+ixv3vOAOZ+Q/DRujbLBwb3/OviIN6tGxAuPEqO9S\nb+b51MW9iaJyFGpsGYuZgMn1MS+ZRXpugVG5KG6YRm6p0P5HwyslP4sHMdvF+qC9\naXHMp6f+y5mqOcS0vtdrgP9nIp6KKDHd4u5IvdKY7SD3YxqJZbQAhAHD2YUn1TAS\nJruPSRO5qS4ZIpK0/7vBZRGUWtmcqitc6X17DtK23PCMw+QaEqlEj8Stiw5JmVMa\naLJCdYBctRXWq3C9aan6i786+ikagFr4v2TvrMXmcQKBgQDGwhKk2dQCKIMfw1hg\nC0vzNJl4jidoRemHpAmIAQ+3yrFcaMb/ZVkKsIzWJgk+ge/lFjJ1yKGyKUDXOJjT\neIriA7C0BEngX/YGBHhIngbqMuUNa/2sv4v3ZLkdAufRxZ+MPCp53Vd4dsjSL+fV\nfGvfPPIphwICzNwOwngiA/f7iwKBgQDAzsNV9KfABljsaM48pcbXWog4VDUbu/lq\nm+Y3TGljD3y/w021XHqt5HgMTIr436Uk9bm0Yf/d18PNIPtcA0LBH8D/av1DBVTF\nuLpAdmRkkN6y/dBb0lQ97pzGERu23JrZuwbjv9lm5Av4ssJLRX2b6Oz+Bs7qNjOe\noEHPKHF5rQKBgHx8Wx8DC4VaiF3hhL2K9cPawvC94DKv7wc0l3+mYojTm+hr+49E\nk9NdJqiN5CZRTcZm863Pvm6O5fymhxmUGzBZ7Veig/7TO40jSY754wzWWZ3hcF29\nDtYhMMvZ4QYCx94WZOg02K8rfrYeqQ6OQiXszyNxWrIUSxO3e3SalbvnAoGAZW+i\nJuOrKYRtXhsZfaC9xujTR8dNlYTEiIjyil9CBqLMP9sRU/wOctQDMH1Ik/ydVp+M\njtEMGvt8ALx8YYE5qn75O6dfDNaOLeOs4WMoGBx7fXG5H8W9GkQh6LZxfTf8o9YY\nntN9HfuWLMZnH9C0b8UQgei1DVVsvOSVGtatNJUCgYBuJ5/zuHc7eOw/spoNvGh0\nR2n9cCsyLnOETixv2iDwhkPVCg5flbegb9LZToCI+QMW/WVZ6rUIto5C8EdMrOIi\nAyYqleg4Qt+y20/DIT8PSGQZybB0NS98meoZXxdZQwxuTOecYeAuCRC5KK/6zW2S\nYGS/DWGSdh2ggbSgMHz0+w==\n-----END PRIVATE KEY-----\n",
      "client_email": "vertexai@gen-lang-client-0762407615.iam.gserviceaccount.com",
      "client_id": "101608073551091542897",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
      "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/vertexai%40gen-lang-client-0762407615.iam.gserviceaccount.com",
      "universe_domain": "googleapis.com"
    };

    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    console.log('1. Получение access token...');
    const client = await auth.getClient();
    const accessTokenResponse = await client.getAccessToken();
    
    if (!accessTokenResponse.token) {
      throw new Error('Не удалось получить access token');
    }

    const accessToken = accessTokenResponse.token;
    console.log('✅ Access token получен');

    // Тестируем различные модели Gemini
    const modelsToTest = [
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash-exp',
      'gemini-2.5-flash-preview-0520'
    ];

    for (const testModel of modelsToTest) {
      console.log(`\n=== Тестирование модели ${testModel} ===`);
      
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${testModel}:generateContent`;
      
      const requestData = {
        contents: [
          {
            parts: [
              {
                text: "Привет! Улучши этот текст: 'Программа для питания хорошая'"
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 1000
        }
      };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });
      
      console.log(`Статус: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates[0]) {
          const text = data.candidates[0].content.parts[0].text;
          console.log(`✅ ${testModel} работает!`);
          console.log(`Ответ: ${text.substring(0, 100)}...`);
        }
      } else {
        const errorText = await response.text();
        console.log(`❌ ${testModel} недоступна: ${JSON.parse(errorText).error.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// Запускаем тест
testDirectVertexAI();