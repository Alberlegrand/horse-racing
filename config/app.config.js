// config/app.config.js
// Configuration de l'application avec variables d'environnement

/**
 * Durée d'attente avant de lancer une nouvelle course (en secondes)
 * Peut être surchargée via variable d'environnement TIMER_DURATION_SECONDS
 * Par défaut: 20 secondes
 */
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || '20', 10);

/**
 * Durée d'attente en millisecondes
 */
export const TIMER_DURATION_MS = TIMER_DURATION_SECONDS * 1000;

/**
 * Intervalle de mise à jour du timer pour les clients WebSocket (en ms)
 * Le serveur envoie les mises à jour toutes les X ms
 * Par défaut: 1000ms (1 seconde)
 */
export const TIMER_UPDATE_INTERVAL_MS = parseInt(process.env.TIMER_UPDATE_INTERVAL_MS || '1000', 10);

// ========================================
// LIMITES DE MONTANTS DE PARIS (en système)
// ========================================
/**
 * Montant MINIMUM de mise pour un pari (en système = × 100)
 * Frontend: 1000 = 10.00 HTG
 * Par défaut: 1000 (10.00 HTG)
 */
export const MIN_BET_AMOUNT = parseInt(process.env.MIN_BET_AMOUNT || '1000', 10);

/**
 * Montant MAXIMUM de mise pour un pari (en système = × 100)
 * Frontend: 500000 = 5000.00 HTG
 * Par défaut: 500000 (5000.00 HTG)
 */
export const MAX_BET_AMOUNT = parseInt(process.env.MAX_BET_AMOUNT || '500000', 10);

console.log(`⏰ Configuration timer: ${TIMER_DURATION_SECONDS}s (${TIMER_DURATION_MS}ms)`);
console.log(`📡 Intervalle mise à jour WebSocket: ${TIMER_UPDATE_INTERVAL_MS}ms`);
console.log(`💰 Limites de paris: ${MIN_BET_AMOUNT} - ${MAX_BET_AMOUNT} (système)`);

