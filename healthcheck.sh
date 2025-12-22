#!/bin/bash

# 📊 Script de health check pour Horse Racing
# Teste si le serveur répond correctement

echo "🏥 Health Check - Horse Racing Server"
echo "========================================"
echo ""

# URL du serveur
SERVER_URL="http://localhost:8080"

echo "🔍 Checking server at: $SERVER_URL"
echo ""

# Test 1: Server is running
echo "1️⃣  Testing if server is responding..."
if curl -s "$SERVER_URL/" > /dev/null 2>&1; then
    echo "   ✅ Server is responding"
else
    echo "   ❌ Server is NOT responding"
    echo "   Make sure PM2 is running: npm run pm2:start"
    exit 1
fi

# Test 2: Health endpoint
echo ""
echo "2️⃣  Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s "$SERVER_URL/api/v1/health" 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "   ✅ Health endpoint works"
    echo "   Response: $HEALTH_RESPONSE"
else
    echo "   ⚠️  Health endpoint not responding"
fi

# Test 3: Database connection
echo ""
echo "3️⃣  Checking database connection..."
DB_RESPONSE=$(curl -s "$SERVER_URL/api/v1/rounds/status" 2>/dev/null | grep -q "currentRound" && echo "ok" || echo "failed")
if [ "$DB_RESPONSE" = "ok" ]; then
    echo "   ✅ Database is accessible"
else
    echo "   ⚠️  Database might not be accessible"
fi

# Test 4: WebSocket
echo ""
echo "4️⃣  Checking WebSocket availability..."
echo "   Note: WebSocket check requires additional setup"
echo "   ℹ️  WebSocket is at: ws://localhost:8080/connection/websocket"

# Test 5: PM2 Status
echo ""
echo "5️⃣  PM2 Status..."
npx pm2 list | grep -q "horse-racing" && echo "   ✅ PM2 is managing the app" || echo "   ❌ PM2 is not managing the app"

echo ""
echo "========================================"
echo "✅ Health check complete!"
echo ""
echo "For detailed logs, run: npm run pm2:logs"
