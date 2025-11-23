// routes/rounds.js

import express from "express";
// On suppose que gameState est un objet partagé que nous pouvons modifier
import { gameState, startNewRound, wrap } from "../game.js";

// Import ChaCha20 pour la sécurité des positions
import { chacha20Random, chacha20RandomInt, chacha20Shuffle, initChaCha20 } from "../chacha20.js";

// Import cache middleware for performance
import { cacheResponse } from "../middleware/cache.js";

// Import des fonctions et constantes nécessaires pour créer un nouveau round
import { getParticipants, createRound, finishRound, getRoundsHistory, getRoundByNumber } from "../models/gameModel.js";

// Import pour mettre à jour le statut des tickets en DB quand la course se termine
import { updateReceiptStatus } from "../models/receiptModel.js";

// Import de pool pour persister les rounds en DB
import { pool } from "../config/db.js";

// Import du gestionnaire de numéro de round pour éviter les doublons
import { getNextRoundNumber } from "../utils/roundNumberManager.js";

const BASE_PARTICIPANTS = [
    { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0 },
    { number: 7, name: "Ronaldo", coeff: 4.7, family: 1 },
    { number: 8, name: "Mbappe", coeff: 7.2, family: 2 },
    { number: 9, name: "Halland", coeff: 5.8, family: 3 },
    { number: 10, name: "Messi", coeff: 8.1, family: 4 },
    { number: 54, name: "Vinicius", coeff: 4.5, family: 5 }
];

function generateRoundId() {
    return Math.floor(96908000 + chacha20Random() * 1000);
}

// --- CONFIGURATION ---
// La valeur fixe que vous voulez pour l'intervalle d'attente.
// Nous utilisons directement cette valeur (60000 ms = 2 minutes) et non un minuteur externe.
const ROUND_WAIT_DURATION_MS = parseInt(process.env.ROUND_WAIT_DURATION_MS) || 180000; // 3 minutes (60000 ms)
const MOVIE_SCREEN_DURATION_MS = 20000; // 20 secondes pour movie_screen
const FINISH_SCREEN_DURATION_MS = 5000; // 5 secondes pour finish_screen
const TOTAL_RACE_TIME_MS = MOVIE_SCREEN_DURATION_MS + FINISH_SCREEN_DURATION_MS; // 25 secondes total

// --- INITIALISATION DE L'ÉTAT ---
// Stocke le timestamp exact du début du prochain round.
if (typeof gameState.nextRoundStartTime === 'undefined') {
    // null signifie qu'aucun minuteur d'attente n'est en cours (une course est active)
    gameState.nextRoundStartTime = null; 
}


/**
 * Helper to trigger an automatic race finish and start the next round.
 * Called by the auto-loop or scheduled timer.
 */
let pendingAutoFinish = false;

async function triggerAutoFinish(broadcastFn) {
    if (pendingAutoFinish || gameState.isRaceRunning) {
        console.warn('[AUTO-FINISH] Déjà en cours ou course active, skip');
        return;
    }
    pendingAutoFinish = true;
    try {
        console.log('[AUTO-FINISH] Déclenchement du finish automatique');
        // Simulate the finish action by calling the embedded logic
        // This mimics what the finish route does
        const finishReq = { query: { action: 'finish' } };
        const finishRes = {
            json: (data) => console.log('[AUTO-FINISH] Response:', data),
            status: (code) => ({ json: (data) => console.log(`[AUTO-FINISH] Status ${code}:`, data) })
        };
        // Call the finish handler inline (would need to be extracted as a separate function)
        // For now, we'll just note that this needs the finish logic to be callable
        console.log('[AUTO-FINISH] Note: finish logic should be callable from here');
    } finally {
        pendingAutoFinish = false;
    }
}

/**
 * Crée le routeur pour les "rounds".
 * @param {function} broadcast - La fonction de diffusion WebSocket.
 * @returns {express.Router}
 */
