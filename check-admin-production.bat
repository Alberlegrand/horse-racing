@echo off
REM ===================================================================
REM 🔍 Production Readiness Check - Admin Dashboard (Windows)
REM ===================================================================

setlocal enabledelayedexpansion

echo.
echo ════════════════════════════════════════════════════════════════════
echo 🔍 VERIFICATION PRODUCTION - ADMIN DASHBOARD
echo ════════════════════════════════════════════════════════════════════
echo.

set CHECKS_PASSED=0
set CHECKS_FAILED=0

REM ===================================================================
REM 1. VERIFIER LES FICHIERS CLES
REM ===================================================================
echo [1/6] Verification des fichiers cles...

if exist "server.js" (
    echo [OK] server.js existe
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] server.js manquant
    set /a CHECKS_FAILED+=1
)

if exist "public\admin-dashboard.html" (
    echo [OK] admin-dashboard.html existe
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] admin-dashboard.html manquant
    set /a CHECKS_FAILED+=1
)

if exist "routes\admin.js" (
    echo [OK] routes\admin.js existe
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] routes\admin.js manquant
    set /a CHECKS_FAILED+=1
)

if exist "package.json" (
    echo [OK] package.json existe
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] package.json manquant
    set /a CHECKS_FAILED+=1
)

REM ===================================================================
REM 2. VERIFIER LES DEPENDANCES
REM ===================================================================
echo.
echo [2/6] Verification des dependances...

findstr /C:"helmet" package.json >nul
if !errorlevel! equ 0 (
    echo [OK] helmet dans package.json
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] helmet manquant dans package.json
    set /a CHECKS_FAILED+=1
)

findstr /C:"express" package.json >nul
if !errorlevel! equ 0 (
    echo [OK] express dans package.json
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] express manquant
    set /a CHECKS_FAILED+=1
)

findstr /C:"jsonwebtoken" package.json >nul
if !errorlevel! equ 0 (
    echo [OK] jsonwebtoken dans package.json
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] jsonwebtoken manquant
    set /a CHECKS_FAILED+=1
)

findstr /C:"redis" package.json >nul
if !errorlevel! equ 0 (
    echo [OK] redis dans package.json
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] redis manquant
    set /a CHECKS_FAILED+=1
)

REM ===================================================================
REM 3. VERIFIER LE CODE
REM ===================================================================
echo.
echo [3/6] Verification du code...

findstr /C:"import helmet" server.js >nul
if !errorlevel! equ 0 (
    echo [OK] Helmet importe dans server.js
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] Helmet pas importe dans server.js
    set /a CHECKS_FAILED+=1
)

findstr /C:"window.location.origin" public\admin-dashboard.html >nul
if !errorlevel! equ 0 (
    echo [OK] API_BASE utilise window.location.origin
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] API_BASE hardcodee en localhost
    set /a CHECKS_FAILED+=1
)

findstr /C:"/api/v1/admin/" server.js >nul
if !errorlevel! equ 0 (
    echo [OK] Routes admin enregistrees
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] Routes admin non enregistrees
    set /a CHECKS_FAILED+=1
)

REM ===================================================================
REM 4. VERIFIER LES VARIABLES D'ENVIRONNEMENT
REM ===================================================================
echo.
echo [4/6] Verification des variables d'environnement...

if exist ".env" (
    echo [OK] .env existe
    set /a CHECKS_PASSED+=1
    
    findstr /C:"NODE_ENV" .env >nul
    if !errorlevel! equ 0 (
        echo [OK] NODE_ENV configure
        set /a CHECKS_PASSED+=1
    ) else (
        echo [WARN] NODE_ENV non configure
    )
    
    findstr /C:"JWT_SECRET" .env >nul
    if !errorlevel! equ 0 (
        echo [OK] JWT_SECRET configure
        set /a CHECKS_PASSED+=1
    ) else (
        echo [FAIL] JWT_SECRET manquant
        set /a CHECKS_FAILED+=1
    )
) else (
    echo [WARN] .env manquant
)

if exist ".env.production" (
    echo [OK] .env.production exemple existe
    set /a CHECKS_PASSED+=1
) else (
    echo [WARN] .env.production manquant
)

REM ===================================================================
REM 5. VERIFIER LES ENDPOINTS ADMIN
REM ===================================================================
echo.
echo [5/6] Verification des endpoints admin...

findstr /C:"/server/restart" routes\admin.js >nul
if !errorlevel! equ 0 (
    echo [OK] Endpoint POST /server/restart
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] Endpoint manquant: POST /server/restart
    set /a CHECKS_FAILED+=1
)

findstr /C:"/health" routes\admin.js >nul
if !errorlevel! equ 0 (
    echo [OK] Endpoint GET /health
    set /a CHECKS_PASSED+=1
) else (
    echo [FAIL] Endpoint manquant: GET /health
    set /a CHECKS_FAILED+=1
)

REM ===================================================================
REM 6. VERIFIER LA DOCUMENTATION
REM ===================================================================
echo.
echo [6/6] Verification de la documentation...

if exist "ADMIN_DASHBOARD.md" (
    echo [OK] ADMIN_DASHBOARD.md existe
    set /a CHECKS_PASSED+=1
) else (
    echo [WARN] ADMIN_DASHBOARD.md manquant
)

if exist "ADMIN_DASHBOARD_PRODUCTION_GUIDE.md" (
    echo [OK] ADMIN_DASHBOARD_PRODUCTION_GUIDE.md existe
    set /a CHECKS_PASSED+=1
) else (
    echo [WARN] ADMIN_DASHBOARD_PRODUCTION_GUIDE.md manquant
)

REM ===================================================================
REM RESULTAT
REM ===================================================================
echo.
echo ════════════════════════════════════════════════════════════════════
echo 📊 RESUME DE LA VERIFICATION
echo ════════════════════════════════════════════════════════════════════

set /a TOTAL=CHECKS_PASSED+CHECKS_FAILED
if !TOTAL! equ 0 set TOTAL=1

set /a PERCENTAGE=CHECKS_PASSED*100/TOTAL

echo ✅ Verifications reussies: %CHECKS_PASSED%
echo ❌ Verifications echouees: %CHECKS_FAILED%
echo 📈 Score de preparation: %PERCENTAGE%
echo.

if !CHECKS_FAILED! equ 0 (
    echo ✅ LE DASHBOARD EST PRET POUR LA PRODUCTION!
    exit /b 0
) else (
    echo ⚠️ VEUILLEZ CORRIGER LES ERREURS AVANT LA PRODUCTION
    exit /b 1
)
