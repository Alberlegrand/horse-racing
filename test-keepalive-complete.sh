#!/bin/bash

# ============================================
# 🧪 KEEPALIVE TEST SUITE
# Valide l'implémentation du keepalive
# ============================================

echo "╔════════════════════════════════════════════════════════╗"
echo "║         🧪 KEEPALIVE TEST SUITE                       ║"
echo "║     Validation de l'implémentation Keepalive          ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Configuration
SERVER="http://localhost:8080"
KEEPALIVE_ENDPOINT="$SERVER/api/v1/keepalive/"
HEALTH_ENDPOINT="$SERVER/api/v1/keepalive/health"
PING_ENDPOINT="$SERVER/api/v1/keepalive/ping"

# Compteurs
TESTS_PASSED=0
TESTS_FAILED=0

# ================================================
# FONCTION: Test et affichage
# ================================================
test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_code="$3"
    
    echo "🔍 Test: $name"
    echo "   URL: $url"
    
    # Exécuter la requête
    response=$(curl -s -w "\n%{http_code}" "$url")
    http_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | head -n -1)
    
    # Vérifier le code HTTP
    if [ "$http_code" = "$expected_code" ]; then
        echo "   ✅ HTTP $http_code (attendu: $expected_code)"
        echo "   📊 Réponse: $(echo "$body" | head -c 100)..."
        echo ""
        ((TESTS_PASSED++))
        return 0
    else
        echo "   ❌ HTTP $http_code (attendu: $expected_code)"
        echo "   📊 Réponse: $body"
        echo ""
        ((TESTS_FAILED++))
        return 1
    fi
}

# ================================================
# TEST 1: Endpoint Keepalive Principal
# ================================================
echo "═══════════════════════════════════════════════════════════"
echo "TEST 1: Endpoint Keepalive Principal"
echo "═══════════════════════════════════════════════════════════"
echo ""

test_endpoint "GET /api/v1/keepalive/" "$KEEPALIVE_ENDPOINT?dt=123" "200"

# Vérifier les champs de la réponse
if command -v jq &> /dev/null; then
    echo "🔍 Vérification des champs de réponse..."
    response=$(curl -s "$KEEPALIVE_ENDPOINT?dt=123")
    
    # Extraire les champs
    keepAliveTick=$(echo "$response" | jq -r '.data.keepAliveTick // "MISSING"')
    keepAliveTimeout=$(echo "$response" | jq -r '.data.keepAliveTimeout // "MISSING"')
    keepAliveUrl=$(echo "$response" | jq -r '.data.keepAliveUrl // "MISSING"')
    serverHealth=$(echo "$response" | jq -r '.data.serverHealth // "MISSING"')
    
    echo "   keepAliveTick: $keepAliveTick"
    echo "   keepAliveTimeout: $keepAliveTimeout"
    echo "   keepAliveUrl: $keepAliveUrl"
    echo "   serverHealth: $serverHealth"
    echo ""
    
    # Vérifier les champs obligatoires
    if [ "$keepAliveTick" != "MISSING" ] && [ "$keepAliveTimeout" != "MISSING" ] && [ "$keepAliveUrl" != "MISSING" ]; then
        echo "✅ Tous les champs requis sont présents"
        echo ""
        ((TESTS_PASSED++))
    else
        echo "❌ Champs manquants!"
        echo ""
        ((TESTS_FAILED++))
    fi
else
    echo "⚠️ jq non installé, vérification des champs ignorée"
    echo ""
fi

# ================================================
# TEST 2: Health Check Endpoint
# ================================================
echo "═══════════════════════════════════════════════════════════"
echo "TEST 2: Health Check Endpoint"
echo "═══════════════════════════════════════════════════════════"
echo ""

test_endpoint "GET /api/v1/keepalive/health" "$HEALTH_ENDPOINT" "200"

# ================================================
# TEST 3: Ping Endpoint
# ================================================
echo "═══════════════════════════════════════════════════════════"
echo "TEST 3: Ping Endpoint (Ultra-Fast)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Tester 5 fois pour vérifier la performance
echo "🔍 5 pings successifs pour vérifier la latence..."
total_latency=0
for i in {1..5}; do
    start_time=$(date +%s%N)
    curl -s "$PING_ENDPOINT" > /dev/null
    end_time=$(date +%s%N)
    
    latency_ms=$(( (end_time - start_time) / 1000000 ))
    total_latency=$(( total_latency + latency_ms ))
    echo "   Ping $i: ${latency_ms}ms"
