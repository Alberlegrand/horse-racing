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
        
        // ✅ TEST: Générer quelques nombres aléatoires pour vérifier que le RNG fonctionne
        console.log(`[ROUND-CREATE] 🔬 ========== TEST DU RNG ==========`);
        const testRandom1 = chacha20RandomInt(100);
        const testRandom2 = chacha20RandomInt(100);
        const testRandom3 = chacha20RandomInt(100);
        const testRandom4 = chacha20RandomInt(6); // Pour simuler une sélection de place
        const testRandom5 = chacha20RandomInt(6);
        const testRandom6 = chacha20RandomInt(6);
        console.log(`[ROUND-CREATE] 🔬 Test RNG (3 nombres aléatoires 0-99): [${testRandom1}, ${testRandom2}, ${testRandom3}]`);
        console.log(`[ROUND-CREATE] 🔬 Test RNG (3 nombres aléatoires 0-5 pour places): [${testRandom4}, ${testRandom5}, ${testRandom6}]`);
        console.log(`[ROUND-CREATE] 🔬 Vérification: Les valeurs sont différentes = ${testRandom1 !== testRandom2 || testRandom2 !== testRandom3 ? '✅ Oui' : '⚠️ Non'}`);
        console.log(`[ROUND-CREATE] 🔬 ========== FIN TEST DU RNG ==========`);
        
        // ✅ ALGORITHME RNG COMPLÈTEMENT RÉVISÉ: Attribution aléatoire avec shuffle Fisher-Yates
        // 
        // PROBLÈME IDENTIFIÉ: L'itération séquentielle sur BASE_PARTICIPANTS (family 0→5)
        // créait un pattern prévisible même avec sélection aléatoire de places.
        //
        // SOLUTION: Mélanger les participants AVANT d'attribuer les places pour garantir
        // un ordre d'attribution vraiment aléatoire.
        //
        // ÉTAPE 1: Créer une liste des places disponibles (1-6)
        const availablePlaces = [1, 2, 3, 4, 5, 6];
        
        // ÉTAPE 2: Créer une copie des participants
        const participantsCopy = BASE_PARTICIPANTS.map(p => ({ ...p }));
        
        console.log(`[ROUND-CREATE] 🎲 ========== DÉBUT ATTRIBUTION ALÉATOIRE DES PLACES ==========`);
        console.log(`[ROUND-CREATE] 🔍 Round ID: ${newRoundId}`);
        console.log(`[ROUND-CREATE] 🔍 Seed (hex): [${roundSeed.map(s => s.toString(16).padStart(8, '0')).join(', ')}]`);
        console.log(`[ROUND-CREATE] 📋 Participants AVANT shuffle (ordre original):`);
        participantsCopy.forEach((p, idx) => {
            console.log(`   [${idx}] №${p.number} ${p.name} (family: ${p.family}, coeff: ${p.coeff})`);
        });
        console.log(`[ROUND-CREATE] 📋 Places disponibles: [${availablePlaces.join(', ')}]`);
        
        // ✅ ÉTAPE 3 CRITIQUE: MÉLANGER LES PARTICIPANTS AVANT D'ATTRIBUER LES PLACES
        // Cela garantit que l'ordre d'attribution est vraiment aléatoire, pas séquentiel
        console.log(`[ROUND-CREATE] 🔀 Mélange des participants avec Fisher-Yates shuffle...`);
        const shuffledParticipants = chacha20Shuffle(participantsCopy);
        
        // ✅ Vérifier que le shuffle a bien modifié l'ordre
        const orderChanged = !participantsCopy.every((p, idx) => p.number === shuffledParticipants[idx].number);
        console.log(`[ROUND-CREATE] 🔀 Ordre modifié par le shuffle: ${orderChanged ? '✅ Oui' : '⚠️ Non (problème possible!)'}`);
        if (!orderChanged) {
            console.warn(`[ROUND-CREATE] ⚠️ ATTENTION: Le shuffle n'a pas modifié l'ordre des participants!`);
            console.warn(`[ROUND-CREATE] ⚠️ Cela peut indiquer un problème avec le RNG ou le shuffle`);
        }
        
        console.log(`[ROUND-CREATE] ✅ Participants APRÈS shuffle (ordre aléatoire):`);
        shuffledParticipants.forEach((p, idx) => {
            const originalIndex = participantsCopy.findIndex(orig => orig.number === p.number);
            const moved = originalIndex !== idx ? ` (déplacé de position ${originalIndex})` : '';
            console.log(`   [${idx}] №${p.number} ${p.name} (family: ${p.family}, coeff: ${p.coeff})${moved}`);
        });
        
        // ✅ ÉTAPE 4: Assigner une place aléatoire à chaque participant DANS L'ORDRE MÉLANGÉ
        // Utiliser Fisher-Yates pour sélectionner une place aléatoire pour chaque participant
        const participantsWithPlaces = [];
        const placesRemaining = [...availablePlaces];
        
        console.log(`[ROUND-CREATE] 🎯 Attribution des places (ordre mélangé):`);
        for (let i = 0; i < shuffledParticipants.length; i++) {
            const participant = shuffledParticipants[i];
            
            // Sélectionner une place aléatoire parmi les places restantes
            const randomIndex = chacha20RandomInt(placesRemaining.length);
            const selectedPlace = placesRemaining[randomIndex];
            
            // Logs détaillés pour chaque attribution
            console.log(`[ROUND-CREATE]   ┌─ Itération ${i + 1}/${shuffledParticipants.length}`);
            console.log(`[ROUND-CREATE]   │  Participant: №${participant.number} ${participant.name} (family: ${participant.family})`);
            console.log(`[ROUND-CREATE]   │  Places restantes: [${placesRemaining.join(', ')}] (${placesRemaining.length} disponibles)`);
            console.log(`[ROUND-CREATE]   │  Index aléatoire généré: ${randomIndex} (via chacha20RandomInt(${placesRemaining.length}))`);
            console.log(`[ROUND-CREATE]   │  Place sélectionnée: ${selectedPlace}`);
            
            // Retirer la place sélectionnée de la liste
            placesRemaining.splice(randomIndex, 1);
            
            // Assigner la place au participant
            const participantWithPlace = {
                ...participant,
                place: selectedPlace
            };
            
            participantsWithPlaces.push(participantWithPlace);
            
            console.log(`[ROUND-CREATE]   └─ ✅ Attribué: №${participant.number} ${participant.name} (family: ${participant.family}) → place ${selectedPlace}`);
            console.log(`[ROUND-CREATE]      Places restantes après attribution: [${placesRemaining.join(', ')}]`);
        }
        
        // ✅ ÉTAPE 5: Vérifier l'intégrité des places (chaque place 1-6 doit être présente exactement une fois)
        const assignedPlaces = participantsWithPlaces.map(p => p.place).sort((a, b) => a - b);
        const expectedPlaces = [1, 2, 3, 4, 5, 6];
        const placesValid = JSON.stringify(assignedPlaces) === JSON.stringify(expectedPlaces);
        
        console.log(`[ROUND-CREATE] 🔍 ========== VÉRIFICATION DE L'INTÉGRITÉ ==========`);
        console.log(`[ROUND-CREATE] 🔍 Places assignées (triées): [${assignedPlaces.join(', ')}]`);
        console.log(`[ROUND-CREATE] 🔍 Places attendues: [${expectedPlaces.join(', ')}]`);
        console.log(`[ROUND-CREATE] 🔍 Places restantes: [${placesRemaining.join(', ')}]`);
        console.log(`[ROUND-CREATE] 🔍 Validation: ${placesValid ? '✅ OK' : '❌ ÉCHEC'}`);
        
        if (!placesValid) {
            console.error(`[ROUND-CREATE] ❌ ERREUR CRITIQUE: Places invalides!`);
            console.error(`   Places assignées: [${assignedPlaces.join(', ')}]`);
            console.error(`   Places attendues: [${expectedPlaces.join(', ')}]`);
            console.error(`   Places restantes: [${placesRemaining.join(', ')}]`);
            throw new Error(`Invalid place distribution: expected [1,2,3,4,5,6], got [${assignedPlaces.join(',')}]`);
        }
        
        // ✅ ÉTAPE 6: Analyser la distribution des places par family
        console.log(`[ROUND-CREATE] 📊 ========== ANALYSE DE LA DISTRIBUTION ==========`);
        const distributionByFamily = {};
        participantsWithPlaces.forEach(p => {
            if (!distributionByFamily[p.family]) {
                distributionByFamily[p.family] = [];
            }
            distributionByFamily[p.family].push({
                number: p.number,
                name: p.name,
                place: p.place
            });
        });
        
        console.log(`[ROUND-CREATE] 📊 Distribution des places par family:`);
        for (let family = 0; family <= 5; family++) {
            const familyParticipants = distributionByFamily[family] || [];
            if (familyParticipants.length > 0) {
                const places = familyParticipants.map(p => p.place).sort((a, b) => a - b);
                const isWinner = places.includes(1) ? ' 🏆' : '';
                console.log(`[ROUND-CREATE]   Family ${family}: ${familyParticipants.map(p => `№${p.number} ${p.name}`).join(', ')} → places [${places.join(', ')}]${isWinner}`);
            } else {
                console.log(`[ROUND-CREATE]   Family ${family}: Aucun participant`);
            }
        }
        
        // ✅ Vérifier si le pattern uniforme (family 0→5 = place 1→6) est présent
        const sortedByFamily = [...participantsWithPlaces].sort((a, b) => a.family - b.family);
        const sortedByPlace = [...participantsWithPlaces].sort((a, b) => a.place - b.place);
        const isUniformPattern = sortedByFamily.every((p, idx) => p.place === idx + 1);
        
        if (isUniformPattern) {
            console.warn(`[ROUND-CREATE] ⚠️ ATTENTION: Pattern uniforme détecté!`);
            console.warn(`[ROUND-CREATE] ⚠️ Family 0→5 correspond exactement à place 1→6`);
            console.warn(`[ROUND-CREATE] ⚠️ Cela ne devrait PAS se produire avec un vrai shuffle aléatoire`);
        } else {
            console.log(`[ROUND-CREATE] ✅ Pas de pattern uniforme détecté (bon signe)`);
        }
        
        console.log(`[ROUND-CREATE] 🎲 ========== RÉSULTAT FINAL DE L'ATTRIBUTION ==========`);
        console.log(`[ROUND-CREATE] 🎲 Résultat trié par place:`);
        sortedByPlace.forEach((p, i) => {
            const isWinner = p.place === 1 ? ' 🏆' : '';
            console.log(`[ROUND-CREATE]   Place ${p.place}: №${p.number} ${p.name} (family: ${p.family})${isWinner}`);
        });
        
        console.log(`[ROUND-CREATE] 🎲 Résultat trié par ordre d'attribution:`);
        participantsWithPlaces.forEach((p, i) => {
            const isWinner = p.place === 1 ? ' 🏆' : '';
            console.log(`[ROUND-CREATE]   [${i}] №${p.number} ${p.name} (family: ${p.family}) → place ${p.place}${isWinner}`);
        });
        
        console.log(`[ROUND-CREATE] 🎲 ========== FIN ATTRIBUTION ALÉATOIRE DES PLACES ==========`);

        const newRound = {
            id: newRoundId,
            participants: participantsWithPlaces,
            receipts: [],
            lastReceiptId: 3,
            totalPrize: 0,
            persisted: false
        };
        
        // ✅ Trouver le gagnant (participant avec place: 1)
        const winner = newRound.participants.find(p => p.place === 1);
        if (winner) {
            console.log(`[ROUND-CREATE] 🏆 ========== GAGNANT DÉTERMINÉ ==========`);
            console.log(`[ROUND-CREATE] 🏆 Gagnant: №${winner.number} ${winner.name} (family: ${winner.family}, place: 1)`);
            console.log(`[ROUND-CREATE] 🏆 Vérification: Le gagnant a bien place === 1: ${winner.place === 1 ? '✅ Oui' : '❌ Non'}`);
            console.log(`[ROUND-CREATE] 📊 Distribution complète des places (triée par place):`);
            newRound.participants
                .sort((a, b) => a.place - b.place)
                .forEach(p => {
                    const isWinner = p.place === 1 ? ' 🏆' : '';
                    console.log(`[ROUND-CREATE]   Place ${p.place}: №${p.number} ${p.name} (family: ${p.family})${isWinner}`);
                });
            console.log(`[ROUND-CREATE] 🏆 ========== FIN GAGNANT ==========`);
        } else {
            console.error(`[ROUND-CREATE] ❌ ERREUR: Aucun participant avec place: 1 trouvé!`);
            console.error(`[ROUND-CREATE] ❌ Participants disponibles:`);
            newRound.participants.forEach(p => {
                console.error(`[ROUND-CREATE]   №${p.number} ${p.name} (family: ${p.family}, place: ${p.place})`);
            });
            throw new Error('No winner found: participant with place: 1 is missing');
        }

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


