#!/bin/bash

# ============================================
# Vérification Configuration Production
# ============================================

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   Production Configuration Check       ║"
echo "║   Vérification variables d'env         ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Vérifier si .env existe
if [ ! -f ".env" ]; then
    echo "⚠️  Fichier .env non trouvé"
    echo ""
    echo "Créez un fichier .env à la racine avec:"
    echo ""
    echo "NODE_ENV=production"
    echo "PORT=8080"
    echo "DATABASE_URL=postgresql://..."
    echo "REDIS_URL=redis://:password@host:port"
    echo "JWT_SECRET=your-secret-key"
    echo ""
    exit 1
fi

echo "✅ Fichier .env trouvé"
echo ""
echo "Vérification des variables d'environnement:"
echo "─────────────────────────────────────────────"
echo ""

# Charger .env
source .env

# Vérifier NODE_ENV
if [ -z "$NODE_ENV" ]; then
    echo "❌ NODE_ENV manquant"
elif [ "$NODE_ENV" == "production" ]; then
    echo "✅ NODE_ENV=production"
else
    echo "⚠️  NODE_ENV=$NODE_ENV (devrait être 'production')"
fi

# Vérifier PORT
if [ -z "$PORT" ]; then
    echo "❌ PORT manquant"
else
    echo "✅ PORT=$PORT"
fi

# Vérifier DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL manquant"
else
    echo "✅ DATABASE_URL présent"
fi

# Vérifier REDIS_URL
if [ -z "$REDIS_URL" ]; then
    echo "⚠️  REDIS_URL optionnel (manquant)"
else
    echo "✅ REDIS_URL présent"
fi

# Vérifier JWT_SECRET
if [ -z "$JWT_SECRET" ]; then
    echo "❌ JWT_SECRET manquant"
else
    echo "✅ JWT_SECRET présent"
fi

# Vérifier ecosystem.config.cjs
echo ""
echo "Configuration PM2:"
echo "─────────────────────"
if [ -f "ecosystem.config.cjs" ]; then
    echo "✅ ecosystem.config.cjs trouvé"
else
    echo "❌ ecosystem.config.cjs manquant"
fi

# Vérifier dossier logs
echo ""
echo "Répertoires:"
echo "─────────────"
if [ -d "logs" ]; then
    echo "✅ Dossier logs existe"
else
    echo "⚠️  Dossier logs n'existe pas (sera créé par PM2)"
fi

# Vérifier node_modules
if [ -d "node_modules" ]; then
    echo "✅ node_modules existe"
else
    echo "❌ node_modules manquant - exécuter: npm install"
fi

# Vérifier server.js
echo ""
echo "Application:"
echo "─────────────"
if [ -f "server.js" ]; then
    echo "✅ server.js trouvé"
else
    echo "❌ server.js manquant"
fi

if [ -f "game.js" ]; then
    echo "✅ game.js trouvé"
else
    echo "❌ game.js manquant"
fi

# Résumé
echo ""
echo "════════════════════════════════════════"
echo "ℹ️  Prochaines étapes:"
echo ""
echo "1. Vérifier fichier .env complet"
echo "2. Exécuter: npm install"
echo "3. Tester localement: node server.js"
echo "4. Démarrer avec PM2: npm run pm2:start"
echo "5. Vérifier logs: npm run pm2:logs"
echo ""
echo "════════════════════════════════════════"
echo ""