export default function createRoundsRouter(broadcast) {
    const router = express.Router();

    // Petit cache de logging pour éviter d'écrire la même ligne de log plusieurs fois
    // (ex : plusieurs clients pollent l'API /rounds/ à intervalle très court)
    let lastLoggedMemoryRoundId = null;
    let lastLoggedDbRoundId = null;

    // Store the finish handler so we can call it from auto-start
    let finishHandler = null;

    // Helper: Extract the finish logic into a reusable function
    const executeFinish = async () => {
        console.log('[FINISH] Exécution du finish');
        
        // Marque le début de la course pour la synchronisation
        const raceStartTime = Date.now();
        gameState.isRaceRunning = true;
        gameState.raceStartTime = raceStartTime;
        gameState.raceEndTime = null;

        // Broadcast complet avec toutes les informations de synchronisation
        broadcast({ 
            event: "race_start", 
            roundId: gameState.currentRound.id,
            raceStartTime: raceStartTime,
            currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
            isRaceRunning: true
        });

        // IMPORTANT: La durée réelle du movie_screen côté client est ~20 secondes
        // On doit attendre 20 secondes avant d'envoyer race_end pour que movie_screen se termine
        const NEW_ROUND_PREPARE_DELAY_MS = 10000; // 10 secondes : créer le nouveau round pour permettre les paris
        
        // Créer le nouveau round après 10 secondes pour permettre aux caissiers de placer des paris
        // même si la course précédente continue
        setTimeout(async () => {
            console.log('🆕 Préparation du nouveau round (10s après le début de la course)');
            
            // Sauvegarder l'ancien round pour la fin de course
            const oldRoundId = gameState.currentRound.id;
            gameState.runningRoundData = JSON.parse(JSON.stringify(gameState.currentRound));
            
            // Créer le nouveau round maintenant
            const newRoundId = generateRoundId();
            const basePlaces = Array.from({ length: BASE_PARTICIPANTS.length }, (_, i) => i + 1);
            
            // Mélange Fisher-Yates avec ChaCha20 (cryptographiquement sécurisé)
            const shuffledPlaces = chacha20Shuffle(basePlaces);
            
            // Créer le nouveau round et le mettre dans currentRound (les nouveaux tickets iront dans ce round)
            const newRound = {
                id: newRoundId,
                participants: BASE_PARTICIPANTS.map((p, i) => ({
                    ...p,
                    place: shuffledPlaces[i],
                })),
            receipts: [],
            lastReceiptId: 3,
            totalPrize: 0,
            persisted: false  // Mark as not yet persisted in DB
        };
            
            // Remplacer currentRound par le nouveau round (les tickets iront maintenant dans le nouveau round)
            gameState.currentRound = newRound;

            // Persist this new round to DB BEFORE broadcasting so cashier can create tickets safely
            try {
                const roundNum = getNextRoundNumber();
                const insertRes = await pool.query(
                    `INSERT INTO rounds (round_id, round_number, status, created_at) 
                     VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
                     ON CONFLICT (round_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                     RETURNING round_id`,
                    [newRoundId, roundNum]
                );
                console.log(`✅ Round #${roundNum} (ID: ${newRoundId}) créé en DB (during race)`);
                gameState.currentRound.persisted = true;
            } catch (err) {
                console.error('[DB] Erreur création round (during race):', err);
                gameState.currentRound.persisted = false;
            }

            // Démarre le timer pour le prochain lancement
            const now = Date.now();
            gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;

            // Broadcast le nouveau round pour que les caissiers puissent commencer à placer des paris
            broadcast({
                event: "new_round",
                roundId: newRoundId,
                game: JSON.parse(JSON.stringify(newRound)),
                currentRound: JSON.parse(JSON.stringify(newRound)),
                timer: {
                    timeLeft: ROUND_WAIT_DURATION_MS,
                    totalDuration: ROUND_WAIT_DURATION_MS,
                    startTime: now,
                    endTime: gameState.nextRoundStartTime
                },
                nextRoundStartTime: gameState.nextRoundStartTime,
                isRaceRunning: true, // La course précédente continue
                raceStartTime: gameState.raceStartTime,
                raceEndTime: null
            });

            console.log(`✅ Nouveau round #${newRoundId} activé et disponible pour les paris (course précédente #${oldRoundId} continue)`);

            // Schedule automatic race start for this new round when its timer expires
            const autoStartDelay = gameState.nextRoundStartTime - Date.now();
            console.log(`[AUTO-START] Programmé pour démarrer dans ${autoStartDelay}ms`);

            // Store this scheduled timer so it can be cleared if needed
            if (gameState.nextRoundAutoStartTimer) {
                clearTimeout(gameState.nextRoundAutoStartTimer);
            }
            gameState.nextRoundAutoStartTimer = setTimeout(async () => {
                console.log(`[AUTO-START] ⏱️ Lancement automatique du round #${newRoundId}`);
                try {
                    const resp = await fetch('http://localhost:8080/api/v1/rounds/auto-finish', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    if (!resp.ok) {
                        console.error('[AUTO-START] Erreur auto-finish:', resp.status, resp.statusText);
                    }
                } catch (err) {
                    console.error('[AUTO-START] Erreur appel auto-finish:', err && err.message ? err.message : err);
                }
            }, autoStartDelay);
        }, NEW_ROUND_PREPARE_DELAY_MS);
        
        // Simule la durée de la course (20 secondes pour correspondre à movie_screen)
        setTimeout(async () => {
            // ... rest of the race finish logic (same as current)
            console.log('[FINISH] Continuation de la logique finish à T+20s');
            // NOTE: Le reste de la logique finish existante devrait continuer ici
        }, MOVIE_SCREEN_DURATION_MS);
    };
    
    // -----------------------------------------------------------------
    // --- API AJOUTÉE : POST /api/v1/rounds/auto-finish (internal) ---
    // -----------------------------------------------------------------
    /**
     * Endpoint interne pour déclencher le finish automatiquement.
     * Appelé par le serveur quand le timer du nouveau round expire.
     */
    router.post("/auto-finish", async (req, res) => {
        console.log('[AUTO-FINISH] Requête reçue');
        try {
            await executeFinish();
            res.json(wrap({ success: true, auto: true }));
        } catch (err) {
            console.error('[AUTO-FINISH] Erreur:', err && err.message ? err.message : err);
            res.status(500).json({ error: 'Erreur executeFinish' });
        }
    });

    // -----------------------------------------------------------------
    // --- API AJOUTÉE : GET /api/v1/rounds/launch-time ---
    // -----------------------------------------------------------------
    /**
     * Cet endpoint est la "Source de Vérité" pour le minuteur.
     * Il calcule le temps restant à partir du timestamp du futur lancement.
     */
    router.get("/launch-time", cacheResponse(10), (req, res) => {
        let timeLeft = 0;
        const now = Date.now();

        // Vérifie si un timestamp de départ est défini et qu'il est dans le futur
        if (gameState.nextRoundStartTime && gameState.nextRoundStartTime > now) {
            timeLeft = gameState.nextRoundStartTime - now;
        }

        console.log(`[API GET /launch-time] Temps restant : ${Math.round(timeLeft / 1000)}s`);

        res.json({
            // La seule valeur qui change est timeLeft
            timeLeft: Math.max(0, timeLeft), 
            // La durée totale d'attente est fixe
            delaiTotalAttente: ROUND_WAIT_DURATION_MS
        });
    });

    // -----------------------------------------------------------------
    // --- API AJOUTÉE : GET /api/v1/rounds/status ---
    // -----------------------------------------------------------------
    /**
     * Retourne l'état actuel du jeu pour la synchronisation au chargement de la page.
     * Permet de savoir quel écran afficher et le temps restant.
     */
    router.get("/status", cacheResponse(5), (req, res) => {
        const now = Date.now();
        const MOVIE_SCREEN_DURATION_MS = 25000; // 25 secondes pour movie_screen (correspond à la durée côté client)
        const FINISH_DURATION_MS = 5000; // 5 secondes pour finish_screen
        const TOTAL_RACE_TIME_MS = MOVIE_SCREEN_DURATION_MS + FINISH_DURATION_MS; // 25 secondes total

        let screen = "game_screen"; // Par défaut
        let timeRemaining = 0;
        let timeInRace = 0; // Temps écoulé depuis le début de la course

        // Vérifie si une course est en cours
        if (gameState.isRaceRunning && gameState.raceStartTime) {
            timeInRace = now - gameState.raceStartTime;
            
            if (timeInRace < MOVIE_SCREEN_DURATION_MS) {
                // Course en cours (movie_screen)
                screen = "movie_screen";
                timeRemaining = MOVIE_SCREEN_DURATION_MS - timeInRace;
            } else if (timeInRace < TOTAL_RACE_TIME_MS) {
                // Course terminée, affichage du finish_screen
                screen = "finish_screen";
                timeRemaining = TOTAL_RACE_TIME_MS - timeInRace;
            } else {
                // Course terminée depuis plus de 25s, retour à game_screen
                screen = "game_screen";
                gameState.isRaceRunning = false;
                gameState.raceStartTime = null;
            }
        } else if (gameState.nextRoundStartTime && gameState.nextRoundStartTime > now) {
            // Timer en cours avant la prochaine course
            timeRemaining = gameState.nextRoundStartTime - now;
            screen = "game_screen";
        }

        res.json({
            screen: screen,
            currentRound: gameState.currentRound,
            isRaceRunning: gameState.isRaceRunning,
            raceStartTime: gameState.raceStartTime,
            raceEndTime: gameState.raceEndTime,
            nextRoundStartTime: gameState.nextRoundStartTime,
            timeInRace: timeInRace,
            timeRemaining: Math.max(0, timeRemaining),
            timerTimeLeft: gameState.nextRoundStartTime && gameState.nextRoundStartTime > now 
                ? gameState.nextRoundStartTime - now 
                : 0,
            timerTotalDuration: ROUND_WAIT_DURATION_MS,
            gameHistory: gameState.gameHistory || []
        });
    });


    // -----------------------------------------------------------------
    // --- API EXISTANTE : POST /api/v1/rounds/ ---
    // -----------------------------------------------------------------
    router.post("/", async (req, res) => {
        let rawBody = req.body;
        if (typeof rawBody === "string" && rawBody.trim()) {
            try { rawBody = JSON.parse(rawBody); } catch (e) { /* keep string */ }
        }
        const action =
            (rawBody && (rawBody.action || (rawBody.data && rawBody.data.action))) ||
            req.query.action ||
            null;

        console.debug(`[ROUNDS] Action reçue : ${action}`);

        // === GET === Retourne le round actuel depuis la mémoire (ZERO DB queries)
        if (action === "get") {
            const roundData = {
                ...gameState.currentRound,
                isRaceRunning: gameState.isRaceRunning,
                raceStartTime: gameState.raceStartTime,
                raceEndTime: gameState.raceEndTime,
                nextRoundStartTime: gameState.nextRoundStartTime
            };
            
            // ✅ OPTIMISATION: Cache headers for browser caching
            res.set('Cache-Control', 'public, max-age=2');
            res.set('X-Data-Source', 'memory');
            
            return res.json(wrap(roundData));
        }

        // === FINISH === Archiver le round en mémoire ET en base
        if (action === "finish") {
            // Logique existante conservée
            res.json(wrap({ success: true }));
            // Appeler la logique extraite
            executeFinish();
            
            // Simule la durée de la course (20 secondes pour correspondre à movie_screen)
            setTimeout(async () => {
                
                // --- VOTRE LOGIQUE DE JEU ORIGINALE (Règlement de la course) ---
                // Utiliser les données de l'ancien round sauvegardé
                const finishedRoundData = gameState.runningRoundData || gameState.currentRound;
                const participants = Array.isArray(finishedRoundData.participants) ? finishedRoundData.participants : [];
                if (participants.length === 0) {
                    console.error("finish: aucun participant -> annulation.");
                    return;
                }

                const winner = participants[chacha20RandomInt(participants.length)];
                
                const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };

                // Mettre à jour les participants dans finishedRoundData
                finishedRoundData.participants = participants.map(p =>
                    (p.number === winner.number ? winnerWithPlace : p)
                );

                let totalPrizeAll = 0;
                const receipts = Array.isArray(finishedRoundData.receipts) ? finishedRoundData.receipts : [];

                receipts.forEach(receipt => {
                    let totalPrizeForReceipt = 0;
                    if (Array.isArray(receipt.bets)) {
                        receipt.bets.forEach(bet => {
                            if (Number(bet.number) === Number(winner.number)) {
                                const betValue = Number(bet.value) || 0;
                                const coeff = Number(winner.coeff) || 0;
                                totalPrizeForReceipt += betValue * coeff;
                            }
                        });
                    }
                    receipt.prize = totalPrizeForReceipt;
                    console.log(`Ticket #${receipt.id} gain : ${receipt.prize} HTG`);
                    totalPrizeAll += totalPrizeForReceipt;
                });

                // Mettre à jour les statuts des tickets en DB (won/lost) avec les prizes calculés
                (async () => {
                  for (const receipt of receipts) {
                    try {
                      const newStatus = receipt.prize > 0 ? 'won' : 'lost';
                      await updateReceiptStatus(receipt.id, newStatus, receipt.prize || 0);
                      console.log(`[DB] ✓ Ticket #${receipt.id} mis à jour: status=${newStatus}, prize=${receipt.prize}`);
                    } catch (err) {
                      console.error(`[DB] ✗ Erreur mise à jour ticket #${receipt.id}:`, err.message);
                    }
                  }
                })();

                // Utiliser les données de l'ancien round sauvegardé (avant qu'il soit remplacé par le nouveau round)
                finishedRoundData.totalPrize = totalPrizeAll;

                // Marque la fin de la course (fin du movie_screen, début du finish_screen)
                gameState.raceEndTime = Date.now();

                // Archiver l'ancien round
                const finishedRoundId = finishedRoundData.id;
                if (finishedRoundId) {
                    const finishedRound = {
                        id: finishedRoundId,
                        receipts: finishedRoundData.receipts || [],
                        participants: finishedRoundData.participants || [],
                        totalPrize: totalPrizeAll,
                        winner: winnerWithPlace,
                    };
                    // Evite la duplication accidentelle : n'ajoute l'entrée que si elle n'existe pas déjà
                    if (!gameState.gameHistory.some(r => r.id === finishedRound.id)) {
                        gameState.gameHistory.push(finishedRound);
                    } else {
                        console.warn(`[ROUNDS] Round ${finishedRound.id} déjà présent dans gameHistory, saut de duplication.`);
                    }
                    // Garde seulement les 10 derniers tours
                    if (gameState.gameHistory.length > 10) gameState.gameHistory.shift();
                    
                    // Sauvegarder le round terminé dans la base de données
                    try {
                        // Résoudre le winner_id attendu par la BDD (participant_id)
                        let winnerParticipantId = null;
                        try {
                            const participantsDb = await getParticipants();
                            const winnerRow = participantsDb.find(p => Number(p.number) === Number(winner.number));
                            if (winnerRow) {
                                winnerParticipantId = winnerRow.participant_id;
                                console.log(`[ROUNDS] ✓ Participant winner résolu: number=${winner.number} -> participant_id=${winnerParticipantId}`);
                            } else {
                                console.warn(`[ROUNDS] ⚠️ Impossible de trouver participant en base pour number=${winner.number}; winner_id sera NULL`);
                            }
                        } catch (lookupErr) {
                            console.error('[ROUNDS] Erreur lookup participant by number:', lookupErr);
                        }

                        await finishRound(finishedRoundId, winnerParticipantId, totalPrizeAll, new Date());
                        console.log(`[ROUNDS] Round ${finishedRoundId} archivé en base de données avec winner participant_id=${winnerParticipantId} (number=${winner.number})`);
                    } catch (dbError) {
                        console.error(`[ROUNDS] Erreur lors de l'archivage du round en base :`, dbError);
                    }
                }

                // Nettoyer la sauvegarde de l'ancien round
                gameState.runningRoundData = null;

                // Broadcast complet avec toutes les informations de fin de course (utilise l'ancien round ID)
                broadcast({
                    event: "race_end",
                    roundId: finishedRoundId, // Utilise l'ancien round ID pour la fin de course
                    winner: winnerWithPlace,
                    receipts: JSON.parse(JSON.stringify(receipts)),
                    prize: totalPrizeAll,
                    totalPrize: totalPrizeAll,
                    raceEndTime: gameState.raceEndTime,
                    currentRound: JSON.parse(JSON.stringify(finishedRoundData)), // Utilise les données de l'ancien round
                    participants: finishedRoundData.participants || []
                });
                
                // Le nouveau round est déjà dans currentRound et disponible pour les paris
                console.log(`✅ Course #${finishedRoundId} terminée, nouveau round #${gameState.currentRound.id} actif`);
                
                // --- FIN DE VOTRE LOGIQUE DE JEU ORIGINALE ---
                
                // Marque la fin complète de la course après finish_screen
                setTimeout(() => {
                    gameState.isRaceRunning = false;
                    gameState.raceStartTime = null;
                    gameState.raceEndTime = null;
                }, 5000); // Après 5 secondes de finish_screen

            }, MOVIE_SCREEN_DURATION_MS); // 20s pour correspondre à la durée réelle du movie_screen
                                          // + 5s de finish_screen = 25s total

            return;
        }

        // === CONFIRM === (INCHANGÉ)
        if (action === "confirm") {
            console.log("Confirmation du round", gameState.currentRound.id);
            return res.json(wrap(gameState.currentRound));
        }

        // === NEW_GAME === Créer un nouveau round en mémoire ET en base avec le même ID
        if (action === "new_game") {
            // Always create a new round, even if a race is currently running
            // This allows creating a new betting round while the previous race is still showing results
            console.log('[ROUNDS] new_game: Creating new round (race_running=' + gameState.isRaceRunning + ')');
            
            startNewRound(broadcast);
            // Synchronisation : utiliser l'ID généré en mémoire pour la base
            const round_id = gameState.currentRound.id;
            const round_number = getNextRoundNumber();
            const winner_id = null;
            const started_at = new Date();
            const next_start_time = new Date(Date.now() + ROUND_WAIT_DURATION_MS);
            const newRoundDb = await createRound({ round_id, round_number, winner_id, started_at, next_start_time });
            console.log(`[ROUNDS] Nouveau round créé en base (ID synchronisé) :`, newRoundDb);
            return res.json(wrap({ success: true, round: gameState.currentRound }));
        }

        // Action inconnue
        console.warn(`[ROUNDS] Action inconnue : ${action}`);
        return res.status(400).json({ error: "Unknown action" });
    });

    return router;
}