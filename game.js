// game.js

// Importer ChaCha20 RNG - cryptographiquement sécurisé pour les jeux d'argent
import { chacha20Random, chacha20RandomInt, chacha20Shuffle, initChaCha20 } from './chacha20.js';
import { pool } from './config/db.js';
import { getNextRoundNumber, getNextRoundId, initRoundIdManager } from './utils/roundNumberManager.js';
import { cacheSet, cacheGet, cacheDelPattern } from './config/redis.js';
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
                
                // ✅ CORRECTION CRITIQUE: NE PAS sauvegarder le gagnant ici
                // Le gagnant est déjà sauvegardé dans calculateRaceResults() (routes/rounds.js)
                // après avoir été déterminé correctement.
                // Sauvegarder ici causerait des incohérences car le gagnant peut être null
                // ou incorrect à ce moment-là.
                console.log(`[ROUND-CREATE] ℹ️ Gagnant du round #${finishedRound.id} déjà sauvegardé dans calculateRaceResults()`);
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
        
        // ✅ CORRECTION CRITIQUE: Mélanger l'ordre des participants pour éviter les patterns
        // Cela garantit que l'index du gagnant sélectionné aléatoirement pointe vers différents participants
        const shuffledParticipants = chacha20Shuffle([...BASE_PARTICIPANTS]);
        console.log(`[ROUND-CREATE] 🎲 Participants mélangés:`, shuffledParticipants.map(p => `№${p.number} ${p.name}`).join(', '));

        const newRound = {
            id: newRoundId,
            participants: shuffledParticipants.map((p, i) => ({
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

        // 4️⃣ PERSISTER EN BASE DE DONNÉES (TRANSACTION ATOMIQUE)
        console.log(`[ROUND-CREATE] 🔄 Début persistance round ${newRoundId} en DB...`);
        try {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                console.log(`[ROUND-CREATE] 🔄 Transaction BEGIN pour round ${newRoundId}`);
                
                const roundNum = await getNextRoundNumber();
                const insertRes = await client.query(
                    `INSERT INTO rounds (round_id, round_number, status, created_at) 
                     VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
                     ON CONFLICT (round_id) DO NOTHING
                     RETURNING round_id`,
                    [newRoundId, roundNum]
                );
                
                // ✅ VÉRIFICATION: S'assurer que l'insertion a réussi
                // Si ON CONFLICT DO NOTHING est déclenché, insertRes.rows sera vide
                // Il faut vérifier si le round existe déjà dans la même transaction
                if (!insertRes.rows || !insertRes.rows[0]) {
                    // Vérifier si le round existe déjà (dans la même transaction)
                    const existingRes = await client.query(
                        `SELECT round_id, status FROM rounds WHERE round_id = $1`,
                        [newRoundId]
                    );
                    if (existingRes.rows && existingRes.rows[0]) {
                        const existingRound = existingRes.rows[0];
                        console.log(`[ROUND-CREATE] ℹ️ Round ${newRoundId} existe déjà avec status=${existingRound.status} (ON CONFLICT)`);
                        // Si le round existe déjà, considérer comme persisté
                        gameState.currentRound.persisted = true;
                        await client.query('COMMIT');
                        // ✅ VÉRIFICATION POST-COMMIT: S'assurer que le round est visible
                        await new Promise(resolve => setTimeout(resolve, 100)); // Délai pour la visibilité du commit
                        const verifyRes = await pool.query(
                            `SELECT round_id FROM rounds WHERE round_id = $1`,
                            [newRoundId]
                        );
                        if (!verifyRes.rows || !verifyRes.rows[0]) {
                            console.error(`[ROUND-CREATE] ❌ Round ${newRoundId} non visible après commit!`);
                            gameState.currentRound.persisted = false; // Marquer comme non persisté si non visible
                        } else {
                            console.log(`[ROUND-CREATE] ✅ Round ${newRoundId} vérifié et visible en DB`);
                        }
                        return newRoundId;
                    } else {
                        // Round n'existe pas et insertion a échoué - erreur critique
                        throw new Error(`Round ${newRoundId} insertion failed: no rows returned and round does not exist`);
                    }
                }
                
                await client.query('COMMIT');
                console.log(`[ROUND-CREATE] ✅ Round #${roundNum} (ID: ${newRoundId}) commité en DB`);
                
                // Libérer le client AVANT la vérification (utiliser le pool global)
                client.release();
                
                // ✅ VÉRIFICATION POST-COMMIT: S'assurer que le round est visible immédiatement
                // Utiliser le pool global (nouvelle connexion) pour vérifier la visibilité
                await new Promise(resolve => setTimeout(resolve, 100)); // Délai pour la visibilité du commit
                
                let verified = false;
                for (let verifyAttempt = 0; verifyAttempt < 10; verifyAttempt++) {
                    try {
                        const verifyRes = await pool.query(
                            `SELECT round_id, status FROM rounds WHERE round_id = $1`,
                            [newRoundId]
                        );
                        if (verifyRes.rows && verifyRes.rows[0]) {
                            console.log(`[ROUND-CREATE] ✅ Round ${newRoundId} vérifié et visible en DB (attempt ${verifyAttempt + 1}, status: ${verifyRes.rows[0].status})`);
                            verified = true;
                            gameState.currentRound.persisted = true;
                            break;
                        }
                    } catch (verifyErr) {
                        console.warn(`[ROUND-CREATE] Erreur vérification round ${newRoundId} (attempt ${verifyAttempt + 1}):`, verifyErr.message);
                    }
                    if (verifyAttempt < 9) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
                
                if (!verified) {
                    console.error(`[ROUND-CREATE] ❌ Round ${newRoundId} non visible après commit après 10 tentatives!`);
                    gameState.currentRound.persisted = false; // Marquer comme non persisté
                    throw new Error(`Round ${newRoundId} non visible en DB après commit - persistance échouée`);
                }
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } catch (err) {
            console.error('[ROUND-CREATE] ❌ Erreur persistence DB:', err.message);
            gameState.currentRound.persisted = false;
            // ✅ CRITIQUE: Ne pas initialiser Redis si la DB échoue
            // ⚠️ Ne pas propager l'erreur pour permettre le broadcast et la configuration du timer
            // Le round reste en mémoire mais non persisté, ce qui sera détecté lors de la création de tickets
            console.warn('[ROUND-CREATE] ⚠️ Round créé en mémoire mais non persisté en DB - les tickets devront attendre');
        }

        // 5️⃣ INITIALISER CACHE REDIS (seulement si DB a réussi)
        // ✅ CRITIQUE: Ne pas initialiser Redis si la DB a échoué
        if (gameState.currentRound.persisted) {
            try {
                await dbStrategy.initRoundCache(newRoundId, gameState.currentRound);
                console.log(`[ROUND-CREATE] ✅ Cache Redis initialisé pour round #${newRoundId}`);
            } catch (err) {
                console.error('[ROUND-CREATE] ❌ Erreur initialisation cache:', err.message);
                // Ne pas bloquer si Redis échoue, mais logger l'erreur
            }
        } else {
            console.warn(`[ROUND-CREATE] ⚠️ Redis non initialisé car round non persisté en DB`);
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
        // ✅ IMPORTANT: activer le lock pour éviter les doubles créations (auto-start, double clic, re-entrance)
        // Si un appel spécifique doit bypass le lock, utiliser createNewRound({ checkLock: false }) directement.
        checkLock: true
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


