// Экспортируем все компоненты унифицированного интерфейса Directus

// Типы данных
export * from '../directus-types';

// Базовый CRUD интерфейс
export { directusCrud } from '../directus-crud';

// Адаптер для хранилища
export { directusStorageAdapter } from '../directus-storage-adapter';

// Менеджер авторизации
export { directusAuthManager } from '../directus-auth-manager';

// Примеры использования:
/*
import { 
  directusCrud, 
  directusStorageAdapter, 
  directusAuthManager, 
  DirectusRequestOptions 
} from './services/directus';

// Пример авторизации
const { token, userId } = await directusAuthManager.login('user@example.com', 'password');

// Пример создания записи
const newCampaign = await directusCrud.create('user_campaigns', {
  name: 'New Campaign',
  description: 'Campaign description',
  userId: userId
}, { authToken: token });

// Пример получения списка записей
const campaigns = await directusStorageAdapter.getCampaigns(userId);
*/