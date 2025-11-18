// routes/receipts.js

import express from "express";
import { gameState, wrap } from "../game.js";
import { escapeHtml, systemToPublic } from "../utils.js";

// Import ChaCha20 pour les IDs de reçus sécurisés
import { chacha20Random, chacha20RandomInt, initChaCha20 } from "../chacha20.js";
import crypto from 'crypto';
// DB models pour persistance des tickets
import { createReceipt as dbCreateReceipt, createBet as dbCreateBet } from "../models/receiptModel.js";
import { pool } from "../config/db.js";

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
            <h2>PARYAJ CHEVAL</h2>
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
    /* -------------------------------
       IMPRESSION 55MM - NOIR ET BLANC
       Lisible, centré, marges sûres
    -------------------------------- */
    * {
      box-sizing: border-box;
      background: #fff !important;
      color: #000 !important;
      font-family: 'Arial', sans-serif;
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

    /* En-tête */
    .header {
      text-align: center;
      margin-bottom: 3mm;
    }

    .header h2 {
      font-size: 14px;
      margin: 0;
      font-weight: bold;
    }

    .header p {
      font-size: 9px;
      margin: 2px 0;
    }

    /* Boîte de statut */
    .status-box {
      border: 1px solid #000;
      text-align: center;
      padding: 3px 0;
      margin: 3mm 0;
      font-size: 11px;
      font-weight: bold;
    }

    /* Lignes d’informations */
    .info-line {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dotted #000;
      padding: 1.2mm 0;
      font-size: 10px;
    }

    .info-label {
      font-weight: bold;
    }

    /* Section Montant */
    .payout-amount {
      text-align: center;
      margin: 3mm 0;
      border: 1px solid #000;
      border-radius: 3px;
      padding: 2mm 0;
    }

    .payout-amount-label {
      font-size: 9px;
      margin-bottom: 2px;
    }

    .payout-amount-value {
      font-size: 16px;
      font-weight: bold;
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

    /* Informations gagnant */
    .winner-info {
      border: 1px solid #000;
      padding: 2mm;
      font-size: 10px;
      margin: 3mm 0;
      border-radius: 2px;
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
      <h2>DECAISSEMENT</h2>
      <p>Ticket #${receipt.id} | Tour #${round.id}<br>${escapeHtml(createdTime)}</p>
    </div>

    <hr class="divider">

    <div class="status-box">
      ${hasWon ? '*** TICKET GAGNANT ***' : '*** TICKET PERDANT ***'}
    </div>

    <div class="info-line">
      <span class="info-label">Mise totale :</span>
      <span>${totalMise.toFixed(2)} HTG</span>
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
      // ✅ Vérification: Un ticket ne peut être créé QUE si un round est actif et prêt
      if (!gameState.currentRound || !gameState.currentRound.id) {
        console.warn("[SYNC] ❌ Impossible créer ticket: aucun round actif");
        return res.status(409).json({
          error: "Aucun round prêt. Veuillez attendre le prochain tirage.",
          code: "NO_ACTIVE_ROUND"
        });
      }

      // If the currentRound hasn't been persisted to DB yet, wait up to 5s for persistence.
      // This avoids creating receipts referencing a round that doesn't yet exist in DB
      // and prevents FK errors / nullable round fallback.
      const waitForPersist = async (timeoutMs = 5000, intervalMs = 100) => {
        const start = Date.now();
        while (!gameState.currentRound.persisted && (Date.now() - start) < timeoutMs) {
          await new Promise(r => setTimeout(r, intervalMs));
        }
        return !!gameState.currentRound.persisted;
      };

      const persisted = await waitForPersist(5000, 100);
      if (!persisted) {
        // If round still not persisted after waiting, reject the request so client can retry.
        console.warn('[DB] ❌ currentRound not persisted after wait - ask client to retry');
        return res.status(503).json({ error: 'Round not ready. Please retry in a moment.', code: 'ROUND_NOT_PERSISTED' });
      }

      const receipt = req.body;
      console.log("Ajout d'un nouveau ticket :", receipt);

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

      // --- Persistance en base de données (asynchrone, avec retry pour FK) ---
      (async () => {
        // Attendre que le round soit créé en DB (avec retry)
        const waitForRound = async (roundId, maxRetries = 50, delayMs = 100) => {
          for (let i = 0; i < maxRetries; i++) {
            try {
              const res = await pool.query("SELECT round_id FROM rounds WHERE round_id = $1 LIMIT 1", [roundId]);
              if (res.rows && res.rows[0]) {
                console.log(`[DB] ✓ Round ${roundId} trouvé en DB après ${i * delayMs}ms`);
                return true;
              }
            } catch (err) {
              console.error('[DB] Erreur lookup round:', err.message);
            }
            if (i < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
          console.warn(`[DB] ⚠️ Round ${roundId} non trouvé après ${maxRetries * delayMs}ms`);
          return false;
        };

        // Vérifier que le round existe avant de persister le receipt
        const roundExists = await waitForRound(gameState.currentRound.id);
        if (!roundExists) {
          console.warn('[DB] ⚠️ Round FK check failed, but continuing (will use nullable round_id)');
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
          // Créer le receipt en base (utilise receipt.id comme receipt_id si fourni)
          // Si le round n'a pas été trouvé en base, envoyer `null` pour round_id afin d'éviter
          // une violation de contrainte FK lorsque la table `rounds` n'a pas encore l'entrée.
          const dbRoundId = roundExists ? gameState.currentRound.id : null;

          // Retry loop: if insert fails with duplicate key, regenerate id and retry
          const MAX_INSERT_ATTEMPTS = 5;
          for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt++) {
            try {
              dbReceipt = await dbCreateReceipt({ round_id: dbRoundId, user_id: receipt.user_id || null, total_amount: totalAmount, status: isRaceFinished ? (receipt.prize > 0 ? 'won' : 'lost') : 'pending', prize: receipt.prize || 0, receipt_id: receipt.id });
              // If DB returned a canonical id, update in-memory receipt
              if (dbReceipt && (dbReceipt.receipt_id || dbReceipt.receipt_id === 0)) {
                receipt.id = dbReceipt.receipt_id || receipt.id;
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
              await pool.query("DELETE FROM receipts WHERE receipt_id = $1", [id]);
              console.log(`[DB] Receipt ${id} supprimé en base (fallback)`);

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

      // Supprimer également en base (s'il existe)
      try {
        await pool.query("DELETE FROM receipts WHERE receipt_id = $1", [id]);
        console.log(`[DB] Receipt ${id} supprimé en base (memo->db)`);
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