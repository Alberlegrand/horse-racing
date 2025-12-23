# Deployment Guide - HITBET777 Betting App

**Date**: December 20, 2025  
**Version**: 1.0  
**Status**: Ready for Production

---

## 🎯 Pre-Deployment Checklist

- [ ] All changes committed to git
- [ ] Database backup created
- [ ] Test environment passes all checks
- [ ] Production environment ready
- [ ] Team notified of deployment

---

## 📋 Deployment Steps

### Step 1: Backup Production Database
```bash
# PostgreSQL backup
pg_dump -U postgres hitbet > hitbet_backup_$(date +%Y%m%d_%H%M%S).sql

# Or if using remote PostgreSQL
PGPASSWORD=your_password pg_dump -h db.example.com -U postgres hitbet > backup.sql
```

### Step 2: Stop Current Server
```bash
# On the server
pm2 stop horse-racing
# OR
systemctl stop horse-racing
# OR manually
pkill -f "node.*server.js"
```

### Step 3: Pull Latest Code
```bash
cd /path/to/horse-racing
git pull origin main
```

### Step 4: Install Dependencies
```bash
npm install
# Session packages should already be installed, but verify:
npm list express-session connect-redis
```

### Step 5: Database Migration
The database migration happens automatically on server startup via `initializeDatabase()`:
- New tables will be created
- Indexes will be created
- Default cashiers will be added

```bash
# You can verify manually if needed:
psql -U postgres hitbet -c "\dt"
# Should show new tables: cashier_accounts, account_transactions
```

### Step 6: Start Server
```bash
# Option A: Using pm2 (production)
pm2 start server.js --name horse-racing

# Option B: Using npm
npm start

# Option C: Using node directly
node server.js

# Option D: With nodemon (development)
npx nodemon server.js
```

### Step 7: Verify Server is Running
```bash
# Check if port 8080 is listening
netstat -an | grep 8080
# or
lsof -i :8080

# Test health endpoint
curl http://localhost:8080/api/v1/health
# Expected: {"status":"healthy",...}
```

### Step 8: Test in Browser
1. Open http://localhost:8080 (or your domain)
2. Login with credentials
3. Navigate to screen (observe Network tab)
4. Verify keepalive requests every 30 seconds:
   - Should see: `GET /api/v1/keepalive/?dt=0.xxx`
   - Status: `200 OK`
   - NOT `404 Not Found`

### Step 9: Monitor Logs
```bash
# Using pm2
pm2 logs horse-racing

# Using systemd
journalctl -u horse-racing -f

# Or check Node output
tail -f /var/log/horse-racing.log
```

---

## 🧪 Post-Deployment Verification

### Test 1: Health Check
```bash
curl http://localhost:8080/api/v1/health
```
Expected: `{"status":"healthy"}`

### Test 2: Keepalive Endpoint
```bash
curl "http://localhost:8080/api/v1/keepalive/?dt=test"
```
Expected: JSON with keepAliveTick, keepAliveTimeout, keepAliveUrl

### Test 3: Account Endpoint (after login)
```bash
curl -H "Cookie: authSession=YOUR_TOKEN" \
  http://localhost:8080/api/v1/accounts/me
```
Expected: Account data with currentBalance, status, etc.

### Test 4: Browser Console
```javascript
// Open browser DevTools console
fetch('/api/v1/keepalive/?dt=' + Math.random(), {
  credentials: 'include'
}).then(r => r.json()).then(d => console.log('✅', d));
```
Expected: Should log response data without errors

### Test 5: Network Tab Check
1. Open Developer Tools (F12)
2. Go to Network tab
3. Keep page idle for 30+ seconds
4. Look for keepalive requests:
   - URL: Should contain `?dt=` (not `&dt=`)
   - Status: Should be `200`
   - Response: Should have keepAliveTick, etc.

---

## 🔍 Troubleshooting

### Issue: Server won't start
```bash
# Check logs
node server.js

# Check if port is already in use
lsof -i :8080

# Kill existing process
pkill -f "node.*server.js"

# Try again
npm start
```

