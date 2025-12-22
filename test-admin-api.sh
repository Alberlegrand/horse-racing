#!/bin/bash

# Test Script for Admin Dashboard API Endpoints
# Usage: ./test-admin-api.sh

BASE_URL="http://localhost:8080"
TOKEN="" # À remplir après login

echo "=========================================="
echo "Test Admin Dashboard API"
echo "=========================================="

# 1. LOGIN
echo ""
echo "1️⃣ Testing Login..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "station": "1",
    "username": "admin",
    "password": "your-password-here"
  }')

echo "Response: $LOGIN_RESPONSE"
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed - no token received"
  exit 1
fi

echo "✅ Login successful - Token: ${TOKEN:0:20}..."

# 2. GET USER INFO
echo ""
echo "2️⃣ Testing GET /api/v1/admin/user/me..."
curl -s -X GET "$BASE_URL/api/v1/admin/user/me" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 3. HEALTH CHECK
echo ""
echo "3️⃣ Testing GET /api/v1/admin/health..."
curl -s -X GET "$BASE_URL/api/v1/admin/health" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 4. GAME STATUS
echo ""
echo "4️⃣ Testing GET /api/v1/admin/game/status..."
curl -s -X GET "$BASE_URL/api/v1/admin/game/status" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 5. DATABASE STATS
echo ""
echo "5️⃣ Testing GET /api/v1/admin/database/stats..."
curl -s -X GET "$BASE_URL/api/v1/admin/database/stats" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 6. SYSTEM METRICS
echo ""
echo "6️⃣ Testing GET /api/v1/admin/system/metrics..."
curl -s -X GET "$BASE_URL/api/v1/admin/system/metrics" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 7. PAUSE GAME (non-destructive)
echo ""
echo "7️⃣ Testing POST /api/v1/admin/game/pause..."
curl -s -X POST "$BASE_URL/api/v1/admin/game/pause" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 8. RESUME GAME
echo ""
echo "8️⃣ Testing POST /api/v1/admin/game/resume..."
curl -s -X POST "$BASE_URL/api/v1/admin/game/resume" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 9. CLEAR CACHE
echo ""
echo "9️⃣ Testing POST /api/v1/admin/server/cache/clear..."
curl -s -X POST "$BASE_URL/api/v1/admin/server/cache/clear" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 10. DATABASE STATS AGAIN
echo ""
echo "🔟 Testing POST /api/v1/admin/database/cache/rebuild..."
curl -s -X POST "$BASE_URL/api/v1/admin/database/cache/rebuild" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "=========================================="
echo "✅ All tests completed!"
echo "=========================================="
