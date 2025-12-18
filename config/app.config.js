// config/app.config.js
// Configuration centralisée de l'application avec variables d'environnement
// 🎯 TOUTES LES DURÉES SONT EN MILLISECONDES (MS) POUR ÉVITER LES CONFUSIONS


/**
 * ========================================
 * TIMERS GLOBAUX (d'attente avant course)
 * ========================================
 * ⚠️ DÉPRÉCIÉ: TIMER_DURATION_MS est maintenant ROUND_WAIT_DURATION_MS
 * Utiliser ROUND_WAIT_DURATION_MS pour cohérence
 */

/**
 * Durée d'attente avant de lancer une nouvelle course (en secondes)
 * ⚠️ DÉPRÉCIÉ: Utiliser ROUND_WAIT_DURATION_SECONDS à la place
 * Peut être surchargée via variable d'environnement TIMER_DURATION_SECONDS
 * Par défaut: 60 secondes (1 minute)
 * @deprecated Utiliser ROUND_WAIT_DURATION_SECONDS
 */
export const TIMER_DURATION_SECONDS = parseInt(process.env.TIMER_DURATION_SECONDS || process.env.ROUND_WAIT_DURATION_SECONDS || '60', 10);

/**
 * Durée d'attente avant course en MILLISECONDES
 * ⚠️ DÉPRÉCIÉ: Utiliser ROUND_WAIT_DURATION_MS à la place
 * ✅ TOUTES LES VALEURS DOIVENT ÊTRE EN MS
 * @deprecated Utiliser ROUND_WAIT_DURATION_MS
 */
export const TIMER_DURATION_MS = TIMER_DURATION_SECONDS * 1000;

/**
 * Intervalle de mise à jour du timer pour les clients WebSocket (en ms)
 * Le serveur envoie les mises à jour toutes les X ms
 * Par défaut: 1000ms (1 seconde)
 */
export const TIMER_UPDATE_INTERVAL_MS = parseInt(process.env.TIMER_UPDATE_INTERVAL_MS || '1000', 10);

/**
 * ========================================
 * TIMERS DE RACE (film + résultats)
 * ========================================
 * Ces timers définissent la durée de chaque phase de la course
 * TOUTES LES VALEURS SONT EN MILLISECONDES
 */

/**
 * Durée de l'animation du movie_screen (film de la course) en secondes
 * Peut être surchargée via MOVIE_SCREEN_DURATION_SECONDS
 * Par défaut: 30 secondes
 */
export const MOVIE_SCREEN_DURATION_SECONDS = parseInt(process.env.MOVIE_SCREEN_DURATION_SECONDS || '30', 10);

/**
 * Durée du movie_screen en MILLISECONDES
 * ✅ EN MS POUR COHÉRENCE GLOBALE
 */
export const MOVIE_SCREEN_DURATION_MS = MOVIE_SCREEN_DURATION_SECONDS * 1000;

/**
 * Durée de l'affichage du finish_screen (résultats) en secondes
 * Peut être surchargée via FINISH_SCREEN_DURATION_SECONDS
 * Par défaut: 5 secondes
 */
export const FINISH_SCREEN_DURATION_SECONDS = parseInt(process.env.FINISH_SCREEN_DURATION_SECONDS || '5', 10);

/**
 * Durée du finish_screen en MILLISECONDES
 * ✅ EN MS POUR COHÉRENCE GLOBALE
 */
export const FINISH_SCREEN_DURATION_MS = FINISH_SCREEN_DURATION_SECONDS * 1000;

/**
 * Durée TOTALE d'une course (movie_screen + finish_screen) en MILLISECONDES
 * Calculée automatiquement = movie_screen + finish_screen
 * ✅ EN MS POUR COHÉRENCE GLOBALE
 */
export const TOTAL_RACE_TIME_MS = MOVIE_SCREEN_DURATION_MS + FINISH_SCREEN_DURATION_MS;

/**
 * ========================================
 * TIMERS DE COORDINATION (entre phases)
 * ========================================
 * Délais pour coordonner les transitions entre phases
 * TOUTES LES VALEURS SONT EN MILLISECONDES
 */

