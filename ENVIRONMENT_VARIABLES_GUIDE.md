# 🔐 Configuration Environment Variables - Production

## 📝 Variables Requises pour Render.com

### 1️⃣ Variables Obligatoires

#### NODE_ENV
```
NODE_ENV = production
```
**Importance:** CRITIQUE - Active mode production dans PM2

#### PORT
```
PORT = 8080
```
**Importance:** Render expose ce port. NE PAS CHANGER.

#### DATABASE_URL
```
DATABASE_URL = postgres://avnadmin:AVNS_7UUhsX4dfeM1gmYNANL@hitskool-alberlegenie-c9aa.c.aivencloud.com:20955/vip_surprise
```
**Source:** Depuis votre Aiven PostgreSQL dashboard
**Format:** `postgres://user:password@host:port/database`

#### REDIS_URL
```
REDIS_URL = redis://:M9W5dTqFXor8nMkWEAOotoKs4SH65Igq@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```
**Source:** Depuis votre Aiven Redis dashboard
**Format:** `redis://:[password]@host:port`

#### JWT_SECRET
```
JWT_SECRET = 2d068e91d42eecbc7c60566513a7e4bd9bfac55c73fd4d5f8c20dc4530a0f321f308a0ecde256302ed618eec2869fdd0e86dfe79bc74cceb976604497b099b33
```
**Source:** À partir de votre `.env` local
**Important:** Doit être identique en prod et dev!

### 2️⃣ Variables Optionnelles (mais recommandées)

#### LOG_LEVEL
```
LOG_LEVEL = info
```
**Production:** `info` (moins verbeux)
**Development:** `debug` (plus détaillé)

#### SSL_CERTIFICATE
```
SSL_CERTIFICATE = ./ca.pem
```
**Pour Aiven:** Certificat SSL (dans git ou Render)

## 🎯 Instructions Render.com

### Étape 1: Accéder aux Settings

1. Aller sur https://dashboard.render.com
2. Sélectionner votre Web Service
3. Aller à **Settings** → **Environment**

### Étape 2: Ajouter Variables (Méthode 1 - Via UI)

Cliquer "Add Environment Variable"

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `DATABASE_URL` | `postgres://avnadmin:...` |
| `REDIS_URL` | `redis://:...@...` |
| `JWT_SECRET` | `2d068e91d42...` |

### Étape 2b: Ajouter Variables (Méthode 2 - Via render.yml)

Fichier `render.yml` à la racine:

```yaml
services:
  - type: web
    name: horse-racing-server
    runtime: node
    buildCommand: npm ci
    startCommand: npm run pm2:start
    
    env: production
    
    envVars:
      - key: NODE_ENV
        value: production
      
      - key: PORT
        value: 8080
      
      - key: DATABASE_URL
        sync: false  # À définir dans Render UI
      
      - key: REDIS_URL
        sync: false  # À définir dans Render UI
      
      - key: JWT_SECRET
        sync: false  # À définir dans Render UI
      
      - key: LOG_LEVEL
        value: info
```

### Étape 3: Vérifier Variables

```bash
# Après deployment, vérifier dans Render logs:
# [INFO] Environment loaded:
# NODE_ENV=production
# PORT=8080
# DATABASE_URL=postgres://...
```

## ⚠️ Sécurité des Variables

### 🔒 Ne JAMAIS Commit en Git

Fichier `.gitignore` doit contenir:
```
.env
.env.local
.env.*.local
```

### 🔒 Variables Sensibles

Ces variables ne doivent JAMAIS être publiques:
- ✅ `DATABASE_URL` (contient password)
- ✅ `REDIS_URL` (contient password)
- ✅ `JWT_SECRET` (clé secrète)

### 🔒 Render Vault

Pour sécurité maximale:

```bash
# Render chiffre les env vars automatiquement
# Aucun risque de leak dans les logs
```

## 📋 Checklist Variables Env

### Local (.env)
```bash
✅ NODE_ENV=development (local, production sur Render)
✅ DATABASE_URL=postgres://...
✅ REDIS_URL=redis://:...@...
✅ JWT_SECRET=2d068e91d42...
✅ LOG_LEVEL=debug (local, info on Render)
```

### Render Dashboard
```bash
✅ NODE_ENV = production
✅ PORT = 8080
✅ DATABASE_URL = (copié de local)
✅ REDIS_URL = (copié de local)
✅ JWT_SECRET = (copié de local)
✅ LOG_LEVEL = info
```

## 🔄 Mettre à Jour une Variable

### Sur Render

1. Aller à **Settings** → **Environment**
2. Cliquer sur la variable
3. Modifier la valeur
4. Cliquer **Save**
5. Service redémarre automatiquement

### Localement

1. Modifier `.env`
2. Redémarrer: `npm run pm2:restart`

## 🧪 Tester les Variables

### Localement

```bash
# Vérifier que variables sont chargées
echo $NODE_ENV
echo $DATABASE_URL
echo $PORT

# Ou avec node
node -e "console.log(process.env.NODE_ENV)"
```

### Sur Render

```bash
# Via Logs, chercher:
[INFO] Environment loaded successfully
[INFO] NODE_ENV = production
[INFO] PORT = 8080
[INFO] Database URL is set
[INFO] Redis URL is set
```

## 🚨 Erreurs Courantes

### ❌ "ECONNREFUSED" Database

**Cause:** DATABASE_URL invalide

**Solution:**
```bash
# Copier exactement depuis Aiven dashboard
# Format: postgres://user:PASSWORD@host:port/db
# ⚠️ PASSWORD doit être échappé si contient caractères spéciaux
```

### ❌ "Cannot read property 'env'"

**Cause:** Variable manquante

**Solution:**
1. Vérifier liste variables Render
2. Redéployer: Dashboard → Redeploy
3. Vérifier logs: Dashboard → Logs

### ❌ "NODE_ENV=undefined"

**Cause:** Variable pas chargée

**Solution:**
1. Ajouter NODE_ENV = production dans Render
2. Vérifier pas de typos
3. Redéployer

## 📚 Exemples Complets

### Aiven PostgreSQL
```
DATABASE_URL = postgres://avnadmin:AVNS_xyz@hitskool-xyz.c.aivencloud.com:20955/vip_surprise?sslmode=require
```

### Aiven Redis
```
REDIS_URL = redis://:xyz@redis-11555.crce220.us-east-1-4.ec2.cloud.redislabs.com:11555
```

### JWT Secret (généré)
```
JWT_SECRET = 2d068e91d42eecbc7c60566513a7e4bd9bfac55c73fd4d5f8c20dc4530a0f321f308a0ecde256302ed618eec2869fdd0e86dfe79bc74cceb976604497b099b33
```

## ✅ Validation Finale

Avant de déployer:

- [ ] NODE_ENV = production
- [ ] DATABASE_URL valide (connecté)
- [ ] REDIS_URL valide (connecté)
- [ ] JWT_SECRET identique à local
- [ ] PORT = 8080
- [ ] Aucune variable ne contient localhost
- [ ] Pas de caractères spéciaux non échappés

## 🎯 Après Configuration

```bash
# 1. Commit et push
git add render.yml .env
git commit -m "Add Render environment configuration"
git push origin main

# 2. Render détecte render.yml automatiquement
# 3. Service redémarre avec nouvelles variables
# 4. Vérifier logs: Dashboard → Logs → "successfully started"
```

---

**Configuration variables complète! Prêt pour production! 🚀**
