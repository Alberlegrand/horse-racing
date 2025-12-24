// Shared round number manager to ensure unique sequential round numbers
// across all round creation operations

import { pool } from '../config/db.js';

let currentRoundNumber = 0;

/**
 * Get and increment the next round number FROM DATABASE (atomic operation)
 * ✅ THREAD-SAFE: Utilise la séquence PostgreSQL
 * @returns {number} The next unique round number
 */
export async function getNextRoundNumber() {
    try {
        const result = await pool.query(
            `SELECT nextval('rounds_round_number_seq'::regclass) as next_number`
        );
        const nextNumber = result.rows[0].next_number;
        console.log(`[ROUND-NUMBER] Next round number from DB: ${nextNumber}`);
        return nextNumber;
    } catch (err) {
        console.error('[ROUND-NUMBER] Error fetching from DB sequence:', err.message);
        // Fallback à la version mémoire en cas d'erreur
        currentRoundNumber++;
        console.warn(`[ROUND-NUMBER] Fallback à mémoire: ${currentRoundNumber}`);
        return currentRoundNumber;
    }
}

/**
 * Initialiser le round number manager depuis la BD
 * À appeler au démarrage du serveur
 */
export async function initRoundNumberManager() {
    try {
        const result = await pool.query(
            `SELECT MAX(round_number) as max_number FROM rounds`
        );
        const maxNumber = result.rows[0].max_number || 0;
        currentRoundNumber = maxNumber;
        console.log(`[ROUND-NUMBER] Initialized from DB: ${currentRoundNumber}`);
    } catch (err) {
        console.error('[ROUND-NUMBER] Error initializing from DB:', err.message);
        currentRoundNumber = 0;
    }
}

/**
 * Reset round number (useful for testing)
 */
export function resetRoundNumber() {
    currentRoundNumber = 0;
}

/**
 * Get current round number without incrementing
 */
export function getCurrentRoundNumber() {
    return currentRoundNumber;
}

// =============================================
// ✅ NOUVEAU: ROUND ID MANAGER (Séquence BIGINT)
// =============================================

let currentRoundId = 10000000;

/**
 * Get and increment the next round ID FROM DATABASE (atomic operation)
 * ✅ THREAD-SAFE: Utilise la séquence PostgreSQL rounds_round_id_seq
 * ✅ PERSISTENT: Survit aux redémarrages du serveur
 * ✅ UNIQUE: Jamais de doublon grâce à la séquence PostgreSQL
 * ✅ FORMAT: Retourne toujours une chaîne de 8 chiffres avec zéro-padding (ex: "00000000")
 * @returns {string} The next unique round ID formaté sur 8 chiffres (ex: "00000000", "00000001", ...)
 */
export async function getNextRoundId() {
    try {
        const result = await pool.query(
            `SELECT nextval('rounds_round_id_seq'::regclass) as next_id`
        );
        const nextId = result.rows[0].next_id;
        currentRoundId = nextId; // ✅ Synchroniser le compteur mémoire
        
        // ✅ FORMAT: Toujours 8 chiffres avec zéro-padding, même si le nombre dépasse 99999999
        // Utiliser modulo 100000000 pour garder dans la plage 0-99999999
        const formattedId = String(nextId % 100000000).padStart(8, '0');
        console.log(`[ROUND-ID] Next round ID from DB: ${nextId} -> formaté: ${formattedId}`);
        return formattedId;
    } catch (err) {
        console.error('[ROUND-ID] Error fetching from DB sequence:', err.message);
        // ✅ AMÉLIORATION: Essayer de récupérer le MAX depuis la DB avant fallback
        try {
            const maxResult = await pool.query(
                `SELECT MAX(round_id) as max_id FROM rounds`
            );
            const maxId = maxResult.rows[0].max_id || 10000000;
            // Convertir maxId en nombre si c'est une chaîne
            const maxIdNum = typeof maxId === 'string' ? parseInt(maxId, 10) : maxId;
            currentRoundId = maxIdNum + 1;
            const formattedId = String(currentRoundId % 100000000).padStart(8, '0');
            console.warn(`[ROUND-ID] Fallback avec MAX de DB: ${currentRoundId} -> formaté: ${formattedId} (séquence indisponible)`);
            return formattedId;
        } catch (fallbackErr) {
            // Dernier recours: incrémenter depuis mémoire
            currentRoundId++;
            const formattedId = String(currentRoundId % 100000000).padStart(8, '0');
            console.warn(`[ROUND-ID] Fallback à mémoire: ${currentRoundId} -> formaté: ${formattedId} (DB indisponible)`);
            return formattedId;
        }
    }
}

