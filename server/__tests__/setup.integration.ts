/**
 * Setup для интеграционных тестов — реальные сетевые запросы, без моков axios
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });
