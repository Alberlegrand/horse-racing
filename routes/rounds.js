// routes/rounds.js

import express from "express";
// On suppose que gameState est un objet partagé que nous pouvons modifier
import { gameState, startNewRound, createNewRound, wrap, BASE_PARTICIPANTS } from "../game.js";

// Import ChaCha20 pour la sécurité des positions
// ✅ PROBLÈME #24 CORRIGÉ: initChaCha20 supprimé (déjà appelé dans game.js au démarrage)
import { chacha20Random, chacha20RandomInt, chacha20Shuffle } from "../chacha20.js";

// Import cache middleware for performance
import { cacheResponse } from "../middleware/cache.js";

// Import des fonctions et constantes nécessaires pour créer un nouveau round
import { getParticipants, createRound, finishRound, getRoundsHistory, getRoundByNumber } from "../models/gameModel.js";

// Import pour mettre à jour le statut des tickets en DB quand la course se termine
import { updateReceiptStatus } from "../models/receiptModel.js";

// Import pour mettre à jour le cache Redis
import { 
    updateTicketInRoundCache,
    initRoundCache,
    getRoundParticipantsFromCache
} from "../config/db-strategy.js";

// Import de pool pour persister les rounds en DB
import { pool } from "../config/db.js";

// Import du gestionnaire de numéro de round pour éviter les doublons
import { getNextRoundNumber } from "../utils/roundNumberManager.js";

// ✅ IMPORTER TOUTES LES CONSTANTES DE TIMER DE LA CONFIG CENTRALISÉE
import { 
  ROUND_WAIT_DURATION_MS,
  TIMER_UPDATE_INTERVAL_MS,
  MOVIE_SCREEN_DURATION_MS,
  FINISH_SCREEN_DURATION_MS,
  TOTAL_RACE_TIME_MS,
  NEW_ROUND_PREPARE_DELAY_MS
} from "../config/app.config.js";

// ✅ Compteur de rounds importé depuis game.js
// ⚠️ N'utiliser que createNewRound() pour créer des rounds!
// Ne PAS utiliser generateRoundId() directement ici

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

