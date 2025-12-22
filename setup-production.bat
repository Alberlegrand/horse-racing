@echo off
REM ============================================
REM Configuration PM2 pour Production
REM ============================================

echo.
echo ╔════════════════════════════════════════╗
echo ║   PM2 Production Setup                 ║
echo ║   Configuration pour Render.com        ║
echo ╚════════════════════════════════════════╝
echo.

REM Vérifier PM2 installé
echo [1/5] Vérification PM2...
call npx pm2 -v >nul 2>&1
if errorlevel 1 (
    echo ❌ PM2 non installé. Installation...
    call npm install pm2
) else (
    echo ✅ PM2 installé
)

REM Créer dossier logs
echo.
echo [2/5] Création dossier logs...
if not exist "logs" mkdir logs
echo ✅ Dossier logs créé

REM Arrêter anciennes instances
echo.
echo [3/5] Arrêt des anciennes instances...
call npx pm2 delete all >nul 2>&1
call npx pm2 kill >nul 2>&1
timeout /t 2 /nobreak

REM Démarrer avec config production
echo.
echo [4/5] Démarrage avec config production...
call npx pm2 start ecosystem.config.cjs --env production
if errorlevel 1 (
    echo ❌ Erreur au démarrage
    exit /b 1
)
echo ✅ PM2 démarré avec NODE_ENV=production

REM Sauvegarder config
echo.
echo [5/5] Sauvegarde configuration...
call npx pm2 save
echo ✅ Configuration sauvegardée

REM Afficher status
echo.
echo ════════════════════════════════════════
echo ✅ Configuration Production Complète!
echo ════════════════════════════════════════
echo.
call npx pm2 status
echo.
echo Commandes utiles:
echo   npm run pm2:logs       - Voir les logs
echo   npm run pm2:monit      - Dashboard temps réel
echo   npm run pm2:restart    - Redémarrer
echo   npm run pm2:stop       - Arrêter
echo.
echo Server URL: http://localhost:8080
echo.
pause
