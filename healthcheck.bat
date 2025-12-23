@echo off

REM 📊 Script de health check pour HITBET777 (Windows)
REM Teste si le serveur répond correctement

echo 🏥 Health Check - HITBET777 Server
echo ========================================
echo.

REM URL du serveur
set SERVER_URL=http://localhost:8080

echo 🔍 Checking server at: %SERVER_URL%
echo.

REM Test 1: Server is running
echo 1️⃣  Testing if server is responding...
curl -s %SERVER_URL%/ > nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo    ✅ Server is responding
) else (
    echo    ❌ Server is NOT responding
    echo    Make sure PM2 is running: npm run pm2:start
    pause
    exit /b 1
)

REM Test 2: Health endpoint
echo.
echo 2️⃣  Testing health endpoint...
curl -s "%SERVER_URL%/api/v1/health" > nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo    ✅ Health endpoint works
) else (
    echo    ⚠️  Health endpoint not responding
)

REM Test 3: Database connection
echo.
echo 3️⃣  Checking database connection...
curl -s "%SERVER_URL%/api/v1/rounds/status" | find /I "currentRound" > nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo    ✅ Database is accessible
) else (
    echo    ⚠️  Database might not be accessible
)

REM Test 4: WebSocket
echo.
echo 4️⃣  Checking WebSocket availability...
echo    Note: WebSocket check requires additional setup
echo    ℹ️  WebSocket is at: ws://localhost:8080/connection/websocket

REM Test 5: PM2 Status
echo.
echo 5️⃣  PM2 Status...
npx pm2 list | find "horse-racing" > nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo    ✅ PM2 is managing the app
) else (
    echo    ❌ PM2 is not managing the app
)

echo.
echo ========================================
echo ✅ Health check complete!
echo.
echo For detailed logs, run: npm run pm2:logs
echo.

pause
