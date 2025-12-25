// routes/init.js - Endpoint d'initialisation optimisé

import express from "express";
import { gameState, wrap } from "../game.js";
import { ROUND_WAIT_DURATION_MS } from "../config/app.config.js";
import { pool } from "../config/db.js";
import { getBetsByReceiptsBatch } from "../models/receiptModel.js";
import { systemToPublic } from "../utils.js";

/**
 * Endpoint d'initialisation rapide du game
 * Retourne TOUTES les données nécessaires au démarrage en UNE SEULE requête
 * 
 * GET /api/v1/init/game
 * 
 * Response:
 * {
 *   round: { id, participants, status, ... },
 *   balance: { money, totalReceived, totalPayouts },
 *   tickets: [],
 *   timer: { timeLeft, totalDuration, ... },
 *   cacheTimestamp: Date.now()
 * }
 */

export default function createInitRouter() {
  const router = express.Router();

  // GET /api/v1/init/game - Charge TOUT en une seule requête
  router.get("/game", (req, res) => {
    const now = Date.now();
    
    // ✅ ZERO DB QUERIES - Toutes les données sont en mémoire
    const timeLeft = gameState.nextRoundStartTime ? Math.max(0, gameState.nextRoundStartTime - now) : 0;

    const initData = {
      // Round data
      round: {
        id: gameState.currentRound?.id,
        participants: gameState.currentRound?.participants || [],
        status: gameState.isRaceRunning ? 'running' : 'waiting',
        isRaceRunning: gameState.isRaceRunning,
        raceStartTime: gameState.raceStartTime,
        raceEndTime: gameState.raceEndTime,
      },

      // Timer data
      timer: {
        timeLeft: Math.max(0, timeLeft),
        totalDuration: ROUND_WAIT_DURATION_MS,
        serverTime: now,
        percentage: 100 - (timeLeft / ROUND_WAIT_DURATION_MS) * 100
      },

      // Receipt data (from memory)
      tickets: gameState.currentRound?.receipts || [],

      // Game state flags
      isRaceRunning: gameState.isRaceRunning,
      nextRoundStartTime: gameState.nextRoundStartTime,

      // Cache information for client-side
      cacheTimestamp: now,
      source: 'memory'  // Tell client data comes from memory (instant)
    };

    // ✅ Cache headers
    res.set('Cache-Control', 'public, max-age=2');
    res.set('X-Data-Source', 'memory-single-request');
    res.set('X-Response-Time', `${Date.now() - now}ms`);

    return res.json(wrap(initData));
  });

  // GET /api/v1/init/dashboard - Optimized cashier dashboard init
  router.get("/dashboard", async (req, res) => {
    const now = Date.now();
    const currentRoundId = gameState.currentRound?.id;

    // ✅ CRITIQUE: Récupérer les tickets depuis gameState ET depuis la DB
    // Cela garantit que les tickets sont toujours visibles même après un refresh
    let allTickets = [];
    const ticketsFromMemory = gameState.currentRound?.receipts || [];
    const ticketsFromDb = [];

    // ✅ ÉTAPE 1: Récupérer depuis gameState (mémoire)
    console.debug(`[DASHBOARD-API] ${ticketsFromMemory.length} ticket(s) dans gameState pour round ${currentRoundId}`);
    
    // ✅ CRITIQUE: Filtrer les tickets avec statut "cancelled" avant formatage
    const validMemoryTickets = ticketsFromMemory.filter(receipt => receipt.status !== 'cancelled');
    
    // Formater les tickets depuis gameState (déjà filtrés pour exclure "cancelled")
    // ✅ CRITIQUE: gameState stocke TOUJOURS les valeurs en système (×100)
    const formattedMemoryTickets = validMemoryTickets.map(receipt => {
      // Calculer total_amount depuis bets si non présent (les bets sont en système)
      let total_amount = receipt.total_amount;
      if (!total_amount && Array.isArray(receipt.bets) && receipt.bets.length > 0) {
        total_amount = receipt.bets.reduce((sum, bet) => sum + (Number(bet.value) || 0), 0);
      }
      
      // ✅ CRITIQUE: Convertir TOUJOURS de système (×100) à publique pour l'affichage
      // gameState stocke toujours en système, donc on convertit toujours
      let totalAmountPublic = systemToPublic(total_amount || 0);
      totalAmountPublic = typeof totalAmountPublic === 'object' && totalAmountPublic.toNumber ? totalAmountPublic.toNumber() : Number(totalAmountPublic);
      
      let prizePublic = systemToPublic(receipt.prize || 0);
      prizePublic = typeof prizePublic === 'object' && prizePublic.toNumber ? prizePublic.toNumber() : Number(prizePublic);
      
      // ✅ CRITIQUE: Convertir les valeurs des bets de système à publique
      const formattedBets = (receipt.bets || []).map(bet => {
        const betValueSystem = Number(bet.value) || 0;
        const betValuePublic = systemToPublic(betValueSystem);
        return {
          ...bet,
          value: typeof betValuePublic === 'object' && betValuePublic.toNumber ? betValuePublic.toNumber() : Number(betValuePublic)
        };
      });
      
      return {
        id: receipt.id || receipt.receipt_id,
        receipt_id: receipt.id || receipt.receipt_id,
        round_id: receipt.round_id || receipt.roundId || currentRoundId,
        roundId: receipt.round_id || receipt.roundId || currentRoundId,
        status: receipt.status || 'pending',
        prize: prizePublic,
        total_amount: totalAmountPublic,
        bets: formattedBets,
        created_time: receipt.created_time || receipt.created_at || receipt.date,
        created_at: receipt.created_time || receipt.created_at || receipt.date,
        date: receipt.created_time || receipt.created_at || receipt.date,
        user_id: receipt.user_id || null,
        _source: 'memory' // Marquer la source
      };
    });

    // ✅ ÉTAPE 2: Récupérer depuis la DB pour TOUS les rounds récents (pas seulement le round actuel)
    // ✅ CORRECTION CRITIQUE: Récupérer les tickets des rounds récents pour qu'ils restent visibles après la fin d'un round
    try {
      // Récupérer les tickets des 20 derniers rounds ou des dernières 24 heures
      // Cela garantit que les tickets restent visibles même après qu'un round se termine
      const dbReceiptsResult = await pool.query(
        `SELECT r.*, 
                COUNT(b.bet_id) as bet_count
         FROM receipts r 
         LEFT JOIN bets b ON r.receipt_id = b.receipt_id 
         WHERE r.status != 'cancelled'
           AND (r.round_id IN (
             SELECT round_id FROM rounds 
             ORDER BY created_at DESC 
             LIMIT 20
           ) OR r.created_at >= NOW() - INTERVAL '24 hours')
         GROUP BY r.receipt_id 
         ORDER BY r.created_at DESC
         LIMIT 200`,
        []
      );
      
      console.debug(`[DASHBOARD-API] ${dbReceiptsResult.rows.length} ticket(s) trouvé(s) en DB (tous rounds récents, cancelled exclus)`);
      
      if (dbReceiptsResult.rows.length > 0) {
        // ✅ CRITIQUE: Filtrer les tickets avec statut "cancelled" dès la récupération DB
        const validDbReceipts = dbReceiptsResult.rows.filter(r => r.status !== 'cancelled');
        
        // Récupérer tous les bets en batch pour ces tickets valides seulement
        const receiptIds = validDbReceipts.map(r => r.receipt_id);
        const allBets = await getBetsByReceiptsBatch(receiptIds);
        
        // Grouper les bets par receipt_id
        const betsByReceipt = {};
        allBets.forEach(bet => {
          if (!betsByReceipt[bet.receipt_id]) {
            betsByReceipt[bet.receipt_id] = [];
          }
          betsByReceipt[bet.receipt_id].push({
            number: bet.participant_number,
            value: bet.value,
            participant: {
              number: bet.participant_number,
              name: bet.participant_name,
              coeff: bet.coefficient
            }
          });
        });
        
        // Formater les tickets depuis la DB (déjà filtrés pour exclure "cancelled")
        for (const dbReceipt of validDbReceipts) {
          const bets = betsByReceipt[dbReceipt.receipt_id] || [];
          
          // ✅ CRITIQUE: Convertir TOUJOURS les valeurs système (×100) en valeurs publiques
          // La DB stocke TOUJOURS les valeurs en système (cents), il faut les convertir
          const totalAmountSystem = Number(dbReceipt.total_amount) || 0;
          const prizeSystem = Number(dbReceipt.prize) || 0;
          
          // Convertir en valeurs publiques
          const totalAmountPublic = systemToPublic(totalAmountSystem);
          const totalAmountPublicNum = typeof totalAmountPublic === 'object' && totalAmountPublic.toNumber ? totalAmountPublic.toNumber() : Number(totalAmountPublic);
          
          const prizePublic = systemToPublic(prizeSystem);
          const prizePublicNum = typeof prizePublic === 'object' && prizePublic.toNumber ? prizePublic.toNumber() : Number(prizePublic);
          
          // ✅ CRITIQUE: Convertir les valeurs des bets de système à publique
          const formattedBets = bets.map(bet => {
            const betValueSystem = Number(bet.value) || 0;
            const betValuePublic = systemToPublic(betValueSystem);
            return {
              ...bet,
              value: typeof betValuePublic === 'object' && betValuePublic.toNumber ? betValuePublic.toNumber() : Number(betValuePublic)
            };
          });
          
          ticketsFromDb.push({
            id: dbReceipt.receipt_id,
            receipt_id: dbReceipt.receipt_id,
            round_id: dbReceipt.round_id,
            roundId: dbReceipt.round_id,
            status: dbReceipt.status || 'pending',
            prize: prizePublicNum,
            total_amount: totalAmountPublicNum,
            bets: formattedBets,
            created_time: dbReceipt.created_at ? dbReceipt.created_at.toISOString() : new Date().toISOString(),
            created_at: dbReceipt.created_at ? dbReceipt.created_at.toISOString() : new Date().toISOString(),
            date: dbReceipt.created_at ? dbReceipt.created_at.toISOString() : new Date().toISOString(),
            user_id: dbReceipt.user_id || null,
            _source: 'database' // Marquer la source
          });
        }
      }
    } catch (dbErr) {
      console.error('[DASHBOARD-API] ❌ Erreur récupération DB:', dbErr);
      // Continuer avec les tickets de mémoire seulement
    }

    // ✅ ÉTAPE 3: Combiner les tickets en évitant les doublons
    // ✅ CRITIQUE: Exclure les tickets avec statut "cancelled" (tickets supprimés)
    // Cela garantit que les tickets annulés ne sont jamais inclus dans la réponse
    
    // Filtrer les tickets de la DB pour exclure ceux avec statut "cancelled"
    const validTicketsFromDb = ticketsFromDb.filter(t => t.status !== 'cancelled');
    
    // Les tickets de mémoire sont déjà filtrés (validMemoryTickets créé plus haut)
    // Utiliser les tickets de la DB comme source principale (plus à jour)
    // et ajouter ceux de mémoire qui ne sont pas encore en DB
    const ticketIdsFromDb = new Set(validTicketsFromDb.map(t => t.id));
    const uniqueMemoryTickets = formattedMemoryTickets.filter(t => !ticketIdsFromDb.has(t.id));
    
    allTickets = [...validTicketsFromDb, ...uniqueMemoryTickets];
    
    // Trier par date de création (plus récent en premier)
    allTickets.sort((a, b) => {
      const dateA = new Date(a.created_time || a.created_at || a.date || 0);
      const dateB = new Date(b.created_time || b.created_at || b.date || 0);
      return dateB - dateA;
    });

    console.debug(`[DASHBOARD-API] ✅ Total: ${allTickets.length} ticket(s) (${ticketsFromDb.length} DB + ${uniqueMemoryTickets.length} mémoire)`);

    // Get data from gameState (memory only - no DB)
    const dashboardData = {
      round: {
        id: currentRoundId,
        participants: gameState.currentRound?.participants || [],
        status: gameState.isRaceRunning ? 'running' : 'waiting'
      },
      
      tickets: allTickets,
      
      timer: {
        timeLeft: Math.max(0, gameState.nextRoundStartTime ? (gameState.nextRoundStartTime - now) : 0),
        totalDuration: ROUND_WAIT_DURATION_MS,
        serverTime: now
      },

      totalPrize: gameState.currentRound?.totalPrize || 0,
      cacheTimestamp: now,
      source: 'memory+db' // Indiquer que les données viennent de mémoire ET DB
    };

    res.set('Cache-Control', 'public, max-age=2');
    res.set('X-Data-Source', 'memory+db');

    return res.json(wrap(dashboardData));
  });

  return router;
}
