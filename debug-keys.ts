import { globalApiKeysService } from './server/services/global-api-keys';
import { ApiServiceName } from './server/services/api-keys';
import * as dotenv from 'dotenv';

dotenv.config();

async function debugKeys() {
  console.log('--- DEBUG GLOBAL API KEYS ---');
  try {
    await globalApiKeysService.refreshCache();
    
    const services = [
      ApiServiceName.GEMINI,
      ApiServiceName.GOOGLE_API_KEY,
      'gemini',
      'GEMINI',
      'GOOGLE_API_KEY'
    ];

    for (const service of services) {
      const key = await globalApiKeysService.getGlobalApiKey(service as any);
      if (key) {
        console.log(`✅ Found key for [${service}]: ${key.substring(0, 8)}... (length: ${key.length})`);
      } else {
        console.log(`❌ No key found for [${service}]`);
      }
    }
  } catch (error) {
    console.error('Error debugging keys:', error);
  }
}

debugKeys();
