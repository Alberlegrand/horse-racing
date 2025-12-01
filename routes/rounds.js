// routes/rounds.js

import express from "express";
// On suppose que gameState est un objet partagé que nous pouvons modifier
import { gameState, startNewRound, wrap, BASE_PARTICIPANTS } from "../game.js";

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

// ✅ IMPORTER TOUTES LES CONSTANTES DE TIMER DE LA CONFIG CENTRALISÉE
import { 
  TIMER_DURATION_MS,
  TIMER_UPDATE_INTERVAL_MS,
  MOVIE_SCREEN_DURATION_MS,
  FINISH_SCREEN_DURATION_MS,
  TOTAL_RACE_TIME_MS,
  NEW_ROUND_PREPARE_DELAY_MS
} from "../config/app.config.js";

function generateRoundId() {
    return Math.floor(96908000 + chacha20Random() * 1000);
}

/**
 * ✅ Helper pour nettoyer TOUS les timers de gameState
 * Doit être appelé avant chaque nouvelle assignation de timer
 */
function clearAllTimers() {
    console.log('[TIMERS] 🧹 Nettoyage de tous les timers');
    Object.keys(gameState.timers).forEach(key => {
        if (gameState.timers[key]) {
            clearTimeout(gameState.timers[key]);
            gameState.timers[key] = null;
        }
    });
}

// --- CONFIGURATION CENTRALISÉE DES TIMERS ---
// ✅ TOUS LES TIMERS VIENNENT DE config/app.config.js POUR COHÉRENCE GLOBALE
// ✅ TOUTES LES VALEURS SONT EN MILLISECONDES (MS)
const ROUND_WAIT_DURATION_MS = TIMER_DURATION_MS;

console.log(`
========================================
⏰ [ROUNDS] Configuration des timers:
========================================
🕐 Attente avant course: ${ROUND_WAIT_DURATION_MS}ms
🎬 Movie screen: ${MOVIE_SCREEN_DURATION_MS}ms
🏁 Finish screen: ${FINISH_SCREEN_DURATION_MS}ms
📊 Total race: ${TOTAL_RACE_TIME_MS}ms
🆕 Préparation nouveau round: ${NEW_ROUND_PREPARE_DELAY_MS}ms
======================================== 
`);

// --- INITIALISATION DE L'ÉTAT ---
// Les timers sont maintenant centralisés dans gameState.timers
if (typeof gameState.nextRoundStartTime === 'undefined') {
    gameState.nextRoundStartTime = null; 
}


/**
 * ✅ CLASSE POUR GÉRER LES TIMERS DE MANIÈRE ROBUSTE
 * Centralise tous les timers dans gameState.timers pour éviter les conflits et les doublons
 */
class RaceTimerManager {
    constructor() {
        this.activeRaces = new Set(); // { raceId }
    }

