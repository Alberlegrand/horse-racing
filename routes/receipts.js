// routes/receipts.js

import express from "express";
import { gameState, wrap } from "../game.js";
import { escapeHtml } from "../utils.js";

// Pas besoin de factory ici, car on n'injecte pas de dépendances externes
const router = express.Router();

// GET /api/v1/receipts/?action=print&id=...
router.get("/", (req, res) => {
  if (req.query.action === 'print') {
    const receiptId = parseInt(req.query.id, 10);
    // Utilise gameState
    const receipt = gameState.currentRound.receipts.find(r => r.id === receiptId);

    console.log(`🧾 Impression du ticket #${receiptId}:`, receipt);

    if (!receipt) {
      return res.status(404).send("<h1>Ticket non trouvé</h1>");
    }

    const createdTime =
      receipt.created_time
        ? new Date(receipt.created_time).toLocaleString('fr-FR')
        : new Date().toLocaleString('fr-FR');

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
      return `<tr>
          <td style="text-align: left;">${name}</td>
          <td style="text-align: right;">${mise.toFixed(2)} HTG</td>
          <td style="text-align: right;">x${coeff.toFixed(2)}</td>
          <td style="text-align: right;">${gainPot.toFixed(2)} HTG</td>
        </tr>`;
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
          Ticket #${receipt.id} | Tour #${gameState.currentRound.id}<br>
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
router.post("/", (req, res) => {
  const action = req.query.action || "add";

  if (action === "add") {
    const receipt = req.body;
    console.log("Ajout d'un nouveau ticket :", receipt);

    receipt.id = Math.floor(Math.random() * 10000000000);
    receipt.bets = (receipt.bets || []).map(bet => {
      if (!bet.participant || bet.participant.number === undefined) {
        console.warn("Bet sans participant valide :", bet);
        return null;
      }
      return {
        ...bet,
        number: bet.participant.number,
        value: bet.value,
        prize: bet.prize || 0
      };
    }).filter(Boolean);

    // Utilise gameState
    let prizeForThisReceipt = 0;
    const winner = Array.isArray(gameState.currentRound.participants) ? gameState.currentRound.participants.find(p => p.place === 1) : null;

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
    // Mute gameState
    gameState.currentRound.totalPrize = (gameState.currentRound.totalPrize || 0) + prizeForThisReceipt;
    gameState.currentRound.receipts.push(receipt);

    console.log("Ticket ajouté ID :", receipt.id);
    return res.json(wrap({ id: receipt.id, success: true }));
  }

  if (action === "delete") {
    const id = parseInt(req.query.id, 10);
    // Mute gameState
    gameState.currentRound.receipts = gameState.currentRound.receipts.filter(r => r.id !== id);
    return res.json(wrap({ success: true }));
  }

  return res.status(400).json({ error: "Unknown receipts action" });
});

export default router;