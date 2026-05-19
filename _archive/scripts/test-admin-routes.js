/**
 * Test script to verify admin routes functionality
 */
import axios from 'axios';

async function testAdminRoutes() {
  const baseUrl = 'http://localhost:5000';
  
  // Use the DIRECTUS_TOKEN from environment for testing
  const token = process.env.DIRECTUS_TOKEN || '_CYEZbtGwG2bil0Unpd1GQ58EaW22VRm';
  
  console.log('Testing admin routes with token:', token.substring(0, 10) + '...');
  
  try {
    // Test 1: Get admin users list
    console.log('\n1. Testing GET /api/admin/users');
    const usersResponse = await axios.get(`${baseUrl}/api/admin/users`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✓ Users list retrieved successfully');
    console.log(`Found ${usersResponse.data.data?.length || 0} users`);
    
    // Test 2: Get admin activity stats
    console.log('\n2. Testing GET /api/admin/users/activity');
    const activityResponse = await axios.get(`${baseUrl}/api/admin/users/activity`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✓ Activity stats retrieved successfully');
    console.log('Stats:', activityResponse.data.data?.stats);
    
    // Test 3: Update user (if users exist)
    if (usersResponse.data.data && usersResponse.data.data.length > 0) {
      const testUserId = usersResponse.data.data[0].id;
      console.log(`\n3. Testing PATCH /api/admin/users/${testUserId}`);
      
      const updateResponse = await axios.patch(`${baseUrl}/api/admin/users/${testUserId}`, {
        status: 'active'
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('✓ User update successful');
    }
    
    console.log('\n✅ All admin routes are working correctly!');
    
  } catch (error) {
    console.error('\n❌ Admin route test failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Run the test
testAdminRoutes();