### Issue: Database tables not created
```bash
# Check database
psql -U postgres hitbet -c "\dt"

# Check for errors in server logs
npm start 2>&1 | grep -i error

# Manually create tables
psql -U postgres hitbet < config/db.js
```

### Issue: Keepalive getting 404
1. Clear browser cache (Ctrl+Shift+Delete)
2. Reload page (Ctrl+R)
3. Check Network tab for URL format
4. Verify route in server: `grep keepalive server.js`
5. Restart server: `npm start`

### Issue: Account endpoints returning 401
1. Verify user is logged in (check cookies)
2. Check authSession cookie exists
3. Verify JWT is valid
4. Check middleware.session.js is loaded

---

## 📊 Monitoring Recommendations

### Server Health
- Monitor CPU usage
- Monitor memory usage
- Monitor database connections
- Check error logs regularly

### Application Metrics
- Track keepalive request success rate
- Monitor API response times
- Track account transaction volume
- Monitor session creation/destruction

### Database Health
- Monitor query performance
- Check index usage
- Monitor table sizes
- Check slow query logs

---

## 🔄 Rollback Plan

If critical issues arise:

### Step 1: Stop Server
```bash
pm2 stop horse-racing
# OR
pkill -f "node.*server.js"
```

### Step 2: Restore Code
```bash
cd /path/to/horse-racing
git revert HEAD  # or git checkout main -- .
npm install
```

### Step 3: Restore Database (if needed)
```bash
psql -U postgres hitbet < hitbet_backup_20251220_120000.sql
```

### Step 4: Restart Server
```bash
npm start
```

### Step 5: Verify
```bash
curl http://localhost:8080/api/v1/health
```

---

## 📝 Configuration Files

### Environment Variables
```bash
# .env file (if using dotenv)
NODE_ENV=production
PORT=8080
JWT_SECRET=your-secret-key-here
SESSION_SECRET=your-session-secret-here
DB_URL=postgresql://user:password@localhost:5432/hitbet
REDIS_URL=redis://localhost:6379
```

### PM2 Configuration (optional)
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'horse-racing',
    script: './server.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

Start with PM2:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 🔐 Security Checklist

- [ ] HTTPS enabled in production
- [ ] Secrets not in code (use .env)
- [ ] Database password secured
- [ ] Redis password set (if exposed)
- [ ] CORS configured properly
- [ ] Rate limiting enabled
- [ ] SQL injection protection (parameterized queries - ✅ already done)
- [ ] CSRF tokens enabled (if needed)
- [ ] Regular security updates

---

## 📞 Support & Escalation

### During Deployment
- Have backup database ready
- Have rollback plan ready
- Have team on standby
- Monitor for errors

### After Deployment
- Monitor for 24 hours
- Check error logs daily
- Verify all features working
- Get user feedback

### Contact
- DevOps Team: devops@example.com
- Database Admin: dba@example.com
- On-Call: on-call@example.com

---

## 📅 Deployment Schedule

### Recommended
- **Day**: Weekday
- **Time**: Off-peak hours (early morning or night)
- **Duration**: 30-60 minutes
- **Maintenance Window**: 2 hours (with rollback plan)

### Testing Phase
- Development: ✅ DONE
- Staging: Should be done
- Production: This document

---

## ✅ Deployment Checklist (Final)

- [ ] All tests passed
- [ ] Backup created
- [ ] Code pulled and verified
- [ ] Dependencies installed
- [ ] Server started successfully
- [ ] Health check passes
- [ ] Keepalive working (no 404)
- [ ] Account endpoints responding
- [ ] Database tables created
- [ ] Logs monitored for errors
- [ ] Team notified
- [ ] Ready for users

---

## 🎉 Deployment Complete!

If all checks pass:
- ✅ Cashier account management is live
- ✅ Keepalive is fixed and working
- ✅ Production environment is stable
- ✅ Users can now use the system

**Time to celebrate! 🎊**

---

**Note**: For issues or questions, refer to the documentation files:
- `SESSION_COMPLETION_SUMMARY.md` - Feature overview
- `KEEPALIVE_FIX.md` - Keepalive fix details
- `FILES_MODIFIED_SUMMARY.md` - All changes made
