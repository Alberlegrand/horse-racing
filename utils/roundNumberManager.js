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
 * @returns {number} The next unique round ID (8-digit starting from 10000000)
 */
export async function getNextRoundId() {
    try {
        const result = await pool.query(
            `SELECT nextval('rounds_round_id_seq'::regclass) as next_id`
        );
        const nextId = result.rows[0].next_id;
        currentRoundId = nextId; // ✅ Synchroniser le compteur mémoire
        console.log(`[ROUND-ID] Next round ID from DB: ${nextId}`);
        return nextId;
    } catch (err) {
        console.error('[ROUND-ID] Error fetching from DB sequence:', err.message);
        // ✅ AMÉLIORATION: Essayer de récupérer le MAX depuis la DB avant fallback
        try {
            const maxResult = await pool.query(
                `SELECT MAX(round_id) as max_id FROM rounds`
            );
            const maxId = maxResult.rows[0].max_id || 10000000;
            currentRoundId = maxId + 1;
            console.warn(`[ROUND-ID] Fallback avec MAX de DB: ${currentRoundId} (séquence indisponible)`);
            return currentRoundId;
        } catch (fallbackErr) {
            // Dernier recours: incrémenter depuis mémoire
            currentRoundId++;
            console.warn(`[ROUND-ID] Fallback à mémoire: ${currentRoundId} (DB indisponible)`);
            return currentRoundId;
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
        const maxId = result.rows[0].max_id || 10000000;
        
        // 2. ✅ CRITIQUE: Synchroniser la séquence PostgreSQL
        // Si maxId = 10000005, la séquence doit être à 10000006 (prochaine valeur)
        const nextId = maxId >= 10000000 ? maxId + 1 : 10000000;
        try {
            await pool.query(
                `SELECT setval('rounds_round_id_seq', $1, false)`,
                [nextId]
            );
            console.log(`[ROUND-ID] ✅ Séquence synchronisée: ${nextId} (MAX en DB: ${maxId})`);
        } catch (seqErr) {
            console.warn(`[ROUND-ID] ⚠️ Impossible de synchroniser la séquence: ${seqErr.message}`);
            // Continuer même si la synchronisation échoue
        }
        
        currentRoundId = maxId;
        console.log(`[ROUND-ID] Initialized from DB: ${currentRoundId}, next ID will be: ${nextId}`);
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
 */
export function getCurrentRoundId() {
    return currentRoundId;
}
