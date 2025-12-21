import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

// Imports de nos modules
import { gameState, startNewRound, wrap, restoreGameStateFromRedis, loadWinnersHistoryFromDatabase } from "./game.js";
import createRoundsRouter from "./routes/rounds.js";
import createInitRouter from "./routes/init.js";
import createAuthRouter, { verifyToken, requireRole } from "./routes/auth.js";
import createReceiptsRouter from "./routes/receipts.js";
import createMyBetsRouter from "./routes/my_bets.js";
import createWinnersRouter from "./routes/winners.js";
import keepaliveRouter from "./routes/keepalive.js";
import moneyRouter from "./routes/money.js";
import statsRouter from "./routes/stats.js";
import accountsRouter from "./routes/accounts.js";
import { SERVER_WEBSOCKET_CONFIG, logWebSocketConfig } from "./config/websocket.js";
import { logKeepaliveConfig, validateConfig } from "./config/keepalive.config.js";
import { 
  ROUND_WAIT_DURATION_MS,
  MOVIE_SCREEN_DURATION_MS,
  FINISH_SCREEN_DURATION_MS,
  TOTAL_RACE_TIME_MS
} from "./config/app.config.js";

// Import ChaCha20 RNG pour sécurité des jeux d'argent
import { initChaCha20 } from "./chacha20.js";

// Import base de données
import { initializeDatabase, pool } from "./config/db.js";

// Import Redis pour cache et sessions
import { initRedis, closeRedis, redisClient } from "./config/redis.js";
import { cacheResponse } from "./middleware/cache.js";
import auditMiddleware from "./middleware/audit.js";

// ✅ NOUVEAU: express-session avec Redis Store (production-ready)
import session from "express-session";
import RedisStore from "connect-redis";

// ✅ Créer le store Redis pour les sessions
let sessionStore = null;

// ✅ Import du round number manager
import { initRoundNumberManager, initRoundIdManager } from "./utils/roundNumberManager.js";

// Recréation de __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;
const NODE_ENV = process.env.NODE_ENV || "development";

// ✅ Créer le serveur HTTP manuellement pour pouvoir l'utiliser avec WebSocket
const http = await import('http');
const httpServer = http.createServer(app);

// ✅ Afficher l'environnement au démarrage
console.log(`
════════════════════════════════════════════════════════
🚀 Démarrage du serveur
════════════════════════════════════════════════════════
Mode: ${NODE_ENV.toUpperCase()}
Port Express: ${PORT}
Timestamp: ${new Date().toISOString()}
════════════════════════════════════════════════════════
`);

// Initialiser ChaCha20 RNG au démarrage
initChaCha20();

// ✅ Afficher la configuration du keepalive
logKeepaliveConfig();
validateConfig();

// Initialiser Redis (avec fallback gracieux si non disponible)
await initRedis().catch(err => {
  console.warn('⚠️ Redis n\'est pas disponible, fonctionnement sans cache:', err.message);
});

// Initialiser la base de données au démarrage
await initializeDatabase();

// ✅ Initialiser le manager de numéro de round depuis la BD
await initRoundNumberManager();

// ✅ NOUVEAU: Initialiser le manager de round ID depuis la BD
// Cela charge le dernier round_id utilisé et assure la continuité après redémarrage
await initRoundIdManager();

// ✅ IMPORTANT: Restaurer l'état du jeu depuis Redis si serveur crash antérieur
const restored = await restoreGameStateFromRedis();
if (restored) {
  console.log(`✅ État du jeu restauré depuis Redis après crash`);
}

// ✅ NOUVEAU: Charger l'historique des gagnants depuis la BD au démarrage
// Permet la persistance et l'affichage après redémarrage du serveur
await loadWinnersHistoryFromDatabase().catch(err => {
  console.warn('⚠️ Impossible de charger l\'historique des gagnants:', err.message);
});

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

