@echo off
REM ✅ Script de démarrage PM2 pour HITBET777 (Windows)
REM Usage: start-pm2.bat

echo 🚀 Démarrage de HITBET777 avec PM2...

REM Vérifier que PM2 est installé
where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ PM2 n'est pas installé. Installation globale...
    npm install -g pm2
)

REM Arrêter les processus existants
echo 🛑 Arrêt des processus PM2 existants...
pm2 delete all

REM Démarrer avec la configuration
echo ✅ Démarrage des processus...
call npm run pm2:start

REM Sauvegarder pour redémarrage automatique
echo 💾 Sauvegarde de la configuration...
call npm run pm2:save

REM Afficher l'état
echo.
echo 📊 État des processus:
pm2 list

echo.
echo ✅ HITBET777 est maintenant en cours d'exécution avec PM2!
echo.
echo Commandes utiles:
echo   npm run pm2:logs      - Voir les logs en temps réel
echo   npm run pm2:monit     - Monitor les processus
echo   npm run pm2:restart   - Redémarrer
echo   npm run pm2:stop      - Arrêter
echo.

pause
