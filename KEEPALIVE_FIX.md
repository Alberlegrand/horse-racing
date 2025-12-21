# Keepalive Implementation Fix

## Problem
The keepalive request was returning 404 errors in production with malformed URLs like:
```
GET https://hitbet777.store/api/v1/keepalive&dt=0.27... 404 (Not Found)
```

The URL format was incorrect - using `&` (ampersand) instead of `?` (question mark) for query parameters.

## Root Causes Identified

1. **Incorrect URL formatting in `webclient.js`** (Line 93)
   - Was using: `keepAliveUrl + "&dt=" + Math.random()`
   - Should use: `keepAliveUrl + "?dt=" + Math.random()`

2. **Missing trailing slash in `screen.html`** (Line 547)
   - Was using: `keepAliveUrl: "/api/v1/keepalive"`
   - Should use: `keepAliveUrl: "/api/v1/keepalive/"`

## Solutions Applied

### 1. Fixed URL Format in `webclient.js`
```javascript
// BEFORE (Line 93)
url: keepAliveUrl + "&dt=" + Math.random(),

// AFTER
url: keepAliveUrl + "?dt=" + Math.random(),
```

### 2. Updated `screen.html` Configuration
```html
<!-- BEFORE (Line 547) -->
keepAliveUrl: "/api/v1/keepalive",

<!-- AFTER -->
keepAliveUrl: "/api/v1/keepalive/",
```

## How Keepalive Works

### Client-Side (`webclient.js`)
- Runs in WebClient's `_activateKeepAlive()` method
- Sends periodic GET requests to keep session alive
- Interval: Configurable (default: 30,000ms = 30 seconds)
- Timeout: Configurable (default: 5,000ms = 5 seconds)
- Query parameter `dt` added with random value to prevent caching

### Server-Side (`routes/keepalive.js`)
- Route: `GET /api/v1/keepalive/`
- Returns JSON with keepalive configuration
- No authentication required (public endpoint)
- Keeps browser session active during idle periods

### Response Format
```json
{
  "data": {
    "keepAliveTick": 30000,
    "keepAliveTimeout": 5000,
    "keepAliveUrl": "https://hitbet777.store/api/v1/keepalive/"
  }
}
```

## Configuration Points

1. **In `screen.html` (line 547)**
   - `keepAliveUrl`: Base URL for keepalive requests
   - `keepAliveTick`: Interval between requests (30 seconds)
   - `keepAliveTimeout`: Request timeout (5 seconds)

2. **In `static/js/main.js` (line 48)**
   - `keepAliveUrl`: "/api/v1/keepalive/"
   - `keepAliveTick`: "20000" (20 seconds)
   - `keepAliveTimeout`: "5000" (5 seconds)

## Purpose & Benefits

### Prevents Server Timeout
- Keeps connection active even during idle periods
- Prevents server from closing inactive connections
- Essential for production environments with aggressive connection cleanup

### Session Management
- Maintains user session on backend
- Prevents authentication token expiration
- Works with Redis session store for persistence

### Network Resilience
- Random query parameter prevents caching
- Handles network fluctuations gracefully
- Auto-reconnects on failure (handled by webclient)

## Testing Checklist

- [x] URL format corrected (using `?` for query parameters)
- [x] Trailing slash added to keepAliveUrl
- [x] Route registered in server.js
- [x] keepalive.js exports correct response format
- [x] WebSocket doesn't interfere with keepalive
- [ ] Test in production after deployment

## Production Deployment Notes

1. **Monitor keepalive requests** in server logs for 404 errors
2. **Check CDN/Proxy settings** - some may strip query parameters
3. **Verify HTTPS** - keepalive requests must use same protocol as page
4. **Load testing** - ensure keepalive doesn't overwhelm server with interval traffic
5. **Session timeout** - adjust backend session TTL to match keepalive interval

## Files Modified

1. `static/js/webclient.js` - Line 93 (URL format fix)
2. `screen.html` - Line 547 (keepAliveUrl configuration)

## No Changes Needed

- `routes/keepalive.js` - Already correctly implemented
- `server.js` - Route already properly mounted
- `cashier.html` - Doesn't use keepalive (for cashier operations)
- `horse.html` - Uses different WebSocket connection
