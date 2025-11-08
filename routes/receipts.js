// routes/receipts.js

import express from "express";
import { gameState, wrap } from "../game.js";
import { escapeHtml, systemToPublic } from "../utils.js";

/**
 * Crée le routeur pour les "receipts" (tickets).
 * @param {function} broadcast - La fonction de diffusion WebSocket (optionnelle).
 * @returns {express.Router}
 */
export default function createReceiptsRouter(broadcast) {
  const router = express.Router();

  // GET /api/v1/receipts/?action=print&id=...
  router.get("/", (req, res) => {
    if (req.query.action === 'print') {
      const receiptId = parseInt(req.query.id, 10);
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

      // Génération des lignes de paris
      const betsHTML = receipt.bets.map((bet) => {
        const participant = bet.participant || {};
        const name = escapeHtml(participant.name || `N°${participant.number || "?"}`);
        const coeff = parseFloat(participant.coeff || 0);
        // Les valeurs bet.value sont en système, convertir en publique pour l'affichage
        const miseSystem = parseFloat(bet.value || 0);
        const mise = systemToPublic(miseSystem);
        const gainPot = systemToPublic(miseSystem * coeff);
        totalMise += mise;
        totalGainPotentiel += gainPot;
        
        return `
          <div class="bet-item">
            <div class="bet-line">
              <span class="bet-name">${name}</span>
              <span class="bet-coeff">x${coeff.toFixed(2)}</span>
            </div>
            <div class="bet-line">
              <span class="bet-mise">Mise: <strong>${mise.toFixed(2)} HTG</strong></span>
              <span class="bet-gain">Gain: <strong>${gainPot.toFixed(2)} HTG</strong></span>
            </div>
          </div>`;
      }).join('');

      // === Gabarit du reçu HTML (Standardisé et optimisé pour POS) ===
      const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ticket #${receipt.id}</title>
        <style>
          /* --- Configuration d'impression --- */
          @media print {
            @page {
              /* Forcer la taille du papier et supprimer les marges d'impression */
              size: 58mm auto; /* Cible 58mm. Changez à 80mm si nécessaire */
              margin: 0;
            }
            body {
              margin: 0;
              padding: 0;
              -webkit-print-color-adjust: exact; /* Forcer les couleurs sur Chrome */
              print-color-adjust: exact;
            }
            .receipt-container {
                border: none;
            }
          }

          /* --- Styles de base et standardisation --- */
          body {
            /* Utilisation d'une police POS standard */
            font-family: 'Courier New', 'Monaco', monospace;
            background: #fff;
            margin: 0;
            padding: 0; /* Important pour les POS */
            font-size: 12px; /* Taille de base lisible */
            line-height: 1.4;
            color: #000; /* Assurer que le texte non-gras est noir */
          }
          
          .receipt-container {
            /* Largeur cible (58mm papier - 6mm marges = 52mm) */
            width: 52mm; 
            max-width: 52mm;
            margin: 0 auto;
            /* Marges internes pour la lisibilité */
            padding: 5mm 3mm; 
            box-sizing: border-box;
          }

          /* --- Structure & Typographie --- */
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          
          .divider {
            border: none;
            border-top: 1px dashed #000; /* Ligne simple dash */
            margin: 10px 0;
          }

          /* --- En-tête --- */
          .header h2 {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 5px;
            /* Forcer la couleur noire pour éviter le blanc */
            color: #000 !important; 
          }
          .header p {
            font-size: 11px;
            line-height: 1.2;
            margin-bottom: 10px;
          }

          /* --- Section Paris --- */
          .bets-title {
            font-size: 12px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 8px;
          }
          
          .bet-item {
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px dotted #888;
          }
          .bet-item:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
          }
          
          .bet-line {
            display: flex;
            justify-content: space-between;
            font-size: 12px; 
            line-height: 1.5;
            /* Forcer les éléments à droite à flotter si flexbox échoue */
            /* Ajoutez ceci si les éléments ne s'alignent pas :
            overflow: hidden; 
            */
          }
          .bet-name { font-weight: bold; }
          .bet-coeff { color: #000; font-size: 11px; } /* Noir standard */
          .bet-mise { font-size: 12px; }
          .bet-gain { font-weight: bold; } /* Juste gras */

          /* --- Section Totaux --- */
          .totals { margin: 10px 0; }
          .total-line {
            display: flex;
            justify-content: space-between;
            font-size: 13px; 
            font-weight: bold;
            padding: 4px 0;
          }
          .total-line.potential {
            color: #000; /* Revenir au noir pour la fiabilité */
          }

          /* --- Pied de page --- */
          .footer {
             margin-top: 10px; 
             text-align: center;
          }
          .footer p {
            font-size: 11px;
            line-height: 1.5;
            margin: 5px 0;
          }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          
          <div class="header text-center">
            <h2>🏇 PARYAJ CHEVAL</h2>
            <p>
              Ticket #${receipt.id} | Tour #${gameState.currentRound.id}<br>
              ${escapeHtml(createdTime)}
            </p>
          </div>

          <hr class="divider">

          <h3 class="bets-title">Détail des Paris</h3>

          <div class="bets-list">
            ${betsHTML}
          </div>

          <hr class="divider">

          <div class="totals">
            <div class="total-line">
              <span>MISE TOTALE :</span>
              <span>${totalMise.toFixed(2)} HTG</span>
            </div>
            <div class="total-line potential">
              <span>GAIN POTENTIEL :</span>
              <span>${totalGainPotentiel.toFixed(2)} HTG</span>
            </div>
          </div>

          <hr class="divider">

          <div class="footer text-center">
            <p>
              Merci pour votre confiance 💸<br>
              Bonne chance 🍀
            </p>
          </div>

        </div>
      </body>
      </html>
      `;

      res.setHeader("Content-Type", "text/html");
      return res.send(receiptHTML);
    }

    // GET /api/v1/receipts/?action=payout&id=... (Décaissement/Payout)
    if (req.query.action === 'payout') {
      const receiptId = parseInt(req.query.id, 10);
      
      // Chercher dans le round actuel
      let receipt = gameState.currentRound.receipts.find(r => r.id === receiptId);
      let round = gameState.currentRound;
      let foundInCurrentRound = true;
      
      // Si pas trouvé, chercher dans l'historique
      if (!receipt) {
        foundInCurrentRound = false;
        for (const historicalRound of gameState.gameHistory) {
          receipt = (historicalRound.receipts || []).find(r => r.id === receiptId);
          if (receipt) {
            round = historicalRound;
            break;
          }
        }
      }

      if (!receipt) {
        return res.status(404).send("<h1>Ticket non trouvé</h1>");
      }

      const createdTime = receipt.created_time
        ? new Date(receipt.created_time).toLocaleString('fr-FR')
        : new Date().toLocaleString('fr-FR');

      // Déterminer le résultat (receipt.prize est en système, convertir en publique)
      const prizeSystem = parseFloat(receipt.prize || 0);
      const prize = systemToPublic(prizeSystem);
      const hasWon = prize > 0;
      const status = hasWon ? 'GAGNÉ' : 'PERDU';
      const payoutAmount = hasWon ? prize : 0;

      // Trouver le gagnant de la course
      const winner = (round.participants || []).find(p => p.place === 1);
      const winnerName = winner ? `${winner.name} (N°${winner.number})` : 'Non disponible';

      // Calculer les totaux et préparer le détail par pari
      let totalMise = 0;
      let totalGainPari = 0;
      const betsDetailHTML = receipt.bets.map(bet => {
        const participant = bet.participant || {};
        const miseSystem = parseFloat(bet.value || 0);
        const mise = systemToPublic(miseSystem);
        const coeff = parseFloat(participant.coeff || 0) || 0;
        const isWin = winner && Number(bet.number) === Number(winner.number);
        const gain = isWin ? systemToPublic(miseSystem * coeff) : 0;
        totalMise += mise;
        totalGainPari += gain;

        return `
          <div class="info-line">
            <span class="info-label">#${escapeHtml(String(participant.number || bet.number || '?'))} ${escapeHtml(String(participant.name || ''))}</span>
            <span>${mise.toFixed(2)} HTG</span>
          </div>
          <div class="info-line">
            <span class="info-label">Cote</span>
            <span>x${coeff.toFixed(2)}</span>
          </div>
          <div class="info-line">
            <span class="info-label">Résultat</span>
            <span>${isWin ? 'GAGNÉ' : 'PERDU'}</span>
          </div>
          <div class="info-line">
            <span class="info-label">Gain pari</span>
            <span>${gain.toFixed(2)} HTG</span>
          </div>
          <hr class="divider" />`;
      }).join('');

      // Le montant total du décaissement est la somme des gains par pari (chaque pari est traité individuellement)
      const payoutAmountComputed = totalGainPari;

      // Générer le HTML du décaissement
      const payoutHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Décaissement #${receipt.id}</title>
        <style>
          @media print {
            @page {
              margin: 15mm 10mm;
              size: auto;
            }
            body {
              margin: 0;
              padding: 0;
            }
            .payout-container {
              width: 100%;
              max-width: 80mm;
              margin: 0 auto;
              padding: 20px !important;
            }
          }
          body {
            font-family: Arial, Helvetica, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 10px;
            background: white;
          }
          .payout-container {
            font-family: Arial, Helvetica, 'Segoe UI', sans-serif;
            width: 280px;
            max-width: 280px;
            margin: 0 auto;
            padding: 20px;
            border: 2px solid #000;
            box-sizing: border-box;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
          }
          .header h2 {
            margin: 0 0 10px 0;
            font-size: 18px;
            font-weight: bold;
          }
          .status-box {
            text-align: center;
            padding: 12px;
            margin: 15px 0;
            border: 2px solid;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
          }
          .status-won {
            background-color: #d4edda;
            border-color: #28a745;
            color: #155724;
          }
          .status-lost {
            background-color: #f8d7da;
            border-color: #dc3545;
            color: #721c24;
          }
          .info-line {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 13px;
            border-bottom: 1px dotted #ccc;
          }
          .info-label {
            font-weight: bold;
          }
          .payout-amount {
            text-align: center;
            margin: 20px 0;
            padding: 15px;
            background-color: #f0f0f0;
            border: 2px solid #000;
            border-radius: 8px;
          }
          .payout-amount-label {
            font-size: 12px;
            color: #666;
            margin-bottom: 5px;
          }
          .payout-amount-value {
            font-size: 24px;
            font-weight: bold;
            color: #000;
          }
          .divider {
            border: none;
            border-top: 2px solid #000;
            margin: 15px 0;
          }
          .winner-info {
            background-color: #e7f3ff;
            padding: 10px;
            border-radius: 5px;
            margin: 15px 0;
            font-size: 12px;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 11px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="payout-container">
          <div class="header">
            <h2>💰 DÉCAISSEMENT</h2>
            <p style="font-size: 12px; margin: 8px 0;">
              Ticket #${receipt.id} | Tour #${round.id}<br>
              ${escapeHtml(createdTime)}
            </p>
          </div>

          <hr class="divider">

          <div class="status-box ${hasWon ? 'status-won' : 'status-lost'}">
            ${hasWon ? '✅ TICKET GAGNANT ✅' : '❌ TICKET PERDANT ❌'}
          </div>

          <div class="info-line">
            <span class="info-label">Mise totale :</span>
            <span>${totalMise.toFixed(2)} HTG</span>
          </div>

          <h3 style="margin-top:12px;">Détail des paris</h3>
          ${betsDetailHTML}

          ${hasWon ? `
          <div class="winner-info">
            <strong>Gagnant de la course :</strong><br>
            ${escapeHtml(winnerName)}
          </div>
          ` : ''}

          <div class="payout-amount">
            <div class="payout-amount-label">MONTANT DU DÉCAISSEMENT</div>
            <div class="payout-amount-value">${payoutAmountComputed.toFixed(2)} HTG</div>
          </div>

          <hr class="divider">

          <div class="info-line">
            <span class="info-label">Statut du paiement :</span>
            <span>${receipt.isPaid ? '✅ Payé' : '⏳ En attente'}</span>
          </div>

          ${receipt.isPaid && receipt.paid_at ? `
          <div class="info-line">
            <span class="info-label">Date de paiement :</span>
            <span>${new Date(receipt.paid_at).toLocaleString('fr-FR')}</span>
          </div>
          ` : ''}

          <hr class="divider">

          <div class="footer">
            <p>
              Ce document prouve le résultat du ticket.<br>
              Conservez-le comme justificatif.
            </p>
          </div>
        </div>
      </body>
      </html>
      `;

      res.setHeader("Content-Type", "text/html");
      return res.send(payoutHTML);
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
      // IMPORTANT: Ne calculer le prize que si la course est terminée
      // Un ticket ajouté pendant le round actuel doit rester en "pending" jusqu'à la fin de la course
      let prizeForThisReceipt = 0;
      const winner = Array.isArray(gameState.currentRound.participants) ? gameState.currentRound.participants.find(p => p.place === 1) : null;
      
      // Vérifier si la course est terminée
      // Un round est terminé SEULEMENT si la course a été lancée ET terminée
      // Cela garantit que les nouveaux tickets restent en "pending" tant que la course n'a pas été lancée
      const isRaceFinished = gameState.raceEndTime !== null || 
                             (gameState.raceStartTime !== null && !gameState.isRaceRunning && winner !== null);
      
      // Ne calculer le prize que si la course est terminée
      if (isRaceFinished && Array.isArray(receipt.bets) && winner) {
        receipt.bets.forEach(bet => {
          if (Number(bet.number) === Number(winner.number)) {
            const betValue = Number(bet.value) || 0;
            const coeff = Number(winner.coeff) || 0;
            prizeForThisReceipt += betValue * coeff;
          }
        });
      }

      receipt.prize = prizeForThisReceipt;
      // Ajout de la date de création si elle n'existe pas
      if (!receipt.created_time) {
        receipt.created_time = new Date().toISOString();
      }
      // Mute gameState
      // IMPORTANT: Ne mettre à jour totalPrize que si la course est terminée
      // Sinon, le totalPrize sera recalculé à la fin de la course
      if (isRaceFinished) {
        gameState.currentRound.totalPrize = (gameState.currentRound.totalPrize || 0) + prizeForThisReceipt;
      }
      gameState.currentRound.receipts.push(receipt);

      console.log("Ticket ajouté ID :", receipt.id);
      
      // Broadcast WebSocket pour notifier les clients avec toutes les infos
      if (broadcast) {
        broadcast({
          event: "receipt_added",
          receipt: JSON.parse(JSON.stringify(receipt)),
          receiptId: receipt.id,
          roundId: gameState.currentRound.id,
          totalReceipts: gameState.currentRound.receipts.length,
          currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
          totalPrize: gameState.currentRound.totalPrize || 0
        });
      }
      
      return res.json(wrap({ id: receipt.id, success: true }));
    }

    if (action === "delete") {
      const id = parseInt(req.query.id, 10);
      
      // Chercher le ticket dans le round actuel
      let receipt = gameState.currentRound.receipts.find(r => r.id === id);
      let foundInCurrentRound = true;
      
      // Si pas trouvé dans le round actuel, chercher dans l'historique
      if (!receipt) {
        foundInCurrentRound = false;
        for (const historicalRound of gameState.gameHistory) {
          receipt = (historicalRound.receipts || []).find(r => r.id === id);
          if (receipt) {
            // On ne peut pas annuler un ticket de l'historique
            return res.status(400).json({ 
              error: "Impossible d'annuler un ticket d'un round terminé" 
            });
          }
        }
      }
      
      if (!receipt) {
        return res.status(404).json({ error: "Ticket non trouvé" });
      }

      // Vérifier si le round est réellement terminé (course lancée ET terminée)
      // On ne doit bloquer l'annulation que si la course est terminée avec un gagnant.
      const hasWinner = Array.isArray(gameState.currentRound.participants) &&
                        gameState.currentRound.participants.some(p => p.place === 1);

      const isRaceFinished = gameState.raceEndTime !== null ||
                             (gameState.raceStartTime !== null && !gameState.isRaceRunning && hasWinner);

      // Bloquer l'annulation uniquement si la course est réellement terminée
      if (isRaceFinished) {
        return res.status(400).json({
          error: "Impossible d'annuler un ticket une fois la course terminée avec résultats"
        });
      }
      
      // Supprimer le ticket du round actuel
      gameState.currentRound.receipts = gameState.currentRound.receipts.filter(r => r.id !== id);
      
      // Recalculer le totalPrize si nécessaire
      if (receipt.prize) {
        gameState.currentRound.totalPrize = Math.max(0, (gameState.currentRound.totalPrize || 0) - receipt.prize);
      }
      
      // Broadcast WebSocket pour notifier les clients avec toutes les infos
      if (broadcast) {
        broadcast({
          event: "receipt_deleted",
          receiptId: id,
          roundId: gameState.currentRound.id,
          totalReceipts: gameState.currentRound.receipts.length,
          currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
          totalPrize: gameState.currentRound.totalPrize || 0
        });
      }
      
      console.log("Ticket supprimé ID :", id);
      return res.json(wrap({ success: true }));
    }

    return res.status(400).json({ error: "Unknown receipts action" });
  });

  return router;
}