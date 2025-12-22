@echo off
REM Test Script for Admin Dashboard API Endpoints (Windows)
REM Usage: test-admin-api.bat

setlocal enabledelayedexpansion

set BASE_URL=http://localhost:8080
set TOKEN=
set "PWD=your-password-here"

echo.
echo ==========================================
echo Test Admin Dashboard API
echo ==========================================
echo.

REM 1. LOGIN
echo 1 Testing Login...
powershell -Command "^
  $loginResponse = Invoke-WebRequest -Uri '%BASE_URL%/api/v1/auth/login' ^
    -Method POST ^
    -Headers @{'Content-Type'='application/json'} ^
    -Body '{\"station\":\"1\",\"username\":\"admin\",\"password\":\"%PWD%\"}' ^
    -UseBasicParsing; ^
  $loginBody = $loginResponse.Content | ConvertFrom-Json; ^
  if ($loginBody.token) { ^
    Write-Host 'Token: ' $loginBody.token.Substring(0,20)'...'; ^
    Set-Content -Path 'token.txt' -Value $loginBody.token ^
  } else { ^
    Write-Host 'Login failed'; ^
    exit 1 ^
  } ^
"

if not exist token.txt (
  echo Error: Login failed - no token file created
  exit /b 1
)

REM Read token from file
for /f %%i in (token.txt) do set TOKEN=%%i

echo Token acquired: %TOKEN:~0,20%...
echo.

REM 2. GET HEALTH
echo 2 Testing GET /api/v1/admin/health...
powershell -Command "^
  $response = Invoke-WebRequest -Uri '%BASE_URL%/api/v1/admin/health' ^
    -Method GET ^
    -Headers @{'Authorization'='Bearer %TOKEN%'} ^
    -UseBasicParsing; ^
  $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5 ^
"
echo.

REM 3. GET GAME STATUS
echo 3 Testing GET /api/v1/admin/game/status...
powershell -Command "^
  $response = Invoke-WebRequest -Uri '%BASE_URL%/api/v1/admin/game/status' ^
    -Method GET ^
    -Headers @{'Authorization'='Bearer %TOKEN%'} ^
    -UseBasicParsing; ^
  $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5 ^
"
echo.

REM 4. GET DATABASE STATS
echo 4 Testing GET /api/v1/admin/database/stats...
powershell -Command "^
  $response = Invoke-WebRequest -Uri '%BASE_URL%/api/v1/admin/database/stats' ^
    -Method GET ^
    -Headers @{'Authorization'='Bearer %TOKEN%'} ^
    -UseBasicParsing; ^
  $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5 ^
"
echo.

REM 5. CLEAR CACHE
echo 5 Testing POST /api/v1/admin/server/cache/clear...
powershell -Command "^
  $response = Invoke-WebRequest -Uri '%BASE_URL%/api/v1/admin/server/cache/clear' ^
    -Method POST ^
    -Headers @{'Authorization'='Bearer %TOKEN%'} ^
    -UseBasicParsing; ^
  $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5 ^
"
echo.

REM 6. PAUSE GAME
echo 6 Testing POST /api/v1/admin/game/pause...
powershell -Command "^
  $response = Invoke-WebRequest -Uri '%BASE_URL%/api/v1/admin/game/pause' ^
    -Method POST ^
    -Headers @{'Authorization'='Bearer %TOKEN%'} ^
    -UseBasicParsing; ^
  $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5 ^
"
echo.

REM 7. RESUME GAME
echo 7 Testing POST /api/v1/admin/game/resume...
powershell -Command "^
  $response = Invoke-WebRequest -Uri '%BASE_URL%/api/v1/admin/game/resume' ^
    -Method POST ^
    -Headers @{'Authorization'='Bearer %TOKEN%'} ^
    -UseBasicParsing; ^
  $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5 ^
"
echo.

REM Cleanup
del token.txt

echo ==========================================
echo Test completed!
echo ==========================================
pause
