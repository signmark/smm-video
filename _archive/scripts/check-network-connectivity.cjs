#!/usr/bin/env node

/**
 * Диагностика сетевого подключения для Claude API
 * Использование: node check-network-connectivity.cjs
 */

const https = require('https');
const dns = require('dns');
const axios = require('axios');

async function checkDNS() {
  console.log('🔍 Checking DNS resolution for api.anthropic.com...');
  
  return new Promise((resolve) => {
    dns.lookup('api.anthropic.com', (err, address, family) => {
      if (err) {
        console.log(`❌ DNS resolution failed: ${err.message}`);
        resolve({ success: false, error: err.message });
      } else {
        console.log(`✅ DNS resolved: api.anthropic.com -> ${address} (IPv${family})`);
        resolve({ success: true, address, family });
      }
    });
  });
}

async function checkTCPConnection() {
  console.log('🔍 Checking TCP connection to api.anthropic.com:443...');
  
  return new Promise((resolve) => {
    const socket = new (require('net').Socket)();
    
    socket.setTimeout(10000);
    
    socket.on('connect', () => {
      console.log('✅ TCP connection successful');
      socket.destroy();
      resolve({ success: true });
    });
    
    socket.on('timeout', () => {
      console.log('❌ TCP connection timeout');
      socket.destroy();
      resolve({ success: false, error: 'timeout' });
    });
    
    socket.on('error', (err) => {
      console.log(`❌ TCP connection failed: ${err.message}`);
      socket.destroy();
      resolve({ success: false, error: err.message });
    });
    
    socket.connect(443, 'api.anthropic.com');
  });
}

async function checkHTTPS() {
  console.log('🔍 Checking HTTPS connection...');
  
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/',
      method: 'GET',
      timeout: 10000
    };
    
    const req = https.request(options, (res) => {
      console.log(`✅ HTTPS connection successful: ${res.statusCode} ${res.statusMessage}`);
      resolve({ success: true, statusCode: res.statusCode });
    });
    
    req.on('error', (err) => {
      console.log(`❌ HTTPS connection failed: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
    
    req.on('timeout', () => {
      console.log('❌ HTTPS connection timeout');
      req.destroy();
      resolve({ success: false, error: 'timeout' });
    });
    
    req.end();
  });
}

async function checkAxiosRequest() {
  console.log('🔍 Testing simple axios request to Claude API...');
  
  try {
    const response = await axios.get('https://api.anthropic.com/', {
      timeout: 10000,
      validateStatus: () => true // Принимаем любой статус
    });
    
    console.log(`✅ Axios request successful: ${response.status} ${response.statusText}`);
    return { success: true, status: response.status, headers: response.headers };
  } catch (error) {
    console.log(`❌ Axios request failed: ${error.message}`);
    if (error.code) {
      console.log(`   Error code: ${error.code}`);
    }
    return { success: false, error: error.message, code: error.code };
  }
}

async function main() {
  console.log('🚀 Network Connectivity Diagnostic for Claude API');
  console.log('=================================================');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Node.js: ${process.version}`);
  console.log('');
  
  const tests = [
    { name: 'DNS Resolution', fn: checkDNS },
    { name: 'TCP Connection', fn: checkTCPConnection },
    { name: 'HTTPS Connection', fn: checkHTTPS },
    { name: 'Axios Request', fn: checkAxiosRequest }
  ];
  
  const results = [];
  
  for (const test of tests) {
    console.log(`\n--- ${test.name} ---`);
    const result = await test.fn();
    results.push({ name: test.name, ...result });
    
    // Пауза между тестами
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n=== SUMMARY ===');
  
  const passed = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (passed.length > 0) {
    console.log(`✅ Passed tests (${passed.length}/${results.length}):`);
    passed.forEach(r => console.log(`   - ${r.name}`));
  }
  
  if (failed.length > 0) {
    console.log(`❌ Failed tests (${failed.length}/${results.length}):`);
    failed.forEach(r => console.log(`   - ${r.name}: ${r.error || 'unknown error'}`));
  }
  
  console.log('');
  
  if (failed.length === 0) {
    console.log('🎉 All network tests passed! Claude API should be reachable.');
  } else if (failed.some(r => r.name === 'DNS Resolution')) {
    console.log('🔥 DNS resolution failed - this is likely the root cause.');
    console.log('   Check DNS settings or try using a different DNS server.');
  } else if (failed.some(r => r.name === 'TCP Connection')) {
    console.log('🔥 TCP connection failed - likely firewall or network policy blocking.');
    console.log('   Check firewall rules for outgoing HTTPS connections.');
  } else {
    console.log('⚠️  Some network issues detected. Check the failures above.');
  }
}

main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});