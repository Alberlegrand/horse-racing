import express from "express";
import { gameState, wrap } from "../game.js";

const router = express.Router();

/**
 * Formate un ticket (receipt) pour la réponse API "my-bets".
 * Calcule le montant total, la cote moyenne, et le gain potentiel.
 */
function formatTicket(receipt, roundId, defaultStatus = 'pending') {
  let totalAmount = 0;
  let totalCoeff = 0;
  let totalPotentialWinnings = 0;
  const betCount = receipt.bets?.length || 0;

  if (betCount > 0) {
    receipt.bets.forEach(bet => {
      const mise = parseFloat(bet.value) || 0;
      const coeff = parseFloat(bet.participant?.coeff) || 1; // 1 pour éviter division par 0
      
      totalAmount += mise;
      totalCoeff += coeff;
      totalPotentialWinnings += mise * coeff;
    });
  }

  // Détermine le statut final
  let status = defaultStatus;
  if (defaultStatus !== 'pending') {
    // Pour les tickets de l'historique, le 'prize' est déjà calculé
    status = (receipt.prize > 0) ? 'won' : 'lost';
  }
  
  // (Note: 'cancelled' n'est pas géré par la logique actuelle)

  return {
    id: receipt.id,
    date: receipt.created_time || new Date().toISOString(),
    roundId: roundId,
    totalAmount: totalAmount,
    avgCoeff: (betCount > 0) ? (totalCoeff / betCount) : 0,
    potentialWinnings: totalPotentialWinnings,
    status: status,
    prize: receipt.prize || 0
  };
}


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

    // Tickets en cours (pending)
    const pendingTickets = (gameState.currentRound.receipts || []).map(r => 
      formatTicket(r, gameState.currentRound.id, 'pending')
    );
    
    // Tickets de l'historique (won/lost)
    const historicalTickets = gameState.gameHistory.flatMap(round => 
      (round.receipts || []).map(r => formatTicket(r, round.id, 'historical'))
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

    const stats = {
      totalBetAmount,
      potentialWinnings,
      activeTicketsCount,
      winRate: (winRate * 100).toFixed(0) // En pourcentage
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

export default router;
