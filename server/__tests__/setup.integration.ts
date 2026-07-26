/**
 * Setup для интеграционных тестов — реальные сетевые запросы, без моков axios
 */
import path from 'path';
import dotenv from 'dotenv';

// Интеграционные тесты бьют по реальной сети, поэтому реальный ../../.env
// (если он есть) грузится ПЕРВЫМ и имеет приоритет. Фиктивный .env.test —
// только запасные значения, чтобы setup не падал при отсутствии кред.
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '.env.test') });
