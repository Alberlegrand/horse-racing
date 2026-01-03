// routes/receipts.js

import express from "express";
import { gameState, wrap } from "../game.js";
import { escapeHtml, systemToPublic } from "../utils.js";
import { SYSTEM_NAME, CURRENT_GAME } from "../config/system.config.js";

// Import ChaCha20 pour les IDs de reçus sécurisés
import { chacha20Random, chacha20RandomInt, initChaCha20 } from "../chacha20.js";
import crypto from 'crypto';
// DB models pour persistance des tickets
import { createReceipt as dbCreateReceipt, createBet as dbCreateBet, getReceiptById, getBetsByReceipt, updateReceiptStatus } from "../models/receiptModel.js";
import { pool } from "../config/db.js";
// Import cache strategy (Redis)
import dbStrategy, { deleteTicketFromRoundCache, updateTicketInRoundCache } from "../config/db-strategy.js";
// Import validation des montants
import { MIN_BET_AMOUNT, MAX_BET_AMOUNT, BETTING_LOCK_DURATION_MS } from "../config/app.config.js";

/**
 * Crée le routeur pour les "receipts" (tickets).
 * @param {function} broadcast - La fonction de diffusion WebSocket (optionnelle).
 * @returns {express.Router}
 */
export default function createReceiptsRouter(broadcast) {
  const router = express.Router();

  // GET /api/v1/receipts/?action=print&id=...
  router.get("/", async (req, res) => {
    if (req.query.action === 'print') {
      const receiptId = parseInt(req.query.id, 10);
      
      // Chercher dans le round actuel
      let receipt = gameState.currentRound.receipts.find(r => r.id === receiptId || r.receipt_id === receiptId);
      let round = gameState.currentRound;
      
      // ✅ CORRECTION: S'assurer que le receipt a bien tous ses bets
      if (receipt && (!receipt.bets || receipt.bets.length === 0)) {
        console.warn(`[PRINT] ⚠️ Receipt trouvé dans gameState mais sans bets, récupération depuis DB...`);
        try {
          const bets = await getBetsByReceipt(receiptId);
          if (bets && bets.length > 0) {
            receipt.bets = bets.map(bet => ({
              ...bet,
              participant: {
                number: bet.participant_number,
                name: bet.participant_name,
                coeff: bet.coefficient
              },
              number: bet.participant_number,
              value: bet.value || 0
            }));
            console.log(`[PRINT] ✅ ${receipt.bets.length} pari(s) récupéré(s) depuis la DB pour receipt gameState`);
          }
        } catch (betErr) {
          console.warn(`[PRINT] ⚠️ Erreur récupération bets depuis DB:`, betErr.message);
        }
      }
      
      // Si pas trouvé, chercher dans l'historique
      if (!receipt) {
        for (const historicalRound of gameState.gameHistory) {
          receipt = (historicalRound.receipts || []).find(r => r.id === receiptId || r.receipt_id === receiptId);
          if (receipt) {
            round = historicalRound;
            // ✅ CORRECTION: Vérifier que le receipt historique a bien tous ses bets
            if (!receipt.bets || receipt.bets.length === 0) {
              console.warn(`[PRINT] ⚠️ Receipt historique sans bets, récupération depuis DB...`);
              try {
                const bets = await getBetsByReceipt(receiptId);
                if (bets && bets.length > 0) {
                  receipt.bets = bets.map(bet => ({
                    ...bet,
                    participant: {
                      number: bet.participant_number,
                      name: bet.participant_name,
                      coeff: bet.coefficient
                    },
                    number: bet.participant_number,
                    value: bet.value || 0
                  }));
                  console.log(`[PRINT] ✅ ${receipt.bets.length} pari(s) récupéré(s) depuis la DB pour receipt historique`);
                }
              } catch (betErr) {
                console.warn(`[PRINT] ⚠️ Erreur récupération bets depuis DB:`, betErr.message);
              }
            }
            break;
          }
        }
      }

      // Si toujours pas trouvé, chercher en base de données
      if (!receipt) {
        try {
          console.log(`[PRINT] Recherche du ticket #${receiptId} en base de données`);
          receipt = await getReceiptById(receiptId);
          if (receipt) {
            console.log(`[PRINT] ✅ Ticket #${receiptId} trouvé en base de données`);
            // ✅ CORRECTION: Mapper receipt_id vers id pour compatibilité
            if (!receipt.id && receipt.receipt_id) {
              receipt.id = receipt.receipt_id;
            }
            // ✅ CORRECTION: Récupérer TOUS les paris du ticket depuis la DB
            let bets = await getBetsByReceipt(receiptId);
            console.log(`[PRINT] 📊 ${bets.length} pari(s) trouvé(s) pour le ticket #${receiptId}`);
            // Transformer les bets en format compatible avec la mémoire
            bets = bets.map(bet => ({
              ...bet,
              participant: {
                number: bet.participant_number,
                name: bet.participant_name,
                coeff: bet.coefficient
              },
              number: bet.participant_number,  // Compatibility fallback
              value: bet.value || 0  // ✅ S'assurer que value est présent
            }));
            receipt.bets = bets || [];
            // Essayer de trouver le round correspondant
            for (const historicalRound of gameState.gameHistory) {
              if (historicalRound.id === receipt.round_id) {
                round = historicalRound;
                break;
              }
            }
            // Si le round n'est pas trouvé, utiliser le round actuel comme fallback
            if (!round || round.id !== receipt.round_id) {
              console.log(`[PRINT] ⚠️ Round #${receipt.round_id} non trouvé, utilisation du round actuel`);
              round = gameState.currentRound;
            }
          }
        } catch (dbErr) {
          console.warn(`[PRINT] Erreur lors de la requête DB pour le ticket #${receiptId}:`, dbErr.message);
        }
      }

      // ✅ CORRECTION: S'assurer que l'ID est toujours présent (même si receipt vient de gameState)
      if (receipt && !receipt.id) {
        receipt.id = receipt.receipt_id || receiptId;
      }

      console.log(`🧾 Impression du ticket #${receiptId}:`, receipt);
      console.log(`🧾 Nombre de paris: ${receipt?.bets?.length || 0}`);

      if (!receipt) {
        return res.status(404).send("<h1>Ticket non trouvé</h1>");
      }

      // ✅ CORRECTION: Vérifier que les bets sont présents
      if (!receipt.bets || receipt.bets.length === 0) {
        console.warn(`[PRINT] ⚠️ Aucun pari trouvé pour le ticket #${receiptId}, tentative de récupération depuis la DB...`);
        try {
          const bets = await getBetsByReceipt(receiptId);
          if (bets && bets.length > 0) {
            receipt.bets = bets.map(bet => ({
              ...bet,
              participant: {
                number: bet.participant_number,
                name: bet.participant_name,
                coeff: bet.coefficient
              },
              number: bet.participant_number,
              value: bet.value || 0
            }));
            console.log(`[PRINT] ✅ ${receipt.bets.length} pari(s) récupéré(s) depuis la DB`);
          } else {
            console.error(`[PRINT] ❌ Aucun pari trouvé en DB pour le ticket #${receiptId}`);
            return res.status(404).send("<h1>Ticket sans paris - impossible d'imprimer</h1>");
          }
        } catch (betErr) {
          console.error(`[PRINT] ❌ Erreur récupération bets:`, betErr.message);
          return res.status(500).send("<h1>Erreur lors de la récupération des paris</h1>");
        }
      }

      const receiptDate = receipt.created_time
        ? new Date(receipt.created_time)
        : new Date();
      // Utiliser le fuseau horaire Haïti/Port-au-Prince pour l'impression
      const createdDate = receiptDate.toLocaleDateString('fr-FR', {
        timeZone: 'America/Port-au-Prince'
      });
      const createdTime = receiptDate.toLocaleTimeString('fr-FR', {
        timeZone: 'America/Port-au-Prince',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      // ✅ Génération des sections de paris avec détails et totaux séparés pour chaque pari
      const betsArray = Array.isArray(receipt.bets) ? receipt.bets : [];
      console.log(`[PRINT] 📋 Génération HTML pour ${betsArray.length} pari(s)`);
      
      // ✅ Générer le HTML pour chaque pari avec ses propres détails et totaux
      const betsSectionsHTML = betsArray.map((bet, index) => {
        const participant = bet.participant || {};
        const name = escapeHtml(
          participant.name || 
          bet.participant_name || 
          `N°${participant.number || bet.participant_number || bet.number || "?"}`
        );
        const number = participant.number || bet.participant_number || bet.number || "?";
        const coeff = parseFloat(
          participant.coeff || 
          bet.coefficient || 
          bet.coeff || 
          0
        );
        const miseSystem = parseFloat(bet.value || 0);
        if (miseSystem <= 0) {
          console.warn(`[PRINT] ⚠️ Pari ${index + 1} a une mise invalide: ${bet.value}`);
        }
        const mise = systemToPublic(miseSystem);
        const gainPot = systemToPublic(miseSystem * coeff);
        
        const description = `N°${number} ${name}`;
        
        return `
          <!-- Détails Pari ${index + 1} -->
          <div class="bets-section">
            <div class="bets-header"><span>Détails</span><span>Mise</span></div>
            <div class="bet-row">
              <span>${description}</span>
              <span style="font-weight:bold;">${mise.toFixed(2)}</span>
            </div>
            <div class="bet-row">
              <span>Cote</span>
              <span style="font-weight:bold;">${coeff.toFixed(2)}</span>
            </div>
            ${gainPot > 0 ? `
            <div class="bet-row">
              <span>Gain Potentiel</span>
              <span style="font-weight:bold;">${gainPot.toFixed(2)}</span>
            </div>
            ` : ''}
          </div>
          ${index < betsArray.length - 1 ? '<div class="separator-line">-------------------------------</div>' : ''}
        `;
      }).join('');
      
      // ✅ Vérifier qu'au moins un pari est affiché
      if (!betsSectionsHTML || betsSectionsHTML.trim() === '') {
        console.error(`[PRINT] ❌ Aucun pari à afficher pour le ticket #${receiptId}`);
        return res.status(500).send("<h1>Erreur: Aucun pari trouvé pour ce ticket</h1>");
      }

// === Gabarit du reçu HTML (Basé sur GOOJPRT PT-210, adapté pour 46mm) ===
const receiptHTML = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Ticket #${receipt.id}</title>
<style>
/* RESET POUR IMPRESSION */
* { margin: 0; padding: 0; box-sizing: border-box; }

@media print {
  @page { size: 48mm auto; margin: 0; }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body { 
    width: 100% !important;
    max-width: 48mm !important;
    margin: 0 !important; 
    padding: 0 !important; 
    background: #fff !important;
    overflow-x: hidden !important;
  }
  .receipt-container {
    /* Largeur 100% avec max-width 38mm, marge gauche 3mm */
    width: 100% !important; 
    max-width: 38mm !important;
    margin: 0 !important;
    margin-left: 8mm !important;
    padding: 0 !important;
    box-sizing: border-box !important;
    overflow-x: hidden !important;
  }
}

/* STYLE DU TICKET */
body {
  font-family: "Courier New", Courier, monospace;
  font-size: 9pt;
  line-height: 1.1;
  color: #000;
}

.receipt-container { 
  width: 100%;
  max-width: 38mm;
  margin: 0;
  margin-left: 8mm;
  padding: 0;
  box-sizing: border-box;
}

.header-section { text-align: center; margin-bottom: 4px; }
.shop-name { font-size: 11pt; font-weight: bold; }
.shop-phone { font-size: 8pt; }

.separator-line {
  text-align: center;
  font-size: 7pt;
  margin: 2px 0;
  white-space: nowrap;
  overflow: hidden;
}

.receipt-title { 
  text-align: center; 
  font-size: 10pt; 
  font-weight: bold; 
  margin: 4px 0;
  border: 1px solid #000;
  padding: 2px;
}

.info-section { margin: 3px 0; }
.info-row { display: flex; justify-content: space-between; width: 100%; margin-bottom: 1px; }
.info-value { font-weight: bold; }
.info-date { font-size: 7.5pt; }
.info-date .info-value { font-size: 7.5pt; }

.bets-section { margin: 5px 0; }
.bets-header { 
  display: flex; 
  justify-content: space-between; 
  font-weight: bold; 
  border-bottom: 1px dashed #000;
  margin-bottom: 2px;
  font-size: 8pt;
}
.bet-row { display: flex; justify-content: space-between; font-size: 8.5pt; }

.totals-section { 
  margin-top: 5px; 
  border-top: 1px solid #000; 
  padding-top: 2px; 
}
.total-row { display: flex; justify-content: space-between; font-size: 10pt; font-weight: bold; }

.footer-section { text-align: center; margin-top: 8px; }
.thank-you { font-size: 9pt; font-weight: bold; }
.barcode { font-size: 7pt; margin-top: 2px; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="receipt-container">
  <!-- En-tête -->
  <div class="header-section">
    <div class="shop-name">${SYSTEM_NAME}</div>
    <div class="shop-phone">Course Cheval</div>
  </div>

  <div class="separator-line">-------------------------------</div>
  <div class="receipt-title">REÇU DE PARI</div>
  <div class="separator-line">-------------------------------</div>

  <!-- Infos Ticket -->
  <div class="info-section">
    <div class="info-row"><span>Ticket:</span><span class="info-value">#${receipt.id || receipt.receipt_id || receiptId}</span></div>
    <div class="info-row"><span>Round:</span><span class="info-value">#${round?.id || receipt.round_id || gameState.currentRound?.id || 'N/A'}</span></div>
    <div class="info-row info-date"><span>Date:</span><span class="info-value">${escapeHtml(createdDate)}</span></div>
    <div class="info-row info-date"><span>Heure:</span><span class="info-value">${escapeHtml(createdTime)}</span></div>
  </div>

  <div class="separator-line">-------------------------------</div>

  ${betsSectionsHTML}

  <div class="separator-line">-------------------------------</div>

  <!-- Pied de page -->
  <div class="footer-section">
    <div class="thank-you">MERCI & BONNE CHANCE!</div>
    <div class="barcode">${String(receipt.id || receipt.receipt_id || receiptId).padStart(8, '0')}</div>
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

      // Si toujours pas trouvé, chercher en base de données
      if (!receipt) {
        try {
          console.log(`[PAYOUT] Recherche du ticket #${receiptId} en base de données`);
          receipt = await getReceiptById(receiptId);
          if (receipt) {
            console.log(`[PAYOUT] ✅ Ticket #${receiptId} trouvé en base de données`);
            // ✅ CORRECTION: Mapper receipt_id vers id pour compatibilité
            if (!receipt.id && receipt.receipt_id) {
              receipt.id = receipt.receipt_id;
            }
            // Récupérer les paris du ticket
            let bets = await getBetsByReceipt(receiptId);
            // Transformer les bets en format compatible avec la mémoire
            bets = bets.map(bet => ({
              ...bet,
              participant: {
                number: bet.participant_number,
                name: bet.participant_name,
                coeff: bet.coefficient
              },
              number: bet.participant_number  // Compatibility fallback
            }));
            receipt.bets = bets || [];
            // Essayer de trouver le round correspondant en historique
            for (const historicalRound of gameState.gameHistory) {
              if (historicalRound.id === receipt.round_id) {
                round = historicalRound;
                break;
              }
            }
            // Si le round n'est pas trouvé, utiliser le round actuel comme fallback
            if (!round || round.id !== receipt.round_id) {
              console.log(`[PAYOUT] ⚠️ Round #${receipt.round_id} non trouvé, utilisation du round actuel`);
              round = gameState.currentRound;
            }
          }
        } catch (dbErr) {
          console.warn(`[PAYOUT] Erreur lors de la requête DB pour le ticket #${receiptId}:`, dbErr.message);
        }
      }

      if (!receipt) {
        return res.status(404).send("<h1>Ticket non trouvé</h1>");
      }

      // ✅ CORRECTION: S'assurer que l'ID est toujours présent (même si receipt vient de gameState)
      if (receipt && !receipt.id) {
        receipt.id = receipt.receipt_id || receiptId;
      }

      const receiptDate = receipt.created_time
        ? new Date(receipt.created_time)
        : new Date();
      // Utiliser le fuseau horaire Haïti/Port-au-Prince pour l'impression
      const createdDate = receiptDate.toLocaleDateString('fr-FR', {
        timeZone: 'America/Port-au-Prince'
      });
      const createdTime = receiptDate.toLocaleTimeString('fr-FR', {
        timeZone: 'America/Port-au-Prince',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      // Déterminer le résultat (receipt.prize est en système, convertir en publique)
      const prizeSystem = parseFloat(receipt.prize || 0);
      const prize = systemToPublic(prizeSystem);
      const hasWon = prize > 0;
      const status = hasWon ? 'GAGNÉ' : 'PERDU';
      const payoutAmount = hasWon ? prize : 0;

      // Trouver le gagnant de la course
      const winner = (round.participants || []).find(p => p.isWinner === true);
      const winnerName = winner ? `${winner.name} (N°${winner.number})` : 'Non disponible';
      
      // ✅ LOG: Tracer le gagnant utilisé pour l'impression du ticket
      console.log(`[PRINT-TICKET] 🏆 Gagnant utilisé pour ticket #${receiptId}:`, winner ? `№${winner.number} ${winner.name}` : 'Non trouvé');
      console.log(`[PRINT-TICKET] 📊 Round ID: ${round?.id}, Participants marqués isWinner=true:`, (round.participants || []).filter(p => p.isWinner === true).map(p => `№${p.number} ${p.name}`));

      // Calculer les totaux et préparer le détail par pari avec meilleure organisation
      let totalMise = 0;
      let totalGainPari = 0;
      const betsDetailHTML = receipt.bets.map((bet, index) => {
        const participant = bet.participant || {};
        const miseSystem = parseFloat(bet.value || 0);
        const mise = systemToPublic(miseSystem);
        const coeff = parseFloat(participant.coeff || 0) || 0;
        const isWin = winner && Number(bet.number) === Number(winner.number);
        const gain = isWin ? systemToPublic(miseSystem * coeff) : 0;
        totalMise += mise;
        totalGainPari += gain;
        const number = participant.number || bet.number || '?';
        const name = escapeHtml(String(participant.name || ''));

        return `
          <div class="bet-detail-item">
            <div class="bet-detail-row">
              <span class="info-label">Pari ${index + 1}: N°${number} ${name}</span>
            </div>
            <div class="bet-detail-row">
              <span class="info-label">Mise:</span> <span class="info-value">${mise.toFixed(2)} HTG</span>
            </div>
            <div class="bet-detail-row">
              <span class="info-label">Cote:</span> <span class="info-value">x${coeff.toFixed(2)}</span>
            </div>
            <div class="bet-detail-row">
              <span class="info-label">Résultat:</span> <span class="info-value">${isWin ? '✓ GAGNÉ' : '✗ PERDU'}</span>
            </div>
            ${isWin ? `
            <div class="bet-detail-row">
              <span class="info-value">Gain:</span> <span class="info-value">${gain.toFixed(2)} HTG</span>
            </div>
            ` : ''}
          </div>`;
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
  <title>Décaissement #${receipt.id || receipt.receipt_id || receiptId}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    /* RESET POUR IMPRESSION */
    * { margin: 0; padding: 0; box-sizing: border-box; }

    @media print {
      @page { size: 48mm auto; margin: 0; }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body { 
        width: 100% !important;
        max-width: 48mm !important;
        margin: 0 !important; 
        padding: 0 !important; 
        background: #fff !important;
        overflow-x: hidden !important;
      }
      .payout-container {
        /* Largeur 100% avec max-width 38mm, marge gauche 3mm */
        width: 100% !important; 
        max-width: 38mm !important;
        margin: 0 !important;
        margin-left: 8mm !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        overflow-x: hidden !important;
      }
    }

    /* STYLE DU TICKET */
    body {
      font-family: "Courier New", Courier, monospace;
      font-size: 9pt;
      line-height: 1.1;
      color: #000;
    }

    .payout-container { 
      width: 100%;
      max-width: 38mm;
      margin: 0;
      margin-left: 8mm;
      padding: 0;
      box-sizing: border-box;
    }

    .header-section { text-align: center; margin-bottom: 4px; }
    .shop-name { font-size: 11pt; font-weight: bold; }
    .shop-phone { font-size: 8pt; }

    .separator-line {
      text-align: center;
      font-size: 7pt;
      margin: 2px 0;
      white-space: nowrap;
      overflow: hidden;
    }

    .receipt-title { 
      text-align: center; 
      font-size: 10pt; 
      font-weight: bold; 
      margin: 4px 0;
      border: 1px solid #000;
      padding: 2px;
    }

    .info-section { margin: 3px 0; }
    .info-row { display: flex; justify-content: space-between; width: 100%; margin-bottom: 1px; }
    .info-value { font-weight: bold; }
    .info-date { font-size: 7.5pt; }
    .info-date .info-value { font-size: 7.5pt; }

    .status-section {
      text-align: center;
      margin: 4px 0;
      font-size: 9pt;
      font-weight: bold;
      text-transform: uppercase;
    }

    .bet-detail-section { margin: 5px 0; }
    .bet-detail-title {
      text-align: center;
      font-size: 8pt;
      font-weight: bold;
      margin-bottom: 2px;
      text-transform: uppercase;
    }
    .bet-detail-row { display: flex; justify-content: space-between; font-size: 8.5pt; }

    .winner-section {
      text-align: center;
      margin: 4px 0;
      font-size: 8.5pt;
    }

    .payout-amount-section { 
      margin-top: 5px; 
      border-top: 1px solid #000; 
      padding-top: 2px; 
    }
    .payout-amount-label {
      text-align: center;
      font-size: 8pt;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .payout-amount-value {
      text-align: center;
      font-size: 10pt;
      font-weight: bold;
    }

    .footer-section { text-align: center; margin-top: 8px; }
    .footer-text { font-size: 7pt; margin: 2px 0; }

    @media screen {
      body {
        background: #f5f5f5;
        padding: 10px;
      }
      
      .payout-container {
        background: white;
        border: 1px solid #ddd;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        border-radius: 4px;
        max-width: 80mm;
      }
    }
  </style>
</head>

<body>
  <div class="payout-container">
    <!-- En-tête -->
    <div class="header-section">
      <div class="shop-name">${SYSTEM_NAME}</div>
      <div class="shop-phone">Course Cheval</div>
    </div>

    <div class="separator-line">-------------------------------</div>
    <div class="receipt-title">DECAISSEMENT</div>
    <div class="separator-line">-------------------------------</div>

    <!-- Infos Ticket -->
    <div class="info-section">
      <div class="info-row"><span>Ticket:</span><span class="info-value">#${receipt.id || receipt.receipt_id || receiptId}</span></div>
      <div class="info-row"><span>Tour:</span><span class="info-value">#${round.id}</span></div>
      <div class="info-row info-date"><span>Date:</span><span class="info-value">${escapeHtml(createdDate)}</span></div>
      <div class="info-row info-date"><span>Heure:</span><span class="info-value">${escapeHtml(createdTime)}</span></div>
    </div>

    <div class="separator-line">-------------------------------</div>

    <!-- Statut -->
    <div class="status-section">
      ${hasWon ? 'TICKET GAGNANT' : 'TICKET PERDANT'}
    </div>

    <!-- Mise totale -->
    <div class="info-section">
      <div class="info-row"><span>Mise totale:</span><span class="info-value">${totalMise.toFixed(2)} HTG</span></div>
    </div>

    <!-- Détail des paris -->
    <div class="bet-detail-section">
      <div class="bet-detail-title">Détail des paris</div>
      ${betsDetailHTML}
    </div>

    ${hasWon ? `
    <div class="winner-section">
      <div>Gagnant: ${escapeHtml(winnerName)}</div>
    </div>
    ` : ''}

    <!-- Montant du décaissement -->
    <div class="payout-amount-section">
      <div class="payout-amount-label">Montant du décaissement</div>
      <div class="payout-amount-value">${payoutAmountComputed.toFixed(2)} HTG</div>
    </div>

    <div class="separator-line">-------------------------------</div>

    <!-- Pied de page -->
    <div class="footer-section">
      <div class="footer-text">Conservez ce document comme justificatif.</div>
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
  router.post("/", async (req, res) => {
    const action = req.query.action || "add";

    if (action === "add") {
      // ✅ CORRECTION: Extraire user_id depuis req.user (JWT) si disponible
      // Cela permet d'associer le ticket à l'utilisateur connecté
      if (req.user?.userId && !req.body.user_id) {
        req.body.user_id = req.user.userId;
      }
      // ✅ Vérification: Un ticket ne peut être créé QUE si un round est actif et prêt
      if (!gameState.currentRound || !gameState.currentRound.id) {
        console.warn("[SYNC] ❌ Impossible créer ticket: aucun round actif");
        return res.status(409).json({
          error: "Aucun round prêt. Veuillez attendre le prochain tirage.",
          code: "NO_ACTIVE_ROUND"
        });
      }

      // ✅ CORRECTION: Vérifier que le round existe en DB (même si persisted=false)
      // Au lieu de bloquer sur persisted, on vérifie directement en DB
      const roundId = gameState.currentRound.id;
      let roundExistsInDb = false;
      
      // Vérification directe en DB (plus fiable que persisted flag)
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const dbCheck = await pool.query(
            "SELECT round_id FROM rounds WHERE round_id = $1 LIMIT 1",
            [roundId]
          );
          if (dbCheck.rows && dbCheck.rows[0]) {
            roundExistsInDb = true;
            console.log(`[DB] ✓ Round ${roundId} trouvé en DB (attempt ${attempt + 1})`);
            break;
          }
        } catch (checkErr) {
          console.warn(`[DB] Erreur vérification round ${roundId} (attempt ${attempt + 1}):`, checkErr.message);
        }
        if (attempt < 19) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
      
      if (!roundExistsInDb) {
        console.warn(`[DB] ❌ Round ${roundId} non trouvé en DB après 20 tentatives (persisted=${gameState.currentRound.persisted})`);
        // ✅ CORRECTION: Ne pas bloquer complètement - permettre la création en mémoire
        // Le round sera créé en DB de manière asynchrone
        console.warn('[DB] ⚠️ Création du receipt en mémoire uniquement (round sera créé en DB plus tard)');
      } else {
        // Si le round existe en DB, mettre à jour le flag persisted
        gameState.currentRound.persisted = true;
      }

      // ✅ SÉCURITÉ: Vérifier si les paris sont autorisés (quelques secondes avant le lancement)
      if (gameState.isRaceRunning) {
        console.warn("[SECURITY] ❌ Tentative de pari pendant une course en cours");
        return res.status(403).json({
          error: "Les paris sont fermés pendant la course",
          code: "BETTING_LOCKED_RACE_RUNNING"
        });
      }
      
      // Vérifier si le timer est proche de 0 (délai de sécurité)
      if (gameState.nextRoundStartTime) {
        const now = Date.now();
        const timeLeft = gameState.nextRoundStartTime - now;
        if (timeLeft > 0 && timeLeft <= BETTING_LOCK_DURATION_MS) {
          const secondsLeft = Math.ceil(timeLeft / 1000);
          console.warn(`[SECURITY] ❌ Tentative de pari ${secondsLeft}s avant le lancement`);
          return res.status(403).json({
            error: `Les paris sont fermés. Démarrage dans ${secondsLeft} seconde${secondsLeft > 1 ? 's' : ''}`,
            code: "BETTING_LOCKED_TIMER",
            secondsLeft: secondsLeft
          });
        }
      }

      const receipt = req.body;
      
      // ✅ CORRECTION: S'assurer que user_id est défini depuis req.user si disponible
      if (!receipt.user_id && req.user?.userId) {
        receipt.user_id = req.user.userId;
      }
      
      console.log("Ajout d'un nouveau ticket :", receipt);

      // ✅ VALIDATION STRICTE: Vérifier que les participants du ticket existent dans le round actuel
      if (!Array.isArray(receipt.bets) || receipt.bets.length === 0) {
        console.warn("[VALIDATION] ❌ Ticket sans paris");
        return res.status(400).json({
          error: "Le ticket doit contenir au moins un pari",
          code: "NO_BETS"
        });
      }

      // Vérifier que TOUS les participants du ticket existent dans le round
      let currentParticipantNumbers = (gameState.currentRound.participants || []).map(p => p.number);
      
      // ✅ SECURITÉ: Si pas de participants, charger depuis BASE_PARTICIPANTS
      if (currentParticipantNumbers.length === 0) {
        console.warn(`[VALIDATION] ⚠️ currentRound.participants vide, chargement depuis BASE_PARTICIPANTS`);
        try {
          const gameModule = await import('../game.js');
          const BASE_PARTICIPANTS = gameModule.BASE_PARTICIPANTS;
          currentParticipantNumbers = BASE_PARTICIPANTS.map(p => p.number);
        } catch (importErr) {
          console.error('[VALIDATION] Erreur import BASE_PARTICIPANTS:', importErr);
        }
      }
      
      // 🔍 DEBUG DÉTAILLÉ
      console.log(`[DEBUG] Rebet validation détaillé:`, {
        roundId: gameState.currentRound.id,
        participantsCount: currentParticipantNumbers.length,
        participantsAvailable: currentParticipantNumbers,
        betsCount: receipt.bets?.length || 0,
        betsDetail: receipt.bets?.map(b => ({
          number: b.number,
          participant: b.participant,
          participantNumber: b.participant?.number
        })) || [],
        requestedParticipants: receipt.bets?.map(b => {
          const num = b.participant?.number || b.number;
          console.log(`  - Bet participant number: ${num}, included in list: ${currentParticipantNumbers.includes(num)}`);
          return num;
        }) || []
      });
      
      const invalidBets = receipt.bets.filter(bet => {
        const participantNumber = bet.participant?.number || bet.number;
        // ✅ IMPORTANT: Convertir en nombre pour la comparaison (au cas où l'un soit string et l'autre number)
        const numToCheck = Number(participantNumber);
        const isValid = currentParticipantNumbers.map(n => Number(n)).includes(numToCheck);
        return !isValid;
      });

      if (invalidBets.length > 0) {
        console.warn(`[VALIDATION] ❌ Participants introuvables: ${invalidBets.map(b => b.participant?.number || b.number).join(', ')}`);
        return res.status(400).json({
          error: "Un ou plusieurs participants ne sont pas valides pour ce tour",
          code: "INVALID_PARTICIPANTS",
          invalidParticipants: invalidBets.map(b => b.participant?.number || b.number)
        });
      }

      // ✅ VALIDATION: Vérifier les limites de montants pour chaque pari
      const invalidAmountBets = receipt.bets.filter(bet => {
        const betAmount = parseFloat(bet.value) || 0;
        return betAmount < MIN_BET_AMOUNT || betAmount > MAX_BET_AMOUNT;
      });

      if (invalidAmountBets.length > 0) {
        console.warn(`[VALIDATION] ❌ Montants invalides (min: ${MIN_BET_AMOUNT}, max: ${MAX_BET_AMOUNT}):`, invalidAmountBets.map(b => `${b.participant?.number}: ${b.value}`).join(', '));
        return res.status(400).json({
          error: `Les montants doivent être entre ${systemToPublic(MIN_BET_AMOUNT)} et ${systemToPublic(MAX_BET_AMOUNT)} HTG`,
          code: "INVALID_BET_AMOUNT",
          minBet: systemToPublic(MIN_BET_AMOUNT),
          maxBet: systemToPublic(MAX_BET_AMOUNT),
          invalidBets: invalidAmountBets.map(b => ({ 
            participant: b.participant?.number, 
            amount: systemToPublic(b.value) 
          }))
        });
      }

      // Génération d'un ID formaté : <stationNumber><6chiffres>
      // - `STATION_NUMBER` peut être fourni via la variable d'environnement pour représenter la succursale.
      // - Par défaut on utilisera la valeur fictive '01' (modifiable si besoin).
      // Exemple: station '01' + '034521' => receipt.id = 01034521
      const STATION_NUMBER = (process.env.STATION_NUMBER || '01').toString();
      // Générer 6 chiffres via crypto.randomInt (plus robuste que RNG JS pour éviter collisions)
      const seq6 = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const composedIdStr = `${STATION_NUMBER}${seq6}`;
      const numericId = Number(composedIdStr);
      receipt.id = Number.isSafeInteger(numericId) ? numericId : composedIdStr;
      receipt.bets = (receipt.bets || []).map(bet => {
        if (!bet.participant || bet.participant.number === undefined) {
          console.warn("Bet sans participant valide :", bet);
          return null;
        }
        return {
          ...bet,
          participant: bet.participant, // ✅ IMPORTANT: Conserver participant pour rebet
          number: bet.participant.number,
          value: bet.value,
          prize: bet.prize || 0
        };
      }).filter(Boolean);

      // Utilise gameState
      // IMPORTANT: Ne calculer le prize que si la course est terminée
      // Un ticket ajouté pendant le round actuel doit rester en "pending" jusqu'à la fin de la course
      let prizeForThisReceipt = 0;
      const winner = Array.isArray(gameState.currentRound.participants) ? gameState.currentRound.participants.find(p => p.isWinner === true) : null;
      
      // ✅ LOG: Tracer le gagnant utilisé pour le calcul du prize
      if (winner) {
        console.log(`[RECEIPTS-ADD] 🏆 Gagnant trouvé pour calcul prize: №${winner.number} ${winner.name} (Round #${gameState.currentRound?.id})`);
      } else {
        console.log(`[RECEIPTS-ADD] ℹ️ Aucun gagnant trouvé (Round #${gameState.currentRound?.id}, participants: ${gameState.currentRound?.participants?.length || 0})`);
      }
      
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
      // ✅ OBLIGATOIRE: round_id doit être défini (round actuel)
      receipt.roundId = gameState.currentRound.id;
      receipt.round_id = gameState.currentRound.id;
      // ✅ CRITIQUE: Calculer total_amount en système (×100) et l'ajouter au receipt
      // Les valeurs bet.value sont en système (×100), donc total_amount doit aussi être en système
      receipt.total_amount = (receipt.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
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

      // 🚀 OPTIMISATION: Ajouter le ticket au cache Redis (pas de DB queries!)
      const cacheResult = await dbStrategy.addTicketToRoundCache(gameState.currentRound.id, receipt);
      if (!cacheResult) {
        console.warn(`⚠️ Failed to cache ticket ${receipt.id}, will persist to DB on race finish`);
      }

      console.log("✅ Ticket ajouté ID :", receipt.id, `(cache: ${cacheResult ? 'OK' : 'FALLBACK'})`);
      (async () => {
        // ✅ OBLIGATOIRE: Vérifier que le round existe AVANT de créer le receipt
        const roundId = gameState.currentRound.id;
        if (!roundId) {
          throw new Error('Impossible de créer un receipt: aucun round actif (round_id est obligatoire)');
        }
        
        // ✅ OPTIMISATION: Vérifier que le round existe vraiment en DB (même si persisted=true)
        // Il peut y avoir un délai de commit/visibilité, donc on fait plusieurs tentatives
        let roundExists = false;
        const maxDbChecks = 50; // 50 tentatives (augmenté pour plus de tolérance)
        const dbCheckDelay = 150; // 150ms entre chaque tentative = 7.5s max
        
        console.log(`[DB] 🔍 Vérification round ${roundId} en DB (persisted=${gameState.currentRound.persisted})...`);
        
        for (let attempt = 0; attempt < maxDbChecks; attempt++) {
          try {
            const dbCheck = await pool.query(
              "SELECT round_id, status FROM rounds WHERE round_id = $1 LIMIT 1",
              [roundId]
            );
            if (dbCheck.rows && dbCheck.rows[0]) {
              console.log(`[DB] ✓ Round ${roundId} trouvé en DB (attempt ${attempt + 1}/${maxDbChecks}, status: ${dbCheck.rows[0].status})`);
              roundExists = true;
              break;
            }
          } catch (checkErr) {
            console.warn(`[DB] Erreur vérification round ${roundId} (attempt ${attempt + 1}):`, checkErr.message);
          }
          
          // Attendre avant la prochaine tentative (sauf pour la dernière)
          if (attempt < maxDbChecks - 1) {
            await new Promise(resolve => setTimeout(resolve, dbCheckDelay));
          }
        }
        
        // ✅ CORRECTION: Ne créer le receipt en DB que si le round existe
        if (!roundExists) {
          // ✅ CORRECTION: Ne pas bloquer - le round sera créé en DB plus tard
          // Le receipt est déjà créé en mémoire et sera persisté quand le round sera disponible
          console.warn(`[DB] ⚠️ Round ${roundId} non trouvé en DB après ${maxDbChecks} tentatives. Le receipt ${receipt.id} sera persisté plus tard (quand le round sera en DB).`);
          // Ne pas lancer d'erreur - permettre la création en mémoire
          // Le round sera créé en DB de manière asynchrone et le receipt sera persisté ensuite
          return; // Sortir de la fonction asynchrone - le receipt reste en mémoire
        }

        // ✅ VALIDATION: receipt.id est obligatoire
        if (!receipt.id && receipt.id !== 0) {
          throw new Error('Impossible de créer un receipt: receipt_id est obligatoire');
        }

        let dbReceipt = null;
        // Helper to generate a new formatted receipt id (stationNumber + 6 digits)
        const generateFormattedId = () => {
          const STATION_NUMBER = (process.env.STATION_NUMBER || '01').toString();
          const seq6 = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
          const composed = `${STATION_NUMBER}${seq6}`;
          const num = Number(composed);
          return Number.isSafeInteger(num) ? num : composed;
        };

        try {
          // ✅ CRITIQUE: Utiliser receipt.total_amount qui est déjà calculé en système (×100)
          // Les valeurs bet.value sont en système (×100), donc total_amount doit aussi être en système
          // receipt.total_amount a été calculé juste avant le push dans gameState
          const totalAmount = receipt.total_amount || (receipt.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
          
          // ✅ OBLIGATOIRE: round_id doit être le round actuel (pas null)
          const dbRoundId = roundId;

          // Retry loop: if insert fails with duplicate key, regenerate id and retry
          const MAX_INSERT_ATTEMPTS = 5;
          for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt++) {
            try {
              // ✅ OBLIGATOIRE: receipt_id et round_id sont maintenant obligatoires
              dbReceipt = await dbCreateReceipt({ 
                receipt_id: receipt.id,  // ✅ OBLIGATOIRE
                round_id: dbRoundId,     // ✅ OBLIGATOIRE (round actuel)
                user_id: receipt.user_id || null, 
                total_amount: totalAmount, 
                status: isRaceFinished ? (receipt.prize > 0 ? 'won' : 'lost') : 'pending', 
                prize: receipt.prize || 0 
              });
              // ✅ CORRECTION: Synchroniser l'ID dans gameState si l'ID a changé
              if (dbReceipt && (dbReceipt.receipt_id || dbReceipt.receipt_id === 0)) {
                const oldId = receipt.id;
                receipt.id = dbReceipt.receipt_id || receipt.id;
                
                // ✅ NOUVEAU: Si l'ID a changé, mettre à jour la référence dans gameState
                if (oldId !== receipt.id) {
                  console.log(`[DB] ⚠️ ID régénéré: ${oldId} → ${receipt.id}, synchronisation gameState...`);
                  // Trouver et mettre à jour la référence dans gameState
                  const receiptIndex = gameState.currentRound.receipts.findIndex(r => r.id === oldId);
                  if (receiptIndex !== -1) {
                    gameState.currentRound.receipts[receiptIndex].id = receipt.id;
                    console.log(`[DB] ✓ Référence gameState synchronisée avec nouvel ID ${receipt.id}`);
                  } else {
                    console.warn(`[DB] ⚠️ Référence non trouvée dans gameState pour ID ${oldId}`);
                  }
                }
              }
              console.log(`[DB] ✓ Receipt ${receipt.id} créé en DB (attempt ${attempt})`);
              break; // success
            } catch (insertErr) {
              // Unique violation (duplicate primary key) - regenerate id and retry
              if (insertErr && insertErr.code === '23505') {
                console.warn(`[DB] Duplicate receipt_id ${receipt.id} on insert (attempt ${attempt}). Regenerating id and retrying.`);
                // generate a new id and update the in-memory receipt (gameState reference will follow)
                const newId = generateFormattedId();
                receipt.id = newId;
                // if last attempt, bubble the error after loop
                if (attempt === MAX_INSERT_ATTEMPTS) {
                  console.error('[DB] Échec création receipt après plusieurs tentatives de génération d[0m id');
                }
                // continue to next attempt
                continue;
              } else {
                // other DB error - log and stop retrying
                console.error('[DB] Erreur persistance receipt:', insertErr && insertErr.message ? insertErr.message : insertErr);
                break;
              }
            }
          }
        } catch (err) {
          // Fallback catch; should be rare due to inner handling
          console.error('[DB] Erreur persistance receipt (unexpected):', err && err.message ? err.message : err);
        }
        try {
          // If receipt wasn't persisted in DB, do NOT try to persist bets because bets reference receipts via FK.
          if (!dbReceipt) {
            console.warn('[DB] Receipt non persisté en base; saut des insertions de bets pour éviter violation FK');
            return;
          }
          // Créer les bets en base (si la table bets existe)
          for (const b of receipt.bets || []) {
            try {
              const participantNumber = b.number || b.participant?.number || null;
              let participantId = null;
              if (participantNumber !== null) {
                try {
                  // Debug: check if table has data
                  const countRes = await pool.query("SELECT COUNT(*) as cnt FROM participants");
                  const totalParticipants = parseInt(countRes.rows[0]?.cnt || 0, 10);
                  console.log(`[DB] Participants dans la table: ${totalParticipants}`);
                  
                  const pRes = await pool.query("SELECT participant_id FROM participants WHERE number = $1 LIMIT 1", [participantNumber]);
                  if (pRes && pRes.rows && pRes.rows[0]) {
                    participantId = pRes.rows[0].participant_id;
                    console.log(`[DB] ✓ Participant trouvé: numero=${participantNumber}, id=${participantId}`);
                  } else {
                    console.warn(`[DB] ⚠️ Aucun participant trouvé pour numero=${participantNumber}`);
                    // Show all participants for debugging
                    const allRes = await pool.query("SELECT participant_id, number, name FROM participants");
                    if (allRes.rows.length > 0) {
                      console.log("[DB] Participants disponibles:", allRes.rows);
                    }
                  }
                } catch (lookupErr) {
                  console.error('[DB] Erreur lookup participant by number:', lookupErr.message);
                }
              }

              // Only persist bet if we have a valid participant_id (required by schema)
              if (participantId !== null) {
                await dbCreateBet({
                  receipt_id: receipt.id,
                  participant_id: participantId,
                  participant_number: participantNumber,
                  participant_name: b.participant?.name || null,
                  coefficient: b.participant?.coeff || null,
                  value: Number(b.value) || 0
                });
              } else {
                console.warn('[DB] Impossible de persister le pari: participant_id introuvable pour numero', participantNumber);
              }
            } catch (err2) {
              console.error('[DB] Erreur persistance bet:', err2);
            }
          }
        } catch (err3) {
          console.error('[DB] Erreur lors de la persistance des bets:', err3);
        }
      })();

      // ✅ Broadcast WebSocket pour notifier les clients avec toutes les infos
      // ✅ OPTIMISATION: Inclure toutes les données formatées pour mise à jour directe du DOM
      if (broadcast) {
        // ✅ CRITIQUE: Convertir totalAmount de système (×100) à publique pour le frontend
        // receipt.total_amount est en système, il faut le convertir en publique
        const totalAmountSystem = receipt.total_amount || (receipt.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
        const totalAmountPublic = systemToPublic(totalAmountSystem);

        // Formater les bets pour le frontend (conversion système -> publique)
        const formattedBets = (receipt.bets || []).map(bet => {
          const valueSystem = Number(bet.value || 0);
          const valuePublic = systemToPublic(valueSystem);
          return {
            number: bet.number || bet.participant?.number,
            value: typeof valuePublic === 'object' && valuePublic.toNumber ? valuePublic.toNumber() : Number(valuePublic),
            participant: bet.participant || {
              number: bet.number,
              name: bet.participant?.name || '',
              coeff: bet.participant?.coeff || 0
            }
          };
        });

        broadcast({
          event: "receipt_added",
          receipt: JSON.parse(JSON.stringify(receipt)),
          receiptId: receipt.id,
          totalAmount: typeof totalAmountPublic === 'object' && totalAmountPublic.toNumber ? totalAmountPublic.toNumber() : Number(totalAmountPublic),
          roundId: gameState.currentRound.id,
          status: receipt.status || (isRaceFinished ? (receipt.prize > 0 ? 'won' : 'lost') : 'pending'),
          prize: receipt.prize || 0,
          // ✅ NOUVEAU: Données formatées pour mise à jour directe du DOM
          totalAmount: totalAmountPublic, // Valeur publique pour affichage
          bets: formattedBets, // Bets formatés avec valeurs publiques
          created_time: receipt.created_time || new Date().toISOString(),
          date: receipt.created_time || new Date().toISOString(),
          user_id: receipt.user_id || null,
          // Stats du round
          totalReceipts: gameState.currentRound.receipts.length,
          currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
          totalPrize: gameState.currentRound.totalPrize || 0,
          isRaceRunning: gameState.isRaceRunning,
          timestamp: Date.now()
        });
      }
      
      return res.json(wrap({ id: receipt.id, success: true }));
    }

    if (action === "delete") {
      // ✅ SÉCURITÉ: Vérifier si l'annulation est autorisée (quelques secondes avant le lancement)
      if (gameState.isRaceRunning) {
        console.warn("[SECURITY] ❌ Tentative d'annulation pendant une course en cours");
        return res.status(403).json({
          error: "L'annulation est fermée pendant la course",
          code: "BETTING_LOCKED_RACE_RUNNING"
        });
      }
      
      // Vérifier si le timer est proche de 0 (délai de sécurité)
      if (gameState.nextRoundStartTime) {
        const now = Date.now();
        const timeLeft = gameState.nextRoundStartTime - now;
        if (timeLeft > 0 && timeLeft <= BETTING_LOCK_DURATION_MS) {
          const secondsLeft = Math.ceil(timeLeft / 1000);
          console.warn(`[SECURITY] ❌ Tentative d'annulation ${secondsLeft}s avant le lancement`);
          return res.status(403).json({
            error: `L'annulation est fermée. Démarrage dans ${secondsLeft} seconde${secondsLeft > 1 ? 's' : ''}`,
            code: "BETTING_LOCKED_TIMER",
            secondsLeft: secondsLeft
          });
        }
      }
      
      const id = parseInt(req.query.id, 10);

      console.log(`[DELETE ATTEMPT] id=${id} currentRound=${gameState.currentRound?.id} isRaceRunning=${gameState.isRaceRunning} raceStartTime=${String(gameState.raceStartTime)} raceEndTime=${String(gameState.raceEndTime)}`);

      // Chercher le ticket dans le round actuel (mémoire)
      let receipt = gameState.currentRound.receipts.find(r => r.id === id);
      let foundInCurrentRound = true;

      // Si pas trouvé dans le round actuel, chercher dans l'historique mémoire
      if (!receipt) {
        foundInCurrentRound = false;
        for (const historicalRound of gameState.gameHistory) {
          receipt = (historicalRound.receipts || []).find(r => r.id === id);
          if (receipt) {
            console.warn(`[DELETE] Receipt ${id} found in historical round ${historicalRound.id} - deletion denied`);
            // On ne peut pas annuler un ticket de l'historique
            return res.status(400).json({ 
              error: "Impossible d'annuler un ticket d'un round terminé",
              reason: "found_in_history",
              historicalRoundId: historicalRound.id,
              receiptId: id
            });
          }
        }
      }

      // Si toujours pas trouvé en mémoire, tenter une recherche dans la base (fallback)
      if (!receipt) {
        try {
          const dbRes = await pool.query("SELECT receipt_id, round_id, status, prize FROM receipts WHERE receipt_id = $1 LIMIT 1", [id]);
          if (dbRes.rows && dbRes.rows[0]) {
              const dbReceipt = dbRes.rows[0];
              // Si le ticket appartient à un round différent => il est historique
              if (dbReceipt.round_id && Number(dbReceipt.round_id) !== Number(gameState.currentRound.id)) {
                console.warn(`[DELETE] Receipt ${id} in DB belongs to round ${dbReceipt.round_id} (current ${gameState.currentRound.id}) - deletion denied`);
                return res.status(400).json({ error: "Impossible d'annuler un ticket d'un round terminé", reason: "db_round_mismatch", dbRoundId: dbReceipt.round_id, currentRoundId: gameState.currentRound.id, receiptId: id });
              }

            // Vérifier si la course est réellement terminée (course lancée ET terminée)
            const hasWinner = Array.isArray(gameState.currentRound.participants) &&
                              gameState.currentRound.participants.some(p => p.isWinner === true);
            const isRaceFinished = gameState.raceEndTime !== null ||
                                   (gameState.raceStartTime !== null && !gameState.isRaceRunning && hasWinner);
            if (isRaceFinished) {
              console.warn(`[DELETE] Receipt ${id} deletion denied because race is finished (isRaceFinished=${isRaceFinished})`);
              return res.status(400).json({ error: "Impossible d'annuler un ticket une fois la course terminée avec résultats", reason: "race_finished", isRaceFinished, receiptId: id });
            }

            // ✅ CORRECTION: Marquer le ticket comme "cancelled" au lieu de le supprimer complètement
            
            // Décrémenter totalPrize si le ticket avait un prize
            const prizeValue = dbReceipt.prize ? Number(dbReceipt.prize) : 0;
            if (prizeValue) {
              gameState.currentRound.totalPrize = Math.max(0, (gameState.currentRound.totalPrize || 0) - prizeValue);
            }
            
            // ✅ ÉTAPE 1: MARQUER COMME "cancelled" EN MÉMOIRE (gameState) - TOUJOURS effectuée
            const receiptIndex = gameState.currentRound.receipts.findIndex(r => r.id === id);
            if (receiptIndex !== -1) {
              gameState.currentRound.receipts[receiptIndex].status = 'cancelled';
              console.log(`[CANCEL] ✅ Ticket ${id} marqué comme "cancelled" dans gameState (fallback)`);
            } else {
              // Si pas trouvé dans gameState, essayer de l'ajouter avec statut cancelled (au cas où)
              console.warn(`[CANCEL] ⚠️ Ticket ${id} non trouvé dans gameState.currentRound.receipts (fallback)`);
            }

            // ✅ ÉTAPE 2: METTRE À JOUR REDIS - TOUJOURS effectuée (indépendante de DB)
            try {
              await updateTicketInRoundCache(gameState.currentRound.id, id, 'cancelled', null);
              console.log(`[REDIS] ✅ Ticket ${id} marqué comme "cancelled" dans Redis (fallback)`);
            } catch (redisErr) {
              console.error('[REDIS] ❌ Échec mise à jour ticket dans Redis (fallback):', redisErr && redisErr.message);
              // Ne pas bloquer - la mise à jour gameState est déjà effectuée
            }

            // ✅ ÉTAPE 3: METTRE À JOUR EN BASE (DB) - Tentative avec gestion d'erreur
            try {
              // Mettre à jour le statut du ticket en "cancelled" au lieu de le supprimer
              const updateResult = await updateReceiptStatus(id, 'cancelled', null);
              if (updateResult.success && updateResult.rowsAffected > 0) {
                console.log(`[DB] ✅ Receipt ${id} marqué comme "cancelled" en base (fallback)`);
              } else {
                console.warn(`[DB] ⚠️ Receipt ${id} non trouvé en base ou déjà annulé (reason: ${updateResult.reason || 'unknown'})`);
              }
            } catch (dbErr) {
              console.error('[DB] ❌ Échec mise à jour receipt en base (fallback):', dbErr && dbErr.message);
              // Ne pas bloquer - les mises à jour gameState et Redis sont déjà effectuées
            }

            // Broadcast WebSocket pour notifier les clients
            if (broadcast) {
              broadcast({
                event: "receipt_cancelled", // ✅ CORRECTION: Utiliser "receipt_cancelled" pour indiquer le statut
                receiptId: id,
                roundId: gameState.currentRound.id,
                status: 'cancelled', // ✅ NOUVEAU: Inclure le statut "cancelled" dans le message
                totalReceipts: gameState.currentRound.receipts.length,
                currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
                totalPrize: gameState.currentRound.totalPrize || 0
              });
            }

            return res.json(wrap({ success: true }));
          }
        } catch (dbErr) {
          console.error('[DB] Erreur lookup/delete receipt fallback:', dbErr);
          return res.status(500).json({ error: 'Erreur serveur lors de la suppression' });
        }

        // Si on est ici, rien trouvé en mémoire ni en base
        console.warn(`[DELETE] Receipt ${id} not found in memory nor DB`);
        return res.status(404).json({ error: "Ticket non trouvé", reason: "not_found", receiptId: id });
      }

      // Vérifier si le round est réellement terminé (course lancée ET terminée)
      // On ne doit bloquer l'annulation que si la course est terminée avec un gagnant.
      const hasWinner = Array.isArray(gameState.currentRound.participants) &&
                        gameState.currentRound.participants.some(p => p.isWinner === true);

      const isRaceFinished = gameState.raceEndTime !== null ||
                             (gameState.raceStartTime !== null && !gameState.isRaceRunning && hasWinner);

      // Bloquer l'annulation uniquement si la course est réellement terminée
      if (isRaceFinished) {
        return res.status(400).json({
          error: "Impossible d'annuler un ticket une fois la course terminée avec résultats"
        });
      }

      // ✅ CORRECTION: Marquer le ticket comme "cancelled" au lieu de le supprimer complètement
      // Cela permet de garder une trace et d'éviter les problèmes si le ticket s'affiche encore
      
      // Calculer prize à retirer si présent
      if (receipt && receipt.prize) {
        gameState.currentRound.totalPrize = Math.max(0, (gameState.currentRound.totalPrize || 0) - Number(receipt.prize));
      }

      // ✅ ÉTAPE 1: MARQUER COMME "cancelled" EN MÉMOIRE (gameState) - TOUJOURS effectuée
      const receiptIndex = gameState.currentRound.receipts.findIndex(r => r.id === id);
      if (receiptIndex !== -1) {
        gameState.currentRound.receipts[receiptIndex].status = 'cancelled';
        console.log(`[CANCEL] ✅ Ticket ${id} marqué comme "cancelled" dans gameState.currentRound.receipts`);
      } else {
        console.warn(`[CANCEL] ⚠️ Ticket ${id} non trouvé dans gameState.currentRound.receipts`);
      }

      // ✅ ÉTAPE 2: METTRE À JOUR REDIS - TOUJOURS effectuée (indépendante de DB)
      try {
        await updateTicketInRoundCache(gameState.currentRound.id, id, 'cancelled', null);
        console.log(`[REDIS] ✅ Ticket ${id} marqué comme "cancelled" dans le cache Redis`);
      } catch (redisErr) {
        console.error('[REDIS] ❌ Échec mise à jour ticket dans Redis:', redisErr && redisErr.message);
        // Ne pas bloquer - la mise à jour gameState est déjà effectuée
      }

      // ✅ ÉTAPE 3: METTRE À JOUR EN BASE (DB) - Tentative avec gestion d'erreur
      try {
        // Mettre à jour le statut du ticket en "cancelled" au lieu de le supprimer
        const updateResult = await updateReceiptStatus(id, 'cancelled', null);
        if (updateResult.success && updateResult.rowsAffected > 0) {
          console.log(`[DB] ✅ Receipt ${id} marqué comme "cancelled" en base`);
        } else {
          console.warn(`[DB] ⚠️ Receipt ${id} non trouvé en base ou déjà annulé (reason: ${updateResult.reason || 'unknown'})`);
        }
      } catch (dbErr) {
        console.error('[DB] ❌ Échec mise à jour receipt en base (memo->db) pour id', id, dbErr && dbErr.message);
        // ✅ IMPORTANT: Ne pas throw - les mises à jour gameState et Redis sont déjà effectuées
        // Le ticket est marqué comme "cancelled" dans gameState et Redis même si la DB échoue
      }

      // Broadcast WebSocket pour notifier les clients avec toutes les infos
      if (broadcast) {
        broadcast({
          event: "receipt_cancelled", // ✅ CORRECTION: Utiliser "receipt_cancelled" pour indiquer le statut
          receiptId: id,
          roundId: gameState.currentRound.id,
          status: 'cancelled', // ✅ NOUVEAU: Inclure le statut "cancelled" dans le message
          totalReceipts: gameState.currentRound.receipts.length,
          currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
          totalPrize: gameState.currentRound.totalPrize || 0
        });
      }

      console.log("Ticket annulé (statut 'cancelled') ID :", id);
      return res.json(wrap({ success: true }));
    }

    return res.status(400).json({ error: "Unknown receipts action" });
  });

  return router;
}