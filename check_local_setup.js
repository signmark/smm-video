#!/usr/bin/env node

import axios from 'axios';

async function checkLocalDirectus() {
    try {
        console.log('Checking local Directus at http://localhost:8055...');
        const response = await axios.get('http://localhost:8055/server/ping');
        console.log('✅ Local Directus is running:', response.data);
        return true;
    } catch (error) {
        console.log('❌ Local Directus not available:', error.message);
        return false;
    }
}

async function checkProductionDirectus() {
    try {
        console.log('Checking production Directus at https://directus.roboflow.tech...');
        const response = await axios.get('https://directus.roboflow.tech/server/ping');
        console.log('✅ Production Directus is running:', response.data);
        return true;
    } catch (error) {
        console.log('❌ Production Directus not available:', error.message);
        return false;
    }
}

async function main() {
    console.log('=== Directus Connectivity Check ===');
    
    const localOk = await checkLocalDirectus();
    const productionOk = await checkProductionDirectus();
    
    console.log('\n=== Summary ===');
    console.log('Local Directus (localhost:8055):', localOk ? 'Available' : 'Not Available');
    console.log('Production Directus (directus.roboflow.tech):', productionOk ? 'Available' : 'Not Available');
    
    if (!localOk && !productionOk) {
        console.log('\n⚠️ No Directus instances are available. You may need to:');
        console.log('1. Start local Docker containers');
        console.log('2. Check production server status');
        console.log('3. Verify network connectivity');
    } else if (localOk) {
        console.log('\n✅ Local Directus is available - system should use localhost');
    } else if (productionOk) {
        console.log('\n⚠️ Only production Directus is available - check local setup');
    }
}

main().catch(console.error);