// routes/keepalive.js
// Route pour maintenir la session actif

import express from "express";
import { wrap } from "../game.js";

const router = express.Router();
const PORT = process.env.PORT || 8080;

// === ROUTE KEEPALIVE ===
// Route /api/v1/keepalive/ pour maintenir la session
router.all("/", (req, res) => {
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const basePath = '/api/v1/keepalive/';
  const keepAliveUrl = `${proto}://${host}${basePath}`;

  const payload = {
    keepAliveTick: 30000,
    keepAliveTimeout: 5000,
    keepAliveUrl
  };

  return res.json(wrap(payload));
});

export default router;
