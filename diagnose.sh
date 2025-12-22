#!/bin/bash

# 🚨 Script de démarrage DIAGNOSTIC pour production
# Utilisé pour capturer les vraies erreurs au démarrage

echo "🔧 Mode DIAGNOSTIC - Lancement direct du serveur (sans PM2)"
echo "📍 Ceci affichera toutes les erreurs du serveur"
echo ""

# Définir les variables d'environnement
export NODE_ENV=production
export PORT=8080
export LOG_LEVEL=debug

echo "🌍 Environment:"
echo "  NODE_ENV=$NODE_ENV"
echo "  PORT=$PORT"
echo "  LOG_LEVEL=$LOG_LEVEL"
echo ""

echo "▶️  Démarrage du serveur..."
echo "════════════════════════════════════════════════"

# Lancer le serveur directement pour voir tous les logs
node server.js

echo "════════════════════════════════════════════════"
echo "❌ Le serveur s'est arrêté"
