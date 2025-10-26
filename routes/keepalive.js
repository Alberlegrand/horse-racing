import express from "express";

const app = express();

// === Middleware ===
app.use(express.json());

// === Simulation de données ===
let fakeUser = {
  userId: 6130290,
  sessionId: "82c598b0-9829-47ca-9c91-a69a7d7ca156",
  balance: 170455,
};

// === ROUTE KEEPALIVE ===
// Route /api/v1/keepalive/ pour maintenir la session
app.all(/^\/api\/v1\/keepalive(\/.*)?$/, (req, res) => {
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

export default app;