// ✅ CONFIGURATION EXPRESS-SESSION AVEC REDIS (Production-Ready)
// Initialiser le RedisStore après que Redis soit connecté
if (redisClient && redisClient.isOpen) {
  sessionStore = new RedisStore({
    client: redisClient,
    prefix: 'session:',
    ttl: 86400 // 24 heures
  });
  console.log('✅ Express-Session configuré avec Redis Store (production-ready)');
} else {
  console.warn('⚠️ Redis non disponible, utilisation du store en mémoire (développement seulement)');
  // Fallback: MemoryStore pour développement (avec avertissement)
  sessionStore = new session.MemoryStore();
}

// Middleware express-session
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production', // HTTPS seulement en production
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 86400000 // 24 heures en ms
  },
  name: 'sessionId' // Nom du cookie
}));

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
// ✅ En production (Render), attacher le WebSocket au serveur HTTP existant
// ✅ En développement local, créer un serveur WebSocket séparé
let wss;

/**
 * Diffuse des données à tous les clients WebSocket connectés.
 * ✅ Ajoute automatiquement serverTime pour synchronisation
 * ✅ Vérifie que wss existe avant de broadcaster (évite erreurs si WebSocket pas encore initialisé)
 */
function broadcast(data) {
  // ✅ Vérifier que WebSocket est initialisé
  if (!wss) {
    console.warn('[BROADCAST] ⚠️ WebSocket non initialisé, broadcast ignoré');
    return;
  }
  
  const enhancedData = {
    ...data,
    serverTime: Date.now() // ✅ SYNC: Timestamp serveur pour tous les broadcasts
  };
  
  try {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // 1 = WebSocket.OPEN
        client.send(JSON.stringify(enhancedData));
      }
    });
  } catch (err) {
    console.error('[BROADCAST] ❌ Erreur lors du broadcast:', err.message);
  }
}

/**
 * Configure tous les handlers WebSocket après que wss soit créé
 */
function setupWebSocket() {
  wss.on("connection", (ws) => {
    console.log("📡 Client connecté au WebSocket local");
    
    // Calcule l'état actuel pour envoyer au nouveau client
    const now = Date.now();
    // ✅ Tous les timers importés depuis config/app.config.js (single source of truth)
    
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
      currentScreen: screen,  // ✅ NOUVEAU: Alias pour cohérence
      isRaceRunning: gameState.isRaceRunning,
      raceStartTime: gameState.raceStartTime,
      raceEndTime: gameState.raceEndTime,
      timeInRace: timeInRace,  // ✅ NOUVEAU: Temps écoulé depuis le début de la course
      nextRoundStartTime: gameState.nextRoundStartTime,
      timerTimeLeft: gameState.nextRoundStartTime && gameState.nextRoundStartTime > now 
        ? gameState.nextRoundStartTime - now 
        : 0,
      currentRound: JSON.parse(JSON.stringify(gameState.currentRound || {})),
      totalReceipts: (gameState.currentRound?.receipts || []).length,
      totalPrize: gameState.currentRound?.totalPrize || 0
    }));
  });
  
  // Event: WebSocket server listening
  wss.on("listening", () => {
    logWebSocketConfig();
  });
}

// ========================================================================
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
app.get("/user-dashboard", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "./pages/dashboard.html")));
app.get("/bet_frame", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "bet_frame.html")));
app.get("/my-bets", requireAuthHTML, (req, res) => res.sendFile(path.join(__dirname, "./static/pages", "my-bets.html")));
// ✅ NOUVEAU: Route pour la gestion du compte de caisse
app.get("/cashier-account", requireRoleHTML('cashier'), (req, res) => res.sendFile(path.join(__dirname, "./static/pages", "cashier-account.html")));



