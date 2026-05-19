/**
 * Script to clear all cached authentication tokens and force re-authentication
 * with the correct production credentials
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Clear any cached token files
const cacheFiles = [
  'admin_token_cache.json',
  'directus_session_cache.json',
  '.admin_token',
  'cached_admin_token.txt'
];

console.log('Clearing authentication cache...');

cacheFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted cache file: ${file}`);
  }
});

// Clear server cache directories
const cacheDirs = [
  'server/cache',
  'cache',
  '.cache'
];

cacheDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`Cleared cache directory: ${dir}`);
    } catch (error) {
      console.log(`Could not clear directory ${dir}: ${error.message}`);
    }
  }
});

console.log('Cache cleared. Environment variables:');
console.log(`DIRECTUS_URL: ${process.env.DIRECTUS_URL}`);
console.log(`DIRECTUS_ADMIN_EMAIL: ${process.env.DIRECTUS_ADMIN_EMAIL}`);
console.log(`DIRECTUS_ADMIN_PASSWORD: [${process.env.DIRECTUS_ADMIN_PASSWORD ? 'SET' : 'NOT SET'}]`);

console.log('\nRestart the server to apply changes.');