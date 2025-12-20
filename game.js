// game.js

// Importer ChaCha20 RNG - cryptographiquement sécurisé pour les jeux d'argent
import { chacha20Random, chacha20RandomInt, chacha20Shuffle, initChaCha20 } from './chacha20.js';
import { pool } from './config/db.js';
import { getNextRoundNumber, getNextRoundId, initRoundIdManager } from './utils/roundNumberManager.js';
import { cacheSet, cacheGet, cacheDelPattern } from './config/redis.js';
import { saveWinner, getRecentWinners } from './models/winnerModel.js';
import dbStrategy from './config/db-strategy.js';
import { ROUND_WAIT_DURATION_MS } from './config/app.config.js';

// Initialiser ChaCha20 RNG au démarrage
initChaCha20();

// ========================================
// Participants de base - SOURCE DE VÉRITÉ UNIQUE
// ⚠️ Utiliser UNIQUEMENT cette constante pour initialiser les participants
// ========================================
export const BASE_PARTICIPANTS = [
    { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0 },
    { number: 7, name: "Ronaldo", coeff: 4.7, family: 1, place: 0 },
    { number: 8, name: "Mbappe", coeff: 7.2, family: 2, place: 0 },
    { number: 9, name: "Halland", coeff: 5.8, family: 3, place: 0 },
    { number: 10, name: "Messi", coeff: 8.1, family: 4, place: 0 },
    { number: 54, name: "Vinicius", coeff: 4.5, family: 5, place: 0 }
];

// L'état est encapsulé dans un objet pour être partageable
export const gameState = {
    currentRound: {},
    gameHistory: [],
    nextRoundStartTime: null, // timestamp du prochain lancement de tour, null signifie qu'aucun minuteur n'est en cours (une course est active)
    // ✅ PROBLÈME #18: timerInterval supprimé (jamais utilisé, remplacé par timers.nextRound)
    autoLoopActive: false, // Flag pour éviter les boucles multiples
    raceStartTime: null, // Timestamp du début de la course actuelle (pour synchronisation)
    raceEndTime: null, // Timestamp de la fin de la course actuelle
    isRaceRunning: false, // Indique si une course est actuellement en cours
    // ✅ SUPPRIMÉ: runningRoundData - Utiliser currentRound directement et sauvegarder en DB avant de créer le nouveau round
    // ✅ CENTRALISATION DE TOUS LES TIMERS
    timers: {
        nextRound: null,  // Timer du prochain round (avant la course)
        finish: null,     // Timer pour la fin de la course
        prepare: null,    // Timer pour préparer le nouveau round
        cleanup: null     // Timer pour nettoyer après la course
    },
    // ✅ LOCK GLOBAL UNIFIÉ POUR ÉVITER LES EXÉCUTIONS MULTIPLES
    // Remplace finishLock et roundCreationLock par un seul lock unifié
    operationLock: false,  // ✅ Lock unifié pour toutes les opérations critiques (race finish, round creation)
    // ✅ PROBLÈME #19: preStartTimer déclaré explicitement (au lieu de propriété dynamique)
    preStartTimer: null  // Timer pour le pré-démarrage du round
};

// ✅ ROUND ID GENERATION: Utilise la séquence PostgreSQL pour garantir unicité et persistance
// ⚠️ IMPORTANT: Appeler initRoundIdManager() au démarrage du serveur
export async function generateRoundId() {
    return await getNextRoundId();
}

// Simple helper pour envelopper les réponses
export function wrap(data) {
    return { data };
}

/**
 * ✅ FONCTION UNIFIÉE: Crée un nouveau round avec toute la logique consolidée
 * Remplace startNewRound() et createNewRoundAfterRace()
 * 
 * @param {Object} options Configuration de la création
 *   - broadcast: function - Fonction pour notifier les clients WebSocket
 *   - raceStartTime: number - Timestamp du début de la course (pour logs)
 *   - archiveCurrentRound: boolean - Archiver le round actuel avant d'en créer un nouveau (default: false)
 *   - checkLock: boolean - Vérifier et acquérir le lock (default: true)
 */