    /**
     * Créer une séquence complète de timers pour une course
     * Timeline: T=0 race_start → T=10 create_new_round → T=20 finish_logic → T=25 cleanup
     */
    startRaceSequence(raceId, callbacks) {
        console.log(`[TIMER] 🚀 Démarrage séquence course #${raceId}`);
        
        // Éviter les doublons
        if (this.activeRaces.has(raceId)) {
            console.warn(`[TIMER] ⚠️ Séquence déjà active pour race #${raceId}, ignorée`);
            return false;
        }

        // ✅ NETTOYER TOUS LES TIMERS AVANT DE COMMENCER
        clearAllTimers();

        // Marquer la course comme active
        this.activeRaces.add(raceId);

        try {
            // T=0: Race start
            console.log(`[TIMER] T+0s: Broadcasting race_start`);
            if (callbacks.onRaceStart) {
                callbacks.onRaceStart();
            }

            // T=10s: Créer le nouveau round
            console.log('[TIMER] ⏱️ Programmation T+10s: Préparation du nouveau round');
            gameState.timers.prepare = setTimeout(() => {
                console.log(`[TIMER] T+10s: Préparation du nouveau round`);
                if (callbacks.onPrepareNewRound) {
                    callbacks.onPrepareNewRound();
                }
            }, NEW_ROUND_PREPARE_DELAY_MS);

            // T=20s: Exécuter la logique de fin de course
            console.log('[TIMER] ⏱️ Programmation T+20s: Exécution fin de course');
            gameState.timers.finish = setTimeout(() => {
                console.log(`[TIMER] T+20s: Exécution de la fin de course`);
                if (callbacks.onFinishRace) {
                    callbacks.onFinishRace();
                }
            }, MOVIE_SCREEN_DURATION_MS);

            // T=25s: Nettoyage et réinitialisation
            console.log('[TIMER] ⏱️ Programmation T+25s: Nettoyage post-race');
            gameState.timers.cleanup = setTimeout(() => {
                console.log(`[TIMER] T+25s: Nettoyage post-race`);
                this.activeRaces.delete(raceId);
                clearAllTimers();
                if (callbacks.onCleanup) {
                    callbacks.onCleanup();
                }
            }, TOTAL_RACE_TIME_MS);

            return true;

        } catch (err) {
            console.error(`[TIMER] ❌ Erreur création séquence:`, err.message);
            clearAllTimers();
            this.activeRaces.delete(raceId);
            return false;
        }
    }

    /**
     * Programmer le lancement automatique du prochain round
     * ✅ UTILISE gameState.timers.nextRound
     */
    scheduleNextRaceStart(nextRaceId, delayMs, callbacks) {
        console.log(`[TIMER] 📅 Auto-start programmé pour race #${nextRaceId} dans ${delayMs}ms`);
        
        // ✅ NETTOYER LE TIMER PRÉCÉDENT
        if (gameState.timers.nextRound) {
            clearTimeout(gameState.timers.nextRound);
            gameState.timers.nextRound = null;
        }

        gameState.timers.nextRound = setTimeout(async () => {
            console.log(`[TIMER] ⏱️ Auto-start déclenché pour race #${nextRaceId}`);
            try {
                // Vérifier que pas une autre race en cours
                if (gameState.isRaceRunning) {
                    console.warn(`[TIMER] ⚠️ Une course est déjà en cours, auto-start ignoré`);
                    return;
                }

                if (callbacks.onAutoStart) {
                    await callbacks.onAutoStart();
                }
            } catch (err) {
                console.error(`[TIMER] ❌ Erreur auto-start:`, err.message);
            }
        }, delayMs);
    }

    /**
     * Nettoyer tous les timers (catastrophe recovery)
     */
    clearAllTimers() {
        console.log(`[TIMER] 🔴 Nettoyage GLOBAL de tous les timers`);
        clearAllTimers();
        this.activeRaces.clear();
    }

    /**
     * Obtenir l'état des timers (pour debugging)
     */
    getStatus() {
        return {
            activeRaces: Array.from(this.activeRaces),
            timers: {
                nextRound: gameState.timers.nextRound ? 'active' : 'inactive',
                prepare: gameState.timers.prepare ? 'active' : 'inactive',
                finish: gameState.timers.finish ? 'active' : 'inactive',
                cleanup: gameState.timers.cleanup ? 'active' : 'inactive'
            }
        };
    }
}

/**
 * Crée le routeur pour les "rounds".
 * @param {function} broadcast - La fonction de diffusion WebSocket.
 * @returns {express.Router}
 */
