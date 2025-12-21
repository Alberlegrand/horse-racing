// routes/system.js
// Route pour servir la configuration du système HITBET777

import express from "express";
import { SYSTEM_NAME, CURRENT_GAME, RECEIPT_CONFIG, UI_CONFIG, FOOTER_CONFIG } from "../config/system.config.js";

const router = express.Router();

/**
 * GET /api/v1/system/config
 * Retourne la configuration complète du système
 */
router.get("/config", (req, res) => {
  res.json({
    success: true,
    system: {
      name: SYSTEM_NAME,
      currentGame: CURRENT_GAME,
      receiptConfig: RECEIPT_CONFIG,
      uiConfig: UI_CONFIG,
      footerConfig: FOOTER_CONFIG,
    },
  });
});

/**
 * GET /api/v1/system/name
 * Retourne juste le nom du système
 */
router.get("/name", (req, res) => {
  res.json({
    success: true,
    systemName: SYSTEM_NAME,
  });
});

/**
 * GET /api/v1/system/game
 * Retourne les infos du jeu actuel
 */
router.get("/game", (req, res) => {
  res.json({
    success: true,
    game: CURRENT_GAME,
  });
});

/**
 * GET /api/v1/system/display-name
 * Retourne le nom d'affichage complet (HITBET777 - Cheval)
 */
router.get("/display-name", (req, res) => {
  res.json({
    success: true,
    displayName: `${SYSTEM_NAME} - ${CURRENT_GAME.displayName}`,
    systemName: SYSTEM_NAME,
    gameName: CURRENT_GAME.displayName,
  });
});

export default router;