export async function createNewRound(options = {}) {
    const {
        broadcast = null,
        raceStartTime = null,
        archiveCurrentRound = false,
        checkLock = true
    } = options;

    console.log(`[ROUND-CREATE] 🎬 Création d'un nouveau round (archive=${archiveCurrentRound}, lock=${checkLock})`);

    // 1️⃣ GÉRER LE LOCK: Éviter la double création
    if (checkLock) {
        if (gameState.operationLock) {
            console.warn('[ROUND-CREATE] ⚠️ Opération déjà en cours, ignorée');
            return null;
        }
        gameState.operationLock = true;
        console.log('[LOCK] 🔒 operationLock acquis par createNewRound()');
    }

    try {
        // 2️⃣ ARCHIVER LE ROUND ACTUEL (si demandé)
        if (archiveCurrentRound && gameState.currentRound.id) {
            const finishedRound = {
                id: gameState.currentRound.id,
                receipts: JSON.parse(JSON.stringify(gameState.currentRound.receipts || [])),
                participants: JSON.parse(JSON.stringify(gameState.currentRound.participants || [])),
                totalPrize: gameState.currentRound.totalPrize || 0,
                winner: (gameState.currentRound.participants || []).find(p => p.place === 1) || null,
            };
            
            // Éviter la duplication
            if (!gameState.gameHistory.some(r => r.id === finishedRound.id)) {
                gameState.gameHistory.push(finishedRound);
                console.log(`[ROUND-CREATE] ✅ Round #${finishedRound.id} archivé dans gameHistory`);
                
                // ✅ NOUVEAU: Sauvegarder le gagnant en base de données
                if (finishedRound.winner && finishedRound.winner.id) {
                    const savedWinner = await saveWinner(finishedRound.id, {
                        id: finishedRound.winner.id,
                        number: finishedRound.winner.number,
                        name: finishedRound.winner.name,
                        family: finishedRound.winner.family,
                        prize: finishedRound.totalPrize
                    });
                    if (savedWinner) {
                        console.log(`[ROUND-CREATE] ✅ Gagnant sauvegardé en BD: ${finishedRound.winner.name} (Round #${finishedRound.id})`);
                    }
                }
            } else {
                console.warn(`[ROUND-CREATE] ⚠️ Round #${finishedRound.id} déjà archivé`);
            }

            // Garder seulement les 10 derniers rounds
            if (gameState.gameHistory.length > 10) {
                gameState.gameHistory.shift();
            }

            // ✅ SUPPRIMÉ: runningRoundData - Les données sont déjà dans gameHistory et seront sauvegardées en DB
        }

        // 3️⃣ CRÉER LE NOUVEAU ROUND
        const newRoundId = await generateRoundId();
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
        console.log(`[ROUND-CREATE] ✅ Nouveau round #${newRoundId} en mémoire`);

        // 4️⃣ PERSISTER EN BASE DE DONNÉES
        try {
            const roundNum = await getNextRoundNumber();
            const insertRes = await pool.query(
                `INSERT INTO rounds (round_id, round_number, status, created_at) 
                 VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
                 ON CONFLICT (round_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                 RETURNING round_id`,
                [newRoundId, roundNum]
            );
            gameState.currentRound.persisted = true;
            console.log(`[ROUND-CREATE] ✅ Round #${roundNum} (ID: ${newRoundId}) persisté en DB`);
        } catch (err) {
            console.error('[ROUND-CREATE] ❌ Erreur persistence DB:', err.message);
            gameState.currentRound.persisted = false;
        }

        // 5️⃣ INITIALISER CACHE REDIS
        try {
            await dbStrategy.initRoundCache(newRoundId, gameState.currentRound);
            console.log(`[ROUND-CREATE] ✅ Cache Redis initialisé pour round #${newRoundId}`);
        } catch (err) {
            console.error('[ROUND-CREATE] ❌ Erreur initialisation cache:', err.message);
        }

        // 6️⃣ CONFIGURER LE TIMER POUR LE NOUVEAU ROUND
        // ✅ CRITIQUE: Définir nextRoundStartTime pour que le timer fonctionne
        const now = Date.now();
        gameState.nextRoundStartTime = now + ROUND_WAIT_DURATION_MS;
        console.log(`[ROUND-CREATE] ⏱️ Timer configuré: ${ROUND_WAIT_DURATION_MS}ms (fin à ${new Date(gameState.nextRoundStartTime).toISOString()})`);

        // 7️⃣ BROADCAST AUX CLIENTS
        if (broadcast && typeof broadcast === 'function') {
            const elapsedFromRaceStart = raceStartTime ? (now - raceStartTime) : 0;
            
            console.log(`[ROUND-CREATE] 🎙️ Broadcasting new_round (elapsed: ${elapsedFromRaceStart}ms)`);
            
            broadcast({
                event: "new_round",
                roundId: newRoundId,
                game: JSON.parse(JSON.stringify(newRound)),
                currentRound: JSON.parse(JSON.stringify(newRound)),
                participants: newRound.participants,
                isRaceRunning: gameState.isRaceRunning,
                raceStartTime: gameState.isRaceRunning ? gameState.raceStartTime : null,
                raceEndTime: gameState.isRaceRunning ? gameState.raceEndTime : null,
                gameHistory: gameState.gameHistory || [],
                timer: {
                    timeLeft: ROUND_WAIT_DURATION_MS,
                    totalDuration: ROUND_WAIT_DURATION_MS,
                    startTime: now,
                    endTime: gameState.nextRoundStartTime
                }
            });
        } else {
            console.warn('[ROUND-CREATE] ⚠️ Fonction broadcast non fournie');
        }

        // 8️⃣ ✅ SAUVEGARDER LE GAMESTATE EN REDIS (CRITICAL!)
        // Cela sauvegarde le currentRound + gameHistory + tous les états
        try {
            await saveGameStateToRedis();
            console.log(`[ROUND-CREATE] ✅ GameState sauvegardé en Redis`);
        } catch (err) {
            console.error('[ROUND-CREATE] ⚠️ Erreur sauvegarde gameState:', err.message);
        }

            console.log(`[ROUND-CREATE] 🎉 Round #${newRoundId} créé avec succès`);
            console.log(`[ROUND-CREATE] 📊 Vérification finale:`);
            console.log(`   - Round ID: ${gameState.currentRound.id}`);
            console.log(`   - Participants: ${gameState.currentRound.participants?.length || 0}`);
            console.log(`   - Timer configuré: ${gameState.nextRoundStartTime ? 'Oui' : 'Non'}`);
            console.log(`   - Persisté en DB: ${gameState.currentRound.persisted ? 'Oui' : 'Non'}`);
            
            return newRoundId;

    } finally {
        // 9️⃣ LIBÉRER LE LOCK
        if (checkLock) {
            gameState.operationLock = false;
            console.log('[LOCK] 🔓 operationLock libéré par createNewRound()');
        }
    }
}

