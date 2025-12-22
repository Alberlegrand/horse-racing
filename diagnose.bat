@echo off

REM 🚨 Script de démarrage DIAGNOSTIC pour production (Windows)
REM Utilisé pour capturer les vraies erreurs au démarrage

echo 🔧 Mode DIAGNOSTIC - Lancement direct du serveur (sans PM2)
echo 📍 Ceci affichera toutes les erreurs du serveur
echo.

REM Définir les variables d'environnement
set NODE_ENV=production
set PORT=8080
set LOG_LEVEL=debug

echo 🌍 Environment:
echo   NODE_ENV=%NODE_ENV%
echo   PORT=%PORT%
echo   LOG_LEVEL=%LOG_LEVEL%
echo.

echo ▶️  Démarrage du serveur...
echo ════════════════════════════════════════════════

REM Lancer le serveur directement pour voir tous les logs
node server.js

echo ════════════════════════════════════════════════
echo ❌ Le serveur s'est arrêté

pause