export default function createRoundsRouter(broadcast) {
    const router = express.Router();

    // ✅ INSTANCE CENTRALISÉE DU GESTIONNAIRE DE TIMERS
    const raceTimerManager = new RaceTimerManager();

    // Petit cache de logging pour éviter d'écrire la même ligne de log plusieurs fois
    // (ex : plusieurs clients pollent l'API /rounds/ à intervalle très court)
    let lastLoggedMemoryRoundId = null;
    let lastLoggedDbRoundId = null;

    // Helper: Extraire la vraie logique de fin de course (SÉPARÉE et RÉUTILISABLE)
    const executeRaceFinish = async () => {
        console.log('[RACE-FINISH] Exécution de la logique de fin de course');
        
        // ✅ LOCK GLOBAL: Éviter les exécutions multiples simultanées
        if (gameState.finishLock) {
            console.warn('[RACE-FINISH] ⚠️ Déjà en cours (lock actif), ignoré');
            return;
        }
        gameState.finishLock = true;
        
        try {
            const finishedRoundData = gameState.runningRoundData || gameState.currentRound;
            const participants = Array.isArray(finishedRoundData.participants) ? finishedRoundData.participants : [];
            
            if (participants.length === 0) {
                console.error('[RACE-FINISH] Aucun participant -> annulation');
                gameState.finishLock = false;
                return;
            }

            // Calculer le gagnant
            const winner = participants[chacha20RandomInt(participants.length)];
            const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };

            // Mettre à jour les participants
            finishedRoundData.participants = participants.map(p =>
                (p.number === winner.number ? winnerWithPlace : p)
            );

            // Calculer les gains pour chaque ticket
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
                console.log(`[RACE-FINISH] Ticket #${receipt.id} gain: ${receipt.prize} HTG`);
                totalPrizeAll += totalPrizeForReceipt;
            });

            // Mettre à jour les statuts des tickets en DB
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

            finishedRoundData.totalPrize = totalPrizeAll;

            // Marquer la fin de la course
            gameState.raceEndTime = Date.now();

            // Archiver l'ancien round en DB
            const finishedRoundId = finishedRoundData.id;
            if (finishedRoundId) {
                const finishedRound = {
                    id: finishedRoundId,
                    receipts: finishedRoundData.receipts || [],
                    participants: finishedRoundData.participants || [],
                    totalPrize: totalPrizeAll,
                    winner: winnerWithPlace,
                };
                
                // Évite la duplication accidentelle
                if (!gameState.gameHistory.some(r => r.id === finishedRound.id)) {
                    gameState.gameHistory.push(finishedRound);
                } else {
                    console.warn(`[RACE-FINISH] Round ${finishedRound.id} déjà présent dans gameHistory, saut`);
                }
                
                // Garde seulement les 10 derniers tours
                if (gameState.gameHistory.length > 10) gameState.gameHistory.shift();
                
                // Sauvegarder en DB
                try {
                    let winnerParticipantId = null;
                    try {
                        const participantsDb = await getParticipants();
                        const winnerRow = participantsDb.find(p => Number(p.number) === Number(winner.number));
                        if (winnerRow) {
                            winnerParticipantId = winnerRow.participant_id;
                            console.log(`[RACE-FINISH] ✓ Winner résolu: number=${winner.number} -> participant_id=${winnerParticipantId}`);
                        } else {
                            console.warn(`[RACE-FINISH] ⚠️ Participant winner non trouvé: number=${winner.number}`);
                        }
                    } catch (lookupErr) {
                        console.error('[RACE-FINISH] Erreur lookup participant:', lookupErr);
                    }

                    await finishRound(finishedRoundId, winnerParticipantId, totalPrizeAll, new Date());
                    console.log(`[RACE-FINISH] Round ${finishedRoundId} archivé en DB avec winner ${winnerParticipantId}`);
                } catch (dbError) {
                    console.error(`[RACE-FINISH] Erreur archivage round:`, dbError);
                }
            }

            // Nettoyer la sauvegarde de l'ancien round
            gameState.runningRoundData = null;

            // Broadcast complet avec résultats
            broadcast({
                event: "race_end",
                roundId: finishedRoundId,
                winner: winnerWithPlace,
                receipts: JSON.parse(JSON.stringify(receipts)),
                prize: totalPrizeAll,
                totalPrize: totalPrizeAll,
                raceEndTime: gameState.raceEndTime,
                currentRound: JSON.parse(JSON.stringify(finishedRoundData)),
                participants: finishedRoundData.participants || []
            });
            
            console.log(`✅ Course #${finishedRoundId} terminée, nouveau round #${gameState.currentRound.id} actif`);

            // Marquer la fin complète après le finish_screen
            setTimeout(() => {
                gameState.isRaceRunning = false;
                gameState.raceStartTime = null;
                gameState.raceEndTime = null;
                gameState.finishLock = false;  // ✅ LIBÉRER LE LOCK
                console.log('[RACE-FINISH] État réinitialisé après finish_screen, lock libéré');
            }, FINISH_SCREEN_DURATION_MS);

        } catch (err) {
            console.error('[RACE-FINISH] ❌ Erreur:', err.message || err);
            gameState.finishLock = false;  // ✅ LIBÉRER LE LOCK EN CAS D'ERREUR
        }
    };

    // ✅ DÉFINIR LES CALLBACKS DE LA SÉQUENCE DE COURSE
    const raceCallbacks = {
        // T=0: Race commence
        onRaceStart: () => {
            const raceStartTime = Date.now();
            gameState.isRaceRunning = true;
            gameState.raceStartTime = raceStartTime;
            gameState.raceEndTime = null;
            // ✅ RESET LE TIMER POUR ÉVITER LE PETIT TIMER PENDANT LE FINISH SCREEN
            gameState.nextRoundStartTime = null;

            broadcast({
                event: "race_start",
                roundId: gameState.currentRound.id,
                raceStartTime: raceStartTime,
                currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
                isRaceRunning: true
            });
        },

        // T=10s: Préparer le nouveau round
        onPrepareNewRound: async () => {
            console.log('[RACE-SEQ] Préparation nouveau round');
            
            // Sauvegarder l'ancien round
            const oldRoundId = gameState.currentRound.id;
            gameState.runningRoundData = JSON.parse(JSON.stringify(gameState.currentRound));

            // Créer le nouveau round
            const newRoundId = generateRoundId();
            const basePlaces = Array.from({ length: BASE_PARTICIPANTS.length }, (_, i) => i + 1);
            const shuffledPlaces = chacha20Shuffle(basePlaces);

            const newRound = {
                id: newRoundId,
                participants: BASE_PARTICIPANTS.map((p, i) => ({
                    ...p,
                    place: shuffledPlaces[i],
                })),
                receipts: [],
                lastReceiptId: 3,
                totalPrize: 0,
                persisted: false
            };

            gameState.currentRound = newRound;

            // Persist to DB
            try {
                const roundNum = getNextRoundNumber();
                await pool.query(
                    `INSERT INTO rounds (round_id, round_number, status, created_at) 
                     VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
                     ON CONFLICT (round_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                     RETURNING round_id`,
                    [newRoundId, roundNum]
                );
                console.log(`✅ Round #${roundNum} (ID: ${newRoundId}) créé en DB`);
                gameState.currentRound.persisted = true;
            } catch (err) {
                console.error('[DB] Erreur création round:', err);
                gameState.currentRound.persisted = false;
            }

            // Programmer le prochain lancement
            const now = Date.now();
            gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;

            // Broadcast du nouveau round
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
                isRaceRunning: true,
                raceStartTime: gameState.raceStartTime,
                raceEndTime: null
            });

            console.log(`✅ Nouveau round #${newRoundId} activé (ancien #${oldRoundId} en cours)`);

            // ✅ PROGRAMMER LE PROCHAIN AUTO-START
            const autoStartDelay = gameState.nextRoundStartTime - Date.now();
            raceTimerManager.scheduleNextRaceStart(newRoundId, autoStartDelay, {
                onAutoStart: async () => {
                    // Appeler /auto-finish via une vraie requête HTTP
                    try {
                        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
                        const host = process.env.SERVER_HOST || 'localhost';
                        const port = process.env.PORT || 8080;
                        const url = `${protocol}://${host}:${port}/api/v1/rounds/auto-finish`;
                        
                        const resp = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        if (!resp.ok) {
                            console.error('[AUTO-START] Erreur auto-finish:', resp.status);
                        }
                    } catch (err) {
                        console.error('[AUTO-START] Erreur:', err && err.message ? err.message : err);
                    }
                }
            });
        },

        // T=20s: Exécuter la logique de fin
        onFinishRace: async () => {
            console.log('[RACE-SEQ] Exécution logique fin de course');
            await executeRaceFinish();
        },

        // T=25s: Nettoyage
        onCleanup: () => {
            console.log('[RACE-SEQ] Nettoyage post-race');
            gameState.isRaceRunning = false;
            gameState.raceStartTime = null;
            gameState.raceEndTime = null;
            gameState._finishInProgress = false;
        }
    };

    
    // -----------------------------------------------------------------
    // --- API AJOUTÉE : POST /api/v1/rounds/auto-finish (internal) ---
    // -----------------------------------------------------------------
    /**
     * Endpoint interne pour déclencher la course automatiquement.
     * Appelé par le serveur quand le timer du nouveau round expire.
     * ✅ UTILISE LE GESTIONNAIRE CENTRALISÉ DE TIMERS
     */
    router.post("/auto-finish", async (req, res) => {
        console.log('[AUTO-FINISH] Requête reçue');
        
        // ✅ PROTECTION: Vérifier qu'une race n'est pas déjà en cours
        if (gameState.isRaceRunning) {
            console.warn('[AUTO-FINISH] Une course est déjà en cours, ignoré');
            return res.json(wrap({ skipped: true, reason: 'race already running' }));
        }

        try {
            const raceId = gameState.currentRound.id;
            
            // ✅ UTILISER LE GESTIONNAIRE CENTRALISÉ
            const success = raceTimerManager.startRaceSequence(raceId, raceCallbacks);
            
            if (!success) {
                return res.json(wrap({ skipped: true, reason: 'race sequence already active' }));
            }

            res.json(wrap({ success: true }));
        } catch (err) {
            console.error('[AUTO-FINISH] Erreur:', err && err.message ? err.message : err);
            res.status(500).json({ error: 'Erreur startRaceSequence' });
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
     * 
     * ⚠️ TIMER GUARD: Si le timer est bloqué (nextRoundStartTime null/passé et pas de race),
     * déclencher automatiquement un nouveau round pour la robustesse sur Render.
     */
    router.get("/status", cacheResponse(5), async (req, res) => {
        const now = Date.now();
        // ✅ UTILISER LES CONSTANTES UNIFIÉES IMPORTÉES DE config/app.config.js
        // Pas de redéfinition locale des timers!

        // ✅ TIMER GUARD: Vérifier si le timer est bloqué
        if (!gameState.isRaceRunning && 
            (!gameState.nextRoundStartTime || gameState.nextRoundStartTime <= now)) {
          console.warn('⚠️ [TIMER-GUARD] Timer bloqué détecté dans /status, redémarrage du round...');
          try {
            await startNewRound(broadcast);
            console.log('✅ [TIMER-GUARD] Round redémarré avec succès');
          } catch (error) {
            console.error('❌ [TIMER-GUARD] Erreur lors du redémarrage:', error.message);
          }
        }

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
                // Course terminée depuis plus de TOTAL_RACE_TIME_MS, retour à game_screen
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

        // === FINISH === Déclencher la séquence de course
        if (action === "finish") {
            // ✅ PROTECTION: Vérifier qu'une race n'est pas déjà en cours
            if (gameState.isRaceRunning) {
                console.warn('[FINISH] Une course est déjà en cours, ignoré');
                return res.json(wrap({ skipped: true, reason: 'race already running' }));
            }

            try {
                const raceId = gameState.currentRound.id;
                
                // ✅ UTILISER LE GESTIONNAIRE CENTRALISÉ
                const success = raceTimerManager.startRaceSequence(raceId, raceCallbacks);
                
                if (!success) {
                    return res.json(wrap({ skipped: true, reason: 'race sequence already active' }));
                }

                // Répondre immédiatement au client
                res.json(wrap({ success: true }));

            } catch (err) {
                console.error('[FINISH] Erreur:', err && err.message ? err.message : err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Erreur startRaceSequence' });
                }
            }

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