import axios from 'axios';

const DIRECTUS_URL = process.env.DIRECTUS_URL;

if (!DIRECTUS_URL) {
  console.error('❌ Ошибка: DIRECTUS_URL не задан в .env');
}

export const directusApi = axios.create({
  baseURL: DIRECTUS_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Обработка ошибок
directusApi.interceptors.response.use(
  response => response,
  error => {
    console.error('Directus API Error:', error.response?.data || error.message);
    throw error;
  }
);

export { DIRECTUS_URL };