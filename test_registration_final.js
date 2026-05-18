/**
 * Final test of registration system with corrected SMM Manager User role
 */

import axios from 'axios';

const LOCAL_API_URL = 'http://localhost:5000';

async function testRegistration() {
  try {
    console.log('Testing registration with corrected SMM Manager User role...\n');
    
    const registrationData = {
      email: 'test-final-registration-' + Date.now() + '@roboflow.tech',
      password: 'TestPassword123!',
      confirmPassword: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User'
    };

    console.log('Registration data:', {
      ...registrationData,
      password: '***',
      confirmPassword: '***'
    });

    const response = await axios.post(`${LOCAL_API_URL}/api/auth/register`, registrationData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✓ Registration successful!');
    console.log('Response:', response.data);
    
    // Test login with the new user
    const loginData = {
      email: registrationData.email,
      password: registrationData.password
    };

    const loginResponse = await axios.post(`${LOCAL_API_URL}/api/auth/login`, loginData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✓ Login successful!');
    console.log('User data:', loginResponse.data.user);
    
    return true;
  } catch (error) {
    console.log('✗ Registration failed:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error:', error.response.data);
    } else {
      console.log('Error:', error.message);
    }
    return false;
  }
}

async function main() {
  const result = await testRegistration();
  
  if (result) {
    console.log('\n🎉 Registration system is now working correctly!');
    console.log('Users can successfully register and log in to the system.');
  } else {
    console.log('\n❌ Registration system still has issues.');
  }
}

main();