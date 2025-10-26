// routes/rounds.js

import express from "express";
import { gameState, startNewRound, wrap } from "../game.js";

/**
 * Crée le routeur pour les "rounds".
 * @param {function} broadcast - La fonction de diffusion WebSocket.
 * @returns {express.Router}
 */
export default function createRoundsRouter(broadcast) {
  const router = express.Router();

  // POST /api/v1/rounds/
  router.post("/", (req, res) => {
    // Parsing défensif de l'action
    let rawBody = req.body;
    if (typeof rawBody === "string" && rawBody.trim()) {
      try { rawBody = JSON.parse(rawBody); } catch (e) { /* keep string */ }
    }
    const action =
      (rawBody && (rawBody.action || (rawBody.data && rawBody.data.action))) ||
      req.query.action ||
      null;
    
    // === GET ===
    if (action === "get") {
      // Utilise gameState.currentRound
      return res.json(wrap(gameState.currentRound));
    }

    // === FINISH ===
    if (action === "finish") {
      res.json(wrap({ success: true }));

      // Utilise broadcast et gameState
      broadcast({ event: "race_start", roundId: gameState.currentRound.id });

      // Simule la durée de la course
      setTimeout(() => {
        const participants = Array.isArray(gameState.currentRound.participants) ? gameState.currentRound.participants : [];
        if (participants.length === 0) {
          console.error("finish: aucun participant -> annulation.");
          return;
        }

        const winner = participants[Math.floor(Math.random() * participants.length)];
        const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };

        // Met à jour les places
        gameState.currentRound.participants = participants.map(p =>
          (p.number === winner.number ? winnerWithPlace : p)
        );

        let totalPrizeAll = 0;
        const receipts = Array.isArray(gameState.currentRound.receipts) ? gameState.currentRound.receipts : [];

        receipts.forEach(receipt => {
          let totalPrizeForReceipt = 0;
          if (Array.isArray(receipt.bets)) {
            receipt.bets.forEach(bet => {
              if (Number(bet.number) === Number(winner.number)) {
                const betValue = Number(bet.value) || 0;
                const coeff = Number(winner.coeff) || 0;
                totalPrizeForReceipt += betValue * coeff;
              }
            });
          }
          receipt.prize = totalPrizeForReceipt;
          console.log(`Ticket #${receipt.id} gain : ${receipt.prize} HTG`);
          totalPrizeAll += totalPrizeForReceipt;
        });

        gameState.currentRound.totalPrize = totalPrizeAll;

        broadcast({
          event: "race_end",
          winner: winnerWithPlace,
          receipts: JSON.parse(JSON.stringify(receipts)),
          roundId: gameState.currentRound.id,
          prize: gameState.currentRound.totalPrize,
        });

        console.log("Nouveau tour dans 15 secondes...");
        // On passe broadcast à startNewRound
        setTimeout(() => startNewRound(broadcast), 15000); 
      }, 7000);

      return;
    }

    // === CONFIRM ===
    if (action === "confirm") {
      console.log("Confirmation du round", gameState.currentRound.id);
      return res.json(wrap(gameState.currentRound));
    }

    // Action inconnue
    return res.status(400).json({ error: "Unknown action" });
  });

  return router;
}