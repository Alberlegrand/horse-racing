// config/system.config.js
// Configuration globale du système HITBET777

/**
 * Nom du système - Affiché partout dans l'application
 */
export const SYSTEM_NAME = 'HITBET777';

/**
 * Noms des jeux disponibles
 * Chaque jeu dans le système doit avoir un identifiant unique
 */
export const GAMES = {
  HORSE: {
    id: 'horse',
    name: 'Cheval',                    // Nom du jeu en français
    displayName: 'Cheval',             // Nom affiché sur les reçus
    description: 'Course de Chevaux',  // Description longue
    icon: '🐴',                        // Emoji du jeu
  },
  KENO: {
    id: 'keno',
    name: 'Kéno',
    displayName: 'Kéno',
    description: 'Jeu de Kéno',
    icon: '🎲',
  },
  BINGO: {
    id: 'bingo',
    name: 'Bingo',
    displayName: 'Bingo',
    description: 'Jeu de Bingo',
    icon: '🎯',
  },
  ROULETTE: {
    id: 'roulette',
    name: 'Roulette',
    displayName: 'Roulette',
    description: 'Roulette',
    icon: '🎡',
  },
};

/**
 * Jeu actuellement actif
 * À modifier selon le jeu déployé
 */
export const CURRENT_GAME = GAMES.HORSE;

/**
 * Obtenir le nom complet du système avec le jeu
 * Exemple: "HITBET777 - Cheval"
 */
export function getSystemDisplayName() {
  return `${SYSTEM_NAME} - ${CURRENT_GAME.displayName}`;
}

/**
 * Obtenir le titre du reçu
 * Utilisé sur les tickets imprimés
 */
export function getReceiptTitle() {
  return `${SYSTEM_NAME}\nJeu: ${CURRENT_GAME.displayName}`;
}

/**
 * Configuration des reçus
 */
export const RECEIPT_CONFIG = {
  systemName: SYSTEM_NAME,
  gameName: CURRENT_GAME.displayName,
  includeGameName: true,  // Afficher le nom du jeu sur les reçus
  includeSystemName: true, // Afficher le nom du système sur les reçus
  dateFormat: 'fr-FR',    // Format de la date
  timeFormat: 'fr-FR',    // Format de l'heure
};

/**
 * Configuration de l'interface utilisateur
 */
export const UI_CONFIG = {
  systemName: SYSTEM_NAME,
  gameName: CURRENT_GAME.displayName,
  gameIcon: CURRENT_GAME.icon,
  browserTitle: `${SYSTEM_NAME} - ${CURRENT_GAME.displayName}`,
};

/**
 * Configuration du pied de page
 */
export const FOOTER_CONFIG = {
  copyright: SYSTEM_NAME,
  year: new Date().getFullYear(),
};

export default {
  SYSTEM_NAME,
  GAMES,
  CURRENT_GAME,
  RECEIPT_CONFIG,
  UI_CONFIG,
  FOOTER_CONFIG,
};
