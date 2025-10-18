import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Recréation de __dirname (car non dispo en ES module)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8080;

// =================================================================
// ===           CONFIGURATION DU MIDDLEWARE                     ===
// =================================================================
app.use(cors());
app.use(express.json());
// Ajout : parser aussi les corps urlencoded (jQuery par défaut envoie ainsi)
app.use(express.urlencoded({ extended: true }));

// === CORRECTION IMPORT
// Sert les fichiers depuis le dossier courant (où se trouvent index.html, js/, css/)
// Cela corrige l'erreur de type MIME ('text/html' au lieu de 'text/css').
app.use(express.static(path.join(__dirname)));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/img', express.static(path.join(__dirname, 'img')));


// =================================================================
// ===           ÉTAT DU JEU ET DONNÉES EN MÉMOIRE               ===
// =================================================================

function generateRoundId() {
  return Math.floor(96908000 + Math.random() * 1000);
}

// Données de base des participants qui seront réutilisées à chaque tour
const BASE_PARTICIPANTS = [
  { number: 6, name: "De Bruyne", coeff: 5.5, family: 0 },
  { number: 7, name: "Ronaldo", coeff: 4.7, family: 1 },
  { number: 8, name: "Mbappe", coeff: 7.2, family: 2 },
  { number: 9, name: "Halland", coeff: 5.8, family: 3 },
  { number: 10, name: "Messi", coeff: 8.1, family: 4 },
  { number: 54, name: "Vinicius", coeff: 4.5, family: 5 }
];

let currentRound = {};
let gameHistory = []; // Pour stocker les résultats des tours précédents

// Simple helper pour envelopper les réponses comme attendu par le client
function wrap(data) {
  return { data };
}

// =================================================================
// ===      NOUVELLE FONCTIONNALITÉ : GESTION DU CYCLE DE JEU    ===
// =================================================================

/**
 * Archive le tour terminé et en démarre un nouveau.
 */
function startNewRound() {
    console.log(`🏁 Fin du tour #${currentRound.id}. Archivage des résultats.`);
    
    // 1. Archive le tour complété
    if (currentRound.id) {
        const finishedRound = {
            id: currentRound.id,
            winner: currentRound.participants.find(p => p.place === 1),
        };
        gameHistory.push(finishedRound);
        if (gameHistory.length > 10) gameHistory.shift(); // Garde seulement les 10 derniers tours
    }

    // 2. Prépare le nouveau tour
    const newRoundId = generateRoundId();
    currentRound = {
        id: newRoundId,
        participants: BASE_PARTICIPANTS.map(p => ({...p, place: undefined})), // Réinitialise les places
        receipts: [],
        lastReceiptId: 1,
    };

    console.log(`🚀 Nouveau tour #${currentRound.id} prêt à commencer !`);

    // 3. Notifie tous les clients qu'un nouveau tour est disponible
    broadcast({ event: "new_round", game: currentRound });
}


// =================================================================
// ===                   ROUTES DE L'APPLICATION                  ===
// =================================================================

// === Racine ===
// === Racine ===
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/horse", (req, res) => {
  res.sendFile(path.join(__dirname, "horse.html"));
});

// === API v1 ===
// POST /api/v1/rounds/  - body.action = "get" | "finish" | "confirm"
app.post("/api/v1/rounds/", (req, res) => {
  // Parsing défensif de l'action
  let rawBody = req.body;
  if (typeof rawBody === "string" && rawBody.trim()) {
    try { rawBody = JSON.parse(rawBody); } catch (e) { /* keep string */ }
  }

  const action =
    (rawBody && (rawBody.action || (rawBody.data && rawBody.data.action))) ||
    req.query.action ||
    null;

  // Debug utile pour tracer
  console.log("/api/v1/rounds/ headers:", req.headers);
  console.log("/api/v1/rounds parsed action:", action);
  if (!action) console.warn("/api/v1/rounds/ no action found. body:", req.body, "query:", req.query);

  // === GET ===
  if (action === "get") {
    return res.json(wrap(currentRound));
  }

  // === FINISH ===
  if (action === "finish") {
    res.json(wrap({ success: true }));

    broadcast({ event: "race_start", roundId: currentRound.id });

    // Simule la durée de la course
    setTimeout(() => {
      const winner = currentRound.participants[Math.floor(Math.random() * currentRound.participants.length)];
      const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };


      // Met à jour les places dans le tour courant
      currentRound.participants = currentRound.participants.map(p =>
        (p.number === winner.number ? winnerWithPlace : p)
      );

      // Calcul des gains
      currentRound.receipts.forEach(receipt => {
        let totalPrize = 0;
        if (Array.isArray(receipt.bets)) {
          receipt.bets.forEach(bet => {
            try {
              if (Number(bet.number) === Number(winner.number)) {
                const betValue = Number(bet.value) || 0;
                const coeff = Number(winner.coeff) || 0;
                totalPrize += betValue * coeff;
              }
            } catch (e) {}
          });
        }
        receipt.prize = totalPrize;
      });

      // Envoie les résultats
      broadcast({
        event: "race_end",
        winner: winnerWithPlace,
        receipts: currentRound.receipts,
        roundId: currentRound.id
      });

      // Nouveau tour après 15s
      console.log("Le nouveau tour commencera dans 15 secondes...");
      setTimeout(startNewRound, 15000);
    }, 7000);

    return;
  }

  // === CONFIRM ===
  if (action === "confirm") {
    console.log("Confirmation du round", currentRound.id);
    // On peut renvoyer le tour courant avec participants et tickets
    return res.json(wrap(currentRound));
  }

  // Action inconnue
  return res.status(400).json({ error: "Unknown action" });
});