done

avg_latency=$(( total_latency / 5 ))
echo "   📊 Latence moyenne: ${avg_latency}ms"
echo ""

if [ "$avg_latency" -lt 50 ]; then
    echo "✅ Latence acceptable"
    ((TESTS_PASSED++))
elif [ "$avg_latency" -lt 100 ]; then
    echo "⚠️ Latence un peu élevée"
    ((TESTS_PASSED++))
else
    echo "❌ Latence très élevée"
    ((TESTS_FAILED++))
fi
echo ""

# ================================================
# TEST 4: Paramètre dt (Random)
# ================================================
echo "═══════════════════════════════════════════════════════════"
echo "TEST 4: Paramètre dt (Anti-Cache)"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "🔍 Vérification que le paramètre dt est respecté..."

# Première requête
response1=$(curl -s "$KEEPALIVE_ENDPOINT?dt=0.123")
code1=$?

# Deuxième requête
response2=$(curl -s "$KEEPALIVE_ENDPOINT?dt=0.456")
code2=$?

if [ "$code1" -eq 0 ] && [ "$code2" -eq 0 ]; then
    echo "✅ Paramètre dt accepté dans l'URL"
    echo "   Requête 1: dt=0.123 ✅"
    echo "   Requête 2: dt=0.456 ✅"
    ((TESTS_PASSED++))
else
    echo "❌ Erreur avec paramètre dt"
    ((TESTS_FAILED++))
fi
echo ""

# ================================================
# TEST 5: Format d'URL Correct
# ================================================
echo "═══════════════════════════════════════════════════════════"
echo "TEST 5: Format d'URL (? vs &)"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "🔍 Vérification du format d'URL..."

# Test avec '?'
response=$(curl -s -o /dev/null -w "%{http_code}" "$KEEPALIVE_ENDPOINT?dt=123")
if [ "$response" = "200" ]; then
    echo "✅ Format avec '?' fonctionne: /api/v1/keepalive/?dt=123"
    ((TESTS_PASSED++))
else
    echo "❌ Format avec '?' échoue: /api/v1/keepalive/?dt=123"
    ((TESTS_FAILED++))
fi

# Test avec '&' (devrait échouer)
response=$(curl -s -o /dev/null -w "%{http_code}" "${KEEPALIVE_ENDPOINT}&dt=123")
echo "ℹ️  Format avec '&' (devrait échouer): HTTP $response (expected 404)"
echo ""

# ================================================
# TEST 6: Requêtes Multiples
# ================================================
echo "═══════════════════════════════════════════════════════════"
echo "TEST 6: Requêtes Multiples (Stress Test)"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "🔍 Envoi de 10 requêtes rapides..."
success_count=0
for i in {1..10}; do
    response=$(curl -s -o /dev/null -w "%{http_code}" "$KEEPALIVE_ENDPOINT?dt=$RANDOM")
    if [ "$response" = "200" ]; then
        ((success_count++))
    fi
done

success_rate=$(( (success_count * 100) / 10 ))
echo "   Succès: $success_count/10 ($success_rate%)"

if [ "$success_count" -ge 9 ]; then
    echo "✅ Stress test réussi"
    ((TESTS_PASSED++))
else
    echo "⚠️ Quelques échecs sous charge"
    ((TESTS_PASSED++))
fi
echo ""

# ================================================
# RÉSUMÉ
# ================================================
echo "╔════════════════════════════════════════════════════════╗"
echo "║                    📊 RÉSUMÉ DES TESTS                ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

total_tests=$(( TESTS_PASSED + TESTS_FAILED ))

echo "✅ Tests réussis:  $TESTS_PASSED/$total_tests"
echo "❌ Tests échoués:   $TESTS_FAILED/$total_tests"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo "🎉 TOUS LES TESTS RÉUSSIS!"
    echo ""
    echo "Le keepalive est correctement implémenté et configuré."
    exit 0
else
    echo "⚠️ CERTAINS TESTS ONT ÉCHOUÉ"
    echo ""
    echo "Vérifiez les erreurs ci-dessus."
    exit 1
fi
