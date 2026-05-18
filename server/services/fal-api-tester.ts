/**
 * Тестовый модуль для проверки работы с FAL.AI API
 * Используется для отладки проблем с авторизацией и форматированием API ключа
 */

import axios from 'axios';
import { log } from '../utils/logger';

/**
 * Тестирует подключение к FAL.AI API с различными форматами ключа
 * @param apiKey Исходный API ключ
 * @returns Результаты тестирования
 */
export async function testFalApiConnection(apiKey: string): Promise<any> {
  if (!apiKey) {
    return {
      success: false,
      error: "API ключ не предоставлен",
      details: "Необходимо указать API ключ FAL.AI для тестирования"
    };
  }

  // Подробное логирование ключа (без вывода чувствительной информации)
  const keyInfo = {
    length: apiKey.length,
    hasPrefix: apiKey.startsWith('Key '),
    hasColon: apiKey.includes(':'),
    format: apiKey.startsWith('Key ') ? 'Key prefix' : 'No Key prefix',
    isCorrectFormat: apiKey.startsWith('Key ') && apiKey.includes(':')
  };
  
  log(`Testing FAL.AI API connection with key format: ${keyInfo.format}`, 'fal-tester');
  
  // Подготовка вариантов ключа для тестирования
  const keyVariants = prepareKeyVariants(apiKey);
  
  // Результаты тестирования для каждого варианта ключа
  const results = [];
  
  // Простой запрос для тестирования
  const requestData = {
    prompt: "Test image",
    negative_prompt: "",
    width: 512,
    height: 512,
    num_images: 1
  };
  
  // Проверяем каждый вариант форматирования ключа
  for (const variant of keyVariants) {
    try {
      log(`Testing FAL.AI API with key format: "${variant.description}"`, 'fal-tester');
      
      try {
        // Сначала пробуем модель flux/schnell
        log(`Testing with flux/schnell endpoint...`, 'fal-tester');
        const response = await axios.post(
          'https://queue.fal.run/fal-ai/flux/schnell',
          requestData,
          {
            headers: {
              'Authorization': variant.key,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            timeout: 10000 // 10 секунд таймаут для тестов
          }
        );
      
        results.push({
          format: variant.description,
          success: true,
          status: response.status,
          endpoint: 'flux/schnell',
          data: typeof response.data === 'object' ? 
            Object.keys(response.data) : 
            'Non-object response'
        });
      
        log(`✅ Successful test for format: "${variant.description}" with flux/schnell`, 'fal-tester');
      } catch (schnellError) {
        // При ошибке с первым эндпоинтом пробуем второй (fast-sdxl)
        log(`flux/schnell test failed, trying fast-sdxl endpoint...`, 'fal-tester');
        try {
          const sdxlResponse = await axios.post(
            'https://queue.fal.run/fal-ai/fast-sdxl',
            requestData,
            {
              headers: {
                'Authorization': variant.key,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              timeout: 10000 // 10 секунд таймаут для тестов
            }
          );
          
          results.push({
            format: variant.description,
            success: true,
            status: sdxlResponse.status,
            endpoint: 'fast-sdxl',
            data: typeof sdxlResponse.data === 'object' ? 
              Object.keys(sdxlResponse.data) : 
              'Non-object response'
          });
          
          log(`✅ Successful test for format: "${variant.description}" with fast-sdxl`, 'fal-tester');
        } catch (sdxlError) {
          // Если оба эндпоинта не работают, логируем ошибку
          log(`❌ Both endpoints failed for format: "${variant.description}"`, 'fal-tester');
          
          // Используем ошибку от второго эндпоинта для отчета, так как это более свежий результат
          const errorDetails = (sdxlError as any).response ? {
            status: (sdxlError as any).response.status,
            data: (sdxlError as any).response.data,
            endpoints: 'both failed'
          } : {
            message: (sdxlError as any).message,
            endpoints: 'both failed'
          };
          
          results.push({
            format: variant.description,
            success: false,
            error: errorDetails
          });
          
          // Мы не выбрасываем ошибку дальше, так как уже обработали её здесь
        }
      }
    } catch (error: any) {
      // Логирование ошибки без вывода чувствительных данных
      const errorDetails = error.response ? {
        status: error.response.status,
        data: error.response.data
      } : {
        message: error.message
      };
      
      results.push({
        format: variant.description,
        success: false,
        error: errorDetails
      });
      
      log(`❌ Failed test for format: "${variant.description}"`, 'fal-tester');
    }
  }
  
  return {
    success: results.some(r => r.success),
    keyInfo,
    results
  };
}

/**
 * Подготавливает различные варианты форматирования API ключа
 * @param originalKey Исходный API ключ
 * @returns Массив вариантов ключа с описанием
 */
function prepareKeyVariants(originalKey: string): Array<{key: string, description: string}> {
  const variants = [];
  
  // Оригинальный ключ без изменений
  variants.push({
    key: originalKey,
    description: "Original (unchanged)"
  });
  
  // Если ключ не начинается с "Key ", добавляем вариант с префиксом
  if (!originalKey.startsWith('Key ')) {
    variants.push({
      key: `Key ${originalKey}`,
      description: "With 'Key ' prefix added"
    });
  }
  
  // Если ключ начинается с "Key ", добавляем вариант без префикса
  if (originalKey.startsWith('Key ')) {
    variants.push({
      key: originalKey.substring(4), // Удаляем "Key "
      description: "Without 'Key ' prefix"
    });
  }
  
  // Дополнительная проверка: если ключ не имеет ":", но имеет формат UUID,
  // пробуем добавить образец формата как показал пользователь (с разделителем ":")
  if (!originalKey.includes(':') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(originalKey)) {
    // Специальное предупреждение - это просто шаблон, а не настоящий ключ
    variants.push({
      key: `Key ${originalKey}:example_secret_part_should_be_provided`,
      description: "Template format (missing secret part)"
    });
    
    log('⚠️ Warning: Your API key appears to be missing the secret part after colon (:). Example format: Key uuid:secret', 'fal-tester');
  }
  
  return variants;
}