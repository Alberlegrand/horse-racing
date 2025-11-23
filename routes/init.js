// routes/init.js - Endpoint d'initialisation optimisé

import express from "express";
import { gameState, wrap } from "../game.js";

/**
 * Endpoint d'initialisation rapide du game
 * Retourne TOUTES les données nécessaires au démarrage en UNE SEULE requête
 * 
 * GET /api/v1/init/game
 * 
 * Response:
 * {
 *   round: { id, participants, status, ... },
 *   balance: { money, totalReceived, totalPayouts },
 *   tickets: [],
 *   timer: { timeLeft, totalDuration, ... },
 *   cacheTimestamp: Date.now()
 * }
 */

export default function createInitRouter() {
  const router = express.Router();

  // GET /api/v1/init/game - Charge TOUT en une seule requête
  router.get("/game", (req, res) => {
    const now = Date.now();
    
    // ✅ ZERO DB QUERIES - Toutes les données sont en mémoire
    const timeLeft = gameState.nextRoundStartTime ? Math.max(0, gameState.nextRoundStartTime - now) : 0;
    const envDuration = Number(process.env.ROUND_WAIT_DURATION_MS);
    const ROUND_WAIT_DURATION_MS = (envDuration > 0) ? envDuration : 180000;

    const initData = {
      // Round data
      round: {
        id: gameState.currentRound?.id,
        participants: gameState.currentRound?.participants || [],
        status: gameState.isRaceRunning ? 'running' : 'waiting',
        isRaceRunning: gameState.isRaceRunning,
        raceStartTime: gameState.raceStartTime,
        raceEndTime: gameState.raceEndTime,
      },

      // Timer data
      timer: {
        timeLeft: Math.max(0, timeLeft),
        totalDuration: ROUND_WAIT_DURATION_MS,
        serverTime: now,
        percentage: 100 - (timeLeft / ROUND_WAIT_DURATION_MS) * 100
      },

      // Receipt data (from memory)
      tickets: gameState.currentRound?.receipts || [],

      // Game state flags
      isRaceRunning: gameState.isRaceRunning,
      nextRoundStartTime: gameState.nextRoundStartTime,

      // Cache information for client-side
      cacheTimestamp: now,
      source: 'memory'  // Tell client data comes from memory (instant)
    };

    // ✅ Cache headers
    res.set('Cache-Control', 'public, max-age=2');
    res.set('X-Data-Source', 'memory-single-request');
    res.set('X-Response-Time', `${Date.now() - now}ms`);

    return res.json(wrap(initData));
  });

  // GET /api/v1/init/dashboard - Optimized cashier dashboard init
  router.get("/dashboard", (req, res) => {
    const now = Date.now();

    // Get data from gameState (memory only - no DB)
    const dashboardData = {
      round: {
        id: gameState.currentRound?.id,
        participants: gameState.currentRound?.participants || [],
        status: gameState.isRaceRunning ? 'running' : 'waiting'
      },
      
      tickets: gameState.currentRound?.receipts || [],
      
      timer: {
        timeLeft: Math.max(0, gameState.nextRoundStartTime - now),
        totalDuration: Number(process.env.ROUND_WAIT_DURATION_MS) || 180000,
        serverTime: now
      },

      cacheTimestamp: now,
      source: 'memory'
    };

    res.set('Cache-Control', 'public, max-age=2');
    res.set('X-Data-Source', 'memory-single-request');

    return res.json(wrap(dashboardData));
  });

  return router;
}
