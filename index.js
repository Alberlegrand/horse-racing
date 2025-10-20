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
app.use(express.static(path.join(__dirname, "static")));
app.use('/css', express.static(path.join(__dirname, 'static', 'css')));
app.use('/js', express.static(path.join(__dirname, 'static', 'js')));
app.use('/img', express.static(path.join(__dirname, 'static', 'img')));


// =================================================================
// ===           ÉTAT DU JEU ET DONNÉES EN MÉMOIRE               ===
// =================================================================

function generateRoundId() {
  return Math.floor(96908000 + Math.random() * 1000);
}

// Données de base des participants qui seront réutilisées à chaque tour
const BASE_PARTICIPANTS = [
  { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0  },
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

    // 1️⃣ Archive le tour complété
    if (currentRound.id) {
        const finishedRound = {
            id: currentRound.id,
            // deep-clone receipts & participants pour éviter toute mutation future
            receipts: JSON.parse(JSON.stringify(currentRound.receipts || [])),
            participants: JSON.parse(JSON.stringify(currentRound.participants || [])),
            totalPrize: currentRound.totalPrize || 0,
            winner: (currentRound.participants || []).find(p => p.place === 1) || null,
        };
        gameHistory.push(finishedRound);

        // Garde seulement les 10 derniers tours
        if (gameHistory.length > 10) gameHistory.shift();
    }

    // 2️⃣ Prépare le nouveau tour avec des places uniques aléatoires
    const newRoundId = generateRoundId();

    // Génère un tableau de places 1..N
    const basePlaces = Array.from({ length: BASE_PARTICIPANTS.length }, (_, i) => i + 1);

    // Mélange les places avec Fisher-Yates pour avoir un ordre aléatoire
    for (let i = basePlaces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [basePlaces[i], basePlaces[j]] = [basePlaces[j], basePlaces[i]];
    }

    // Assigne les places uniques à chaque participant
    currentRound = {
        id: newRoundId,
        participants: BASE_PARTICIPANTS.map((p, i) => ({
            ...p,
            place: basePlaces[i],
        })),
        receipts: [],         // <-- garantie : table des receipts vide pour chaque nouveau round
        lastReceiptId: 3,
        totalPrize: 0
    };

    console.log(`🚀 Nouveau tour #${currentRound.id} prêt à commencer !`);

    // 3️⃣ Notifie tous les clients qu'un nouveau tour est disponible
    // en envoyant une copie sûre (receipts vide)
    broadcast({ event: "new_round", game: JSON.parse(JSON.stringify(currentRound)) });
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

  let totalPrize = 0;

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
  //console.log("/api/v1/rounds/ headers:", req.headers);
  //console.log("/api/v1/rounds parsed action:", action);
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
      // Defensive: ensure participants array exists and has entries
      const participants = Array.isArray(currentRound.participants) ? currentRound.participants : [];
      if (participants.length === 0) {
        console.error("finish: aucun participant dans currentRound -> annulation de la finish flow.");
        return;
      }

      const winner = participants[Math.floor(Math.random() * participants.length)];
      const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };

      // Met à jour les places dans le tour courant
      currentRound.participants = participants.map(p =>
        (p.number === winner.number ? winnerWithPlace : p)
      );

      // Calcul des gains : variables locales, protections
      let totalPrizeAll = 0; // total de tous les tickets
      const receipts = Array.isArray(currentRound.receipts) ? currentRound.receipts : [];

      receipts.forEach(receipt => {
        let totalPrizeForReceipt = 0;

        if (Array.isArray(receipt.bets)) {
          receipt.bets.forEach(bet => {
            // chaque bet doit contenir number et value validés upstream
            if (Number(bet.number) === Number(winner.number)) {
              const betValue = Number(bet.value) || 0;
              const coeff = Number(winner.coeff) || 0;
              totalPrizeForReceipt += betValue * coeff;
            }
          });
        }

        receipt.prize = totalPrizeForReceipt;
        console.log(`Ticket #${receipt.id} a un gain de : ${receipt.prize} HTG`);
        totalPrizeAll += totalPrizeForReceipt;
      });

      // Stocker le total pour le FinishScreen
      currentRound.totalPrize = totalPrizeAll;

      // Envoie les résultats (cloner pour éviter références mutables)
      broadcast({
        event: "race_end",
        winner: winnerWithPlace,
        receipts: JSON.parse(JSON.stringify(receipts)),
        roundId: currentRound.id,
        prize: currentRound.totalPrize,
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

    console.log(`🧾 Impression du ticket #${receiptId}:`, receipt);

    if (!receipt) {
      return res.status(404).send("<h1>Ticket non trouvé</h1>");
    }

    // Horodatage
    const createdTime =
      receipt.created_time
        ? new Date(receipt.created_time).toLocaleString('fr-FR')
        : new Date().toLocaleString('fr-FR');

    // === Calculs ===
    let totalMise = 0;
    let totalGainPotentiel = 0;

    const betsHTML = receipt.bets.map((bet, index) => {
      const participant = bet.participant || {};
      const name = participant.name || `N°${participant.number || "?"}`;
      const coeff = parseFloat(participant.coeff || 0);
      const mise = parseFloat(bet.value || 0);
      const gainPot = mise * coeff;

      totalMise += mise;
      totalGainPotentiel += gainPot;

      return `
        <tr>
          <td style="text-align: left;">${name}</td>
          <td style="text-align: right;">${mise.toFixed(2)} HTG</td>
          <td style="text-align: right;">x${coeff.toFixed(2)}</td>
          <td style="text-align: right;">${gainPot.toFixed(2)} HTG</td>
        </tr>
      `;
    }).join('');

    // === Gabarit du reçu HTML ===
    const receiptHTML = `
      <div style="
        font-family: 'Courier New', monospace;
        width: 300px;
        padding: 10px;
        border: 1px solid #000;
      ">
        <!-- ENTÊTE -->
        <h2 style="text-align: center; margin: 0;">🏇 PARYAJ CHEVAL</h2>
        <p style="text-align: center; font-size: 0.9em; margin: 4px 0;">
          Ticket #${receipt.id} | Tour #${currentRound.id}<br>
          ${escapeHtml(createdTime)}
        </p>
        <hr style="border: none; border-top: 1px dashed #000;">

        <!-- TABLE DES PARIS -->
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="text-align: left;">Pari</th>
              <th style="text-align: right;">Mise</th>
              <th style="text-align: right;">Cote</th>
              <th style="text-align: right;">Gain</th>
            </tr>
          </thead>
          <tbody>${betsHTML}</tbody>
        </table>

        <hr style="border: none; border-top: 1px dashed #000; margin: 6px 0;">

        <!-- TOTAUX -->
        <p style="font-weight: bold; text-align: right;">
          MISE TOTALE : ${totalMise.toFixed(2)} HTG
        </p>
        <p style="font-weight: bold; text-align: right;">
          GAIN POTENTIEL : ${totalGainPotentiel.toFixed(2)} HTG
        </p>

        <hr style="border: none; border-top: 1px dashed #000; margin: 6px 0;">

        <!-- PIED DE PAGE -->
        <p style="text-align: center; font-size: 0.85em; margin: 0;">
          Merci pour votre confiance 💸<br>
          Bonne chance 🍀
        </p>
      </div>
    `;

    res.setHeader("Content-Type", "text/html");
    return res.send(receiptHTML);
  }

  return res.status(400).send("Action non reconnue.");
});


