# Redis Quick Reference - HITBET777

## 🚀 Quick Start

### Development (Windows)
```powershell
# Terminal 1: Start Redis with Docker
docker run -d -p 6379:6379 --name redis-hitbet redis:latest

# Terminal 2: Start the app
npm run dev
```

### Production
1. Set `REDIS_URL` in `.env` with cloud Redis credentials
2. Set `NODE_ENV=production`
3. Run: `npm start`

---

## 🔧 Setup Commands

### Windows PowerShell
```powershell
# Interactive setup
powershell -ExecutionPolicy Bypass -File setup-redis.ps1

# Or manual Docker
docker run -d -p 6379:6379 --name redis-hitbet redis:latest
redis-cli ping  # Should return PONG
```

### WSL/Linux/macOS
```bash
# Interactive setup
bash setup-redis.sh

# Or manual
docker run -d -p 6379:6379 redis:latest
redis-cli ping  # Should return PONG
```

---

## 📝 Configuration

### `.env` for Development
```env
NODE_ENV=development
REDIS_URL=redis://localhost:6379
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5
```

### `.env` for Production (Aiven Example)
```env
NODE_ENV=production
REDIS_URL=redis://:password@redis-host.aivencloud.com:20955
REDIS_TIMEOUT_MS=5000
REDIS_RECONNECT_MAX_ATTEMPTS=5
```

---

## ✔️ Testing Redis

### Test Connection
```bash
# Using redis-cli
redis-cli ping
# Output: PONG

# Using curl
curl http://localhost:3000/api/v1/keepalive/health
# Check "redis": "ok" or "offline"
```

### View Server Status
```bash
# Check logs during startup
npm run dev 2>&1 | grep REDIS

# Expected output:
# 📍 [STARTUP] Redis Configuration:
#    • URL: redis://localhost:6379
#    • Timeout: 5000ms
#    • Max Retries: 5
#    • Environment: DEVELOPMENT
# ✅ [REDIS] Connecté avec succès
# ✅ [REDIS] Prêt et fonctionnel
```

---

## 🐳 Docker Cheat Sheet

```bash
# Start Redis
docker run -d -p 6379:6379 --name redis-hitbet redis:latest

# Stop Redis
docker stop redis-hitbet

# Start existing Redis
docker start redis-hitbet

# View Redis logs
docker logs redis-hitbet

# Interactive Redis CLI in Docker
docker exec -it redis-hitbet redis-cli

# Remove Redis container
docker rm redis-hitbet

# Check if Redis is running
docker ps | grep redis
```

---

## 🔍 Troubleshooting

### Redis won't connect in development
```bash
# Check if Redis is running
redis-cli ping

# If not installed/running:
docker run -d -p 6379:6379 redis:latest

# Check firewall (Windows)
netstat -an | grep 6379
# Should show: TCP 127.0.0.1:6379 LISTENING
```

### Redis won't connect in production
```bash
# 1. Verify REDIS_URL in .env.production
echo $REDIS_URL

# 2. Test connection directly
redis-cli -u "redis://:password@host:port" ping

# 3. Check firewall/VPC rules

# 4. View logs
tail -f app.log | grep REDIS
```

### Reconnection loop in logs
```
🔄 [REDIS] Reconnexion en cours... (tentative X/5)
```
**Solutions:**
- In dev: Restart Redis and app
- In prod: Verify Redis cloud service is running
- Check password and hostname in REDIS_URL

---

## 📊 API Endpoints

### Health Check
```bash
curl http://localhost:3000/api/v1/keepalive/health

# Response:
{
  "status": "healthy",
  "serverHealth": {
    "redis": "ok",  # or "offline"
    "memory": {
      "used": 45.5,
      "percentage": 45.5,
      "status": "healthy"  # or "degraded" / "critical"
    }
  }
}
```

---

## 🚨 Important Notes

1. **No Redis = Degraded Mode** - App works without Redis cache
2. **Development**: Reconnection retries are unlimited (keeps trying)
3. **Production**: Reconnection stops after 5 attempts (configurable)
4. **Sessions**: Stored in Redis if available, otherwise in memory
5. **Game State**: Backed up to Redis for crash recovery

---

## 📚 Documentation Files

- `REDIS_SETUP_GUIDE.md` - Complete setup guide
- `.env.example` - Example configuration
- `setup-redis.sh` - Linux/macOS setup helper
- `setup-redis.ps1` - Windows PowerShell setup helper

---

**Need help?** Check `REDIS_SETUP_GUIDE.md` for detailed instructions.
