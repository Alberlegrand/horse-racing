#!/usr/bin/env bash
# Redis Setup Script for HITBET777
# Supports: Windows (WSL), macOS, Linux

echo "═══════════════════════════════════════════════════════════════════"
echo "🚀 HITBET777 - Redis Setup Helper"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    # Check if WSL
    if grep -qi microsoft /proc/version; then
        OS="wsl"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
else
    OS="unknown"
fi

echo "Système détecté: $OS"
echo ""

# Menu principal
echo "Choisissez une option:"
echo "1) Lancer Redis avec Docker (recommandé)"
echo "2) Installer Redis localement (Linux/WSL/macOS)"
echo "3) Vérifier la connexion Redis"
echo "4) Afficher la configuration"
echo "5) Quitter"
echo ""
read -p "Option (1-5): " choice

case $choice in
    1)
        echo ""
        echo "📦 Lancement de Redis avec Docker..."
        docker ps | grep redis > /dev/null
        if [ $? -eq 0 ]; then
            echo "✅ Redis est déjà en cours d'exécution"
            docker logs --tail 5 redis-hitbet
        else
            echo "🔧 Démarrage du conteneur Redis..."
            docker run -d \
                --name redis-hitbet \
                -p 6379:6379 \
                redis:latest redis-server --appendonly yes
            
            echo "⏳ Attente du démarrage..."
            sleep 2
            
            docker logs redis-hitbet | tail -3
            echo ""
            echo "✅ Redis est maintenant disponible sur redis://localhost:6379"
        fi
        ;;
    
    2)
        echo ""
        case $OS in
            linux|wsl)
                echo "🐧 Installation Redis pour Linux/WSL..."
                sudo apt-get update
                sudo apt-get install -y redis-server
                echo ""
                echo "✅ Redis installé. Démarrage du service..."
                sudo systemctl start redis-server
                sudo systemctl enable redis-server
                echo "✅ Service Redis activé"
                ;;
            macos)
                echo "🍎 Installation Redis pour macOS..."
                if ! command -v brew &> /dev/null; then
                    echo "⚠️  Homebrew non trouvé. Installez depuis https://brew.sh"
                    exit 1
                fi
                brew install redis
                echo ""
                echo "✅ Redis installé. Démarrage..."
                brew services start redis
                echo "✅ Service Redis démarré"
                ;;
            *)
                echo "❌ Système non supporté pour l'installation directe"
                echo "💡 Utilisez Docker: docker run -d -p 6379:6379 redis:latest"
                ;;
        esac
        ;;
    
    3)
        echo ""
        echo "🔍 Vérification de la connexion Redis..."
        if command -v redis-cli &> /dev/null; then
            redis-cli ping
            if [ $? -eq 0 ]; then
                echo "✅ Redis est connecté!"
                echo ""
                echo "Info Redis:"
                redis-cli info server | grep redis_version
                redis-cli dbsize
            else
                echo "❌ Redis n'est pas accessible"
                echo "Assurez-vous que Redis est lancé:"
                echo "  • Docker: docker run -d -p 6379:6379 redis:latest"
                echo "  • Local: redis-server"
            fi
        else
            echo "⚠️  redis-cli n'est pas installé"
            echo "Installez Redis ou utilisez Docker"
        fi
        ;;
    
    4)
        echo ""
        echo "📋 Configuration Redis (depuis .env):"
        if [ -f ".env" ]; then
            echo ""
            grep -E "^REDIS|^NODE_ENV" .env | grep -v "^#"
            echo ""
            echo "ℹ️  Pour voir tous les exemples de configuration:"
            echo "   Consultez: .env.example"
            echo "   Guide complet: REDIS_SETUP_GUIDE.md"
        else
            echo "⚠️  Fichier .env non trouvé"
            echo "Créez-le à partir de .env.example"
        fi
        ;;
    
    5)
        echo "Au revoir! 👋"
        exit 0
        ;;
    
    *)
        echo "❌ Option invalide"
        exit 1
        ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "Pour démarrer l'application:"
echo "  npm run dev    (développement)"
echo "  npm start      (production)"
echo "═══════════════════════════════════════════════════════════════════"
