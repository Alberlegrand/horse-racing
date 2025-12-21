/**
 * Test Keepalive Endpoint
 * Vérifie que les requêtes keepalive fonctionnent correctement
 */

console.log('🔍 Test Keepalive Endpoint');
console.log('='.repeat(50));

// Test 1: URL format
console.log('\n✅ Test 1: URL Format');
const baseUrl = '/api/v1/keepalive/';
const dt = Math.random();
const fullUrl = baseUrl + '?dt=' + dt;
console.log('Base URL:', baseUrl);
console.log('With query param:', fullUrl);
console.log('Expected format: /api/v1/keepalive/?dt=0.xxx');
console.log('Format correct:', fullUrl.includes('?dt='));

// Test 2: Fetch request
console.log('\n✅ Test 2: Fetch Request');
async function testKeepalive() {
  try {
    const url = '/api/v1/keepalive/?dt=' + Math.random();
    console.log('Fetching:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Status:', response.status, response.statusText);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Response data:', data);
      
      if (data.data) {
        console.log('✅ Keepalive endpoint working correctly!');
        console.log('  - keepAliveTick:', data.data.keepAliveTick);
        console.log('  - keepAliveTimeout:', data.data.keepAliveTimeout);
        console.log('  - keepAliveUrl:', data.data.keepAliveUrl);
        return true;
      }
    } else {
      console.error('❌ Request failed:', response.status);
      return false;
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    return false;
  }
}

// Execute test
testKeepalive().then(success => {
  console.log('\n' + '='.repeat(50));
  if (success) {
    console.log('✅ Keepalive test PASSED');
  } else {
    console.log('❌ Keepalive test FAILED');
  }
});