// === API v1 ===
// ✅ NOUVEAU: Health check endpoint (public, no auth required)
// Permet de vérifier que le serveur est en bon état
app.get('/api/v1/health', async (req, res) => {
  try {
    const now = Date.now();
    
    // Vérifier la connexion à la base de données
    let dbHealthy = false;
    try {
      await pool.query('SELECT NOW()');
      dbHealthy = true;
    } catch (err) {
      console.warn('[HEALTH] ⚠️ Database unhealthy:', err.message);
    }
    
    // Vérifier la connexion Redis (optionnel)
    let redisHealthy = true;
    try {
      if (global.redisClient) {
        // Si Redis est disponible, faire un ping
        await global.redisClient.ping();
      }
    } catch (err) {
      console.warn('[HEALTH] ⚠️ Redis unhealthy:', err.message);
      redisHealthy = false;
    }
    
    // Vérifier si WebSocket est initialisé
    const wsHealthy = !!wss;
    
    // Déterminer le statut global
    const overallHealthy = dbHealthy && wsHealthy; // Redis est optionnel
    const status = overallHealthy ? 'healthy' : 'degraded';
    
    // Retourner les infos de santé
    return res.json({
      status: status,
      timestamp: now,
      uptime: process.uptime(),
      services: {
        database: dbHealthy ? 'healthy' : 'unhealthy',
        websocket: wsHealthy ? 'healthy' : 'unhealthy',
        redis: redisHealthy ? 'healthy' : 'unavailable'
      },
      game: {
        isRaceRunning: gameState.isRaceRunning,
        currentRoundId: gameState.currentRound?.id || null,
        totalReceipts: (gameState.currentRound?.receipts || []).length,
        nextRoundStartTime: gameState.nextRoundStartTime,
        timeUntilNextRound: gameState.nextRoundStartTime 
          ? Math.max(0, gameState.nextRoundStartTime - now) 
          : null
      },
      version: '1.0.0'
    });
  } catch (err) {
    console.error('[HEALTH] ❌ Health check failed:', err);
    return res.status(503).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: Date.now()
    });
  }
});

// Auth routes (no protection needed - public login endpoint)
app.use('/api/v1/auth/', createAuthRouter());

// Init routes - Fast game initialization (public endpoints)
const initRouter = createInitRouter();
app.use("/api/v1/init/", initRouter);

// Keepalive route centralisée (no protection)
app.use("/api/v1/keepalive/", keepaliveRouter);

// ✅ PROBLÈME #13: Les routes sont créées mais wss n'est pas encore initialisé
// Les routes seront initialisées APRÈS que wss soit créé dans httpServer.listen()
// Pour l'instant, on crée juste les routers (ils utiliseront broadcast qui sera lié à wss plus tard)
let roundsRouter = null; // Sera initialisé après wss

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

// ✅ CORRECTION: Protéger aussi POST /api/v1/receipts/ pour que req.user soit disponible
app.post("/api/v1/receipts/", verifyToken, (req, res, next) => {
  // Pour POST, on vérifie juste l'authentification (pas de rôle spécifique)
  // Les rôles seront vérifiés dans le router si nécessaire
  next();
});

app.use("/api/v1/receipts/", createReceiptsRouter(broadcast));

app.use("/api/v1/my-bets/", verifyToken, createMyBetsRouter(broadcast));

app.use("/api/v1/winners/", createWinnersRouter());

app.use("/api/v1/money/", verifyToken, requireRole('cashier', 'admin'), moneyRouter);

// ✅ NOUVEAU: Routes de gestion des comptes de caisse
app.use("/api/v1/accounts/", accountsRouter);

// ✅ NOUVEAU: Stats & Audit routes (PostgreSQL + Redis strategy)
app.use("/api/v1/stats/", statsRouter);

// ✅ NOUVEAU: Audit middleware (enregistre automatiquement les actions)
app.use(auditMiddleware);

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