/**
 * Délai d'attente après un round AVANT de lancer le prochain (en secondes)
 * Permet aux caissiers de voir les résultats et aux joueurs de placer les paris
 * Peut être surchargée via ROUND_WAIT_DURATION_SECONDS ou TIMER_DURATION_SECONDS (pour compatibilité)
 * Par défaut: 60 secondes (1 minute)
 * ✅ SOURCE DE VÉRITÉ UNIQUE pour le timer d'attente entre rounds
 */
export const ROUND_WAIT_DURATION_SECONDS = parseInt(process.env.ROUND_WAIT_DURATION_SECONDS || process.env.TIMER_DURATION_SECONDS || '60', 10);

/**
 * Durée d'attente avant prochain round en MILLISECONDES
 * ✅ EN MS POUR COHÉRENCE GLOBALE
 * ✅ SOURCE DE VÉRITÉ UNIQUE - Utiliser cette constante partout au lieu de TIMER_DURATION_MS
 */
export const ROUND_WAIT_DURATION_MS = ROUND_WAIT_DURATION_SECONDS * 1000;

/**
 * Délai avant de créer le nouveau round après race_start (en secondes)
 * Permet aux caissiers de voir la course en cours avant de placer des paris
 * Peut être surchargée via NEW_ROUND_PREPARE_DELAY_SECONDS
 * Par défaut: 10 secondes (milieu du movie_screen de 15s)
 */
export const NEW_ROUND_PREPARE_DELAY_SECONDS = parseInt(process.env.NEW_ROUND_PREPARE_DELAY_SECONDS || '10', 10);

/**
 * Délai avant création du nouveau round en MILLISECONDES
 * ✅ EN MS POUR COHÉRENCE GLOBALE
 */
export const NEW_ROUND_PREPARE_DELAY_MS = NEW_ROUND_PREPARE_DELAY_SECONDS * 1000;

/**
 * ========================================
 * LIMITES DE MONTANTS DE PARIS
 * ========================================
 */

/**
 * Montant MINIMUM de mise pour un pari (en système = × 100)
 * Frontend: 1000 = 10.00 HTG
 * Par défaut: 1000 (10.00 HTG)
 */
export const MIN_BET_AMOUNT = parseInt(process.env.MIN_BET_AMOUNT || '2500', 10);

/**
 * Montant MAXIMUM de mise pour un pari (en système = × 100)
 * Frontend: 500000 = 5000.00 HTG
 * Par défaut: 500000 (5000.00 HTG)
 */
export const MAX_BET_AMOUNT = parseInt(process.env.MAX_BET_AMOUNT || '500000', 10);

/**
 * ========================================
 * LOGS D'INITIALISATION
 * ========================================
 */
console.log(`
========================================
⏰ CONFIGURATION DES TIMERS (tous en MS)
========================================
⏳ TIMER D'ATTENTE ENTRE ROUNDS (ROUND_WAIT):
   ${ROUND_WAIT_DURATION_SECONDS}s = ${ROUND_WAIT_DURATION_MS}ms
   (TIMER_DURATION_MS est déprécié, utiliser ROUND_WAIT_DURATION_MS)

🎬 TIMERS DE RACE:
   Movie screen: ${MOVIE_SCREEN_DURATION_SECONDS}s = ${MOVIE_SCREEN_DURATION_MS}ms
   Finish screen: ${FINISH_SCREEN_DURATION_SECONDS}s = ${FINISH_SCREEN_DURATION_MS}ms
   Total race: ${Math.round(TOTAL_RACE_TIME_MS / 1000)}s = ${TOTAL_RACE_TIME_MS}ms

⚙️ COORDINATION:
   Préparation nouveau round: ${NEW_ROUND_PREPARE_DELAY_SECONDS}s = ${NEW_ROUND_PREPARE_DELAY_MS}ms
   Mise à jour WebSocket: ${TIMER_UPDATE_INTERVAL_MS}ms

💰 LIMITES DE PARIS:
   Min: ${MIN_BET_AMOUNT} | Max: ${MAX_BET_AMOUNT}
========================================
`);

