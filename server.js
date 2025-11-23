import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

// Imports de nos modules
import { gameState, startNewRound, wrap, restoreGameStateFromRedis } from "./game.js";
import createRoundsRouter from "./routes/rounds.js";
import createAuthRouter, { verifyToken, requireRole } from "./routes/auth.js";
import createReceiptsRouter from "./routes/receipts.js";
import createMyBetsRouter from "./routes/my_bets.js";
import keepaliveRouter from "./routes/keepalive.js";
import moneyRouter from "./routes/money.js";
import { SERVER_WEBSOCKET_CONFIG } from "./config/websocket.js";

// Import ChaCha20 RNG pour sécurité des jeux d'argent
import { initChaCha20 } from "./chacha20.js";

// Import base de données
import { initializeDatabase } from "./config/db.js";

// Import Redis pour cache et sessions
import { initRedis, closeRedis } from "./config/redis.js";
import { cacheResponse } from "./middleware/cache.js";
import { sessionMiddleware } from "./middleware/session.js";

// Recréation de __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

// Initialiser ChaCha20 RNG au démarrage
initChaCha20();

// Initialiser Redis (avec fallback gracieux si non disponible)
await initRedis().catch(err => {
  console.warn('⚠️ Redis n\'est pas disponible, fonctionnement sans cache:', err.message);
});

// Initialiser la base de données au démarrage
await initializeDatabase();

// ✅ IMPORTANT: Restaurer l'état du jeu depuis Redis si serveur crash antérieur
const restored = await restoreGameStateFromRedis();
if (restored) {
  console.log(`✅ État du jeu restauré depuis Redis après crash`);
}

// =================================================================
// ===           CONFIGURATION DU MIDDLEWARE                     ===
// =================================================================
app.use(cors({
  origin: true,
  credentials: true, // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ MIDDLEWARE: Sessions Redis
app.use(sessionMiddleware());

// Fichiers statiques
app.use(express.static(path.join(__dirname, "static")));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Test_screen', express.static(path.join(__dirname, 'Test_screen')));

app.use('/pages', express.static(path.join(__dirname, 'public', 'pages')));
app.use('/css', express.static(path.join(__dirname, 'static', 'css')));
app.use('/js', express.static(path.join(__dirname, 'static', 'js')));
app.use('/img', express.static(path.join(__dirname, 'static', 'img')));
app.use('/fonts', express.static(path.join(__dirname, 'static', 'fonts')));

// =================================================================
// ===           SERVEUR WEBSOCKET                               ===
// =================================================================
const wss = new WebSocketServer({ 
  port: SERVER_WEBSOCKET_CONFIG.port, 
  path: SERVER_WEBSOCKET_CONFIG.path 
});

/**
 * Diffuse des données à tous les clients WebSocket connectés.
 * ✅ Ajoute automatiquement serverTime pour synchronisation
 */
function broadcast(data) {
  const enhancedData = {
    ...data,
    serverTime: Date.now() // ✅ SYNC: Timestamp serveur pour tous les broadcasts
  };
  
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 = WebSocket.OPEN
      client.send(JSON.stringify(enhancedData));
    }
  });
}

wss.on("connection", (ws) => {
  console.log("📡 Client connecté au WebSocket local");
  
  // Calcule l'état actuel pour envoyer au nouveau client
  const now = Date.now();
  const MOVIE_SCREEN_DURATION_MS = 20000; // 20 secondes pour movie_screen
  const FINISH_DURATION_MS = 5000; // 5 secondes pour finish_screen
  const TOTAL_RACE_TIME_MS = MOVIE_SCREEN_DURATION_MS + FINISH_DURATION_MS; // 25 secondes total
  
  let screen = "game_screen";
  let timeInRace = 0;
  
  if (gameState.isRaceRunning && gameState.raceStartTime) {
    timeInRace = now - gameState.raceStartTime;
    if (timeInRace < MOVIE_SCREEN_DURATION_MS) {
      screen = "movie_screen";
    } else if (timeInRace < TOTAL_RACE_TIME_MS) {
      screen = "finish_screen";
    }
  }
  
  // Envoie l'état complet au nouveau client pour synchronisation
  ws.send(JSON.stringify({ 
    event: "connected", 
    serverTime: Date.now(), // ✅ SYNC: Timestamp serveur pour synchronisation client
    roundId: gameState.currentRound?.id || null,
    screen: screen,
    isRaceRunning: gameState.isRaceRunning,
    raceStartTime: gameState.raceStartTime,
    raceEndTime: gameState.raceEndTime,
    timeInRace: timeInRace,
    nextRoundStartTime: gameState.nextRoundStartTime,
    timerTimeLeft: gameState.nextRoundStartTime && gameState.nextRoundStartTime > now 
      ? gameState.nextRoundStartTime - now 
      : 0,
    currentRound: JSON.parse(JSON.stringify(gameState.currentRound || {})),
    totalReceipts: (gameState.currentRound?.receipts || []).length,
    totalPrize: gameState.currentRound?.totalPrize || 0
  }));
});

// =================================================================
// ===           ROUTES DE L'APPLICATION                         ===
// =================================================================

/**
 * Middleware pour protéger les routes HTML - vérifie le cookie d'authentification
 */