// ✅ Job scheduler avec retry logic pour initialiser le jeu avec robustesse
async function initializeGameWithRetry(maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🚀 [STARTUP] Tentative ${attempt}/${maxAttempts} d'initialisation...`);
      
      // ⏱️ Mesurer le temps d'initialisation
      const startTime = Date.now();
      
      console.log('📊 [STARTUP] Initialisation de la base de données...');
      // Vérifier que la connexion DB est prête
      const testQuery = await pool.query('SELECT NOW()');
      console.log(`✅ [STARTUP] Base de données prête (latence: ${Date.now() - startTime}ms)`);
      
      console.log('📡 [STARTUP] Vérification du système WebSocket...');
      if (!broadcast || typeof broadcast !== 'function') {
        throw new Error('Fonction broadcast non disponible');
      }
      console.log('✅ [STARTUP] WebSocket système OK');
      
      console.log('🎮 [STARTUP] Lancement du premier round...');
      
      // ✅ CORRECTION: Vérifier si un round existe déjà (restauré depuis Redis)
      // Si oui, ne pas en créer un nouveau, juste s'assurer que tout est prêt
      if (gameState.currentRound && gameState.currentRound.id) {
        console.log(`✅ [STARTUP] Round existant trouvé (ID: ${gameState.currentRound.id}), vérification des données...`);
        
        // Vérifier que le timer est configuré
        if (!gameState.nextRoundStartTime) {
          const now = Date.now();
          gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;
          console.log(`⏱️ [STARTUP] Timer configuré pour le round existant: ${ROUND_WAIT_DURATION_MS}ms`);
        }
        
        // Vérifier que les participants sont présents
        if (!gameState.currentRound.participants || gameState.currentRound.participants.length === 0) {
          console.warn('⚠️ [STARTUP] Round existant sans participants, création d\'un nouveau round...');
          await startNewRound(broadcast, false);
        } else {
          console.log(`✅ [STARTUP] Round #${gameState.currentRound.id} prêt avec ${gameState.currentRound.participants.length} participants`);
          
          // Broadcast le round existant pour synchroniser les clients
          if (broadcast) {
            const now = Date.now();
            broadcast({
              event: "new_round",
              roundId: gameState.currentRound.id,
              game: JSON.parse(JSON.stringify(gameState.currentRound)),
              currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
              participants: gameState.currentRound.participants,
              isRaceRunning: gameState.isRaceRunning,
              raceStartTime: gameState.isRaceRunning ? gameState.raceStartTime : null,
              raceEndTime: gameState.isRaceRunning ? gameState.raceEndTime : null,
              gameHistory: gameState.gameHistory || [],
              timer: {
                timeLeft: gameState.nextRoundStartTime && gameState.nextRoundStartTime > now 
                  ? gameState.nextRoundStartTime - now 
                  : ROUND_WAIT_DURATION_MS,
                totalDuration: ROUND_WAIT_DURATION_MS,
                startTime: gameState.nextRoundStartTime ? gameState.nextRoundStartTime - ROUND_WAIT_DURATION_MS : now,
                endTime: gameState.nextRoundStartTime || (now + ROUND_WAIT_DURATION_MS)
              }
            });
          }
        }
      } else {
        // Aucun round existant, créer le premier round
        await startNewRound(broadcast, false);
      }
      
      // ✅ VÉRIFICATION FINALE: S'assurer que le round est bien créé et prêt
      if (!gameState.currentRound || !gameState.currentRound.id) {
        throw new Error('Round non créé après startNewRound()');
      }
      
      if (!gameState.currentRound.participants || gameState.currentRound.participants.length === 0) {
        throw new Error('Round créé sans participants');
      }
      
      if (!gameState.nextRoundStartTime) {
        throw new Error('Timer non configuré pour le round');
      }
      
      console.log(`✅ [STARTUP] Premier round lancé avec succès (durée totale: ${Date.now() - startTime}ms)`);
      console.log(`   📊 Round ID: ${gameState.currentRound.id}`);
      console.log(`   👥 Participants: ${gameState.currentRound.participants.length}`);
      console.log(`   ⏱️ Timer: ${ROUND_WAIT_DURATION_MS}ms (fin à ${new Date(gameState.nextRoundStartTime).toISOString()})`);
      
      return true;
    } catch (error) {
      console.error(`❌ [STARTUP] Tentative ${attempt} échouée:`, error.message);
      
      if (attempt < maxAttempts) {
        const delayMs = 1000 * attempt; // Délai progressif: 1s, 2s, 3s...
        console.log(`⏳ [STARTUP] Attente ${delayMs}ms avant prochaine tentative...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  console.error('❌ [STARTUP] Impossible d\'initialiser le jeu après 3 tentatives');
  return false;
}

// ✅ AUTO-RECOVERY DÉSACTIVÉE
// Le client gère maintenant le timer et clique automatiquement
// Il n'y a plus besoin de l'AUTO-RECOVERY côté serveur
// Si on le laisse actif, il crée plusieurs rounds simultanément
// function scheduleAutoStartRound() {
//   console.log('✅ [SCHEDULER] Auto-start programmé (intervalle: 2s)');
//   ...
// }

httpServer.listen(PORT, async () => {
  console.log(`✅ Serveur de jeu lancé sur http://localhost:${PORT}`);
  
  // ✅ Créer le WebSocket après que le serveur HTTP soit en train de tourner
  wss = new WebSocketServer({
    server: httpServer,
    path: SERVER_WEBSOCKET_CONFIG.path
  });
  
  console.log(`📡 WebSocket attaché au serveur HTTP sur le chemin ${SERVER_WEBSOCKET_CONFIG.path}`);
  
  // ✅ Configurer les handlers WebSocket
  setupWebSocket();
  
  // ✅ PROBLÈME #13 CORRIGÉ: Initialiser les routes APRÈS que wss soit créé
  // Maintenant que wss existe, on peut créer les routes qui utilisent broadcast
  roundsRouter = createRoundsRouter(broadcast);
  app.post("/api/v1/rounds/auto-finish", roundsRouter);
  app.use("/api/v1/rounds/", verifyToken, roundsRouter);
  
  // ✅ Initialiser le jeu avec retry logic
  const initialized = await initializeGameWithRetry(3);
  
  if (!initialized) {
    console.error('⚠️ [STARTUP] Initialisation échouée, le serveur continue mais le jeu n\'est pas prêt');
  }
  
  // ✅ AUTO-RECOVERY DÉSACTIVÉE
  // Le client gère le timer et clique automatiquement, plus besoin de l'AUTO-RECOVERY
  // scheduleAutoStartRound();
  
  // ✅ BROADCAST TIMER: Synchronisation client toutes les 500ms
  // Cela permet aux clients de rester synchronisés même s'ils dérivent
  setInterval(() => {
    const now = Date.now();
    if (gameState.nextRoundStartTime && gameState.nextRoundStartTime > now) {
      const timeLeft = gameState.nextRoundStartTime - now;
          // ✅ Utilise ROUND_WAIT_DURATION_MS importé depuis config/app.config.js
      
      broadcast({
        event: 'timer_update',
        roundId: gameState.currentRound?.id,
        timer: {
          timeLeft: Math.max(0, timeLeft),
          totalDuration: ROUND_WAIT_DURATION_MS,
          startTime: gameState.nextRoundStartTime - ROUND_WAIT_DURATION_MS,
          endTime: gameState.nextRoundStartTime,
          percentage: 100 - (timeLeft / ROUND_WAIT_DURATION_MS) * 100,
          serverTime: now
        }
      });
    }
  }, 500);
  
  // ✅ SUPPRIMÉ: Plus besoin de démarrer automatiquement la course
  // Le round est maintenant créé au démarrage avec un timer actif
  // Les clients peuvent lancer la course quand le timer expire
  // Le système fonctionne maintenant avec le timer client qui déclenche le lancement
  console.log('✅ [STARTUP] Round créé et prêt. Les clients peuvent lancer la course quand le timer expire.');
});
