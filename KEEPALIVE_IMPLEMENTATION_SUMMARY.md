# Keepalive Fix Summary - December 20, 2025

## Issue Reported
Production error in keepalive requests:
```
GET https://hitbet777.store/api/v1/keepalive&dt=0.27... 404 (Not Found)
```

The URL was malformed with `&` instead of `?` for query parameters, causing 404 errors.

## Root Cause Analysis

### Problem 1: Incorrect Query Parameter Format
**File**: `static/js/webclient.js` (Line 93)
**Issue**: Using ampersand (`&`) instead of question mark (`?`) for first query parameter
```javascript
// WRONG
url: keepAliveUrl + "&dt=" + Math.random()
// Results in: /api/v1/keepalive&dt=0.xxx (404)

// CORRECT
url: keepAliveUrl + "?dt=" + Math.random()
// Results in: /api/v1/keepalive/?dt=0.xxx (200)
```

### Problem 2: Missing Trailing Slash
**File**: `screen.html` (Line 547)
**Issue**: keepAliveUrl without trailing slash
```html
<!-- WRONG -->
keepAliveUrl: "/api/v1/keepalive"

<!-- CORRECT -->
keepAliveUrl: "/api/v1/keepalive/"
```

## Solutions Implemented

### Change 1: Fixed `webclient.js`
```diff
  $.ajax({
    type: "GET",
-   url: keepAliveUrl + "&dt=" + Math.random(),
+   url: keepAliveUrl + "?dt=" + Math.random(),
    contentType: "application/json",
```

### Change 2: Updated `screen.html`
```diff
  window.client.init({
    assetPath: "/js/",
    receiptUrl: "/api/v1/receipts",
    limits: new LimitModel(0, 0),
-   keepAliveUrl: "/api/v1/keepalive",
+   keepAliveUrl: "/api/v1/keepalive/",
    keepAliveTick: 30000,
```

### Change 3: Created Test Script
**File**: `static/js/test-keepalive.js`
- Validates URL format
- Tests fetch request to keepalive endpoint
- Verifies response contains required fields

### Change 4: Documentation
**File**: `KEEPALIVE_FIX.md`
- Detailed explanation of the issue
- Configuration references
- Testing checklist
- Production deployment notes

## How Keepalive Works

### Client Flow
1. WebClient loads `screen.html` configuration
2. `_activateKeepAlive()` initializes with interval timer
3. Every 30 seconds, sends: `GET /api/v1/keepalive/?dt=0.xxx`
4. Server responds with current keepalive configuration
5. Client updates intervals if needed (dynamic config)

### Server Flow
1. Request arrives at `GET /api/v1/keepalive/`
2. Matched by Express route: `app.use("/api/v1/keepalive/", keepaliveRouter)`
3. `routes/keepalive.js` handles the request
4. Responds with JSON: `{ data: { keepAliveTick, keepAliveTimeout, keepAliveUrl } }`
5. Keeps session alive on backend

## Benefits
- ✅ Prevents server from closing idle connections
- ✅ Maintains session state on Redis
- ✅ Handles production network timeouts
- ✅ Allows dynamic keepalive configuration updates
- ✅ No authentication required (lightweight)

## Files Modified

| File | Line | Change | Type |
|------|------|--------|------|
| `static/js/webclient.js` | 93 | `&dt=` → `?dt=` | Bug Fix |
| `screen.html` | 547 | Add trailing `/` | Bug Fix |
| `KEEPALIVE_FIX.md` | NEW | Documentation | New File |
| `static/js/test-keepalive.js` | NEW | Test script | New File |

## Testing Instructions

### Manual Test in Browser Console
```javascript
// Copy and paste in browser console on screen page
fetch('/api/v1/keepalive/?dt=' + Math.random(), {
  credentials: 'include'
}).then(r => r.json()).then(d => console.log('✅ Keepalive works!', d));
```

### Expected Response
```json
{
  "data": {
    "keepAliveTick": 30000,
    "keepAliveTimeout": 5000,
    "keepAliveUrl": "https://hitbet777.store/api/v1/keepalive/"
  }
}
```

### Production Verification
1. Deploy changes to production
2. Open `screen.html` in browser
3. Open Developer Tools → Network tab
4. Look for `keepalive?dt=...` requests
5. Verify status: `200 OK` (not `404`)
6. Requests should appear every 30 seconds during idle

## Configuration Reference

### Default Keepalive Settings
- **Interval**: 30 seconds (configurable per page)
- **Timeout**: 5 seconds per request
- **Query Parameter**: `dt=random()` to prevent caching
- **Authentication**: None required (public endpoint)
- **Protocol**: Matches page protocol (HTTP or HTTPS)

### Per-Page Configuration
- **screen.html**: 30s interval, 5s timeout
- **main.js**: 20s interval, 5s timeout
- Can be overridden via response data

## Migration Notes

### For Existing Deployments
1. Deploy `static/js/webclient.js` changes first
2. Update `screen.html` configuration
3. Clear browser cache if needed
4. Verify keepalive requests in Network tab

### No Breaking Changes
- ✅ Backward compatible
- ✅ No database changes
- ✅ No API changes
- ✅ No authentication changes
- ✅ No dependency updates

## Future Improvements

1. Add keepalive metrics to analytics
2. Monitor keepalive request patterns
3. Dynamic timeout adjustment based on network conditions
4. Server-side keepalive tracking per session
5. Keepalive failure alerts/notifications

## Related Files (No Changes Needed)
- `routes/keepalive.js` - Already correct
- `server.js` - Route already mounted
- `config/app.config.js` - No keepalive config needed
- Database schema - No changes needed

## Rollback Plan
If issues occur:
1. Revert `static/js/webclient.js` line 93 back to `&dt=`
2. Revert `screen.html` line 547 back to `/api/v1/keepalive`
3. Clear browser cache
4. Restart affected clients

## Success Metrics

After deployment, monitor:
- ✅ No more 404 errors on keepalive requests
- ✅ Keepalive requests every 30 seconds in Network tab
- ✅ 200 OK responses from server
- ✅ No WebSocket disconnections due to timeout
- ✅ Session stays active during idle periods
