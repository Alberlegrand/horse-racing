// game.js

// Importer ChaCha20 RNG - cryptographiquement sécurisé pour les jeux d'argent
import { chacha20Random, chacha20RandomInt, chacha20Shuffle, initChaCha20 } from './chacha20.js';
import { pool } from './config/db.js';
import { getNextRoundNumber, getNextRoundId, initRoundIdManager, formatRoundId } from './utils/roundNumberManager.js';
import { cacheSet, cacheGet, cacheDelPattern } from './config/redis.js';
import dbStrategy from './config/db-strategy.js';
import { ROUND_WAIT_DURATION_MS } from './config/app.config.js';

// Import crypto pour génération de seed aléatoire (Node.js)
// Utilisation d'une fonction helper pour charger crypto de manière dynamique
let nodeCryptoModule = null;
function getNodeCrypto() {
    if (nodeCryptoModule === null) {
        try {
            if (typeof require !== 'undefined') {
                nodeCryptoModule = require('crypto');
            }
        } catch (err) {
            // crypto peut ne pas être disponible dans certains environnements
            nodeCryptoModule = false; // Marquer comme non disponible
        }
    }
    return nodeCryptoModule;
}

// Initialiser ChaCha20 RNG au démarrage
initChaCha20();

// ========================================
// Participants de base - SOURCE DE VÉRITÉ UNIQUE
// ⚠️ Utiliser UNIQUEMENT cette constante pour initialiser les participants
// ========================================
export const BASE_PARTICIPANTS = [
    { number: 6, name: "De Bruyne", coeff: 5.5, family: 0, place: 0 },
    { number: 7, name: "Ronaldo", coeff: 4.7, family: 1, place: 0},
    { number: 8, name: "Mbappe", coeff: 7.2, family: 2, place: 0 },
    { number: 9, name: "Halland", coeff: 5.8, family: 3, place: 0},
    { number: 10, name: "Messi", coeff: 8.1, family: 4, place: 0},
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
        
        // ✅ CRITIQUE: Réinitialiser le RNG avec un seed unique et cryptographiquement aléatoire pour chaque round
        // Cela garantit que chaque round a une distribution complètement aléatoire et indépendante
        // Le seed est généré avec crypto.randomBytes() pour garantir un vrai aléatoire cryptographique
        let roundSeed;
        try {
            // Priorité 1: Utiliser crypto.randomBytes() de Node.js (le plus sûr)
            const nodeCrypto = getNodeCrypto();
            if (nodeCrypto && nodeCrypto.randomBytes) {
                const buf = nodeCrypto.randomBytes(32); // 32 bytes = 8 * 4 bytes (8 Uint32)
                const arr = new Uint32Array(buf.buffer);
                roundSeed = Array.from(arr);
                console.log(`[ROUND-CREATE] 🔐 Seed généré avec crypto.randomBytes() (Node.js)`);
            }
            // Priorité 2: Utiliser crypto.getRandomValues() (Browser ou Node.js global)
            else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                const arr = new Uint32Array(8);
                crypto.getRandomValues(arr);
                roundSeed = Array.from(arr);
                console.log(`[ROUND-CREATE] 🔐 Seed généré avec crypto.getRandomValues()`);
            }
            // Fallback final: combiner timestamp + roundId + Math.random (moins idéal mais fonctionnel)
            else {
                throw new Error('No crypto available');
            }
        } catch (err) {
            console.warn(`[ROUND-CREATE] ⚠️ Erreur génération seed crypto, utilisation fallback:`, err.message);
            // Fallback en cas d'erreur: combiner timestamp + roundId + Math.random
            const timestamp = Date.now();
            const roundIdNum = typeof newRoundId === 'string' ? parseInt(newRoundId.replace(/\D/g, ''), 10) : newRoundId;
            roundSeed = [
                timestamp & 0xFFFFFFFF,
                (timestamp >>> 32) & 0xFFFFFFFF,
                roundIdNum & 0xFFFFFFFF,
                (roundIdNum >>> 32) & 0xFFFFFFFF,
                Math.floor(Math.random() * 0xFFFFFFFF),
                Math.floor(Math.random() * 0xFFFFFFFF),
                Math.floor(Math.random() * 0xFFFFFFFF),
                Math.floor(Math.random() * 0xFFFFFFFF)
            ];
            console.warn(`[ROUND-CREATE] ⚠️ Seed fallback utilisé (timestamp + roundId + Math.random)`);
        }
        
        // Réinitialiser le RNG avec le seed unique du round
        initChaCha20(roundSeed);
        console.log(`[ROUND-CREATE] 🎲 RNG réinitialisé avec seed cryptographique unique pour round #${newRoundId}`);
        console.log(`[ROUND-CREATE] 🔑 Seed complet (hex): [${roundSeed.map(s => s.toString(16).padStart(8, '0')).join(', ')}]`);
        console.log(`[ROUND-CREATE] 🔑 Seed (décimal): [${roundSeed.join(', ')}]`);
        
       
        // ✅ ARCHITECTURE SIMPLIFIÉE: Pas de places au démarrage
        // Les places seront attribuées par profit-choice APRÈS réception des paris
        // et AVANT le broadcast de race_start
        
        const participantsWithoutPlaces = BASE_PARTICIPANTS.map(p => ({ ...p, place: 0 }));
        
        console.log(`[ROUND-CREATE] 📋 Participants créés (places seront attribuées par profit-choice au démarrage de la course):`);
        participantsWithoutPlaces.forEach((p, idx) => {
            console.log(`   [${idx}] №${p.number} ${p.name} (family: ${p.family}, coeff: ${p.coeff})`);
        });

        const newRound = {
            id: newRoundId,
            participants: participantsWithoutPlaces,  // ✅ place:0 = EN ATTENTE
            receipts: [],
            lastReceiptId: 3,
            totalPrize: 0,
            persisted: false
        };
        
        // ✅ ARCHITECTURE FINALE - SIMPLE ET EFFICACE:
        // T=?s: Paris reçus via POST /api/bets
        // T=Race Start: Appel à profit-choice() → détermine places 1-6 POUR TOUS les participants
        // T=0s: race_start broadcast avec places finales du profit-choice
        // T=30s: race_end event
        // T=40s: finish_screen affiche gagnant
        
        console.log(`[ROUND-CREATE] ⏰ TIMELINE SIMPLIFIÉE:`);
        console.log(`[ROUND-CREATE]   - Participants initialisés avec place:0`);
        console.log(`[ROUND-CREATE]   - Au démarrage de la course: profit-choice attribue les places 1-6`);
        console.log(`[ROUND-CREATE]   - race_start broadcast avec places finales du profit-choice`);

        gameState.currentRound = newRound;
        console.log(`[ROUND-CREATE] ✅ Nouveau round #${newRoundId} en mémoire`);
        console.log(`[ROUND-CREATE] 🔍 Debug: round.id type=${typeof newRoundId}, value="${newRoundId}", truthy=${!!newRoundId}`);

        // 4️⃣ PERSISTER EN BASE DE DONNÉES (TRANSACTION ATOMIQUE)
        console.log(`[ROUND-CREATE] 🔄 Début persistance round ${newRoundId} en DB...`);
        let shouldReturnEarly = false; // Flag pour retour anticipé après le finally
        try {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                console.log(`[ROUND-CREATE] 🔄 Transaction BEGIN pour round ${newRoundId}`);
                
                const roundNum = await getNextRoundNumber();
                // ✅ CONVERSION: Convertir le round_id formaté (string) en nombre pour l'insertion DB
                // Le round_id est stocké comme BIGINT en DB mais formaté comme string dans le code
                const roundIdForDb = typeof newRoundId === 'string' ? parseInt(newRoundId, 10) : newRoundId;
                const insertRes = await client.query(
                    `INSERT INTO rounds (round_id, round_number, status, created_at) 
                     VALUES ($1, $2, 'waiting', CURRENT_TIMESTAMP) 
                     ON CONFLICT (round_id) DO NOTHING
                     RETURNING round_id`,
                    [roundIdForDb, roundNum]
                );
                
                // ✅ VÉRIFICATION: S'assurer que l'insertion a réussi
                // Si ON CONFLICT DO NOTHING est déclenché, insertRes.rows sera vide
                // Il faut vérifier si le round existe déjà dans la même transaction
                if (!insertRes.rows || !insertRes.rows[0]) {
                    // Vérifier si le round existe déjà (dans la même transaction)
                    const existingRes = await client.query(
                        `SELECT round_id, status FROM rounds WHERE round_id = $1`,
                        [roundIdForDb]
                    );
                    if (existingRes.rows && existingRes.rows[0]) {
                        const existingRound = existingRes.rows[0];
                        console.log(`[ROUND-CREATE] ℹ️ Round ${newRoundId} existe déjà avec status=${existingRound.status} (ON CONFLICT)`);
                        // Si le round existe déjà, considérer comme persisté
                        gameState.currentRound.persisted = true;
                        await client.query('COMMIT');
                        // ✅ CRITIQUE: Ne pas libérer le client ici - le bloc finally le fera
                        // Libérer ici causerait un double release
                        
                        // ✅ VÉRIFICATION POST-COMMIT: S'assurer que le round est visible
                        // Utiliser le pool global (nouvelle connexion) pour vérifier la visibilité
                        await new Promise(resolve => setTimeout(resolve, 100)); // Délai pour la visibilité du commit
                        const verifyRes = await pool.query(
                            `SELECT round_id FROM rounds WHERE round_id = $1`,
                            [roundIdForDb]
                        );
                        if (!verifyRes.rows || !verifyRes.rows[0]) {
                            console.error(`[ROUND-CREATE] ❌ Round ${newRoundId} non visible après commit!`);
                            gameState.currentRound.persisted = false; // Marquer comme non persisté si non visible
                        } else {
                            console.log(`[ROUND-CREATE] ✅ Round ${newRoundId} vérifié et visible en DB`);
                        }
                        // ✅ CRITIQUE: Marquer pour retour anticipé après le finally
                        shouldReturnEarly = true;
                    } else {
                        // Round n'existe pas et insertion a échoué - erreur critique
                        throw new Error(`Round ${newRoundId} insertion failed: no rows returned and round does not exist`);
                    }
                } else {
                    // Insertion réussie, continuer avec le commit et la vérification
                    await client.query('COMMIT');
                    console.log(`[ROUND-CREATE] ✅ Round #${roundNum} (ID: ${newRoundId}) commité en DB`);
                    
                    // ✅ CRITIQUE: Ne pas libérer le client ici - le bloc finally le fera
                    // Libérer ici causerait un double release si une erreur survient après
                    
                    // ✅ VÉRIFICATION POST-COMMIT: S'assurer que le round est visible immédiatement
                    // Utiliser le pool global (nouvelle connexion) pour vérifier la visibilité
                    await new Promise(resolve => setTimeout(resolve, 100)); // Délai pour la visibilité du commit
                    
                    let verified = false;
                    for (let verifyAttempt = 0; verifyAttempt < 10; verifyAttempt++) {
                        try {
                            const verifyRes = await pool.query(
                                `SELECT round_id, status FROM rounds WHERE round_id = $1`,
                                [roundIdForDb]
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
                }
            } catch (err) {
                // ✅ CRITIQUE: Ne faire ROLLBACK que si la transaction est toujours active
                // Si le client a déjà été libéré, cela causerait une erreur
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackErr) {
                    // Ignorer l'erreur de rollback si le client est déjà libéré
                    console.warn(`[ROUND-CREATE] ⚠️ Erreur lors du ROLLBACK (peut être normal si client déjà libéré):`, rollbackErr.message);
                }
                throw err;
            } finally {
                // ✅ CRITIQUE: Libérer le client UNE SEULE FOIS dans le finally
                // Vérifier que le client n'a pas déjà été libéré
                if (client && typeof client.release === 'function') {
                    try {
                        client.release();
                    } catch (releaseErr) {
                        // Ignorer l'erreur si le client est déjà libéré
                        console.warn(`[ROUND-CREATE] ⚠️ Erreur lors de la libération du client (peut être normal si déjà libéré):`, releaseErr.message);
                    }
                }
            }
            
            // ✅ CRITIQUE: Retour anticipé APRÈS le finally si nécessaire
            if (shouldReturnEarly) {
                return newRoundId;
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
            
            // ✅ CORRECTION CRITIQUE: S'assurer que currentRound contient bien le nouveau round ID
            const currentRoundForBroadcast = JSON.parse(JSON.stringify(newRound));
            if (currentRoundForBroadcast.id !== newRoundId) {
                console.error(`[ROUND-CREATE] ❌ INCOHÉRENCE: currentRound.id (${currentRoundForBroadcast.id}) !== newRoundId (${newRoundId})`);
                currentRoundForBroadcast.id = newRoundId;
                console.log(`[ROUND-CREATE] ✅ Correction appliquée: currentRound.id mis à jour vers ${newRoundId}`);
            }
            
            console.log(`[ROUND-CREATE] 🎙️ Broadcasting new_round:`);
            console.log(`   - roundId: ${newRoundId}`);
            console.log(`   - currentRound.id: ${currentRoundForBroadcast.id}`);
            console.log(`   - isRaceRunning: ${gameState.isRaceRunning}`);
            console.log(`   - elapsed: ${elapsedFromRaceStart}ms`);
            
            broadcast({
                event: "new_round",
                roundId: newRoundId, // ✅ CRITIQUE: Round ID explicite
                game: currentRoundForBroadcast,
                currentRound: currentRoundForBroadcast, // ✅ CRITIQUE: Contient le nouveau round ID
                participants: newRound.participants,
                isRaceRunning: gameState.isRaceRunning, // ✅ Doit être false après la course
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
            
            console.log(`[ROUND-CREATE] ✅ Broadcast new_round envoyé avec roundId=${newRoundId}`);
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
            
            // ✅ CRITIQUE: Formater le round_id du currentRound s'il existe
            if (gameState.currentRound && gameState.currentRound.id) {
                gameState.currentRound.id = formatRoundId(gameState.currentRound.id);
                console.log(`[CACHE] Round ID formaté: ${gameState.currentRound.id}`);
            }
            
            // ✅ CRITIQUE: Formater les round_id dans gameHistory
            if (Array.isArray(gameState.gameHistory)) {
                gameState.gameHistory = gameState.gameHistory.map(round => {
                    if (round && round.id) {
                        round.id = formatRoundId(round.id);
                    }
                    return round;
                });
            }
            
            // ✅ CRITIQUE: Réinitialiser TOUS les locks au redémarrage
            // Les locks ne doivent JAMAIS être persistés en Redis
            gameState.operationLock = false;
            console.log(`✅ [CACHE] GameState restauré depuis Redis (locks réinitialisés, round IDs formatés)`);
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
 * ✅ ARCHITECTURE FINALE: profit-choice attribue place:1-6 à TOUS les participants
 * 
 * Algorithme:
 * 1. Calculer TotalMises = somme de toutes les mises
 * 2. Calculer MargeGlobale = TotalMises × 25%
 * 3. Calculer ResteDistribuable = TotalMises - MargeGlobale
 * 4. Pour chaque participant, estimer payout = somme(mise × coeff) si ce participant gagne
 * 5. Sélectionner un gagnant dont payout ≤ ResteDistribuable
 * 6. Si aucun viable, choisir celui avec payout minimal (perte minimale)
 * 7. Attribuer place:1 au gagnant et places:2-6 aux autres (mélangés aléatoirement)
 * 
 * @param {Object} roundData - Données du round { participants: [], receipts: [] }
 * @param {number} marginPercent - Pourcentage de marge (défaut: 0.25 = 25%)
 * @returns {Object} { winner, allParticipantsWithPlaces, reason, totalMises, margeGlobale, resteDistribuable, payoutsByNumber }
 */
export function chooseProfitableWinner(roundData, marginPercent = 0.25) {
    console.log(`[PROFIT-CHOICE] 🔄 Fonction executée...`);
    const participants = Array.isArray(roundData.participants) ? roundData.participants : [];
    const receipts = Array.isArray(roundData.receipts) ? roundData.receipts : [];

    console.log(`[PROFIT-CHOICE] 📊 Données reçues: ${participants.length} participants, ${receipts.length} receipts`);

    // ÉTAPE 1: Calculer le total des mises
    const totalMises = receipts.reduce((accR, r) => {
        const betsSum = (r.bets || []).reduce((accB, b) => accB + (Number(b.value) || 0), 0);
        return accR + betsSum;
    }, 0);

    // ÉTAPE 2: Calculer la marge globale
    const margeGlobale = Math.floor(totalMises * Number(marginPercent));
    
    // ÉTAPE 3: Calculer le reste distribuable
    const resteDistribuable = totalMises - margeGlobale;

    console.log(`[PROFIT-CHOICE] 💰 ========== MARGE DE RENTABILITÉ (25%) ==========`);
    console.log(`[PROFIT-CHOICE] 💵 TotalMises:        ${totalMises}`);
    console.log(`[PROFIT-CHOICE] 🔐 MargeGlobale (25%): ${margeGlobale}`);
    console.log(`[PROFIT-CHOICE] 💸 ResteDistribuable: ${resteDistribuable}`);

    // ÉTAPE 4: Calculer payout potentiel pour chaque participant
    const payoutsByNumber = {};
    const misesByNumber = {}; // Track mises pour analyse
    participants.forEach(p => { 
        payoutsByNumber[p.number] = 0;
        misesByNumber[p.number] = 0;
    });

    receipts.forEach(receipt => {
        (receipt.bets || []).forEach(bet => {
            const num = Number(bet.number ?? bet.participant?.number);
            if (!Number.isFinite(num)) return;
            
            // Récupérer le coefficient: priorité bet.participant.coeff -> participant coeff
            let coeff = 0;
            if (bet.participant && bet.participant.coeff) {
                coeff = Number(bet.participant.coeff);
            } else {
                const participant = participants.find(pp => Number(pp.number) === num);
                if (participant && participant.coeff) {
                    coeff = Number(participant.coeff);
                }
            }
            
            const betValue = Number(bet.value) || 0;
            misesByNumber[num] = (misesByNumber[num] || 0) + betValue; // Accumuler les mises
            // payout contribution = mise × coeff
            payoutsByNumber[num] = (payoutsByNumber[num] || 0) + Math.floor(betValue * coeff);
        });
    });
    
    // Log des mises et payouts
    console.log(`[PROFIT-CHOICE] 💳 Analyse par participant:`);
    participants.forEach(p => {
        const mise = misesByNumber[p.number] || 0;
        const payout = payoutsByNumber[p.number] || 0;
        const isViable = payout <= resteDistribuable;
        const marker = isViable ? '✅ VIABLE' : '❌ RISQUÉ';
        const margin = resteDistribuable - payout;
        console.log(`[PROFIT-CHOICE]   ${marker} №${p.number} ${p.name}: mise=${mise} → payout=${payout} (marge: ${margin >= 0 ? '+' : ''}${margin})`);
    });

    // ÉTAPE 5: Construire liste de candidats viables
    const viable = participants.filter(p => {
        const payout = payoutsByNumber[p.number] || 0;
        return payout <= resteDistribuable;
    });

    console.log(`[PROFIT-CHOICE] 📋 RÉSUMÉ VIABILITÉ:`);
    console.log(`[PROFIT-CHOICE]   - Viables: ${viable.length}/${participants.length}`);
    console.log(`[PROFIT-CHOICE]   - Mises totales: ${totalMises} centimes (${(totalMises/100).toFixed(2)} HTG)`);
    console.log(`[PROFIT-CHOICE]   - Marge 25%: ${margeGlobale} centimes (${(margeGlobale/100).toFixed(2)} HTG)`);
    console.log(`[PROFIT-CHOICE]   - Reste distribuable: ${resteDistribuable} centimes (${(resteDistribuable/100).toFixed(2)} HTG)`);
    if (viable.length > 0) {
        viable.forEach(p => {
            const payout = payoutsByNumber[p.number] || 0;
            console.log(`[PROFIT-CHOICE]   ✅ №${p.number} ${p.name}: payout=${payout} centimes (${(payout/100).toFixed(2)} HTG)`);
        });
    } else {
        console.warn(`[PROFIT-CHOICE] ⚠️ AUCUN gagnant viable! Mises trop concentrées ou coefficients trop élevés.`);
        console.warn(`[PROFIT-CHOICE] ⚠️ Les participants avec payout minimal:`);
        participants.forEach(p => {
            const payout = payoutsByNumber[p.number] || 0;
            const excess = payout - resteDistribuable;
            console.warn(`[PROFIT-CHOICE]   ❌ №${p.number} ${p.name}: payout=${payout} centimes (DÉPASSEMENT: +${excess} centimes)`);
        });
    }

    let chosen = null;
    let reason = 'unknown';

    if (viable.length > 0) {
        // Choisir au hasard parmi viables
        console.log(`[PROFIT-CHOICE] ✅ ${viable.length} gagnant(s) viable(s) trouvé(s)`);
        try {
            const idx = typeof chacha20RandomInt === 'function' ? chacha20RandomInt(viable.length) : Math.floor(Math.random() * viable.length);
            chosen = viable[idx];
            reason = 'viable';
        } catch (err) {
            console.warn(`[PROFIT-CHOICE] ⚠️ Erreur chacha20RandomInt, fallback random`);
            chosen = viable[Math.floor(Math.random() * viable.length)];
            reason = 'viable_random_fallback';
        }
    } else {
        // ÉTAPE 6: Aucun viable → choisir celui avec payout minimal (perte minimale)
        console.warn(`[PROFIT-CHOICE] ⚠️ Aucun gagnant viable, sélection du moindre coût`);
        let minPayload = Number.POSITIVE_INFINITY;
        participants.forEach(p => {
            const payout = payoutsByNumber[p.number] || 0;
            if (payout < minPayload) {
                minPayload = payout;
                chosen = p;
            }
        });
        reason = 'min_loss';
    }

    if (!chosen && participants.length > 0) {
        console.error(`[PROFIT-CHOICE] ❌ Impossible de choisir un gagnant!`);
        chosen = participants[0];
        reason = 'fallback_first';
    }

    if (chosen) {
        const chosenPayout = payoutsByNumber[chosen.number] || 0;
        const margin = resteDistribuable - chosenPayout;
        const marginPercent = ((margin / totalMises) * 100).toFixed(2);
        console.log(`[PROFIT-CHOICE] 🏆 ========== GAGNANT SÉLECTIONNÉ ==========`);
        console.log(`[PROFIT-CHOICE] 🎯 Participant: №${chosen.number} ${chosen.name}`);
        console.log(`[PROFIT-CHOICE] 💰 Payout estimé: ${chosenPayout}`);
        console.log(`[PROFIT-CHOICE] 🔐 Marge préservée: ${margin} (${marginPercent}%)`);
        console.log(`[PROFIT-CHOICE] 📌 Raison: ${reason}`);
        console.log(`[PROFIT-CHOICE] ========== FIN SÉLECTION ==========`);
    }

    // ✅ ÉTAPE FINALE: Attribuer place:1 au gagnant et places:2-6 aux autres
    console.log(`[PROFIT-CHOICE] 🎲 ATTRIBUTION DES PLACES:`);
    
    // Séparer le gagnant des autres participants
    const otherParticipants = participants.filter(p => Number(p.number) !== Number(chosen?.number));
    
    // Mélanger les autres participants pour aléatoires les places 2-6
    const shuffledOthers = chacha20Shuffle(otherParticipants);
    
    // Construire le tableau final avec places attribuées
    const allParticipantsWithPlaces = [
        { ...chosen, place: 1 },  // Gagnant en place 1
        ...shuffledOthers.map((p, idx) => ({ ...p, place: idx + 2 }))  // Autres en places 2-6
    ];
    
    console.log(`[PROFIT-CHOICE] 🏆 Distribution FINALE des places:`);
    allParticipantsWithPlaces
        .sort((a, b) => a.place - b.place)
        .forEach((p, idx) => {
            const marker = p.place === 1 ? '🏆' : '  ';
            console.log(`[PROFIT-CHOICE]   ${marker} Place ${p.place}: №${p.number} ${p.name}`);
        });

    return {
        winner: (() => {
            // ✅ Retourner le gagnant SANS place (place sera dans allParticipantsWithPlaces)
            const { place, ...winnerWithoutPlace } = chosen;
            return winnerWithoutPlace;
        })(),
        allParticipantsWithPlaces,  // ✅ NOUVEAU: Tableau complet avec places attribuées
        reason,
        totalMises,
        margeGlobale,
        resteDistribuable,
        payoutsByNumber
    };
}


