import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

console.log('🔍 Прямое тестирование Vertex AI...');

async function testVertexAIDirect() {
    try {
        // Креденшалы для проекта laboratory-449308
        const credentials = {
            "type": "service_account",
            "project_id": "laboratory-449308",
            "private_key_id": "e59e916c28da2bdb47f11046b6e1ed4e71fb7c55",
            "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQClIuhxbUn4zuda\nnuR3RgHNFo1SpP/hGBSkcExPadN6y3bC0w54ApMj8gfmquCcjc1cFq6snfwaqmee\n3zydnzXY9m4DBYgqkcn0mr1PpCaO9Y8S029igw9Yy7WNiSdIPUcu7upSx1fJHpkt\nOVk1Ip3Mz68/2cZSw5SSJZSOmpx27H0UHzDACYA0Lw44Ap39ZJhI9m6qOI8afpwJ\nsSFUTfpqihd9gnWkych4q9fsdRwN5IiSepSMry+IYz4tfnVV1C4CMcdbcWCnE2Ml\nGxU8/FpNcjmtAH/ck1MZk5oKD4RaJX8uB3BA1Z0YGDCLrDzfITw1ucgOQ+HBAYa9\nS8JX6EClAgMBAAECggEADBXJarT4/bnv9Cb+XlI5GIVm00kFpuH9xL5T1K37JENB\nTjxm6dZ6ZojfFiekPMt4ih2TgUjQkIevAfv2sixazaV/OJO45YX6KyoAjRRcyV05\nhW2u0Ef6IWFLHfAPIroapwR6ET51yLSyDhK32hZ4nkAGucavZ72DdndEmh5rhp0Q\nPr8Aeqw3z20A7oxA98MEdkJZogtD9UKyGkVlaFpyWOaFyQPaZLRsgB/83Vjs5gjC\ngVTLBk64KsjIdgRFr//bmZ+3Hou1WyeJGFGn42SisQD9MKXtQzOKrt6FsgF3In8s\nxD8p3/gVEt2lDxv5Qs2nhfQro8GIUg+0swqVE2JbQwKBgQDOScow0N3co8gBnJL9\nQTtd2nmmo9AsPJx4rK35ey/1nGZkz1fAU3vPoDlppI/0t6PR/r9J8xuljA1RKnGa\nqIDEMqU4VYkFt8rp/Gstmd+NhN+QOIw/YoyzloBRTp1VXWPPJynDUn6WqeL4yQ8A\nVtTWYrT4X9cAWJ728V4mGnDr8wKBgQDM7manuJ5c0MHXKER7QV7VG/gl2QsqO8Ny\nA7txxPd6wagK6u2P5eCe1U6tp+KdM7ydTr67oswebtRp7B8muSn6t/LuACSxbco3\niDUzQmcjpTp3MbE9GSZqJlLZ93n8mjnQXjFV+Xia7yA36CLBI5v0eYPHXhXWiCa0\nVkgKbXs/BwKBgA+8My8MD5BP8ealkdS9kBC1pIfggPWO3gSab17TVbIvbuQLqM7j\nz1LkDt0PD2gERfuzqdWzNI2pJC7nxOieJ8xPbKjiZWRJQ7IbbfV5gkLiOsdeeNww\n4Tilpz4MeBXV3NIlU5sxhLRrWwPNGlbVSMDdoJ49eUHugJmniZ3wcGKfAoGAeAWc\nS9i9ryB4lrm3ufRkRS33XLtMZbTQ2ALFknFIfDXVZGeJMQDyWDQXu28bMvStH/iR\njrVfFOfWMh8fc394zaVUev3Mf7oMeA+nENlwLJlFr6+D3YPQUtUVKyFc6YuuFpJE\nFNViRGOOnA+x4yom2b0dZ/N7mMTu3im2UZ0jVJsCgYEAyVYlNx76MytTAcgjfktB\nSFQZgNdvwPLuFE0bNzzIFvz7D7g8YHpVEds7dIegLrvVH3kXvS3+qqjyp5xBPCuJ\nOGoStzxEmeEPRHGj+sr5bxWvm2eZj1R28LHoo7XXynh66740EsU3i2EGINNT0DkM\n2jfR5u9hsY14SuOqepciuAU=\n-----END PRIVATE KEY-----\n",
            "client_email": "laboratory@laboratory-449308.iam.gserviceaccount.com",
            "client_id": "110680889001338472512",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/laboratory%40laboratory-449308.iam.gserviceaccount.com",
            "universe_domain": "googleapis.com"
        };
        
        const projectId = credentials.project_id;
        const location = 'us-central1';
        
        console.log('🔑 Получаем access token для Vertex AI...');
        
        const auth = new GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        
        const accessToken = await auth.getAccessToken();
        
        if (!accessToken) {
            throw new Error('Не удалось получить access token');
        }
        
        console.log('✅ Access token получен успешно!');
        console.log(`🔑 Токен: ${accessToken.substring(0, 50)}...`);
        
        // URL для Vertex AI
        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-2.5-flash:generateContent`;
        
        const prompt = "Проанализируй тональность комментария: 'Отличный продукт! Очень доволен!' и верни результат в JSON формате с полями sentiment, confidence и keywords.";
        
        const requestData = {
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.3,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 1024  // Небольшой лимит
            }
        };
        
        console.log('📤 Отправляем запрос на анализ тональности...');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        console.log('📥 Ответ от Vertex AI:', response.status);
        
        if (response.ok) {
            console.log('🎉 Vertex AI успешно ответил!');
            console.log('📊 Полный ответ:', JSON.stringify(result, null, 2));
            
            if (result.candidates && result.candidates.length > 0) {
                const candidate = result.candidates[0];
                
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    console.log('📄 Текст ответа:');
                    console.log(candidate.content.parts[0].text);
                } else if (candidate.finishReason) {
                    console.log(`⚠️ Завершено с причиной: ${candidate.finishReason}`);
                    if (result.usageMetadata) {
                        console.log('📊 Использование токенов:', result.usageMetadata);
                    }
                }
            }
        } else {
            console.log('❌ Ошибка Vertex AI:', result);
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.message);
        console.error('Стек:', error.stack);
    }
}

// Запускаем тест
testVertexAIDirect();