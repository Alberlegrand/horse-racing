import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Imports de nos modules
import { gameState, startNewRound, wrap } from "./game.js";
import createRoundsRouter from "./routes/rounds.js";
import receiptsRouter from "./routes/receipts.js";
import myBetsRouter from "./routes/my_bets.js"; // <-- NOUVEL IMPORT
import keepaliveRouter from "./routes/keepalive.js";
import moneyRouter from "./routes/money.js";

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
app.use('/pages', express.static(path.join(__dirname, 'public', 'pages')));
app.use('/css', express.static(path.join(__dirname, 'static', 'css')));
app.use('/js', express.static(path.join(__dirname, 'static', 'js')));
app.use('/img', express.static(path.join(__dirname, 'static', 'img')));
app.use('/fonts', express.static(path.join(__dirname, 'static', 'fonts')));

// =================================================================
// ===           SERVEUR WEBSOCKET                               ===
// =================================================================
const wss = new WebSocketServer({ port: 8081, path: "/connection/websocket" });

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
  // On envoie l'ID du tour courant depuis le gameState importé
  ws.send(JSON.stringify({ event: "connected", roundId: gameState.currentRound.id }));
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
app.get("/my-bets", (req, res) => res.sendFile(path.join(__dirname,"./static/pages", "my-bets.html")));


// === API v1 ===
// On injecte la fonction 'broadcast' dans le routeur des rounds
app.use("/api/v1/rounds/", createRoundsRouter(broadcast));
// Le routeur des receipts n'a pas besoin de dépendances
app.use("/api/v1/receipts/", receiptsRouter);
// Le nouveau routeur pour "Mes Paris"
app.use("/api/v1/my-bets/", myBetsRouter); // <-- NOUVELLE ROUTE
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
  // Démarre le premier tour au lancement, en passant la fonction broadcast
  startNewRound(broadcast);
});

wss.on("listening", () => {
    console.log("✅ Serveur WebSocket lancé sur ws://localhost:8081");
});