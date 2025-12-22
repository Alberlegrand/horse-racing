@echo off
REM ============================================
REM Vérification Configuration Production
REM ============================================

echo.
echo ╔════════════════════════════════════════╗
echo ║   Production Configuration Check       ║
echo ║   Vérification variables d'env         ║
echo ╚════════════════════════════════════════╝
echo.

REM Vérifier si .env existe
if not exist ".env" (
    echo ⚠️  Fichier .env non trouvé
    echo.
    echo Créez un fichier .env à la racine avec:
    echo.
    echo NODE_ENV=production
    echo PORT=8080
    echo DATABASE_URL=postgresql://...
    echo REDIS_URL=redis://:password@host:port
    echo JWT_SECRET=your-secret-key
    echo.
    pause
    exit /b 1
)

echo ✅ Fichier .env trouvé
echo.
echo Vérification des variables d'environnement:
echo ─────────────────────────────────────────
echo.

REM Vérifier NODE_ENV
findstr /R "^NODE_ENV=" .env >nul
if errorlevel 1 (
    echo ❌ NODE_ENV manquant
) else (
    for /f "tokens=2 delims==" %%a in ('findstr "^NODE_ENV=" .env') do (
        if "%%a"=="production" (
            echo ✅ NODE_ENV=production
        ) else (
            echo ⚠️  NODE_ENV=%%a (devrait être 'production')
        )
    )
)

REM Vérifier PORT
findstr /R "^PORT=" .env >nul
if errorlevel 1 (
    echo ❌ PORT manquant
) else (
    for /f "tokens=2 delims==" %%a in ('findstr "^PORT=" .env') do (
        echo ✅ PORT=%%a
    )
)

REM Vérifier DATABASE_URL
findstr /R "^DATABASE_URL=" .env >nul
if errorlevel 1 (
    echo ❌ DATABASE_URL manquant
) else (
    echo ✅ DATABASE_URL présent
)

REM Vérifier REDIS_URL
findstr /R "^REDIS_URL=" .env >nul
if errorlevel 1 (
    echo ⚠️  REDIS_URL optionnel (manquant)
) else (
    echo ✅ REDIS_URL présent
)

REM Vérifier JWT_SECRET
findstr /R "^JWT_SECRET=" .env >nul
if errorlevel 1 (
    echo ❌ JWT_SECRET manquant
) else (
    echo ✅ JWT_SECRET présent
)

REM Vérifier ecosystem.config.cjs
echo.
echo Configuration PM2:
echo ─────────────────
if exist "ecosystem.config.cjs" (
    echo ✅ ecosystem.config.cjs trouvé
) else (
    echo ❌ ecosystem.config.cjs manquant
)

REM Vérifier dossier logs
echo.
echo Répertoires:
echo ─────────────
if exist "logs" (
    echo ✅ Dossier logs existe
) else (
    echo ⚠️  Dossier logs n'existe pas (sera créé par PM2)
)

REM Vérifier node_modules
if exist "node_modules" (
    echo ✅ node_modules existe
) else (
    echo ❌ node_modules manquant - exécuter: npm install
)

REM Vérifier server.js
echo.
echo Application:
echo ─────────────
if exist "server.js" (
    echo ✅ server.js trouvé
) else (
    echo ❌ server.js manquant
)

if exist "game.js" (
    echo ✅ game.js trouvé
) else (
    echo ❌ game.js manquant
)

REM Résumé
echo.
echo ════════════════════════════════════════
echo ℹ️  Prochaines étapes:
echo.
echo 1. Vérifier fichier .env complet
echo 2. Exécuter: npm install
echo 3. Tester localement: node server.js
echo 4. Démarrer avec PM2: npm run pm2:start
echo 5. Vérifier logs: npm run pm2:logs
echo.
echo ════════════════════════════════════════
echo.
pause
