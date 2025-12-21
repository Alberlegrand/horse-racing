#!/bin/bash

# ✅ Script de démarrage PM2 pour Horse Racing
# Usage: ./start-pm2.sh

echo "🚀 Démarrage de Horse Racing avec PM2..."

# Vérifier que PM2 est installé
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 n'est pas installé. Installation..."
    npm install -g pm2
fi

# Arrêter les processus existants
echo "🛑 Arrêt des processus PM2 existants..."
pm2 delete all

# Démarrer avec la configuration
echo "✅ Démarrage des processus..."
npm run pm2:start

# Sauvegarder pour redémarrage automatique
echo "💾 Sauvegarde de la configuration..."
npm run pm2:save

# Afficher l'état
echo ""
echo "📊 État des processus:"
pm2 list

echo ""
echo "✅ Horse Racing est maintenant en cours d'exécution avec PM2!"
echo ""
echo "Commandes utiles:"
echo "  npm run pm2:logs      - Voir les logs en temps réel"
echo "  npm run pm2:monit     - Monitor les processus"
echo "  npm run pm2:restart   - Redémarrer"
echo "  npm run pm2:stop      - Arrêter"
echo ""
