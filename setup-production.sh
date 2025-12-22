#!/bin/bash

# ============================================
# Configuration PM2 pour Production
# ============================================

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   PM2 Production Setup                 ║"
echo "║   Configuration pour Render.com        ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Vérifier PM2 installé
echo "[1/5] Vérification PM2..."
if ! npx pm2 -v > /dev/null 2>&1; then
    echo "❌ PM2 non installé. Installation..."
    npm install pm2
else
    echo "✅ PM2 installé"
fi

# Créer dossier logs
echo ""
echo "[2/5] Création dossier logs..."
mkdir -p logs
echo "✅ Dossier logs créé"

# Arrêter anciennes instances
echo ""
echo "[3/5] Arrêt des anciennes instances..."
npx pm2 delete all > /dev/null 2>&1
npx pm2 kill > /dev/null 2>&1
sleep 2

# Démarrer avec config production
echo ""
echo "[4/5] Démarrage avec config production..."
npx pm2 start ecosystem.config.cjs --env production
if [ $? -ne 0 ]; then
    echo "❌ Erreur au démarrage"
    exit 1
fi
echo "✅ PM2 démarré avec NODE_ENV=production"

# Sauvegarder config
echo ""
echo "[5/5] Sauvegarde configuration..."
npx pm2 save
echo "✅ Configuration sauvegardée"

# Afficher status
echo ""
echo "════════════════════════════════════════"
echo "✅ Configuration Production Complète!"
echo "════════════════════════════════════════"
echo ""
npx pm2 status
echo ""
echo "Commandes utiles:"
echo "  npm run pm2:logs       - Voir les logs"
echo "  npm run pm2:monit      - Dashboard temps réel"
echo "  npm run pm2:restart    - Redémarrer"
echo "  npm run pm2:stop       - Arrêter"
echo ""
echo "Server URL: http://localhost:8080"
echo ""