function requireAuthHTML(req, res, next) {
  const cookie = req.cookies?.authSession;
  if (!cookie) {
    return res.redirect('/');
  }
  try {
    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
    jwt.verify(cookie, JWT_SECRET);
    next();
  } catch (err) {
    console.log('[AUTH] Invalid session cookie, redirecting to login');
    return res.redirect('/');
  }
}

/**
 * Middleware pour vérifier le rôle sur les routes HTML
 */
function requireRoleHTML(role) {
  return (req, res, next) => {
    const cookie = req.cookies?.authSession;
    if (!cookie) {
      return res.redirect('/');
    }
    try {
      const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
      const decoded = jwt.verify(cookie, JWT_SECRET);
      if (decoded.role !== role && decoded.role !== 'admin') {
        console.log(`[AUTH] Access denied: required role ${role}, got ${decoded.role}`);
        return res.status(403).sendFile(path.join(__dirname, "./static/pages", "login.html"));
      }
      next();
    } catch (err) {
      console.log('[AUTH] Invalid session cookie, redirecting to login');
      return res.redirect('/');
    }
  };
}

// === Routes statiques HTML ===
// Page de login - pas de protection
//app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "./static/pages", "login.html")));
app.get("/landing", (req, res) => res.sendFile(path.join(__dirname, "landing.html")));

// Routes protégées - authentification requise
app.get("/horse", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "horse.html")));
app.get("/cashier", requireRoleHTML('cashier'), (req, res) => res.sendFile(path.join(__dirname, "cashier.html")));
app.get("/screen", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "screen.html")));
app.get("/course-chevaux", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "./pages/course-chevaux.html")));
app.get("/dashboard", requireRoleHTML('admin'), (req, res) => res.sendFile(path.join(__dirname, "./dashboard.html")));
app.get("/bet_frame", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "bet_frame.html")));
app.get("/my-bets", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "./static/pages", "my-bets.html")));



// === API v1 ===
// Auth routes (no protection needed - public login endpoint)
app.use('/api/v1/auth/', createAuthRouter());

// Keepalive route centralisée (no protection)
app.use("/api/v1/keepalive/", keepaliveRouter);

// Protected routes - require authentication
const roundsRouter = createRoundsRouter(broadcast);
app.use("/api/v1/rounds/", verifyToken, roundsRouter);

// Receipts router with special handling for print (no auth required)
app.get("/api/v1/receipts/", (req, res, next) => {
  // Allow print action without authentication
  if (req.query.action === 'print') {
    return next();
  }
  // For other GET/POST actions, require authentication
  verifyToken(req, res, () => {
    requireRole('cashier', 'admin')(req, res, next);
  });
});

app.use("/api/v1/receipts/", createReceiptsRouter(broadcast));

app.use("/api/v1/my-bets/", verifyToken, createMyBetsRouter(broadcast));

app.use("/api/v1/money/", verifyToken, requireRole('cashier', 'admin'), moneyRouter);

// ...existing code...
// Remplacez/ajoutez la route keepalive par ce handler robuste :
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
// ...existing code...

// =================================================================
// ===           DÉMARRAGE                                       ===
// =================================================================
app.listen(PORT, () => {
  console.log(`✅ Serveur de jeu lancé sur http://localhost:${PORT}`);
  // Démarre le premier tour au lancement
  startNewRound(broadcast);
  
  // ✅ NOUVEAU: Broadcast le timer toutes les 500ms pour synchronisation client
  // Cela permet aux clients de rester synchronisés même s'ils dérivent
  setInterval(() => {
    const now = Date.now();
    if (gameState.nextRoundStartTime && gameState.nextRoundStartTime > now) {
      const timeLeft = gameState.nextRoundStartTime - now;
      const envDuration = Number(process.env.ROUND_WAIT_DURATION_MS);
      const ROUND_WAIT_DURATION_MS = (envDuration > 0) ? envDuration : 180000;
      
      broadcast({
        event: 'timer_update',
        roundId: gameState.currentRound?.id, // ✅ Inclure le roundId
        timer: {
          timeLeft: Math.max(0, timeLeft),
          totalDuration: ROUND_WAIT_DURATION_MS, // ✅ Utiliser la vraie durée
          startTime: gameState.nextRoundStartTime - ROUND_WAIT_DURATION_MS,
          endTime: gameState.nextRoundStartTime,
          percentage: 100 - (timeLeft / ROUND_WAIT_DURATION_MS) * 100,
          serverTime: now
        }
      });
    }
  }, 500); // Toutes les 500ms pour synchronisation fine
  
  // Démarrer automatiquement la première course après un court délai
  // La boucle automatique sera gérée par routes/rounds.js après le premier finish
  setTimeout(() => {
    if (roundsRouter.autoStartRace) {
      console.log('🚀 Démarrage automatique de la première course...');
      roundsRouter.autoStartRace();
    } else {
      console.log('⚠️ autoStartRace non disponible, attendre action finish manuelle');
    }
  }, 1000); // Délai pour s'assurer que le round est bien initialisé
});

wss.on("listening", () => {
  console.log(`✅ Serveur WebSocket lancé sur ws://localhost:${SERVER_WEBSOCKET_CONFIG.port}${SERVER_WEBSOCKET_CONFIG.path}`);
});