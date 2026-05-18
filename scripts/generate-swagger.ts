import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { default: swaggerSpecs } = await import('../server/config/swagger.js');

const outPath = path.resolve(__dirname, '../dist/public/swagger.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(swaggerSpecs, null, 2), 'utf-8');
console.log(`✅ swagger.json сгенерирован: ${outPath}`);