/**
 * ✅ MAINTENUE POUR COMPATIBILITÉ BACKWARDS
 * Utilise maintenant la fonction unifiée createNewRound()
 * 
 * Archive le tour terminé et en démarre un nouveau.
 * @param {function} broadcast - La fonction pour notifier les clients WebSocket.
 * @param {boolean} archiveCurrentRound - Si true, archive le round actuel (default: false pour démarrage)
 */
export async function startNewRound(broadcast, archiveCurrentRound = false) {
    console.log(`🏁 startNewRound() appelée - redirection vers createNewRound()`);
    
    // ✅ CORRECTION: Au démarrage, ne pas archiver si aucun round n'existe
    const shouldArchive = archiveCurrentRound && gameState.currentRound && gameState.currentRound.id;
    
    return await createNewRound({
        broadcast: broadcast,
        archiveCurrentRound: shouldArchive,  // Archive seulement si un round existe
        checkLock: false             // Pas de lock au démarrage
    });
}

/**
 * Sauvegarde l'état du jeu complet en Redis avec TTL de 1 heure
 * Permet la récupération après crash serveur
 */
export async function saveGameStateToRedis() {
    try {
        await cacheSet('game:state:current', gameState, 3600);
        console.log(`✅ [CACHE] GameState sauvegardé en Redis`);
        return true;
    } catch (err) {
        console.error(`⚠️ [CACHE] Erreur sauvegarde gameState:`, err.message);
        return false;
    }
}

/**
 * Récupère l'état du jeu depuis Redis (après crash serveur)
 */
export async function restoreGameStateFromRedis() {
    try {
        const savedState = await cacheGet('game:state:current');
        if (savedState) {
            // Restaure les propriétés clés
            gameState.currentRound = savedState.currentRound || {};
            gameState.gameHistory = savedState.gameHistory || [];
            gameState.nextRoundStartTime = savedState.nextRoundStartTime;
            gameState.raceStartTime = savedState.raceStartTime;
            gameState.raceEndTime = savedState.raceEndTime;
            gameState.isRaceRunning = savedState.isRaceRunning;
            
            // ✅ CRITIQUE: Réinitialiser TOUS les locks au redémarrage
            // Les locks ne doivent JAMAIS être persistés en Redis
            gameState.operationLock = false;
            console.log(`✅ [CACHE] GameState restauré depuis Redis (locks réinitialisés)`);
            return true;
        }
        return false;
    } catch (err) {
        console.error(`⚠️ [CACHE] Erreur restauration gameState:`, err.message);
        return false;
    }
}

/**
 * Invalide le cache du gameState (après modification importante)
 */
export async function invalidateGameStateCache() {
    try {
        await cacheDelPattern('game:state:*');
        console.log(`✅ [CACHE] GameState cache invalidé`);
        return true;
    } catch (err) {
        console.error(`⚠️ [CACHE] Erreur invalidation gameState cache:`, err.message);
        return false;
    }
}

/**
 * ✅ NOUVEAU: Charge l'historique des gagnants depuis la base de données au démarrage
 * Permet la persistance et l'affichage après redémarrage du serveur
 */
export async function loadWinnersHistoryFromDatabase() {
    try {
        const recentWinners = await getRecentWinners(10);
        
        if (recentWinners && recentWinners.length > 0) {
            // Transformer les données de la BD au format gameHistory
            const winnersWithRoundData = recentWinners.map(winner => ({
                id: winner.id,
                winner: {
                    id: winner.participant_id,
                    number: winner.number,
                    name: winner.name,
                    family: winner.family
                },
                totalPrize: winner.prize
            }));
            
            // Fusionner avec l'historique existant (préférer les données de la BD)
            gameState.gameHistory = winnersWithRoundData;
            console.log(`✅ [STARTUP] ${recentWinners.length} gagnants chargés depuis la BD`);
            return true;
        } else {
            console.log(`ℹ️ [STARTUP] Aucun gagnant trouvé dans la BD`);
            return false;
        }
    } catch (err) {
        console.error(`⚠️ [STARTUP] Erreur lors du chargement des gagnants depuis la BD:`, err.message);
        return false;
    }
}
