import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const SESSION_COOKIE_NAME = "authSession";
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Auth router that validates credentials against the database.
 */
export default function createAuthRouter() {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const body = req.body || {};
    const station = (body.station || '').toString();
    const username = (body.username || '').toString();
    const password = (body.password || '').toString();

    // Basic validation
    if (!station || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing credentials' });
    }

    try {
      // Query user from database
      const userRes = await pool.query(
        'SELECT user_id, username, email, role, is_active, is_suspended FROM users WHERE username = $1 AND password = $2',
        [username, password]
      );

      if (userRes.rows.length === 0) {
        console.log(`[AUTH] ❌ Failed login attempt for station=${station} username=${username}`);
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }

      const user = userRes.rows[0];

      // Check if user is active
      if (!user.is_active || user.is_suspended) {
        console.log(`[AUTH] ❌ Account suspended/inactive: ${username}`);
        return res.status(403).json({ success: false, error: 'Account is suspended or inactive' });
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.user_id, username: user.username, role: user.role, station },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log(`[AUTH] ✅ Login successful: station=${station} username=${username} role=${user.role}`);

      // Set secure httpOnly cookie
      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'strict',
        maxAge: SESSION_TIMEOUT_MS,
        path: '/'
      });

      // Also store token in localStorage-compatible response
      const redirect = user.role === 'admin' ? '/dashboard' : '/user-dashboard';

      return res.json({ 
        success: true, 
        token, 
        redirect, 
        user: { userId: user.user_id, username: user.username, role: user.role } 
      });
    } catch (err) {
      console.error('[AUTH] Database error:', err.message);
      return res.status(500).json({ success: false, error: 'Server error' });
    }
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return res.json({ success: true, message: 'Logged out successfully' });
  });

  return router;
}

/**
 * Middleware to protect routes - verifies JWT token from cookie or Authorization header
 */
export function verifyToken(req, res, next) {
  let token = null;

  // Try to get token from cookie first
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    token = req.cookies[SESSION_COOKIE_NAME];
  } 
  // Fallback to Authorization header
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Missing or invalid token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('[AUTH] Invalid token:', err.message);
    return res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Middleware to check role
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}