// GET /api/v1/receipts/?action=print&id=...
app.get("/api/v1/receipts/", (req, res) => {
    if (req.query.action === 'print') {
        const receiptId = parseInt(req.query.id, 10);
        const receipt = currentRound.receipts.find(r => r.id === receiptId);

        if (!receipt) {
            return res.status(404).send("<h1>Ticket non trouvé</h1>");
        }

        // === AMÉLIORATION : Génération d'un ticket style "imprimante thermique" ===
        const createdTime = req.query.createdTime || new Date(receipt.create_time).toLocaleString('fr-FR');
        
        let betsHTML = receipt.bets.map(bet => {
            const participantName = bet.participant.name || `N°${bet.participant.number}`;
            return `
                <tr>
                    <td style="text-align: left;">${participantName}</td>
                    <td style="text-align: right;">${parseFloat(bet.value).toFixed(2)} HTG</td>
                </tr>
            `;
        }).join('');

        const receiptHTML = `
            <div style="font-family: 'Courier New', monospace; width: 300px; padding: 10px; border: 1px solid #ccc;">
                <h3 style="text-align: center; margin: 0;">PARYAJ CHEVAL</h3>
                <p style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px;">
                    Ticket #${receipt.id} | Tour #${currentRound.id}<br>
                    ${createdTime}
                </p>
                <table style="width: 100%; font-size: 14px;">
                    <thead><tr><th style="text-align: left;">Participant</th><th style="text-align: right;">Mise</th></tr></thead>
                    <tbody>${betsHTML}</tbody>
                </table>
                <hr style="border: none; border-top: 1px dashed #000;">
                <p style="text-align: right; font-size: 1.1em; font-weight: bold;">
                    TOTAL MISÉ : ${parseFloat(receipt.total_value).toFixed(2)} HTG
                </p>
                <p style="text-align: center; font-size: 0.8em;">Bonne chance !</p>
            </div>
        `;
        
        return res.setHeader('Content-Type', 'text/html').send(receiptHTML);
    }
    return res.status(400).send("Action non reconnue.");
});

// POST /api/v1/receipts/?action=add or ?action=delete&id=...
app.post("/api/v1/receipts/", (req, res) => {
  const action = req.query.action || "add";

  if (action === "add") {
    const receipt = req.body;
    receipt.id = currentRound.lastReceiptId++;
    receipt.bets = receipt.bets || [];
    receipt.prize = 0; // Le gain est initialisé à 0
    currentRound.receipts.push(receipt);
    return res.json(wrap({ id: receipt.id, success: true }));
  } 
  
  if (action === "delete") {
    const id = parseInt(req.query.id, 10);
    currentRound.receipts = currentRound.receipts.filter(r => r.id !== id);
    return res.json(wrap({ success: true }));
  } 
  
  return res.status(400).json({ error: "Unknown receipts action" });
});

// POST /api/v1/money/ - retourne un solde fictif
app.post("/api/v1/money/", (req, res) => {
  return res.json(wrap({ money: 5000 }));
});

// Route /api/v1/keepalive/ pour maintenir la session
app.all(/^\/api\/v1\/keepalive(\/.*)?$/, (req, res) => {
  return res.json(wrap({
    keepAliveTick: 30000,
    keepAliveTimeout: 5000,
    keepAliveUrl: "http://localhost:8080/api/v1/keepalive"
  }));
});

// === WebSocket server ===
const wss = new WebSocketServer({ port: 8081, path: "/connection/websocket" });

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // 1 = WebSocket.OPEN
      client.send(JSON.stringify(data));
    }
  });
}

wss.on("connection", (ws) => {
  console.log("📡 Client connecté au WebSocket local");
  ws.send(JSON.stringify({ event: "connected", roundId: currentRound.id }));
});

// === Démarrage des serveurs ===
app.listen(PORT, () => {
  console.log(`✅ Serveur de jeu lancé sur http://localhost:${PORT}`);
  // Démarre le premier tour au lancement du serveur
  startNewRound();
});

wss.on("listening", () => {
    console.log("✅ Serveur WebSocket lancé sur ws://localhost:8081");
});