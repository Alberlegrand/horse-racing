// game.js

// Importer ChaCha20 RNG - cryptographiquement sécurisé pour les jeux d'argent
import { chacha20Random, chacha20RandomInt, chacha20Shuffle, initChaCha20 } from './chacha20.js';
import { pool } from './config/db.js';
import { getNextRoundNumber } from './utils/roundNumberManager.js';

// Initialiser ChaCha20 RNG au démarrage
initChaCha20();

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
    runningRoundData: null, // Sauvegarde de l'ancien round pendant qu'une course est en cours
};

function generateRoundId() {
    return Math.floor(96908000 + chacha20Random() * 1000);
}

// Simple helper pour envelopper les réponses
export function wrap(data) {
    return { data };
}

/**
 * Archive le tour terminé et en démarre un nouveau.
 * @param {function} broadcast - La fonction pour notifier les clients WebSocket.
 */
export async function startNewRound(broadcast) {
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
        // Evite la duplication accidentelle si un autre module a déjà archivé ce round
        if (!gameState.gameHistory.some(r => r.id === finishedRound.id)) {
            gameState.gameHistory.push(finishedRound);
        } else {
            console.warn(`startNewRound: round ${finishedRound.id} déjà présent dans gameHistory`);
        }

        // Garde seulement les 10 derniers tours
        if (gameState.gameHistory.length > 10) gameState.gameHistory.shift();
    }

    // 2️⃣ Prépare le nouveau tour
    const newRoundId = generateRoundId();
    const basePlaces = Array.from({ length: BASE_PARTICIPANTS.length }, (_, i) => i + 1);

    // Mélange Fisher-Yates avec ChaCha20 (cryptographiquement sécurisé)
    const shuffledPlaces = chacha20Shuffle(basePlaces);

    // !! IMPORTANT : On mute la propriété de l'objet gameState
    gameState.currentRound = {
        id: newRoundId,
        participants: BASE_PARTICIPANTS.map((p, i) => ({
            ...p,
            place: shuffledPlaces[i],
        })),
        receipts: [],
        lastReceiptId: 3,
        totalPrize: 0
    };
    // Mark as not yet persisted in DB. Will be toggled after insert completes.
    gameState.currentRound.persisted = false;

    console.log(`🚀 Nouveau tour #${gameState.currentRound.id} prêt à commencer !`);

    // Persister le round en base de données IMMÉDIATEMENT (dans une fonction async/await)
    const persistRound = async () => {
        try {
            const roundNum = getNextRoundNumber();
            const insertRes = await pool.query(
                `INSERT INTO rounds (round_id, round_number, status, created_at) 
                 VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
                 ON CONFLICT (round_id) DO NOTHING
                 RETURNING round_id`,
                [newRoundId, roundNum]
            );
            console.log(`✅ Round #${roundNum} (ID: ${newRoundId}) créé en DB immédiatement`);
            return true;
        } catch (err) {
            console.error('[DB] Erreur création round:', err);
            return false;
        }
    };
    // Await persistence so clients receive the new_round only after DB row exists.
    const persisted = await persistRound();
    gameState.currentRound.persisted = !!persisted;

    // 3️⃣ Démarre le timer de 2 minutes pour le prochain lancement
    // Le timer commence MAINTENANT, après que le client ait cliqué sur "new_game"
   // 3️⃣ Démarre le timer
    // CORRECTION ICI : On utilise Number() pour convertir la string du .env en nombre
    const envDuration = Number(process.env.ROUND_WAIT_DURATION_MS);
    // Si la conversion échoue (NaN) ou vaut 0, on utilise 180000 par défaut
    const ROUND_WAIT_DURATION_MS = (envDuration > 0) ? envDuration : 180000; 
    
    const now = Date.now();
    
    // Maintenant l'addition sera mathématique (Nombre + Nombre)
    gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;
    
    console.log(`⏰ Timer démarré : nouveau tour dans ${ROUND_WAIT_DURATION_MS / 1000} secondes (fin: ${new Date(gameState.nextRoundStartTime).toLocaleTimeString()})`);

    // Schedule a pre-start broadcast 5 seconds before the next round starts.
    const schedulePreStart = (broadcastFn) => {
        try {
            // Clear any previous pre-start timer
            if (gameState.preStartTimer) {
                clearTimeout(gameState.preStartTimer);
                gameState.preStartTimer = null;
            }
            const nowMs = Date.now();
            const preStartTimeMs = gameState.nextRoundStartTime - 5000; // 5s before
            const delay = preStartTimeMs - nowMs;
            const doBroadcast = () => {
                if (broadcastFn) {
                    broadcastFn({
                        event: 'pre_start',
                        roundId: newRoundId,
                        preStartAt: preStartTimeMs,
                        countdownMs: 5000
                    });
                }
            };
            if (delay <= 0) {
                // If less than 5s remains, broadcast immediately
                doBroadcast();
            } else {
                gameState.preStartTimer = setTimeout(doBroadcast, delay);
            }
        } catch (e) {
            console.error('[SCHED] Erreur schedulePreStart:', e && e.message ? e.message : e);
        }
    };

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
            // schedule the pre-start overlay broadcast 5s before the next round
            schedulePreStart(broadcast);
    } else {
        console.warn("startNewRound: 'broadcast' function non fournie.");
    }
}