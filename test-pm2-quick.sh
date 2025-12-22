#!/bin/bash

# ============================================
# Test PM2 Local - Rapide
# ============================================

echo ""
echo "╔════════════════════════════════════════╗"
echo "║     PM2 Local Test (Rapide)            ║"
echo "║     5 minutes maximum                  ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Arrêter anciennes instances
echo "[0/5] Cleanup..."
npx pm2 delete all > /dev/null 2>&1
npx pm2 kill > /dev/null 2>&1
sleep 1

# Vérifier config
echo ""
echo "[1/5] Vérification config..."
if [ ! -f ".env" ]; then
    echo "❌ Fichier .env manquant!"
    echo "Créez .env avec: NODE_ENV, DATABASE_URL, REDIS_URL, JWT_SECRET"
    exit 1
fi
echo "✅ .env présent"

# Installer deps si besoin
echo ""
echo "[2/5] Installation dépendances..."
if [ ! -d "node_modules" ]; then
    echo "⏳ npm install..."
    npm install --silent
fi
echo "✅ Dépendances OK"

# Démarrer PM2
echo ""
echo "[3/5] Démarrage PM2..."
mkdir -p logs
npx pm2 start ecosystem.config.cjs --silent
sleep 2

# Vérifier status
echo ""
echo "[4/5] Vérification status..."
STATUS=$(npx pm2 status 2>/dev/null | grep "horse-racing" | grep -o "online\|errored\|stopped" | head -1)
if [ "$STATUS" = "online" ]; then
    echo "✅ Status: ONLINE"
else
    echo "❌ Status: $STATUS"
    echo "Logs:"
    npx pm2 logs --lines 20
    exit 1
fi

echo ""
echo "[5/5] Test endpoints (10 secondes)..."
echo "⏳ Attendre que serveur soit prêt..."
sleep 3

echo ""
echo "Résultats:"
echo "─────────────────────"
echo ""

# Test health
echo "Test 1: GET /api/v1/health"
if curl -s http://localhost:8080/api/v1/health | grep -q "status"; then
    echo "✅ Health endpoint OK"
else
    echo "❌ Health endpoint non accessible"
fi

# Test frontend
echo ""
echo "Test 2: GET / (Frontend)"
if curl -s http://localhost:8080 | grep -q "html"; then
    echo "✅ Frontend OK"
else
    echo "❌ Frontend non accessible"
fi

# Afficher logs
echo ""
echo "════════════════════════════════════════"
echo "ℹ️  Derniers 10 logs:"
echo "════════════════════════════════════════"
npx pm2 logs --lines 10
echo ""

# Afficher status final
echo ""
echo "════════════════════════════════════════"
echo "✅ Test Complété!"
echo "════════════════════════════════════════"
npx pm2 status
echo ""

echo "Commandes suivantes:"
echo "  npm run pm2:logs       - Voir tous les logs"
echo "  npm run pm2:monit      - Dashboard temps réel"
echo "  npm run pm2:stop       - Arrêter"
echo "  npm run pm2:delete     - Supprimer"
echo ""
echo "Server URL: http://localhost:8080"
echo ""
