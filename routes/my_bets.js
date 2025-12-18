// my_bets.js

import express from "express";
import { gameState, wrap } from "../game.js";
import { systemToPublic } from "../utils.js";
import { pool } from "../config/db.js";
import { getReceiptsByUser, getBetsByReceipt, getBetsByReceiptsBatch, getReceiptById } from "../models/receiptModel.js";
import { createPayment as dbCreatePayment, updatePaymentStatus as dbUpdatePaymentStatus } from "../models/paymentModel.js";
import { updateReceiptStatus as dbUpdateReceiptStatus } from "../models/receiptModel.js";
import { cacheResponse } from "../middleware/cache.js";

/**
 * Crée le routeur pour "my-bets" (Mes Paris).
 * @param {function} broadcast - La fonction de diffusion WebSocket (optionnelle).
 * @returns {express.Router}
 */
export default function createMyBetsRouter(broadcast) {
  const router = express.Router();

/**
 * Formate un ticket (receipt) pour la réponse API "my-bets".
 * Calcule le montant total, la cote moyenne, et le gain potentiel.
 */
function formatTicket(receipt, roundId, defaultStatus = 'pending', isRoundFinished = false) {
  let totalAmount = 0;
  let totalCoeff = 0;
  let totalPotentialWinnings = 0;
  const betCount = receipt.bets?.length || 0;
  const isMultibet = betCount > 1;

  if (betCount > 0) {
    receipt.bets.forEach(bet => {
      // Les valeurs bet.value sont en système (×100), convertir en publique pour l'affichage
      const miseSystem = parseFloat(bet.value) || 0;
      const misePublic = systemToPublic(miseSystem);
      const coeff = parseFloat(bet.participant?.coeff) || 1; // 1 pour éviter division par 0
      
      totalAmount += misePublic;
      totalCoeff += coeff;
      // Calcul en système puis conversion en publique pour cohérence
      totalPotentialWinnings += systemToPublic(miseSystem * coeff);
    });
  }

  // Détermine le statut final
  let status = defaultStatus;
  
  // ✅ CORRECTION: Vérifier le statut depuis la DB en priorité (notamment "cancelled")
  if (receipt.status === 'cancelled') {
    status = 'cancelled';
  } else if (receipt.isPaid === true) {
    status = 'paid';
  } else if (defaultStatus === 'pending' && isRoundFinished) {
    // Le round est terminé, on peut déterminer le statut basé sur le prize
    // Le prize est en système, convertir en publique pour la comparaison
    const prizePublic = systemToPublic(receipt.prize || 0);
    status = (prizePublic > 0) ? 'won' : 'lost';
  } else if (defaultStatus !== 'pending') {
    // Pour les tickets de l'historique, le 'prize' est déjà calculé (en système)
    const prizePublic = systemToPublic(receipt.prize || 0);
    status = (prizePublic > 0) ? 'won' : 'lost';
  }
  // Sinon, le statut reste 'pending' (round actuel non terminé)

  return {
    id: receipt.id,
    date: receipt.created_time || new Date().toISOString(),
    roundId: roundId,
    totalAmount: totalAmount, // Valeur publique (convertie)
    // Pour un ticket simple, exposer la cote; pour un multibet, ne PAS calculer/afficher une cote moyenne
    avgCoeff: isMultibet ? null : (betCount > 0 ? (totalCoeff / betCount) : 0),
    // Pour l'UX, éviter d'afficher un gain combiné pour les multibets. potentialWinnings vaut pour les tickets simples.
    potentialWinnings: isMultibet ? null : totalPotentialWinnings, // Valeur publique (convertie) ou null pour multibet
    status: status,
    prize: systemToPublic(receipt.prize || 0), // Convertir prize de système à publique
    isPaid: receipt.isPaid || false,
    paidAt: receipt.paid_at || null,
    isInCurrentRound: defaultStatus === 'pending' && !isRoundFinished, // Indique si le ticket est dans le round actuel non terminé
    isMultibet: isMultibet,
    bets: receipt.bets || [] // Inclure les bets pour le rebet
  };
}

// GET /api/v1/my-bets/:id - Récupérer un ticket spécifique avec ses bets
// IMPORTANT: Cette route doit être définie AVANT la route GET "/" pour éviter les conflits
router.get("/:id", async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    
    if (isNaN(ticketId)) {
      return res.status(400).json({ error: "ID de ticket invalide" });
    }

    // Chercher dans le round actuel
    let receipt = gameState.currentRound.receipts.find(r => r.id === ticketId);
    let roundId = gameState.currentRound.id;
    let isRoundFinished = gameState.raceEndTime !== null || 
                         (gameState.raceStartTime !== null && !gameState.isRaceRunning && 
                          Array.isArray(gameState.currentRound.participants) && 
                          gameState.currentRound.participants.some(p => p.place === 1));
    
    // Si pas trouvé, chercher dans l'historique
    if (!receipt) {
      // Rechercher en base si disponible
      try {
        const dbReceipt = await getReceiptById(ticketId);
        if (dbReceipt) {
          // charger les bets
          const dbBets = await getBetsByReceipt(ticketId);
          // normaliser la forme attendue - INCLURE LE NUMBER dans participant!
          dbReceipt.bets = dbBets.map(b => ({ 
            number: b.participant_number, 
            value: b.value, 
            participant: { 
              number: b.participant_number,  // ✅ IMPORTANT: Ajouter number
              name: b.participant_name, 
              coeff: b.coefficient 
            } 
          }));
          receipt = dbReceipt;
          roundId = dbReceipt.round_id;
          isRoundFinished = dbReceipt.status !== 'pending';
        } else {
          for (const historicalRound of gameState.gameHistory) {
            receipt = (historicalRound.receipts || []).find(r => r.id === ticketId);
            if (receipt) {
              roundId = historicalRound.id;
              isRoundFinished = true;
              break;
            }
          }
        }
      } catch (err) {
        console.error('Erreur DB getReceiptById:', err);
      }
    }

    if (!receipt) {
      return res.status(404).json({ error: "Ticket non trouvé" });
    }

    const ticket = formatTicket(receipt, roundId, isRoundFinished ? 'historical' : 'pending', isRoundFinished);
    
    return res.json(wrap(ticket));

  } catch (error) {
    console.error("Erreur sur /api/v1/my-bets/:id:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/v1/my-bets/
router.get("/", cacheResponse(30), async (req, res) => {
  try {
    // 1. Récupérer les filtres de la requête
    const {
      page = 1,
      limit = 10,
      date,
      status,
      searchId
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // ✅ CORRECTION: Extraire user_id depuis req.user (JWT) en priorité
    // req.user est disponible car la route est protégée par verifyToken
    const userId = req.user?.userId || (req.query.user_id ? parseInt(req.query.user_id, 10) : null);

    // If user_id is available, read directly from DB instead of gameState
    if (userId) {
      try {
        const dbLimit = parseInt(limit, 10) || 50;
        const dbReceipts = await getReceiptsByUser(userId, dbLimit);
        const receiptIds = dbReceipts.map(r => r.receipt_id);
        
        // OPTIMISATION: Fetch tous les bets en une seule query au lieu de N queries
        const allBets = receiptIds.length > 0 ? await getBetsByReceiptsBatch(receiptIds) : [];
        const betsByReceipt = {};
        allBets.forEach(bet => {
          if (!betsByReceipt[bet.receipt_id]) betsByReceipt[bet.receipt_id] = [];
          betsByReceipt[bet.receipt_id].push(bet);
        });
        
        const ticketsFromDb = dbReceipts.map(r => {
          const bets = betsByReceipt[r.receipt_id] || [];
          const totalAmountPublic = systemToPublic(Number(r.total_amount) || 0);
          const prizePublic = systemToPublic(Number(r.prize) || 0);
          
          let avgCoeff = 0;
          let potentialWinnings = 0;
          if (bets && bets.length === 1) {
            avgCoeff = Number(bets[0].coefficient) || 0;
            const betValuePublic = systemToPublic(Number(bets[0].value) || 0);
            potentialWinnings = betValuePublic * avgCoeff;
          }
          
          return {
            id: r.receipt_id,
            date: r.created_at ? r.created_at.toISOString() : new Date().toISOString(),
            roundId: r.round_id,
            totalAmount: totalAmountPublic,
            avgCoeff: (bets || []).length > 1 ? null : avgCoeff,
            potentialWinnings: (bets || []).length > 1 ? null : potentialWinnings,
            status: r.status,
            prize: prizePublic,
            isPaid: r.status === 'paid',
            paidAt: r.paid_at || null,
            isInCurrentRound: false,
            isMultibet: (bets || []).length > 1,
            bets: (bets || []).map(b => ({ 
              number: b.participant_number, 
              value: systemToPublic(Number(b.value) || 0),
              participant: { name: b.participant_name, coeff: Number(b.coefficient) || 0 } 
            }))
          };
        });

        const allTickets = ticketsFromDb.sort((a,b) => new Date(b.date) - new Date(a.date));
        const totalItems = allTickets.length;
        const startIndex = (pageNum -1)*limitNum;
        const paginatedTickets = allTickets.slice(startIndex, startIndex + limitNum);
        const stats = { totalBetAmount: allTickets.reduce((s,t)=>s+t.totalAmount,0), potentialWinnings: 0, activeTicketsCount: paginatedTickets.filter(t=>t.status==='pending').length, winRate:0, paidWinnings: allTickets.filter(t=>t.status==='paid').reduce((s,t)=>s+t.prize,0), pendingPayments: allTickets.filter(t=>t.status==='won').reduce((s,t)=>s+t.prize,0) };
        return res.json(wrap({ pagination: { currentPage: pageNum, totalPages: Math.ceil(totalItems/limitNum), totalItems, limit: limitNum, displayedRange: `${startIndex+1}-${startIndex+paginatedTickets.length}` }, stats, tickets: paginatedTickets }));
      } catch (err) {
        console.error('Erreur DB getReceiptsByUser:', err);
        // fallback to in-memory below
      }
    }

    // 2. Si aucun user_id, retourner une erreur (sécurité: ne pas exposer tous les tickets)
    // ✅ CORRECTION: Permettre aux admins/cashiers de voir tous les tickets si nécessaire
    // Pour l'instant, on exige user_id pour la sécurité
    if (!userId) {
      return res.status(400).json({ 
        error: "user_id requis pour récupérer les tickets",
        code: "USER_ID_REQUIRED"
      });
    }

    // 3. Agréger tous les tickets (DB + en mémoire pour les tickets en cours non encore persistés)
    let allTickets = [];

    // IMPORTANT: Charger d'abord les tickets depuis la DB pour avoir les statuts les plus à jour
    // ✅ CORRECTION: Filtrer par user_id pour la sécurité
    try {
      const allDbReceipts = await pool.query(
        `SELECT r.*, 
                COUNT(b.bet_id) as bet_count
         FROM receipts r 
         LEFT JOIN bets b ON r.receipt_id = b.receipt_id 
         WHERE r.user_id = $1
         GROUP BY r.receipt_id 
         ORDER BY r.created_at DESC`,
        [userId]
      );
      
      for (const dbReceipt of allDbReceipts.rows) {
        const bets = await getBetsByReceipt(dbReceipt.receipt_id);
        
        // Convertir total_amount de système à publique
        const totalAmountPublic = systemToPublic(Number(dbReceipt.total_amount) || 0);
        // Convertir prize de système à publique
        const prizePublic = systemToPublic(Number(dbReceipt.prize) || 0);
        
        // Calculer potentialWinnings et avgCoeff à partir des bets
        let avgCoeff = 0;
        let potentialWinnings = 0;
        if (bets && bets.length === 1) {
          avgCoeff = Number(bets[0].coefficient) || 0;
          // Convertir value de système à publique, puis calculer le gain
          const betValuePublic = systemToPublic(Number(bets[0].value) || 0);
          potentialWinnings = betValuePublic * avgCoeff;
        }
        
        const formattedTicket = {
          id: dbReceipt.receipt_id,
          date: dbReceipt.created_at ? dbReceipt.created_at.toISOString() : new Date().toISOString(),
          roundId: dbReceipt.round_id,
          totalAmount: totalAmountPublic,
          status: dbReceipt.status, // Récupérer directement depuis la DB
          prize: prizePublic,
          isPaid: dbReceipt.status === 'paid',
          paidAt: dbReceipt.paid_at || null,
          isInCurrentRound: false,
          isMultibet: (bets || []).length > 1,
          avgCoeff: (bets || []).length > 1 ? null : avgCoeff,
          potentialWinnings: (bets || []).length > 1 ? null : potentialWinnings,
          bets: (bets || []).map(b => ({ 
            number: b.participant_number, 
            value: systemToPublic(Number(b.value) || 0), // Convertir value de système à publique
            participant: { name: b.participant_name, coeff: Number(b.coefficient) || 0 } 
          }))
        };
        allTickets.push(formattedTicket);
      }
    } catch (err) {
      console.error('[DB] Erreur chargement tickets depuis DB:', err.message);
      // Fallback: utiliser gameState si DB échoue
    }

    // Si la DB n'a rien retourné, fallback sur gameState (filtrer par user_id)
    if (allTickets.length === 0) {
      const hasWinner = Array.isArray(gameState.currentRound.participants) && 
                       gameState.currentRound.participants.some(p => p.place === 1);
      
      const isRoundFinished = gameState.raceEndTime !== null || 
                              (gameState.raceStartTime !== null && !gameState.isRaceRunning && hasWinner);
      
      // ✅ CORRECTION: Filtrer par user_id dans gameState aussi
      const pendingTickets = (gameState.currentRound.receipts || [])
        .filter(r => !r.user_id || r.user_id === userId)
        .map(r => {
          const ticket = formatTicket(r, gameState.currentRound.id, 'pending', isRoundFinished);
          ticket.isRoundFinished = isRoundFinished;
          return ticket;
        });
      
      const historicalTickets = gameState.gameHistory.flatMap(round => 
        (round.receipts || [])
          .filter(r => !r.user_id || r.user_id === userId)
          .map(r => {
            const ticket = formatTicket(r, round.id, 'historical');
            ticket.isRoundFinished = true;
            return ticket;
          })
      );
      
      allTickets = [...pendingTickets, ...historicalTickets].sort((a, b) => 
        new Date(b.date) - new Date(a.date)
      );
    }    // 4. Appliquer les filtres
    let filteredTickets = allTickets;

    if (searchId) {
      filteredTickets = filteredTickets.filter(t => 
        t.id.toString().includes(searchId)
      );
    }

    if (status) {
      filteredTickets = filteredTickets.filter(t => t.status === status);
    }

    if (date) { // date est au format 'YYYY-MM-DD'
      filteredTickets = filteredTickets.filter(t => 
        t.date.startsWith(date) // Compare juste le début de la string ISO (ex: '2025-10-26')
      );
    }
    
    // 4. Calculer les statistiques (basées sur les filtres)
    const totalBetAmount = filteredTickets.reduce((sum, t) => sum + t.totalAmount, 0);
    const potentialWinnings = filteredTickets
      .filter(t => t.status === 'pending')
      .reduce((sum, t) => sum + (t.potentialWinnings || 0), 0);
    const activeTicketsCount = filteredTickets.filter(t => t.status === 'pending').length;
    
    const wonTickets = filteredTickets.filter(t => t.status === 'won').length;
    const lostTickets = filteredTickets.filter(t => t.status === 'lost').length;
    const winRate = (wonTickets + lostTickets > 0) 
      ? (wonTickets / (wonTickets + lostTickets)) 
      : 0;

    // Calculer les gains payés
    const paidWinnings = filteredTickets
      .filter(t => t.status === 'paid')
      .reduce((sum, t) => sum + t.prize, 0);
    const pendingPayments = filteredTickets
      .filter(t => t.status === 'won')
      .reduce((sum, t) => sum + t.prize, 0);

    const stats = {
      totalBetAmount,
      potentialWinnings,
      activeTicketsCount,
      winRate: (winRate * 100).toFixed(0), // En pourcentage
      paidWinnings,
      pendingPayments
    };

    // 5. Paginer les résultats
    const totalItems = filteredTickets.length;
    const totalPages = Math.ceil(totalItems / limitNum);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedTickets = filteredTickets.slice(startIndex, startIndex + limitNum);

    const pagination = {
      currentPage: pageNum,
      totalPages: totalPages,
      totalItems: totalItems,
      limit: limitNum,
      displayedRange: `${startIndex + 1}-${startIndex + paginatedTickets.length}`
    };

    // 6. Envoyer la réponse
    return res.json(wrap({
      pagination,
      stats,
      tickets: paginatedTickets
    }));

  } catch (error) {
    console.error("Erreur sur /api/v1/my-bets/:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// POST /api/v1/my-bets/pay/:id - Marquer un ticket comme payé
router.post("/pay/:id", async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    
    if (isNaN(ticketId)) {
      return res.status(400).json({ error: "ID de ticket invalide" });
    }

    // Chercher le ticket en base de données (pas en mémoire)
    let receipt = null;
    try {
      receipt = await getReceiptById(ticketId);
    } catch (err) {
      console.warn('[DB] Erreur lookup receipt:', err.message);
    }

    if (!receipt) {
      return res.status(404).json({ error: "Ticket non trouvé" });
    }

    // Vérifier que le ticket n'est pas déjà payé
    if (receipt.status === 'paid') {
      return res.status(400).json({ error: "Ce ticket a déjà été payé" });
    }

    // Vérifier que le ticket a gagné (statut 'won' ou prize > 0)
    if (receipt.status !== 'won' && (!receipt.prize || receipt.prize <= 0)) {
      return res.status(400).json({ error: "Ce ticket n'a pas gagné, aucun paiement à effectuer" });
    }
    
    let prize = receipt.prize || 0;

    console.log(`💰 Ticket #${ticketId} marqué comme payé (gain: ${prize} HTG)`);

    // Notifier via WebSocket
    if (broadcast) {
      broadcast({
        event: "receipt_paid",
        receiptId: ticketId,
        prize: prize,
        paidAt: new Date().toISOString(),
        roundId: receipt.round_id || null
      });
    }

    // Persister le paiement en base
    try {
      await dbCreatePayment({ receipt_id: ticketId, user_id: receipt.user_id || null, amount: prize || 0, method: 'cash', status: 'completed' });
      // Mettre à jour le statut du receipt en base
      await dbUpdateReceiptStatus(ticketId, 'paid', prize || 0);
    } catch (err) {
      console.error('[DB] Erreur lors de la création du paiement :', err);
    }

    return res.json(wrap({
      success: true,
      ticketId: ticketId,
      prize: prize || 0,
      paidAt: new Date().toISOString()
    }));

  } catch (error) {
    console.error("Erreur sur /api/v1/my-bets/pay/:id:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

  return router;
}