console.log(`
========================================
⏰ [ROUNDS] Configuration des timers:
========================================
🕐 Attente avant course: ${ROUND_WAIT_DURATION_MS}ms
🎬 Movie screen: ${MOVIE_SCREEN_DURATION_MS}ms
🏁 Finish screen: ${FINISH_SCREEN_DURATION_MS}ms
📊 Total race: ${TOTAL_RACE_TIME_MS}ms
🆕 Préparation nouveau round: T+0ms (immédiat, données disponibles dès le début)
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
        console.log(`[TIMER] 📋 CONFIGURATION: MOVIE_SCREEN_DURATION_MS=${MOVIE_SCREEN_DURATION_MS}ms (${MOVIE_SCREEN_DURATION_MS/1000}s), FINISH_SCREEN_DURATION_MS=${FINISH_SCREEN_DURATION_MS}ms (${FINISH_SCREEN_DURATION_MS/1000}s), TOTAL_RACE_TIME_MS=${TOTAL_RACE_TIME_MS}ms (${TOTAL_RACE_TIME_MS/1000}s)`);
        
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

            // ✅ CORRECTION #2: NE PAS créer le nouveau round à T+0
            // Le nouveau round sera créé APRÈS executeRaceFinish (T+20s)
            // Cela évite la confusion entre isRaceRunning et la création du round
            console.log('[TIMER] ⏱️ T+0s: Course démarrée, nouveau round sera créé après la fin');

            // T=20s: Exécuter la logique de fin de course
            console.log(`[TIMER] ⏱️ Programmation T+${MOVIE_SCREEN_DURATION_MS}ms (${MOVIE_SCREEN_DURATION_MS/1000}s): Exécution fin de course`);
            gameState.timers.finish = setTimeout(() => {
                console.log(`[TIMER] T+${MOVIE_SCREEN_DURATION_MS}ms: Exécution de la fin de course`);
                if (callbacks.onFinishRace) {
                    callbacks.onFinishRace();
                }
            }, MOVIE_SCREEN_DURATION_MS);

            // T=35s: Nettoyage et réinitialisation
            console.log('[TIMER] ⏱️ Programmation T+35s: Nettoyage post-race');
            gameState.timers.cleanup = setTimeout(() => {
                console.log(`[TIMER] T+35s: Nettoyage post-race`);
                // ✅ CORRECTION: Toujours nettoyer activeRaces même si onCleanup échoue
                try {
                    this.activeRaces.delete(raceId);
                    clearAllTimers();
                    if (callbacks.onCleanup) {
                        callbacks.onCleanup();
                    }
                } catch (cleanupErr) {
                    console.error('[TIMER] ❌ Erreur dans cleanup:', cleanupErr);
                    // Nettoyer quand même activeRaces pour éviter les blocages
                    this.activeRaces.delete(raceId);
                    clearAllTimers();
                    // Libérer le lock si bloqué
                    gameState.operationLock = false;
                    gameState.isRaceRunning = false;
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
     * ✅ SUPPRESSION: Auto-start serveur n'est plus nécessaire
     * Le client gère le timer et clique automatiquement via mettreAJourProgressBar()
     */

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

    // Helper: Calculer les résultats et mettre à jour en DB
    // ✅ NOUVEAU: Appelé à T=35s (onCleanup) - Utilise currentRound directement
    // ✅ CORRECTION #2: Plus de runningRoundData - Utiliser currentRound comme source unique
    const calculateRaceResults = async () => {
        console.log('[RACE-RESULTS] Calcul des résultats de course');
        
        // ✅ SOURCE UNIQUE: Utiliser currentRound directement
        // Le round actuel contient toutes les données nécessaires (tickets, participants, etc.)
        if (!gameState.currentRound || !gameState.currentRound.id) {
            console.error('[RACE-RESULTS] ❌ Aucune donnée de round disponible dans currentRound');
            return null;
        }
        
        // ✅ Faire une copie locale (variable locale, pas dans gameState)
        // Cela évite de modifier currentRound pendant le calcul
        const finishedRoundData = JSON.parse(JSON.stringify(gameState.currentRound));
        const savedRoundData = finishedRoundData;
        const participants = Array.isArray(savedRoundData.participants) ? savedRoundData.participants : [];
        
        if (participants.length === 0) {
            console.error('[RACE-RESULTS] Aucun participant -> annulation');
            return null;
        }

        // ✅ CORRECTION CRITIQUE: Calculer le gagnant (ALÉATOIRE) avec logs détaillés
        console.log(`[RACE-RESULTS] 🎲 Sélection du gagnant parmi ${participants.length} participants:`);
        participants.forEach((p, i) => {
            console.log(`   [${i}] №${p.number} ${p.name} (place: ${p.place})`);
        });
        
        const winnerIndex = chacha20RandomInt(participants.length);
        const winner = participants[winnerIndex];
        console.log(`[RACE-RESULTS] ✅ Gagnant sélectionné aléatoirement: Index ${winnerIndex} → №${winner.number} ${winner.name}`);
        
        const winnerWithPlace = { ...winner, place: 1, family: winner.family ?? 0 };

        // ✅ CORRECTION CRITIQUE: Mettre à jour les participants AVANT de copier savedRoundData
        // Cela garantit que savedRoundData contient les bons participants avec le gagnant marqué place=1
        const updatedParticipants = participants.map(p =>
            (p.number === winner.number ? winnerWithPlace : p)
        );
        
        // Copier et mettre à jour les participants dans savedRoundData
        savedRoundData.participants = updatedParticipants;

        // Calculer les gains pour chaque ticket
        let totalPrizeAll = 0;
        const receipts = Array.isArray(savedRoundData.receipts) ? savedRoundData.receipts : [];
        const finishedRoundId = savedRoundData.id;

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
            console.log(`[RACE-RESULTS] Ticket #${receipt.id} gain: ${receipt.prize} HTG`);
            totalPrizeAll += totalPrizeForReceipt;
        });

        savedRoundData.totalPrize = totalPrizeAll;
        gameState.raceEndTime = Date.now();
        
        // ✅ Mettre à jour les statuts des tickets en DB
        for (const receipt of receipts) {
            try {
                const newStatus = receipt.prize > 0 ? 'won' : 'lost';
                receipt.status = newStatus;
                
                // Mettre à jour en DB
                await updateReceiptStatus(receipt.id, newStatus, receipt.prize || 0);
                console.log(`[DB] ✓ Ticket #${receipt.id}: status=${newStatus}, prize=${receipt.prize}`);
                
                // Mettre à jour le cache Redis
                if (finishedRoundId) {
                    await updateTicketInRoundCache(finishedRoundId, receipt.id, newStatus, receipt.prize || 0);
                }
            } catch (err) {
                console.error(`[DB] ✗ Erreur ticket #${receipt.id}:`, err.message);
            }
        }

        // ✅ RETOURNER LES RÉSULTATS (PROBLÈME #12)
        const raceResults = {
            roundId: finishedRoundId,
            winner: winnerWithPlace,
            receipts: receipts,
            totalPrize: totalPrizeAll,
            participants: savedRoundData.participants || []
        };
        
        // Archiver en gameHistory
        if (finishedRoundId) {
            const finishedRound = {
                id: finishedRoundId,
                receipts: savedRoundData.receipts || [],
                participants: savedRoundData.participants || [],
                totalPrize: totalPrizeAll,
                winner: winnerWithPlace,
            };
            
            if (!gameState.gameHistory.some(r => r.id === finishedRound.id)) {
                gameState.gameHistory.push(finishedRound);
            }
            if (gameState.gameHistory.length > 10) gameState.gameHistory.shift();
            
            // Archiver en DB
            try {
                // ✅ CORRECTION CRITIQUE: Améliorer la recherche de participant_id avec logs détaillés
                let winnerParticipantId = null;
                try {
                    const participantsDb = await getParticipants();
                    console.log(`[RACE-RESULTS] 🔍 Recherche participant_id pour winner: №${winner.number} ${winner.name}`);
                    
                    if (!participantsDb || participantsDb.length === 0) {
                        console.error('[RACE-RESULTS] ❌ Aucun participant trouvé en BD');
                    } else {
                        console.log(`[RACE-RESULTS] Participants disponibles en BD:`, participantsDb.map(p => ({ number: p.number, name: p.participant_name, id: p.participant_id })));
                        
                        const winnerRow = participantsDb.find(p => Number(p.number) === Number(winner.number));
                        if (winnerRow && winnerRow.participant_id) {
                            winnerParticipantId = winnerRow.participant_id;
                            console.log(`[RACE-RESULTS] ✅ Winner trouvé: number=${winner.number}, name=${winner.name} -> participant_id=${winnerParticipantId}`);
                            
                            // ✅ VÉRIFICATION: S'assurer que le participant_id correspond bien au bon participant
                            if (Number(winnerRow.number) !== Number(winner.number)) {
                                console.error(`[RACE-RESULTS] ❌ INCOHÉRENCE: participant_id=${winnerParticipantId} ne correspond pas à number=${winner.number}`);
                                console.error(`[RACE-RESULTS] Winner attendu: №${winner.number} ${winner.name}`);
                                console.error(`[RACE-RESULTS] Participant trouvé: №${winnerRow.number} ${winnerRow.participant_name}`);
                            }
                        } else {
                            console.error(`[RACE-RESULTS] ❌ Participant gagnant non trouvé en BD: number=${winner.number}, name=${winner.name}`);
                            console.error(`[RACE-RESULTS] Participants disponibles:`, participantsDb.map(p => ({ number: p.number, name: p.participant_name })));
                        }
                    }
                } catch (lookupErr) {
                    console.error('[RACE-RESULTS] ❌ Erreur lookup participant:', lookupErr.message);
                }

                await finishRound(finishedRoundId, winnerParticipantId, totalPrizeAll, new Date());
                console.log(`[RACE-RESULTS] Round ${finishedRoundId} archivé en DB`);
                
                // ✅ CORRECTION CRITIQUE: Sauvegarder le gagnant dans la table winners
                // Cela doit être fait ICI, après avoir déterminé le gagnant et trouvé participant_id
                if (winnerParticipantId && winnerWithPlace && finishedRoundId) {
                    try {
                        const { saveWinner } = await import('../models/winnerModel.js');
                        
                        // ✅ CORRECTION CRITIQUE: Vérifier que toutes les données nécessaires sont présentes
                        if (winnerWithPlace.number && winnerWithPlace.name) {
                            console.log(`[RACE-RESULTS] 💾 Sauvegarde du gagnant dans winners table:`);
                            console.log(`   - Round ID: ${finishedRoundId}`);
                            console.log(`   - Participant ID: ${winnerParticipantId}`);
                            console.log(`   - Number: ${winnerWithPlace.number}`);
                            console.log(`   - Name: ${winnerWithPlace.name}`);
                            console.log(`   - Family: ${winnerWithPlace.family ?? 0}`);
                            console.log(`   - Prize: ${totalPrizeAll}`);
                            
                            const savedWinner = await saveWinner(finishedRoundId, {
                                id: winnerParticipantId,
                                number: winnerWithPlace.number,
                                name: winnerWithPlace.name,
                                family: winnerWithPlace.family ?? 0,
                                prize: totalPrizeAll
                            });
                            
                            if (savedWinner) {
                                console.log(`[RACE-RESULTS] ✅ Gagnant sauvegardé dans winners table: ${winnerWithPlace.name} (Round #${finishedRoundId}, Prize: ${totalPrizeAll})`);
                                console.log(`[RACE-RESULTS] 📊 Vérification sauvegarde:`, {
                                    round_id: savedWinner.round_id,
                                    participant_id: savedWinner.participant_id,
                                    participant_number: savedWinner.participant_number,
                                    participant_name: savedWinner.participant_name
                                });
                            } else {
                                console.error(`[RACE-RESULTS] ❌ Échec sauvegarde gagnant pour Round #${finishedRoundId}`);
                            }
                        } else {
                            console.error(`[RACE-RESULTS] ❌ Données gagnant incomplètes:`, {
                                number: winnerWithPlace.number,
                                name: winnerWithPlace.name,
                                participant_id: winnerParticipantId
                            });
                        }
                    } catch (saveErr) {
                        console.error(`[RACE-RESULTS] ❌ Erreur sauvegarde gagnant:`, saveErr.message);
                    }
                } else {
                    console.error(`[RACE-RESULTS] ❌ Impossible de sauvegarder gagnant: roundId=${finishedRoundId}, winnerId=${winnerParticipantId}, winner=${winnerWithPlace ? 'present' : 'null'}`);
                }
            } catch (dbError) {
                console.error(`[RACE-RESULTS] Erreur archivage:`, dbError);
            }
        }

        // ✅ PROBLÈME #12 CORRIGÉ: Retourner les résultats explicitement
        return {
            roundId: finishedRoundId,
            winner: winnerWithPlace,
            receipts: receipts,
            totalPrize: totalPrizeAll,
            participants: savedRoundData.participants || []
        };
    };

    // Helper: Signal de fin de course SIMPLE (sans résultats)
    // ✅ APPEL À T=30s: Juste broadcaster que la course est finie
    // Les résultats seront calculés à T=35s dans onCleanup()
    const executeRaceFinish = async () => {
        console.log('[RACE-FINISH] Signal de fin de course à T=30s (résultats calculés à T=35s)');
        
        // ✅ ACQUÉRIR LE LOCK pour éviter les exécutions multiples
        if (gameState.operationLock) {
            console.warn('[RACE-FINISH] ⚠️ Opération déjà en cours, ignorée');
            return;
        }
        gameState.operationLock = true;
        console.log('[LOCK] 🔒 operationLock acquis par executeRaceFinish()');
        
        try {
            // ✅ CORRECTION: Vérifier que la course est toujours en cours
            if (!gameState.isRaceRunning) {
                console.warn('[RACE-FINISH] ⚠️ Course déjà terminée, ignorée');
                gameState.operationLock = false;
                return;
            }
            
            // ✅ CORRECTION #2: Plus besoin de sauvegarder dans runningRoundData
            // Les données restent dans currentRound jusqu'à ce que calculateRaceResults() les utilise
            const oldRoundId = gameState.currentRound?.id;
            if (oldRoundId) {
                console.log(`[RACE-FINISH] ✅ Round #${oldRoundId} prêt pour calcul des résultats (données dans currentRound)`);
            }
            
            // Marquer la fin de la course
            gameState.raceEndTime = Date.now();
        
        // Broadcaster SIMPLE: juste dire que la course est finie, sans résultats
        const raceStartTime = gameState.raceStartTime;
        const now = Date.now();
        const elapsed = raceStartTime ? (now - raceStartTime) : 0;
        
        console.log(`[RACE-FINISH] 🎙️ Broadcasting race_end at T=${elapsed}ms (expected: T=${MOVIE_SCREEN_DURATION_MS}ms)`);
        if (Math.abs(elapsed - MOVIE_SCREEN_DURATION_MS) > 1000) {
            console.warn(`[RACE-FINISH] ⚠️ WARNING: race_end is ${elapsed - MOVIE_SCREEN_DURATION_MS}ms off schedule!`);
        }
        
            broadcast({
                event: "race_end",
                roundId: oldRoundId,
                // ❌ PAS DE RÉSULTATS: winner, receipts, prize
                // Les résultats seront calculés à T=35s et broadcastés via race_results
                raceEndTime: gameState.raceEndTime,
                currentScreen: "finish_screen",  // ✅ NOUVEAU: Indiquer l'écran actuel
                timeInRace: elapsed,            // ✅ NOUVEAU: Temps écoulé depuis le début
                // Juste: finish_screen est maintenant active, attendez les résultats
            });
            
            console.log(`[RACE-FINISH] ✅ Signal race_end broadcasté, attente du calcul à T=35s`);
        } catch (err) {
            console.error('[RACE-FINISH] ❌ Erreur:', err.message);
            // Réinitialiser l'état en cas d'erreur pour éviter les blocages
            gameState.isRaceRunning = false;
            gameState.raceStartTime = null;
        } finally {
            // ✅ TOUJOURS libérer le lock
            gameState.operationLock = false;
            console.log('[LOCK] 🔓 operationLock libéré par executeRaceFinish()');
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

            // ✅ Calculer l'écran actuel et le temps écoulé pour synchronisation
            const now = Date.now();
            const timeInRace = 0; // Au début de la course
            const currentScreen = "movie_screen";
            
            broadcast({
                event: "race_start",
                roundId: gameState.currentRound.id,
                raceStartTime: raceStartTime,
                currentRound: JSON.parse(JSON.stringify(gameState.currentRound)),
                isRaceRunning: true,
                currentScreen: currentScreen,  // ✅ NOUVEAU: Écran actuel
                timeInRace: timeInRace,       // ✅ NOUVEAU: Temps écoulé depuis le début
                serverTime: now               // ✅ NOUVEAU: Timestamp serveur pour sync
            });
        },

        // ✅ PROBLÈME #5 CORRIGÉ: onPrepareNewRound supprimé (code mort)
        // Le nouveau round est créé dans onCleanup() à T=35s via createNewRound()

        // T=30s: Exécuter la logique de fin
        onFinishRace: async () => {
            console.log('[RACE-SEQ] Exécution logique fin de course');
            await executeRaceFinish();
            
            // ✅ CORRECTION #2: Créer le nouveau round APRÈS la fin de la course
            // Cela garantit que les données du round précédent sont sauvegardées
            // Note: onPrepareNewRound sera appelé depuis executeRaceFinish via setTimeout
            console.log('[RACE-SEQ] Fin de course terminée, nouveau round sera créé après finish_screen');
        },

        // T=35s: Cleanup et création du nouveau round
        onCleanup: async () => {
            console.log('[RACE-SEQ] T+35s Cleanup: calcul des résultats et création du nouveau round');
            
            try {
                // ✅ ACQUÉRIR LE LOCK avant de créer le round
                if (gameState.operationLock) {
                    console.warn('[RACE-SEQ] ⚠️ Opération déjà en cours dans onCleanup, attente...');
                    let waitCount = 0;
                    while (gameState.operationLock && waitCount < 20) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                        waitCount++;
                    }
                    if (gameState.operationLock) {
                        console.warn('[RACE-SEQ] ⚠️ Timeout attente lock, ignorée');
                        return;
                    }
                }
                gameState.operationLock = true;
                console.log('[LOCK] 🔒 operationLock acquis par onCleanup()');
                
                // ✅ ÉTAPE 1: CALCULER LES RÉSULTATS MAINTENANT (T=35s)
                // ✅ CORRECTION #2: calculateRaceResults() utilise currentRound directement
                // Les données sont sauvegardées en DB dans calculateRaceResults()
                console.log('[RACE-SEQ] ÉTAPE 1: Calcul des résultats (utilise currentRound)');
                const raceResults = await calculateRaceResults();
                
                if (raceResults) {
                    // ✅ Broadcaster les résultats complets à T=35s
                    // ✅ IMPORTANT: Ne PAS changer l'écran, juste mettre à jour les données
                    // Le finish_screen est déjà affiché depuis race_end (T=30s)
                    
                    // ✅ VÉRIFICATION CRITIQUE: S'assurer que le gagnant broadcasté correspond à celui en DB
                    console.log(`[RACE-SEQ] 🏆 Vérification du gagnant avant broadcast:`);
                    console.log(`   - Gagnant calculé: ${raceResults.winner.name} (N°${raceResults.winner.number})`);
                    console.log(`   - Place marquée: ${raceResults.winner.place}`);
                    const finishScreenWinner = raceResults.participants.find(p => p.place === 1);
                    if (finishScreenWinner) {
                        console.log(`   - Gagnant du finish screen: ${finishScreenWinner.name} (N°${finishScreenWinner.number})`);
                        if (finishScreenWinner.number !== raceResults.winner.number) {
                            console.error(`[RACE-SEQ] ❌ INCOHÉRENCE: Le gagnant du finish screen ne correspond pas!`);
                            console.error(`   ${finishScreenWinner.name} vs ${raceResults.winner.name}`);
                        }
                    }
                    
                    broadcast({
                        event: "race_results",
                        roundId: raceResults.roundId,
                        winner: raceResults.winner,
                        receipts: JSON.parse(JSON.stringify(raceResults.receipts)),
                        totalPrize: raceResults.totalPrize,
                        participants: raceResults.participants,
                        gameHistory: gameState.gameHistory || [],
                        currentScreen: "finish_screen",  // ✅ NOUVEAU: Confirmer l'écran actuel
                        // ✅ NE PAS inclure isRaceRunning=false ici - cela sera dans new_round
                    });
                    console.log(`[RACE-SEQ] ✅ Résultats broadcasters: winner=${raceResults.winner?.number} ${raceResults.winner?.name}, totalPrize=${raceResults.totalPrize}`);
                }
                
                // ✅ ÉTAPE 2: CRÉER LE NOUVEAU ROUND (T=35s)
                // Utiliser createNewRound() - une seule source de vérité consolidée
                console.log('[RACE-SEQ] ÉTAPE 2: Création du nouveau round via createNewRound()');
                const raceStartTimeBackup = gameState.raceStartTime;
                gameState.isRaceRunning = false;
                gameState.raceStartTime = null;
                gameState.raceEndTime = null;
                
                // ✅ Appeler la nouvelle fonction unifiée
                // archiveCurrentRound=true car c'est après une course
                // checkLock=true car le lock a déjà été acquis dans onCleanup()... 
                // ATTENDEZ: checkLock devrait être false si le lock est déjà set!
                // Non, checkLock=true veut dire "vérifier et acquérir", donc on ne peut pas l'utiliser si le lock est déjà set
                // SOLUTION: Nous n'utilisons pas directement createNewRound() avec checkLock=true depuis onCleanup()
                // Nous relâchons le lock manuellement APRÈS createNewRound()
                
                const newRoundId = await createNewRound({
                    broadcast: broadcast,
                    raceStartTime: raceStartTimeBackup,
                    archiveCurrentRound: false,  // ❌ PAS d'archive car elle s'est déjà faite dans calculateRaceResults()
                    checkLock: false             // ❌ NE PAS vérifier le lock car il est déjà set dans onCleanup()
                });
                
                // ✅ ÉTAPE 3: CRÉER LE TIMER (T=35s) - ATOMIQUE
                console.log('[RACE-SEQ] ÉTAPE 3: Démarrage du timer pour le prochain round');
                const timerNow = Date.now();
                gameState.nextRoundStartTime = timerNow + ROUND_WAIT_DURATION_MS;
                
                broadcast({
                    event: 'timer_update',
                    serverTime: timerNow,
                    roundId: newRoundId || gameState.currentRound?.id,
                    timer: {
                        timeLeft: ROUND_WAIT_DURATION_MS,
                        totalDuration: ROUND_WAIT_DURATION_MS,
                        startTime: timerNow,
                        endTime: gameState.nextRoundStartTime
                    }
                });
                console.log(`[TIMER] ⏱️ Timer de ${ROUND_WAIT_DURATION_MS}ms créé et broadcasté`);
                
            } catch (error) {
                // ✅ Si une erreur survient, libérer le lock acquis au début de onCleanup()
                console.error('[RACE-SEQ] ❌ Erreur dans onCleanup():', error.message);
                // Réinitialiser l'état pour éviter les blocages
                gameState.isRaceRunning = false;
                gameState.raceStartTime = null;
                gameState.raceEndTime = null;
                // Ne pas throw pour éviter de bloquer le serveur
            } finally {
                // ✅ TOUJOURS libérer le lock à la fin (succès ou erreur)
                gameState.operationLock = false;
                console.log('[LOCK] 🔓 operationLock libéré par onCleanup()');
                
                // ✅ NOUVEAU: Envoyer un message WebSocket pour recharger la page
                broadcast({
                    event: 'reload_page',
                    reason: 'cleanup_complete',
                    roundId: gameState.currentRound?.id || null,
                    serverTime: Date.now()
                });
                console.log('[RACE-SEQ] 📡 Message WebSocket reload_page envoyé après cleanup');
            }
        }
    };

    
    // -----------------------------------------------------------------
    // --- API SIMPLIFIÉE : LE CLIENT GÈRE LE TIMER ET LE CLIC AUTO ---
    // -----------------------------------------------------------------
    // ✅ SUPPRESSION: /auto-finish n'est plus nécessaire
    // Le client clique automatiquement quand le timer s'écoule via mettreAJourProgressBar()
    
    // -----------------------------------------------------------------
    // --- API AJOUTÉE : GET /api/v1/rounds/config/timers ---
    // -----------------------------------------------------------------
    /**
     * ✅ NOUVEAU: Endpoint pour récupérer les vraies durées des timers
     * Permet au client de synchroniser ses timers avec le serveur
     * Source de vérité unique pour les durées de timers
     */
    router.get("/config/timers", cacheResponse(3600), (req, res) => {
        res.json({
            MOVIE_SCREEN_DURATION_MS,
            FINISH_SCREEN_DURATION_MS,
            TOTAL_RACE_TIME_MS,
            ROUND_WAIT_DURATION_MS,
            TIMER_UPDATE_INTERVAL_MS
        });
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
    // ✅ PROBLÈME #15 CORRIGÉ: Cache réduit à 2s (au lieu de 5s) pour éviter les données obsolètes
    router.get("/status", cacheResponse(2), async (req, res) => {
        const now = Date.now();
        // ✅ UTILISER LES CONSTANTES UNIFIÉES IMPORTÉES DE config/app.config.js
        // Pas de redéfinition locale des timers!

        // ✅ PROBLÈME #15 CORRIGÉ: GET endpoint sans side effects
        // La création automatique de round a été déplacée vers POST /api/v1/rounds/ avec action=reset_timer
        // Si le timer est bloqué, l'admin peut appeler POST /api/v1/rounds/ avec action=reset_timer

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
            // MAIS: Vérifier d'abord si isRaceRunning est bloqué (état orphelin)
            if (gameState.isRaceRunning) {
                let shouldReset = false;
                let resetReason = '';
                
                // ✅ Vérification 1: isRaceRunning=true mais pas de raceStartTime = état incohérent
                if (!gameState.raceStartTime) {
                    shouldReset = true;
                    resetReason = 'isRaceRunning=true mais raceStartTime=null (état incohérent)';
                }
                // ✅ Vérification 2: Course "en cours" depuis trop longtemps = état bloqué
                else {
                    const elapsed = Date.now() - gameState.raceStartTime;
                    // ✅ CORRECTION: Vérifier si les timers sont toujours actifs
                    const hasActiveTimers = gameState.timers.finish !== null || gameState.timers.cleanup !== null;
                    
                    if (elapsed > TOTAL_RACE_TIME_MS + 15000) { // 35s + 15s de marge
                        shouldReset = true;
                        resetReason = `isRaceRunning bloqué depuis ${elapsed}ms (>${TOTAL_RACE_TIME_MS + 15000}ms)`;
                    } else if (!hasActiveTimers && elapsed > 2000) {
                        // ✅ NOUVEAU: Si les timers sont morts mais isRaceRunning est toujours true après 2s,
                        // c'est probablement un état bloqué (les timers devraient être actifs pendant 35s)
                        // On utilise 2s au lieu de 5s pour détecter plus rapidement les problèmes
                        shouldReset = true;
                        resetReason = `isRaceRunning=true mais timers inactifs depuis ${elapsed}ms (probable crash ou timers non démarrés)`;
                    }
                }
                
                // ✅ Vérification 3: Pas de séquence active dans activeRaces = état orphelin
                if (!shouldReset && raceTimerManager.activeRaces.size === 0) {
                    // ✅ CORRECTION: Vérifier aussi si raceStartTime existe et si le temps écoulé est > 5s
                    // Si la course vient juste de démarrer (< 5s), c'est probablement un double clic, pas un état orphelin
                    if (!gameState.raceStartTime || (Date.now() - gameState.raceStartTime) > 5000) {
                        shouldReset = true;
                        resetReason = 'isRaceRunning=true mais aucune séquence active dans activeRaces';
                    }
                }
                
                if (shouldReset) {
                    console.warn(`[FINISH] ⚠️ État bloqué détecté: ${resetReason}, réinitialisation...`);
                    gameState.isRaceRunning = false;
                    gameState.raceStartTime = null;
                    gameState.raceEndTime = null;
                    // Nettoyer aussi les timers au cas où
                    clearAllTimers();
                    raceTimerManager.activeRaces.clear();
                    console.log('[FINISH] ✅ État réinitialisé, la course peut maintenant être lancée');
                } else {
                    // C'est vraiment une course en cours, ignorer la requête
                    // Mais logger plus d'informations pour le débogage
                    const elapsed = gameState.raceStartTime ? Date.now() - gameState.raceStartTime : 0;
                    const hasActiveTimers = gameState.timers.finish !== null || gameState.timers.cleanup !== null;
                    console.warn(`[FINISH] Une course est déjà en cours (elapsed=${elapsed}ms, timers=${hasActiveTimers ? 'actifs' : 'inactifs'}, activeRaces=${raceTimerManager.activeRaces.size}), ignoré`);
                    return res.json(wrap({ skipped: true, reason: 'race already running' }));
                }
            }

            // ✅ CORRECTION: Vérifier que operationLock n'est pas bloqué
            // Si le lock est bloqué depuis plus de 60s, le libérer (probable crash/erreur)
            if (gameState.operationLock) {
                console.warn('[FINISH] ⚠️ operationLock est actif, attente...');
                // Attendre un peu pour voir si le lock se libère
                let waitCount = 0;
                while (gameState.operationLock && waitCount < 10) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    waitCount++;
                }
                if (gameState.operationLock) {
                    console.warn('[FINISH] ⚠️ operationLock toujours actif après 1s, libération forcée (probable crash précédent)');
                    gameState.operationLock = false;
                    // Réinitialiser aussi isRaceRunning au cas où
                    if (gameState.isRaceRunning && gameState.raceStartTime) {
                        const elapsed = Date.now() - gameState.raceStartTime;
                        if (elapsed > TOTAL_RACE_TIME_MS + 10000) {
                            console.warn('[FINISH] ⚠️ isRaceRunning bloqué depuis trop longtemps, réinitialisation');
                            gameState.isRaceRunning = false;
                            gameState.raceStartTime = null;
                        }
                    }
                }
            }

            try {
                const roundId = gameState.currentRound?.id;
                if (!roundId) {
                    console.error('[FINISH] ❌ Aucun round disponible');
                    return res.status(400).json({ error: 'No round available' });
                }
                
                // ✅ CORRECTION: Utiliser un ID unique pour chaque séquence de course
                // Combiner roundId + timestamp pour éviter les conflits si le même roundId est réutilisé
                const raceSequenceId = `${roundId}-${Date.now()}`;
                
                // ✅ UTILISER LE GESTIONNAIRE CENTRALISÉ
                const success = raceTimerManager.startRaceSequence(raceSequenceId, raceCallbacks);
                
                if (!success) {
                    console.warn('[FINISH] ⚠️ startRaceSequence a retourné false, nettoyage de activeRaces...');
                    // Nettoyer les anciennes séquences orphelines
                    raceTimerManager.activeRaces.clear();
                    // Réessayer
                    const retrySuccess = raceTimerManager.startRaceSequence(raceSequenceId, raceCallbacks);
                    if (!retrySuccess) {
                        return res.json(wrap({ skipped: true, reason: 'race sequence already active after cleanup' }));
                    }
                }

                // Répondre immédiatement au client
                res.json(wrap({ success: true }));

            } catch (err) {
                console.error('[FINISH] Erreur:', err && err.message ? err.message : err);
                // ✅ CORRECTION: Libérer le lock en cas d'erreur
                gameState.operationLock = false;
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
            
            // ✅ Utiliser createNewRound() (fonction unifiée)
            // Action new_game est appelée manuellement par le client
            // pas après une course, donc archiveCurrentRound=false
            // checkLock=true pour éviter les doublons
            await createNewRound({
              broadcast: broadcast,
              raceStartTime: gameState.raceStartTime,
              archiveCurrentRound: false,  // new_game ne vient pas d'une course
              checkLock: true              // Éviter les doublons
            });
            
            // ✅ Créer le timer pour le prochain round
            const now = Date.now();
            gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;
            
            broadcast({
                event: 'timer_update',
                serverTime: now,
                roundId: gameState.currentRound?.id,
                timer: {
                    timeLeft: ROUND_WAIT_DURATION_MS,
                    totalDuration: ROUND_WAIT_DURATION_MS,
                    startTime: now,
                    endTime: gameState.nextRoundStartTime
                }
            });
            
            // ✅ createNewRoundAfterRace() a déjà créé le round en base de données
            // Pas besoin d'appeler createRound() à nouveau
            console.log(`[ROUNDS] Nouveau round créé avec succès (ID synchronisé)`);
            return res.json(wrap({ success: true, round: gameState.currentRound }));
        }

        // Action inconnue
        console.warn(`[ROUNDS] Action inconnue : ${action}`);
        return res.status(400).json({ error: "Unknown action" });
    });

    return router;
}