// utils.js

/**
 * Échappe les caractères HTML pour un affichage sécurisé.
 */
export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Configuration de conversion de devise (cohérente avec le client)
 * Le client utilise digits: 2, ce qui signifie :
 * - publicToSystem: multiplie par 100 (10^2)
 * - systemToPublic: divise par 100 (10^2)
 */
const CURRENCY_DIGITS = 2;

/**
 * Convertit une valeur publique (affichée à l'utilisateur) en valeur système (stockée)
 * Exemple: publicToSystem(5) = 500 (si digits = 2)
 * @param {number} publicValue - Valeur publique
 * @returns {number} - Valeur système
 */
export function publicToSystem(publicValue) {
  return Math.round(Number(publicValue) * Math.pow(10, CURRENCY_DIGITS));
}

/**
 * Convertit une valeur système (stockée) en valeur publique (affichée à l'utilisateur)
 * Exemple: systemToPublic(500) = 5 (si digits = 2)
 * @param {number} systemValue - Valeur système
 * @returns {number} - Valeur publique
 */
export function systemToPublic(systemValue) {
  return Number(systemValue) / Math.pow(10, CURRENCY_DIGITS);
}