/**
 * Initialiser le round ID manager depuis la BD
 * À appeler au démarrage du serveur pour récupérer le dernier round_id
 * ✅ CRITIQUE: Synchronise la séquence PostgreSQL avec le MAX(round_id) de la DB
 */
export async function initRoundIdManager() {
    try {
        // 1. Récupérer le MAX(round_id) de la DB
        const result = await pool.query(
            `SELECT MAX(round_id) as max_id FROM rounds`
        );
        let maxId = result.rows[0].max_id || 10000000;
        
        // ✅ Convertir en nombre si c'est une chaîne (pour compatibilité)
        if (typeof maxId === 'string') {
            maxId = parseInt(maxId, 10) || 10000000;
        }
        
        // 2. ✅ CRITIQUE: Synchroniser la séquence PostgreSQL
        // Si maxId = 10000005, la séquence doit être à 10000006 (prochaine valeur)
        // Utiliser modulo pour éviter les dépassements
        const nextId = maxId >= 10000000 ? (maxId + 1) % 100000000 : 10000000;
        try {
            await pool.query(
                `SELECT setval('rounds_round_id_seq', $1, false)`,
                [nextId]
            );
            const formattedMaxId = String(maxId % 100000000).padStart(8, '0');
            const formattedNextId = String(nextId).padStart(8, '0');
            console.log(`[ROUND-ID] ✅ Séquence synchronisée: ${formattedNextId} (MAX en DB: ${formattedMaxId})`);
        } catch (seqErr) {
            console.warn(`[ROUND-ID] ⚠️ Impossible de synchroniser la séquence: ${seqErr.message}`);
            // Continuer même si la synchronisation échoue
        }
        
        currentRoundId = maxId;
        const formattedCurrentId = String(currentRoundId % 100000000).padStart(8, '0');
        const formattedNextId = String(nextId).padStart(8, '0');
        console.log(`[ROUND-ID] Initialized from DB: ${formattedCurrentId}, next ID will be: ${formattedNextId}`);
    } catch (err) {
        console.error('[ROUND-ID] Error initializing from DB:', err.message);
        currentRoundId = 10000000;
    }
}

/**
 * Reset round ID (useful for testing)
 */
export function resetRoundId() {
    currentRoundId = 10000000;
}

/**
 * Get current round ID without incrementing
 * @returns {string} Le round ID actuel formaté sur 8 chiffres
 */
export function getCurrentRoundId() {
    return String(currentRoundId % 100000000).padStart(8, '0');
}

/**
 * Convertit un round_id formaté (string) en nombre pour les requêtes de base de données
 * @param {string|number} roundId - Le round ID (peut être string formaté ou number)
 * @returns {number} Le round ID converti en nombre pour la DB
 */
export function roundIdToDbFormat(roundId) {
    if (typeof roundId === 'string') {
        return parseInt(roundId, 10);
    }
    return roundId;
}

/**
 * Formate un round_id (number ou string) en chaîne de 8 chiffres avec zéro-padding
 * @param {string|number} roundId - Le round ID à formater
 * @returns {string} Le round ID formaté sur 8 chiffres (ex: "00000000")
 */
export function formatRoundId(roundId) {
    const numId = typeof roundId === 'string' ? parseInt(roundId, 10) : roundId;
    return String(numId % 100000000).padStart(8, '0');
}
