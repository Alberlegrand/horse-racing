import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Imports de nos modules
import { gameState, startNewRound, wrap } from "./game.js";
import createRoundsRouter from "./routes/rounds.js";
import createReceiptsRouter from "./routes/receipts.js";
import createMyBetsRouter from "./routes/my_bets.js";
import keepaliveRouter from "./routes/keepalive.js";
import moneyRouter from "./routes/money.js";
import { SERVER_WEBSOCKET_CONFIG } from "./config/websocket.js";

// Recréation de __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

// =================================================================
// ===           CONFIGURATION DU MIDDLEWARE                     ===
// =================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
 */
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 = WebSocket.OPEN
      client.send(JSON.stringify(data));
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

// === Routes statiques HTML ===
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/horse", (req, res) => res.sendFile(path.join(__dirname, "horse.html")));
app.get("/cashier", (req, res) => res.sendFile(path.join(__dirname, "cashier.html")));
app.get("/course-chevaux", (req, res) => res.sendFile(path.join(__dirname, "./pages/course-chevaux.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "./dashboard.html")));
app.get("/bet_frame", (req, res) => res.sendFile(path.join(__dirname, "bet_frame.html")));
app.get("/my-bets", (req, res) => res.sendFile(path.join(__dirname, "./static/pages", "my-bets.html")));
app.get("/landing", (req, res) => res.sendFile(path.join(__dirname, "landing.html")));
app.get("/screen", (req, res) => res.sendFile(path.join(__dirname, "screen.html")));



// === API v1 ===
// On injecte la fonction 'broadcast' dans le routeur des rounds
const roundsRouter = createRoundsRouter(broadcast);
app.use("/api/v1/rounds/", roundsRouter);
// On injecte aussi 'broadcast' dans le routeur des receipts pour les notifications temps réel
app.use("/api/v1/receipts/", createReceiptsRouter(broadcast));
// Le nouveau routeur pour "Mes Paris" - avec broadcast pour les notifications
app.use("/api/v1/my-bets/", createMyBetsRouter(broadcast));
app.use("/api/v1/money/", moneyRouter);

// Keepalive route centralisée
app.use("/api/v1/keepalive/", keepaliveRouter);

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