// POST /api/v1/receipts/?action=add or ?action=delete&id=...
app.post("/api/v1/receipts/", (req, res) => {
  const action = req.query.action || "add";

  if (action === "add") {
    const receipt = req.body;
    console.log("Ajout d'un nouveau ticket de pari :", receipt);

    // Génération d'un ID unique et aléatoire pour le ticket
    receipt.id = Math.floor(Math.random() * 10000000000);

    // S'assurer que receipt.bets existe
    receipt.bets = receipt.bets || [];

    // 🔹 Fix : assigner number correct à chaque bet à partir du participant choisi
    receipt.bets = receipt.bets.map(bet => {
      if (!bet.participant || bet.participant.number === undefined) {
        console.warn("Bet sans participant valide détecté :", bet);
        return null; // Ignore les bets invalides
      }

      return {
        ...bet,
        number: bet.participant.number, // <-- Fix ici : prend le numéro réel du participant
        value: bet.value,
        prize: bet.prize || 0
      };
    }).filter(Boolean); // supprimer les bets invalides

    // Calcule le gain du ticket en se basant sur le WINNER actuel du round (s'il existe)
    let prizeForThisReceipt = 0;
    const winner = Array.isArray(currentRound.participants) ? currentRound.participants.find(p => p.place === 1) : null;

    if (Array.isArray(receipt.bets) && winner) {
      receipt.bets.forEach(bet => {
        if (Number(bet.number) === Number(winner.number)) {
          const betValue = Number(bet.value) || 0;
          const coeff = Number(winner.coeff) || 0;
          prizeForThisReceipt += betValue * coeff;
        }
      });
    }

    receipt.prize = prizeForThisReceipt;
    // Met à jour le total du round de façon sûre
    currentRound.totalPrize = (currentRound.totalPrize || 0) + prizeForThisReceipt;

    console.log("Initialisé le gain du ticket à :", receipt.prize);

    // Ajouter le ticket à la liste des receipts
    currentRound.receipts.push(receipt);

    console.log("Ticket ajouté avec ID :", receipt.id, "avec bets :", receipt.bets);
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

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}