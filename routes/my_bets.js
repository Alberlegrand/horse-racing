// my_bets.js

import express from "express";
import { gameState, wrap } from "../game.js";
import { systemToPublic } from "../utils.js";

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
  
  // IMPORTANT: Pour les tickets du round actuel, ne déterminer le statut que si le round est terminé
  if (defaultStatus === 'pending' && isRoundFinished) {
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
  
  // Si le ticket est payé, mettre à jour le statut
  if (receipt.isPaid === true) {
    status = 'paid';
  }
  
  // (Note: 'cancelled' n'est pas géré par la logique actuelle)

  return {
    id: receipt.id,
    date: receipt.created_time || new Date().toISOString(),
    roundId: roundId,
    totalAmount: totalAmount, // Valeur publique (convertie)
    avgCoeff: (betCount > 0) ? (totalCoeff / betCount) : 0,
    potentialWinnings: totalPotentialWinnings, // Valeur publique (convertie)
    status: status,
    prize: systemToPublic(receipt.prize || 0), // Convertir prize de système à publique
    isPaid: receipt.isPaid || false,
    paidAt: receipt.paid_at || null,
    isInCurrentRound: defaultStatus === 'pending' && !isRoundFinished, // Indique si le ticket est dans le round actuel non terminé
    bets: receipt.bets || [] // Inclure les bets pour le rebet
  };
}

// GET /api/v1/my-bets/:id - Récupérer un ticket spécifique avec ses bets
// IMPORTANT: Cette route doit être définie AVANT la route GET "/" pour éviter les conflits
router.get("/:id", (req, res) => {
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
      for (const historicalRound of gameState.gameHistory) {
        receipt = (historicalRound.receipts || []).find(r => r.id === ticketId);
        if (receipt) {
          roundId = historicalRound.id;
          isRoundFinished = true;
          break;
        }
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
router.get("/", (req, res) => {
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

    // 2. Agréger tous les tickets (historique + en cours)
    let allTickets = [];

    // Tickets en cours (pending) - round actuel
    // IMPORTANT: Vérifier si le round est terminé pour déterminer correctement le statut
    // Un round est terminé SEULEMENT si la course a été lancée ET terminée
    const hasWinner = Array.isArray(gameState.currentRound.participants) && 
                     gameState.currentRound.participants.some(p => p.place === 1);
    
    // Un round est terminé si :
    // 1. raceEndTime est défini (course lancée et terminée)
    // OU 2. La course a été lancée (raceStartTime !== null) ET n'est plus en cours ET il y a un gagnant
    // Cela garantit que les tickets restent en "pending" tant que la course n'a pas été lancée
    const isRoundFinished = gameState.raceEndTime !== null || 
                            (gameState.raceStartTime !== null && !gameState.isRaceRunning && hasWinner);
    
    const pendingTickets = (gameState.currentRound.receipts || []).map(r => {
      const ticket = formatTicket(r, gameState.currentRound.id, 'pending', isRoundFinished);
      ticket.isRoundFinished = isRoundFinished;
      return ticket;
    });
    
    // Tickets de l'historique (won/lost) - rounds terminés
    const historicalTickets = gameState.gameHistory.flatMap(round => 
      (round.receipts || []).map(r => {
        const ticket = formatTicket(r, round.id, 'historical');
        ticket.isRoundFinished = true; // Les rounds dans l'historique sont toujours terminés
        return ticket;
      })
    );
    
    // Fusionner et trier par date (plus récent en premier)
    allTickets = [...pendingTickets, ...historicalTickets].sort((a, b) => 
      new Date(b.date) - new Date(a.date)
    );

    // 3. Appliquer les filtres
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
      .reduce((sum, t) => sum + t.potentialWinnings, 0);
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
router.post("/pay/:id", (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    
    if (isNaN(ticketId)) {
      return res.status(400).json({ error: "ID de ticket invalide" });
    }

    // Chercher le ticket dans le round actuel
    let receipt = gameState.currentRound.receipts.find(r => r.id === ticketId);
    let foundInCurrentRound = true;
    
    // Si pas trouvé dans le round actuel, chercher dans l'historique
    if (!receipt) {
      foundInCurrentRound = false;
      for (const round of gameState.gameHistory) {
        receipt = (round.receipts || []).find(r => r.id === ticketId);
        if (receipt) break;
      }
    }

    if (!receipt) {
      return res.status(404).json({ error: "Ticket non trouvé" });
    }

    // Vérifier que le ticket a gagné (prize > 0)
    if (!receipt.prize || receipt.prize <= 0) {
      return res.status(400).json({ error: "Ce ticket n'a pas gagné, aucun paiement à effectuer" });
    }

    // Vérifier que le ticket n'est pas déjà payé
    if (receipt.isPaid === true) {
      return res.status(400).json({ error: "Ce ticket a déjà été payé" });
    }

    // Marquer comme payé
    receipt.isPaid = true;
    receipt.paid_at = new Date().toISOString();

    console.log(`💰 Ticket #${ticketId} marqué comme payé (gain: ${receipt.prize} HTG)`);

    // Notifier via WebSocket
    if (broadcast) {
      broadcast({
        event: "receipt_paid",
        receiptId: ticketId,
        prize: receipt.prize,
        paidAt: receipt.paid_at,
        roundId: foundInCurrentRound ? gameState.currentRound.id : null
      });
    }

    return res.json(wrap({
      success: true,
      ticketId: ticketId,
      prize: receipt.prize,
      paidAt: receipt.paid_at
    }));

  } catch (error) {
    console.error("Erreur sur /api/v1/my-bets/pay/:id:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

  return router;
}
