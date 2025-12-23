// routes/receipts.js

import express from "express";
import { gameState, wrap } from "../game.js";
import { escapeHtml, systemToPublic } from "../utils.js";
import { SYSTEM_NAME, CURRENT_GAME } from "../config/system.config.js";

// Import ChaCha20 pour les IDs de reçus sécurisés
import { chacha20Random, chacha20RandomInt, initChaCha20 } from "../chacha20.js";
import crypto from 'crypto';
// DB models pour persistance des tickets
import { createReceipt as dbCreateReceipt, createBet as dbCreateBet, getReceiptById, getBetsByReceipt } from "../models/receiptModel.js";
import { pool } from "../config/db.js";
// Import cache strategy (Redis)
import dbStrategy, { deleteTicketFromRoundCache } from "../config/db-strategy.js";
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

      const createdTime =
        receipt.created_time
          ? new Date(receipt.created_time).toLocaleString('fr-FR')
          : new Date().toLocaleString('fr-FR');

      let totalMise = 0;
      let totalGainPotentiel = 0;

      // ✅ CORRECTION: Génération des lignes de paris avec meilleure organisation
      // S'assurer que tous les bets sont bien formatés et affichés
      const betsArray = Array.isArray(receipt.bets) ? receipt.bets : [];
      console.log(`[PRINT] 📋 Génération HTML pour ${betsArray.length} pari(s)`);
      
      const betsHTML = betsArray.map((bet, index) => {
        // ✅ CORRECTION: Gérer différents formats de bet (depuis DB ou gameState)
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
        // ✅ CORRECTION: Les valeurs bet.value sont en système, convertir en publique pour l'affichage
        const miseSystem = parseFloat(bet.value || 0);
        if (miseSystem <= 0) {
          console.warn(`[PRINT] ⚠️ Pari ${index + 1} a une mise invalide: ${bet.value}`);
        }
        const mise = systemToPublic(miseSystem);
        const gainPot = systemToPublic(miseSystem * coeff);
        totalMise += mise;
        totalGainPotentiel += gainPot;
        
        return `
          <div class="bet-item">
            <div class="bet-header">
              <span class="bet-number">Pari ${index + 1}</span>
              <span class="bet-separator">•</span>
              <span class="bet-name">N°${number} ${name}</span>
            </div>
            <div class="bet-details">
              <div class="bet-detail-row">
                <span class="bet-label">Mise:</span>
                <span class="bet-value">${mise.toFixed(2)} HTG</span>
              </div>
              <div class="bet-detail-row">
                <span class="bet-label">Cote:</span>
                <span class="bet-value">x${coeff.toFixed(2)}</span>
              </div>
              <div class="bet-detail-row bet-gain-row">
                <span class="bet-label">Gain potentiel:</span>
                <span class="bet-value bet-gain-value">${gainPot.toFixed(2)} HTG</span>
              </div>
            </div>
          </div>`;
      }).join('');
      
      // ✅ CORRECTION: Vérifier qu'au moins un pari est affiché
      if (!betsHTML || betsHTML.trim() === '') {
        console.error(`[PRINT] ❌ Aucun pari à afficher pour le ticket #${receiptId}`);
        return res.status(500).send("<h1>Erreur: Aucun pari trouvé pour ce ticket</h1>");
      }

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
          * {
            font-family: 'Arial', sans-serif !important;
            color: #000 !important;
          }
          
          body {
            background: #fff;
            margin: 0;
            padding: 0; /* Important pour les POS */
            font-size: 12px; /* Taille de base lisible */
            line-height: 1.4;
            color: #000 !important;
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
          
          .header-info {
            margin-top: 8px;
            text-align: left;
            padding: 0 5px;
          }
          
          .header-line {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            line-height: 1.5;
            padding: 2px 0;
          }
          
          .header-label {
            color: #000 !important;
            font-weight: normal;
          }
          
          .header-value {
            font-weight: bold;
            color: #000 !important;
          }

          /* --- Section Paris --- */
          .bets-title {
            font-size: 13px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          
          .bets-list {
            margin-bottom: 10px;
          }
          
          .bet-item {
            margin-bottom: 12px;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 3px;
            background: #f9f9f9;
          }
          .bet-item:last-child {
            margin-bottom: 0;
          }
          
          .bet-header {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 6px;
            padding-bottom: 4px;
            border-bottom: 1px solid #ccc;
          }
          
          .bet-number {
            color: #000 !important;
            font-size: 10px;
            margin-right: 4px;
          }
          
          .bet-separator {
            margin: 0 6px;
            color: #000 !important;
          }
          
          .bet-name {
            flex: 1;
            font-weight: bold;
            color: #000 !important;
          }
          
          .bet-details {
            margin-top: 6px;
          }
          
          .bet-detail-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            line-height: 1.6;
            padding: 2px 0;
          }
          
          .bet-label {
            color: #000 !important;
            font-weight: normal;
          }
          
          .bet-value {
            font-weight: bold;
            color: #000 !important;
          }
          
          .bet-gain-row {
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px dashed #aaa;
          }
          
          .bet-gain-value {
            font-size: 12px;
            color: #000 !important;
          }

          /* --- Section Totaux --- SUPPRIMÉE --- */

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
            <h2>${SYSTEM_NAME}</h2>
            <h3 style="margin: 5px 0; font-size: 16px; color: #666;">Jeu: ${CURRENT_GAME.displayName}</h3>
            <div class="header-info">
              <div class="header-line">
                <span class="header-label">Ticket:</span>
                <span class="header-value">#${receipt.id || receipt.receipt_id || receiptId}</span>
              </div>
              <div class="header-line">
                <span class="header-label">Tour:</span>
                <span class="header-value">#${round?.id || receipt.round_id || gameState.currentRound?.id || 'N/A'}</span>
              </div>
              <div class="header-line">
                <span class="header-label">Date:</span>
                <span class="header-value">${escapeHtml(createdTime)}</span>
              </div>
            </div>
          </div>

          <hr class="divider">

          <h3 class="bets-title">📋 Détail des Paris</h3>

          <div class="bets-list">
            ${betsHTML}
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

      // Si toujours pas trouvé, chercher en base de données
      if (!receipt) {
        try {
          console.log(`[PAYOUT] Recherche du ticket #${receiptId} en base de données`);
          receipt = await getReceiptById(receiptId);
          if (receipt) {
            console.log(`[PAYOUT] ✅ Ticket #${receiptId} trouvé en base de données`);
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
          <div class="bet-detail-card">
            <div class="bet-detail-header">
              <span class="bet-detail-number">Pari ${index + 1}</span>
              <span class="bet-detail-separator">•</span>
              <span class="bet-detail-name">N°${number} ${name}</span>
            </div>
            <div class="bet-detail-content">
              <div class="bet-detail-info">
                <span class="bet-detail-label">Mise:</span>
                <span class="bet-detail-value">${mise.toFixed(2)} HTG</span>
              </div>
              <div class="bet-detail-info">
                <span class="bet-detail-label">Cote:</span>
                <span class="bet-detail-value">x${coeff.toFixed(2)}</span>
              </div>
              <div class="bet-detail-info bet-detail-result ${isWin ? 'bet-won' : 'bet-lost'}">
                <span class="bet-detail-label">Résultat:</span>
                <span class="bet-detail-value">${isWin ? '✓ GAGNÉ' : '✗ PERDU'}</span>
              </div>
              ${isWin ? `
              <div class="bet-detail-info bet-detail-gain">
                <span class="bet-detail-label">Gain:</span>
                <span class="bet-detail-value bet-gain-highlight">${gain.toFixed(2)} HTG</span>
              </div>` : ''}
            </div>
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
  <title>Décaissement #${receipt.id}</title>
  <style>
    /* -------------------------------
       IMPRESSION 55MM - NOIR ET BLANC
       Lisible, centré, marges sûres
    -------------------------------- */
    * {
      box-sizing: border-box;
      background: #fff !important;
      color: #000 !important;
      font-family: 'Arial', sans-serif !important;
      text-shadow: none !important;
      box-shadow: none !important;
    }

    body {
      margin: 0;
      padding: 4mm 3mm; /* Marges de sécurité pour éviter les coupures */
      width: 49mm; /* Réduction pour ne pas coller aux bords physiques du rouleau */
      font-size: 11px;
      line-height: 1.3;
    }

    .payout-container {
      width: 100%;
      margin: 0 auto;
    }

    /* En-tête amélioré */
    .header {
      text-align: center;
      margin-bottom: 4mm;
    }

    .header h2 {
      font-size: 15px;
      margin: 0 0 3mm 0;
      font-weight: bold;
      letter-spacing: 0.5px;
    }
    
    .header-info {
      margin-top: 2mm;
      text-align: left;
      padding: 0 2mm;
    }
    
    .info-total {
      background: #f5f5f5;
      padding: 2mm;
      border: 1px solid #000;
      border-radius: 2px;
      margin: 2mm 0;
    }
    
    .info-value {
      font-weight: bold;
      font-size: 11px;
    }

    /* Boîte de statut améliorée */
    .status-box {
      border: 2px solid #000;
      text-align: center;
      padding: 4mm 2mm;
      margin: 4mm 0;
      font-size: 12px;
      font-weight: bold;
      border-radius: 3px;
      letter-spacing: 0.5px;
    }
    
    .status-box.won {
      background: #e8f5e9;
    }
    
    .status-box.lost {
      background: #ffebee;
    }

    /* Lignes d'informations */
    .info-line {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dotted #000;
      padding: 1.5mm 0;
      font-size: 10px;
      align-items: center;
    }

    .info-label {
      font-weight: bold;
      color: #000 !important;
    }
    
    /* Détails des paris améliorés */
    .bet-detail-card {
      margin-bottom: 3mm;
      padding: 2.5mm;
      border: 1px solid #000;
      border-radius: 2px;
      background: #fafafa;
    }
    
    .bet-detail-header {
      display: flex;
      align-items: center;
      font-size: 10px;
      font-weight: bold;
      margin-bottom: 2mm;
      padding-bottom: 1.5mm;
      border-bottom: 1px solid #ccc;
    }
    
    .bet-detail-number {
      color: #000 !important;
      font-size: 9px;
      margin-right: 3px;
    }
    
    .bet-detail-separator {
      margin: 0 4px;
      color: #000 !important;
    }
    
    .bet-detail-name {
      flex: 1;
      color: #000 !important;
    }
    
    .bet-detail-content {
      margin-top: 1.5mm;
    }
    
    .bet-detail-info {
      display: flex;
      justify-content: space-between;
      font-size: 9.5px;
      padding: 1mm 0;
      border-bottom: 1px dotted #ccc;
    }
    
    .bet-detail-info:last-child {
      border-bottom: none;
    }
    
    .bet-detail-label {
      font-weight: normal;
      color: #000 !important;
    }
    
    .bet-detail-value {
      font-weight: bold;
      color: #000 !important;
    }
    
    .bet-detail-result {
      margin-top: 1mm;
      padding-top: 1.5mm;
      border-top: 1px dashed #999;
    }
    
    .bet-won .bet-detail-value {
      color: #000 !important;
    }
    
    .bet-lost .bet-detail-value {
      color: #000 !important;
    }
    
    .bet-detail-gain {
      margin-top: 1mm;
      padding-top: 1.5mm;
      border-top: 2px solid #000;
    }
    
    .bet-gain-highlight {
      font-size: 11px;
      color: #000 !important;
    }

    /* Section Montant améliorée */
    .payout-amount {
      text-align: center;
      margin: 4mm 0;
      border: 3px solid #000;
      border-radius: 4px;
      padding: 4mm 2mm;
      background: #fff;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .payout-amount-label {
      font-size: 10px;
      margin-bottom: 3mm;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #000 !important;
    }

    .payout-amount-value {
      font-size: 20px;
      font-weight: bold;
      color: #000 !important;
      line-height: 1.2;
    }

    /* Détails des paris */
    h3 {
      font-size: 11px;
      margin: 3mm 0 1.5mm 0;
      text-align: left;
      font-weight: bold;
      border-bottom: 1px solid #000;
      padding-bottom: 1mm;
    }

    /* Informations gagnant améliorées */
    .winner-info {
      border: 2px solid #006600;
      padding: 3mm;
      font-size: 11px;
      margin: 4mm 0;
      border-radius: 3px;
      background: #e8f5e9;
      text-align: center;
    }
    
    .winner-info strong {
      display: block;
      margin-bottom: 2mm;
      font-size: 10px;
      text-transform: uppercase;
      color: #000 !important;
    }

    /* Ligne séparatrice */
    .divider {
      border-top: 1px solid #000;
      margin: 2.5mm 0;
    }

    /* Pied de page */
    .footer {
      text-align: center;
      font-size: 9px;
      margin-top: 4mm;
      line-height: 1.4;
    }

    /* Impression stricte */
    @media print {
      @page {
        size: 55mm auto;
        margin: 0;
      }
      body {
        width: 49mm; /* laisse ~3mm de marge de sécurité de chaque côté */
        padding: 4mm 3mm;
        font-size: 11px;
      }
    }
  </style>
</head>

<body>
  <div class="payout-container">
    <div class="header">
      <h2>💵 DECAISSEMENT</h2>
      <div class="header-info">
        <div class="info-line">
          <span class="info-label">Ticket:</span>
          <span>#${receipt.id}</span>
        </div>
        <div class="info-line">
          <span class="info-label">Tour:</span>
          <span>#${round.id}</span>
        </div>
        <div class="info-line">
          <span class="info-label">Date:</span>
          <span>${escapeHtml(createdTime)}</span>
        </div>
      </div>
    </div>

    <hr class="divider">

    <div class="status-box ${hasWon ? 'won' : 'lost'}">
      ${hasWon ? '🎉 TICKET GAGNANT 🎉' : '❌ TICKET PERDANT'}
    </div>

    <div class="info-line info-total">
      <span class="info-label">Mise totale:</span>
      <span class="info-value">${totalMise.toFixed(2)} HTG</span>
    </div>

    <h3>Détail des paris</h3>
    ${betsDetailHTML}

    ${hasWon ? `
    <div class="winner-info">
      <strong>Gagnant de la course :</strong><br>
      ${escapeHtml(winnerName)}
    </div>` : ''}

    <div class="payout-amount">
      <div class="payout-amount-label">MONTANT DU DECAISSEMENT</div>
      <div class="payout-amount-value">${payoutAmountComputed.toFixed(2)} HTG</div>
    </div>

    <hr class="divider">

    <div class="info-line">
      <span class="info-label">Statut du paiement :</span>
      <span>${receipt.isPaid ? 'Payé' : 'En attente'}</span>
    </div>

    ${receipt.isPaid && receipt.paid_at ? `
    <div class="info-line">
      <span class="info-label">Date de paiement :</span>
      <span>${new Date(receipt.paid_at).toLocaleString('fr-FR')}</span>
    </div>` : ''}

    <hr class="divider">

    <div class="footer">
      <p>Ce document prouve le résultat du ticket.<br>Conservez-le comme justificatif.</p>
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
      // ✅ OBLIGATOIRE: round_id doit être défini (round actuel)
      receipt.roundId = gameState.currentRound.id;
      receipt.round_id = gameState.currentRound.id;
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
          // calculer total_amount (somme des mises en valeur publique)
          const totalAmount = (receipt.bets || []).reduce((sum, b) => sum + (Number(b.value) || 0), 0);
          
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
        // Calculer totalAmount en valeur publique pour le frontend
        const totalAmountPublic = (receipt.bets || []).reduce((sum, b) => {
          const valueSystem = Number(b.value || 0);
          return sum + (valueSystem / 100); // Conversion système -> publique
        }, 0);

        // Formater les bets pour le frontend
        const formattedBets = (receipt.bets || []).map(bet => ({
          number: bet.number || bet.participant?.number,
          value: (Number(bet.value || 0) / 100).toFixed(2), // Valeur publique
          participant: bet.participant || {
            number: bet.number,
            name: bet.participant?.name || '',
            coeff: bet.participant?.coeff || 0
          }
        }));

        broadcast({
          event: "receipt_added",
          receipt: JSON.parse(JSON.stringify(receipt)),
          receiptId: receipt.id,
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
                              gameState.currentRound.participants.some(p => p.place === 1);
            const isRaceFinished = gameState.raceEndTime !== null ||
                                   (gameState.raceStartTime !== null && !gameState.isRaceRunning && hasWinner);
            if (isRaceFinished) {
              console.warn(`[DELETE] Receipt ${id} deletion denied because race is finished (isRaceFinished=${isRaceFinished})`);
              return res.status(400).json({ error: "Impossible d'annuler un ticket une fois la course terminée avec résultats", reason: "race_finished", isRaceFinished, receiptId: id });
            }

            // Supprimer le ticket en base si le ticket existe et appartient au round courant
            try {
              // Supprimer les bets associés au ticket (cascade)
              await pool.query("DELETE FROM bets WHERE receipt_id = $1", [id]);
              console.log(`[DB] Bets associés au ticket ${id} supprimés en base (fallback)`);
              
              // Puis supprimer le ticket lui-même
              await pool.query("DELETE FROM receipts WHERE receipt_id = $1", [id]);
              console.log(`[DB] Receipt ${id} supprimé en base (fallback) + bets associés`);

              // ✅ CORRECTION: Mettre à jour le cache Redis
              await deleteTicketFromRoundCache(gameState.currentRound.id, id);

              // Mettre à jour l'état en mémoire (au cas où une entrée correspondante existerait)
              // Décrémenter totalPrize si le ticket avait un prize
              const prizeValue = dbReceipt.prize ? Number(dbReceipt.prize) : 0;
              if (prizeValue) {
                gameState.currentRound.totalPrize = Math.max(0, (gameState.currentRound.totalPrize || 0) - prizeValue);
              }
              gameState.currentRound.receipts = (gameState.currentRound.receipts || []).filter(r => r.id !== id);

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

              return res.json(wrap({ success: true }));
            } catch (delErr) {
              console.error('[DB] Erreur lookup/delete receipt fallback:', delErr);
              return res.status(500).json({ error: 'Erreur serveur lors de la suppression' });
            }
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
                        gameState.currentRound.participants.some(p => p.place === 1);

      const isRaceFinished = gameState.raceEndTime !== null ||
                             (gameState.raceStartTime !== null && !gameState.isRaceRunning && hasWinner);

      // Bloquer l'annulation uniquement si la course est réellement terminée
      if (isRaceFinished) {
        return res.status(400).json({
          error: "Impossible d'annuler un ticket une fois la course terminée avec résultats"
        });
      }

      // Supprimer le ticket du round actuel en mémoire
      // Calculer prize à retirer si présent
      if (receipt && receipt.prize) {
        gameState.currentRound.totalPrize = Math.max(0, (gameState.currentRound.totalPrize || 0) - Number(receipt.prize));
      }

      gameState.currentRound.receipts = (gameState.currentRound.receipts || []).filter(r => r.id !== id);

      // Supprimer également en base (s'il existe) - Receipt et ses Bets associés
      try {
        // Supprimer les bets associés au ticket (cascade)
        await pool.query("DELETE FROM bets WHERE receipt_id = $1", [id]);
        console.log(`[DB] Bets associés au ticket ${id} supprimés en base`);
        
        // Puis supprimer le ticket lui-même
        await pool.query("DELETE FROM receipts WHERE receipt_id = $1", [id]);
        console.log(`[DB] Receipt ${id} supprimé en base (memo->db) + bets associés`);
        
        // ✅ CORRECTION: Mettre à jour le cache Redis
        await deleteTicketFromRoundCache(gameState.currentRound.id, id);
      } catch (e) {
        console.warn('[DB] Échec suppression receipt en base (memo->db) pour id', id, e && e.message);
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