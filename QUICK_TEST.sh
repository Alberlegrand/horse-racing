#!/usr/bin/env bash
# Quick Test & Verification Script for HITBET777 Betting App

echo "🚀 HITBET777 Betting App - Quick Tests"
echo "=========================================="
echo ""

# Test 1: Check if Node is running
echo "1️⃣  Checking Node.js..."
node --version
if [ $? -eq 0 ]; then
    echo "✅ Node.js is available"
else
    echo "❌ Node.js not found - install it first"
    exit 1
fi

# Test 2: Check dependencies
echo ""
echo "2️⃣  Checking npm packages..."
npm list express-session connect-redis > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Session packages installed"
else
    echo "❌ Session packages missing - running: npm install express-session connect-redis@7"
    npm install express-session connect-redis@7
fi

# Test 3: Check database
echo ""
echo "3️⃣  Database Status"
echo "   - PostgreSQL should be running"
echo "   - Database: hitbet"
echo "   - Tables will be created on server startup"
echo "   To verify manually:"
echo "   psql -U postgres -d hitbet -c '\\dt'"

# Test 4: Start server
echo ""
echo "4️⃣  To start the server:"
echo "   npm start"
echo ""
echo "5️⃣  To start with nodemon (auto-reload):"
echo "   npx nodemon server.js"

# Test 6: Test keepalive endpoint
echo ""
echo "6️⃣  To test keepalive endpoint (after server is running):"
echo "   curl 'http://localhost:8080/api/v1/keepalive?dt=test'"
echo ""
echo "   Expected response:"
echo "   {"
echo "     \"data\": {"
echo "       \"keepAliveTick\": 30000,"
echo "       \"keepAliveTimeout\": 5000,"
echo "       \"keepAliveUrl\": \"http://localhost:8080/api/v1/keepalive/\""
echo "     }"
echo "   }"

# Test 7: Test account endpoint
echo ""
echo "7️⃣  To test accounts endpoint (after login):"
echo "   curl -H 'Cookie: authSession=YOUR_TOKEN' http://localhost:8080/api/v1/accounts/me"

# Test 8: Check logs
echo ""
echo "8️⃣  View server logs:"
echo "   tail -f server.log (if enabled)"

echo ""
echo "=========================================="
echo "📋 Important Files:"
echo "   - models/accountModel.js       (Account operations)"
echo "   - routes/accounts.js           (API endpoints)"
echo "   - static/js/webclient.js       (Fixed keepalive)"
echo "   - screen.html                  (Config updated)"
echo "   - KEEPALIVE_FIX.md             (Fix documentation)"
echo ""
echo "✨ All systems ready for testing!"
