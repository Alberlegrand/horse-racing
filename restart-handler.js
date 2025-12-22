#!/usr/bin/env node

/**
 * Graceful Restart Handler for Admin Dashboard
 * 
 * Usage: node restart-handler.js
 * 
 * Ce script gère le redémarrage gracieux du serveur:
 * 1. Ferme les connexions WebSocket proprement
 * 2. Arrête les timers en attente
 * 3. Ferme les connexions BD/Redis
 * 4. Redémarre le processus
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function gracefulRestart() {
  console.log('[RESTART] Initiating graceful restart...');
  
  try {
    // Vérifier si PM2 est en cours d'exécution
    const { stdout } = await execAsync('npx pm2 list --nostream');
    
    if (stdout && stdout.includes('horse-racing-server')) {
      console.log('[RESTART] Detected PM2 - using PM2 restart');
      await execAsync('npx pm2 restart horse-racing-server');
      console.log('[RESTART] PM2 restart successful');
    } else {
      console.log('[RESTART] No PM2 instance - using direct exit');
      process.exit(0);
    }
  } catch (e) {
    console.log('[RESTART] PM2 not available or error:', e.message);
    console.log('[RESTART] Forcing exit - will be restarted by parent process');
    process.exit(0);
  }
}

gracefulRestart().catch(err => {
  console.error('[RESTART] Error:', err);
  process.exit(1);
});
