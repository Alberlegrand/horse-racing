@echo off
REM ============================================
REM Test PM2 Local - Rapide
REM ============================================

color 0A
echo.
echo ╔════════════════════════════════════════╗
echo ║     PM2 Local Test (Rapide)            ║
echo ║     5 minutes maximum                  ║
echo ╚════════════════════════════════════════╝
echo.

REM Arrêter anciennes instances
echo [0/5] Cleanup...
call npx pm2 delete all >nul 2>&1
call npx pm2 kill >nul 2>&1
timeout /t 1 /nobreak >nul

REM Vérifier config
echo.
echo [1/5] Vérification config...
if not exist ".env" (
    echo ❌ Fichier .env manquant!
    echo Créez .env avec: NODE_ENV, DATABASE_URL, REDIS_URL, JWT_SECRET
    exit /b 1
)
echo ✅ .env présent

REM Installer deps si besoin
echo.
echo [2/5] Installation dépendances...
if not exist "node_modules" (
    echo ⏳ npm install...
    call npm install --silent
)
echo ✅ Dépendances OK

REM Démarrer PM2
echo.
echo [3/5] Démarrage PM2...
mkdir logs >nul 2>&1
call npx pm2 start ecosystem.config.cjs --silent
timeout /t 2 /nobreak >nul

REM Vérifier status
echo.
echo [4/5] Vérification status...
for /f "tokens=3" %%i in ('npx pm2 status 2^>nul ^| findstr "horse-racing"') do (
    if "%%i"=="online" (
        echo ✅ Status: ONLINE
        goto :test_endpoints
    )
)
echo ❌ Status: ERREUR
echo Logs:
call npx pm2 logs --lines 20
exit /b 1

:test_endpoints
echo.
echo [5/5] Test endpoints (10 secondes)...
echo ⏳ Attendre que serveur soit prêt...
timeout /t 3 /nobreak >nul

echo.
echo Résultats:
echo ─────────────────────
echo.

REM Test health
echo Test 1: GET /api/v1/health
curl -s http://localhost:8080/api/v1/health | findstr /I "status" >nul
if errorlevel 1 (
    echo ❌ Health endpoint non accessible
) else (
    echo ✅ Health endpoint OK
)

REM Test frontend
echo.
echo Test 2: GET / (Frontend)
curl -s http://localhost:8080 | findstr /I "html" >nul
if errorlevel 1 (
    echo ❌ Frontend non accessible
) else (
    echo ✅ Frontend OK
)

REM Afficher logs
echo.
echo ════════════════════════════════════════
echo ℹ️  Derniers 10 logs:
echo ════════════════════════════════════════
call npx pm2 logs --lines 10
echo.

REM Afficher status final
echo.
echo ════════════════════════════════════════
echo ✅ Test Complété!
echo ════════════════════════════════════════
call npx pm2 status
echo.

echo Commandes suivantes:
echo   npm run pm2:logs       - Voir tous les logs
echo   npm run pm2:monit      - Dashboard temps réel
echo   npm run pm2:stop       - Arrêter
echo   npm run pm2:delete     - Supprimer
echo.
echo Server URL: http://localhost:8080
echo.
