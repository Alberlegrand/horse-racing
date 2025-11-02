// game.js

// Données de base
const BASE_PARTICIPANTS = [
    { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0 },
    { number: 7, name: "Ronaldo", coeff: 4.7, family: 1 },
    { number: 8, name: "Mbappe", coeff: 7.2, family: 2 },
    { number: 9, name: "Halland", coeff: 5.8, family: 3 },
    { number: 10, name: "Messi", coeff: 8.1, family: 4 },
    { number: 54, name: "Vinicius", coeff: 4.5, family: 5 }
];

// L'état est encapsulé dans un objet pour être partageable
export const gameState = {
    currentRound: {},
    gameHistory: [],
    nextRoundStartTime: null, // timestamp du prochain lancement de tour, null signifie qu'aucun minuteur n'est en cours (une course est active)
    timerInterval: null, // Intervalle pour les mises à jour du timer côté serveur
    autoLoopActive: false, // Flag pour éviter les boucles multiples
    raceStartTime: null, // Timestamp du début de la course actuelle (pour synchronisation)
    raceEndTime: null, // Timestamp de la fin de la course actuelle
    isRaceRunning: false, // Indique si une course est actuellement en cours
};

function generateRoundId() {
    return Math.floor(96908000 + Math.random() * 1000);
}

// Simple helper pour envelopper les réponses
export function wrap(data) {
    return { data };
}

/**
 * Archive le tour terminé et en démarre un nouveau.
 * @param {function} broadcast - La fonction pour notifier les clients WebSocket.
 */
export function startNewRound(broadcast) {
    console.log(`🏁 Fin du tour #${gameState.currentRound.id}. Archivage des résultats.`);

    // 1️⃣ Archive le tour complété
    if (gameState.currentRound.id) {
        const finishedRound = {
            id: gameState.currentRound.id,
            receipts: JSON.parse(JSON.stringify(gameState.currentRound.receipts || [])),
            participants: JSON.parse(JSON.stringify(gameState.currentRound.participants || [])),
            totalPrize: gameState.currentRound.totalPrize || 0,
            winner: (gameState.currentRound.participants || []).find(p => p.place === 1) || null,
        };
        gameState.gameHistory.push(finishedRound);

        // Garde seulement les 10 derniers tours
        if (gameState.gameHistory.length > 10) gameState.gameHistory.shift();
    }

    // 2️⃣ Prépare le nouveau tour
    const newRoundId = generateRoundId();
    const basePlaces = Array.from({ length: BASE_PARTICIPANTS.length }, (_, i) => i + 1);

    // Mélange Fisher-Yates
    for (let i = basePlaces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [basePlaces[i], basePlaces[j]] = [basePlaces[j], basePlaces[i]];
    }

    // !! IMPORTANT : On mute la propriété de l'objet gameState
    gameState.currentRound = {
        id: newRoundId,
        participants: BASE_PARTICIPANTS.map((p, i) => ({
            ...p,
            place: basePlaces[i],
        })),
        receipts: [],
        lastReceiptId: 3,
        totalPrize: 0
    };

    console.log(`🚀 Nouveau tour #${gameState.currentRound.id} prêt à commencer !`);

    // 3️⃣ Démarre le timer de 2 minutes pour le prochain lancement
    // Le timer commence MAINTENANT, après que le client ait cliqué sur "new_game"
    const ROUND_WAIT_DURATION_MS = 120000; // 2 minutes (120000 ms)
    const now = Date.now();
    gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;
    
    console.log(`⏰ Timer démarré : nouveau tour dans ${ROUND_WAIT_DURATION_MS / 1000} secondes (fin: ${new Date(gameState.nextRoundStartTime).toLocaleTimeString()})`);

    // 4️⃣ Notifie les clients (via la fonction passée en paramètre)
    if (broadcast) {
        broadcast({ 
            event: "new_round", 
            roundId: newRoundId,
            game: JSON.parse(JSON.stringify(gameState.currentRound)),
            currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
            timer: {
                timeLeft: ROUND_WAIT_DURATION_MS,
                totalDuration: ROUND_WAIT_DURATION_MS,
                startTime: now,
                endTime: gameState.nextRoundStartTime
            },
            nextRoundStartTime: gameState.nextRoundStartTime,
            isRaceRunning: false,
            raceStartTime: null,
            raceEndTime: null
        });
    } else {
        console.warn("startNewRound: 'broadcast' function non fournie.");
    }
}