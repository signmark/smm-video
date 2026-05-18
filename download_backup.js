#!/usr/bin/env node

import https from 'https';
import http from 'http';
import fs from 'fs';

function downloadFile(url, filename) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        
        const options = {
            rejectUnauthorized: false // Ignore SSL certificate issues
        };

        const request = protocol.get(url, options, (response) => {
            if (response.statusCode === 200) {
                const file = fs.createWriteStream(filename);
                response.pipe(file);
                
                file.on('finish', () => {
                    file.close();
                    console.log(`Downloaded ${filename} successfully`);
                    resolve();
                });
                
                file.on('error', (err) => {
                    fs.unlink(filename, () => {}); // Delete the file on error
                    reject(err);
                });
            } else {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
            }
        });

        request.on('error', (err) => {
            reject(err);
        });

        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function main() {
    const urls = [
        'https://31.128.43.113:8080/backup/all_databases_20250605_111645.sql',
        'http://31.128.43.113:8080/backup/all_databases_20250605_111645.sql',
        'https://31.128.43.113/backup/all_databases_20250605_111645.sql',
        'http://31.128.43.113/backup/all_databases_20250605_111645.sql'
    ];

    for (const url of urls) {
        try {
            console.log(`Trying to download from: ${url}`);
            await downloadFile(url, 'all_databases_20250605_111645.sql');
            console.log('Download successful!');
            return;
        } catch (error) {
            console.log(`Failed: ${error.message}`);
        }
    }

    console.log('All download attempts failed. Manual download required:');
    console.log('scp root@31.128.43.113:/root/backup/all_databases_20250605_111645.sql ./');
}

main().catch(console.error);