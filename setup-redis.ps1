# Redis Setup Script for HITBET777 (Windows PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File setup-redis.ps1

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🚀 HITBET777 - Redis Setup Helper (Windows)" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

function Show-Menu {
    Write-Host "Choisissez une option:`n" -ForegroundColor Yellow
    Write-Host "1) Lancer Redis avec Docker (recommandé)" -ForegroundColor White
    Write-Host "2) Vérifier la connexion Redis" -ForegroundColor White
    Write-Host "3) Afficher la configuration" -ForegroundColor White
    Write-Host "4) Afficher le guide Redis complet" -ForegroundColor White
    Write-Host "5) Quitter`n" -ForegroundColor White
    
    $choice = Read-Host "Option (1-5)"
    return $choice
}

function Test-DockerInstalled {
    try {
        docker --version | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-RedisCli {
    try {
        redis-cli ping | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Show-RedisInfo {
    Write-Host "`n🔍 Vérification de la connexion Redis...`n" -ForegroundColor Cyan
    
    if (Test-RedisCli) {
        Write-Host "✅ Redis est connecté!`n" -ForegroundColor Green
        Write-Host "Info Redis:" -ForegroundColor Yellow
        redis-cli ping
        redis-cli info server | Select-String "redis_version"
        redis-cli dbsize
    } else {
        Write-Host "❌ Redis n'est pas accessible`n" -ForegroundColor Red
        Write-Host "Assurez-vous que Redis est lancé:" -ForegroundColor Yellow
        Write-Host "  • Docker: docker run -d -p 6379:6379 redis:latest" -ForegroundColor Gray
    }
}

function Start-RedisDocker {
    Write-Host "`n📦 Lancement de Redis avec Docker...`n" -ForegroundColor Cyan
    
    if (-not (Test-DockerInstalled)) {
        Write-Host "❌ Docker n'est pas installé" -ForegroundColor Red
        Write-Host "Téléchargez Docker Desktop depuis: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
        return
    }
    
    # Check if Redis container exists and is running
    $containerExists = docker ps -a --filter "name=redis-hitbet" --format "{{.Names}}" 2>$null
    
    if ($containerExists) {
        $isRunning = docker ps --filter "name=redis-hitbet" --format "{{.Names}}" 2>$null
        if ($isRunning) {
            Write-Host "✅ Redis est déjà en cours d'exécution" -ForegroundColor Green
            Write-Host ""
            docker logs --tail 5 redis-hitbet
        } else {
            Write-Host "🔧 Démarrage du conteneur Redis existant...`n" -ForegroundColor Yellow
            docker start redis-hitbet
            Start-Sleep -Seconds 2
            Write-Host "✅ Redis est maintenant disponible sur redis://localhost:6379" -ForegroundColor Green
        }
    } else {
        Write-Host "🔧 Création et démarrage du conteneur Redis...`n" -ForegroundColor Yellow
        docker run -d `
            --name redis-hitbet `
            -p 6379:6379 `
            redis:latest redis-server --appendonly yes
        
        Write-Host "⏳ Attente du démarrage...`n" -ForegroundColor Yellow
        Start-Sleep -Seconds 3
        
        docker logs --tail 5 redis-hitbet
        Write-Host ""
        Write-Host "✅ Redis est maintenant disponible sur redis://localhost:6379" -ForegroundColor Green
    }
}

function Show-Config {
    Write-Host "`n📋 Configuration Redis (depuis .env):`n" -ForegroundColor Cyan
    
    if (Test-Path ".env") {
        $envContent = Get-Content ".env" | Where-Object { $_ -match "^REDIS|^NODE_ENV" -and $_ -notmatch "^#" }
        Write-Host $envContent -ForegroundColor Gray
        
        Write-Host "`nℹ️  Pour voir tous les exemples de configuration:" -ForegroundColor Yellow
        Write-Host "   Consultez: .env.example" -ForegroundColor Gray
        Write-Host "   Guide complet: REDIS_SETUP_GUIDE.md`n" -ForegroundColor Gray
    } else {
        Write-Host "⚠️  Fichier .env non trouvé`n" -ForegroundColor Yellow
        Write-Host "Créez-le à partir de .env.example`n" -ForegroundColor Gray
    }
}

function Show-Guide {
    Write-Host "`n" -ForegroundColor Cyan
    if (Test-Path "REDIS_SETUP_GUIDE.md") {
        Get-Content "REDIS_SETUP_GUIDE.md" | Select-Object -First 100
        Write-Host "`n... (consultez REDIS_SETUP_GUIDE.md pour le guide complet)" -ForegroundColor Yellow
    } else {
        Write-Host "⚠️  REDIS_SETUP_GUIDE.md non trouvé" -ForegroundColor Yellow
    }
}

function Show-StartInfo {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Pour démarrer l'application:" -ForegroundColor Yellow
    Write-Host "  npm run dev    (développement avec nodemon)" -ForegroundColor Gray
    Write-Host "  npm start      (production)" -ForegroundColor Gray
    Write-Host "═══════════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan
}

# Main loop
do {
    $choice = Show-Menu
    
    switch ($choice) {
        "1" { Start-RedisDocker }
        "2" { Show-RedisInfo }
        "3" { Show-Config }
        "4" { Show-Guide }
        "5" {
            Write-Host "`nAu revoir! 👋`n" -ForegroundColor Green
            exit 0
        }
        default {
            Write-Host "`n❌ Option invalide`n" -ForegroundColor Red
        }
    }
    
    if ($choice -ne "5") {
        Write-Host ""
        Write-Host "Appuyez sur une touche pour continuer..." -ForegroundColor Gray
        [Console]::ReadKey($true) | Out-Null
        Clear-Host
    }
} while ($true)
