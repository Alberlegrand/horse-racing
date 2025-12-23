#!/bin/bash

# ===================================================================
# 🔍 Production Readiness Check - Admin Dashboard
# ===================================================================
# Ce script vérifie que le dashboard admin est prêt pour la production

echo "
════════════════════════════════════════════════════════════════════
🔍 VÉRIFICATION PRODUCTION - ADMIN DASHBOARD
════════════════════════════════════════════════════════════════════
"

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CHECKS_PASSED=0
CHECKS_FAILED=0

# Fonction pour test réussi
pass_check() {
  echo -e "${GREEN}✅${NC} $1"
  ((CHECKS_PASSED++))
}

# Fonction pour test échoué
fail_check() {
  echo -e "${RED}❌${NC} $1"
  ((CHECKS_FAILED++))
}

# Fonction pour warning
warn_check() {
  echo -e "${YELLOW}⚠️${NC} $1"
}

# ===================================================================
# 1. VÉRIFIER LES FICHIERS CLÉS
# ===================================================================
echo -e "\n${YELLOW}[1/6] Vérification des fichiers clés...${NC}"

if [ -f "server.js" ]; then
  pass_check "server.js existe"
else
  fail_check "server.js manquant"
fi

if [ -f "public/admin-dashboard.html" ]; then
  pass_check "admin-dashboard.html existe"
else
  fail_check "admin-dashboard.html manquant"
fi

if [ -f "routes/admin.js" ]; then
  pass_check "routes/admin.js existe"
else
  fail_check "routes/admin.js manquant"
fi

if [ -f "package.json" ]; then
  pass_check "package.json existe"
else
  fail_check "package.json manquant"
fi

# ===================================================================
# 2. VÉRIFIER LES DÉPENDANCES
# ===================================================================
echo -e "\n${YELLOW}[2/6] Vérification des dépendances...${NC}"

if grep -q '"helmet"' package.json; then
  pass_check "helmet est dans package.json"
else
  fail_check "helmet manquant dans package.json"
fi

if grep -q '"express"' package.json; then
  pass_check "express est dans package.json"
else
  fail_check "express manquant"
fi

if grep -q '"jsonwebtoken"' package.json; then
  pass_check "jsonwebtoken est dans package.json"
else
  fail_check "jsonwebtoken manquant"
fi

if grep -q '"redis"' package.json; then
  pass_check "redis est dans package.json"
else
  fail_check "redis manquant"
fi

# ===================================================================
# 3. VÉRIFIER LE CODE POUR LES BONNES PRATIQUES
# ===================================================================
echo -e "\n${YELLOW}[3/6] Vérification du code...${NC}"

# Vérifier que server.js importe helmet
if grep -q "import helmet from \"helmet\"" server.js; then
  pass_check "Helmet importé dans server.js"
else
  fail_check "Helmet pas importé dans server.js"
fi

# Vérifier que le dashboard utilise window.location.origin
if grep -q "window.location.origin" public/admin-dashboard.html; then
  pass_check "API_BASE utilise window.location.origin (compatible production)"
else
  fail_check "API_BASE hardcodée en localhost"
fi

# Vérifier que les routes admin sont enregistrées
if grep -q 'app.use.*"/api/v1/admin/"' server.js; then
  pass_check "Routes admin enregistrées dans server.js"
else
  fail_check "Routes admin non enregistrées"
fi

# Vérifier la configuration CORS
if grep -q "corsOptions" server.js; then
  pass_check "Configuration CORS pour production trouvée"
else
  warn_check "Configuration CORS simple (accepte tout origin)"
fi

# ===================================================================
# 4. VÉRIFIER LES VARIABLES D'ENVIRONNEMENT
# ===================================================================
echo -e "\n${YELLOW}[4/6] Vérification des variables d'environnement...${NC}"

if [ -f ".env" ]; then
  pass_check ".env existe"
  
  if grep -q "NODE_ENV" .env; then
    NODE_ENV=$(grep NODE_ENV .env | cut -d= -f2)
    pass_check "NODE_ENV configuré: $NODE_ENV"
  else
    warn_check "NODE_ENV non configuré dans .env"
  fi
  
  if grep -q "JWT_SECRET" .env; then
    pass_check "JWT_SECRET configuré"
  else
    fail_check "JWT_SECRET manquant dans .env"
  fi
  
  if grep -q "DATABASE_URL" .env; then
    pass_check "DATABASE_URL configuré"
  else
    warn_check "DATABASE_URL manquant (peut être en env var)"
  fi
  
  if grep -q "REDIS_URL" .env; then
    pass_check "REDIS_URL configuré"
  else
    warn_check "REDIS_URL manquant (peut être en env var)"
  fi
else
  warn_check ".env manquant (les variables peuvent être en env var)"
fi

if [ -f ".env.production" ]; then
  pass_check ".env.production exemple existe"
else
  warn_check ".env.production exemple manquant"
fi

# ===================================================================
# 5. VÉRIFIER LES ENDPOINTS ADMIN
# ===================================================================
echo -e "\n${YELLOW}[5/6] Vérification des endpoints admin...${NC}"

ENDPOINTS=(
  "POST /server/restart"
  "POST /server/cache/clear"
  "GET /health"
  "GET /game/status"
  "POST /game/pause"
  "POST /game/resume"
  "POST /game/round/force"
  "POST /database/backup"
  "POST /database/cache/rebuild"
)

for endpoint in "${ENDPOINTS[@]}"; do
  if grep -q "$(echo $endpoint | cut -d' ' -f2)" routes/admin.js; then
    pass_check "Endpoint trouvé: $endpoint"
  else
    fail_check "Endpoint manquant: $endpoint"
  fi
done

# ===================================================================
# 6. VÉRIFIER LA DOCUMENTATION
# ===================================================================
echo -e "\n${YELLOW}[6/6] Vérification de la documentation...${NC}"

DOCS=(
  "ADMIN_DASHBOARD.md"
  "ADMIN_DASHBOARD_SETUP.md"
  "ADMIN_DASHBOARD_QUICK_START.md"
  "ADMIN_DASHBOARD_PRODUCTION_GUIDE.md"
)

for doc in "${DOCS[@]}"; do
  if [ -f "$doc" ]; then
    pass_check "Documentation trouvée: $doc"
  else
    warn_check "Documentation manquante: $doc"
  fi
done

# ===================================================================
# RÉSUMÉ
# ===================================================================
echo -e "\n════════════════════════════════════════════════════════════════════"
echo -e "📊 RÉSUMÉ DE LA VÉRIFICATION"
echo -e "════════════════════════════════════════════════════════════════════"

TOTAL=$((CHECKS_PASSED + CHECKS_FAILED))
PERCENTAGE=$((CHECKS_PASSED * 100 / TOTAL))

echo -e "${GREEN}✅ Vérifications réussies: $CHECKS_PASSED${NC}"
echo -e "${RED}❌ Vérifications échouées: $CHECKS_FAILED${NC}"
echo -e "📈 Score de préparation: $PERCENTAGE%"

if [ $CHECKS_FAILED -eq 0 ]; then
  echo -e "\n${GREEN}✅ LE DASHBOARD EST PRÊT POUR LA PRODUCTION!${NC}"
  exit 0
else
  echo -e "\n${RED}⚠️ VEUILLEZ CORRIGER LES ERREURS AVANT LA PRODUCTION${NC}"
  exit 1
fi
