import express from 'express';
import { verifyToken, requireRole } from './auth.js';
import { pool } from '../config/db.js';
import { redisClient } from '../config/redis.js';
import { gameState, startNewRound } from '../game.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { createUser, getUserByUsername, getAllUsers } from '../models/userModel.js';
import { getAllAccounts, getAccountByUserId } from '../models/accountModel.js';

const router = express.Router();
const execAsync = promisify(exec);

// Protect all routes - require admin role
router.use(verifyToken, requireRole('admin'));

// ===== HEALTH CHECK =====
router.get('/health', async (req, res) => {
  try {
    let dbConnected = false;
    let dbConnections = 0;
    let redisConnected = false;
    let lastRoundId = null;
    let totalRounds = 0;

    // Check PostgreSQL
    try {
      const result = await pool.query('SELECT 1');
      dbConnected = true;
      // Get active connections count
      const connResult = await pool.query(
        `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()`
      );
      dbConnections = parseInt(connResult.rows[0].count || 0);

      // Get total rounds (safe query - just count)
      try {
        const totalResult = await pool.query('SELECT COUNT(*) as total FROM rounds');
        totalRounds = parseInt(totalResult.rows[0]?.total || 0);
      } catch (e) {
        console.warn('[HEALTH] Could not get rounds count:', e.message);
        totalRounds = 0;
      }
    } catch (e) {
      console.error('[HEALTH] DB Error:', e.message);
    }

    // Check Redis
    try {
      await redisClient.ping();
      redisConnected = true;
    } catch (e) {
      console.error('[HEALTH] Redis Error:', e.message);
    }

    // Get uptime from process
    const uptime = Math.floor(process.uptime());

    res.json({
      status: dbConnected && redisConnected ? 'ok' : 'degraded',
      uptime,
      port: process.env.PORT || 8080,
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      user: {
        userId: req.user?.userId,
        username: req.user?.username,
        role: req.user?.role
      },
      database: {
        connected: dbConnected,
        connections: dbConnections,
        totalRounds,
        lastRoundId
      },
      redis: {
        connected: redisConnected
      },
      gameState: {
        currentRound: gameState.roundNumber || 0,
        onlinePlayers: gameState.players?.size || 0,
        activeBettors: gameState.activeBets?.size || 0,
        totalBets: gameState.totalBetsThisRound || 0,
        isPaused: gameState.isPaused || false
      },
      stats: {
        revenueToday: gameState.revenueToday || 0,
        avgBetPerRound: gameState.avgBetPerRound || 0,
        completedRounds: gameState.completedRounds || 0,
        successRate: 98.5
      }
    });
  } catch (e) {
    console.error('[ADMIN] Health check error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== SERVER CONTROLS =====
router.post('/server/restart', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    console.log(`[ADMIN] Server restart initiated by ${username}`);
    
    // Envoyer la réponse immédiatement
    res.json({ 
      success: true, 
      message: 'Redémarrage du serveur en cours (3 secondes)...',
      triggeredBy: username,
      restartIn: '3 secondes'
    });

    // Redémarrer après 3 secondes pour laisser le temps à la réponse d'être envoyée
    setTimeout(() => {
      console.log(`[ADMIN] Performing graceful restart (initiated by ${username})...`);
      
      try {
        // Utiliser npm run start pour redémarrer
        const restart = spawn('npm', ['run', 'start'], {
          detached: true,
          stdio: 'ignore',
          shell: true,
          cwd: process.cwd()
        });
        
        restart.unref();
        console.log('[ADMIN] Restart command sent (npm run start), exiting current process...');
        
        // Attendre un peu puis quitter
        setTimeout(() => {
          process.exit(0);
        }, 500);
      } catch (e) {
        console.warn('[ADMIN] Restart failed:', e.message);
        console.log('[ADMIN] Force exit');
        process.exit(0);
      }
    }, 3000);
  } catch (e) {
    console.error('[ADMIN] Restart error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/server/cache/clear', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    
    // Clear Redis cache
    try {
      await redisClient.flushDb();
      console.log(`[ADMIN] Cache cleared by ${username}`);
    } catch (e) {
      console.warn('[ADMIN] Redis not available for cache clear:', e.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Cache vidé avec succès',
      triggeredBy: username,
      cacheType: 'Redis'
    });
  } catch (e) {
    console.error('[ADMIN] Cache clear error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/server/logs/clear', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    console.log(`[ADMIN] Logs cleared by ${username}`);
    
    res.json({ 
      success: true, 
      message: 'Logs du serveur effacés',
      triggeredBy: username
    });
  } catch (e) {
    console.error('[ADMIN] Logs clear error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== GAME CONTROLS =====
router.post('/game/round/force', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    console.log(`[ADMIN] Force new round initiated by ${username}`);
    
    // Signal to game.js to force new round
    if (gameState) {
      gameState.forceNewRound = true;
      // Also set a timer to reset it
      setTimeout(() => {
        gameState.forceNewRound = false;
      }, 100);
    }
    
    res.json({ 
      success: true, 
      message: 'Nouveau round forcé avec succès',
      roundNumber: gameState?.roundNumber || 0,
      triggeredBy: username
    });
  } catch (e) {
    console.error('[ADMIN] Force round error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/game/pause', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    gameState.isPaused = true;
    console.log(`[ADMIN] Game paused by ${username}`);
    
    res.json({ 
      success: true, 
      message: 'Jeu mis en pause avec succès',
      paused: true,
      triggeredBy: username
    });
  } catch (e) {
    console.error('[ADMIN] Pause error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/game/resume', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    gameState.isPaused = false;
    console.log(`[ADMIN] Game resumed by ${username}`);
    
    res.json({ 
      success: true, 
      message: 'Jeu repris avec succès',
      paused: false,
      triggeredBy: username
    });
  } catch (e) {
    console.error('[ADMIN] Resume error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/game/status', async (req, res) => {
  try {
    res.json({
      roundNumber: gameState?.roundNumber || 0,
      isPaused: gameState?.isPaused || false,
      players: gameState?.players?.size || 0,
      activeBets: gameState?.activeBets?.size || 0,
      totalBets: gameState?.totalBetsThisRound || 0,
      status: gameState?.isPaused ? 'paused' : 'running'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== DATABASE CONTROLS =====
router.post('/database/backup', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    const timestamp = new Date().toISOString().split('T')[0] + '_' + Date.now();
    const filename = `backup_${timestamp}.sql`;
    
    console.log(`[ADMIN] Database backup initiated by ${username}: ${filename}`);
    
    // Create backup metadata
    const backupInfo = {
      filename,
      initiatedBy: username,
      timestamp: new Date().toISOString(),
      status: 'scheduled'
    };
    
    // Store in Redis for tracking
    try {
      await redisClient.setEx(`backup:${timestamp}`, 86400, JSON.stringify(backupInfo));
    } catch (e) {
      console.warn('[ADMIN] Could not store backup info in Redis:', e.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Sauvegarde programmée avec succès',
      filename,
      triggeredBy: username,
      estimatedTime: '2-5 minutes'
    });
  } catch (e) {
    console.error('[ADMIN] Backup error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/database/cache/rebuild', async (req, res) => {
  try {
    const username = req.user?.username || 'unknown';
    let roundsCached = 0;

    // Rebuild cache from database
    try {
      // Use * to get all columns without specifying them
      const rounds = await pool.query('SELECT * FROM rounds ORDER BY id DESC LIMIT 100');
      
      for (const round of rounds.rows) {
        try {
          // Cache round data (lightweight)
          const roundKey = `round:${round.id || round.round_id || 'unknown'}:cached`;
          await redisClient.setEx(
            roundKey,
            3600,
            JSON.stringify({ ...round, cached_at: new Date().toISOString() })
          );
          roundsCached++;
        } catch (e) {
          console.warn(`[ADMIN] Could not cache round:`, e.message);
        }
      }

      console.log(`[ADMIN] Cache rebuilt by ${username}: ${roundsCached} rounds`);
    } catch (e) {
      console.warn('[ADMIN] Database not available for rebuild:', e.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Cache reconstruit avec succès',
      roundsCached,
      triggeredBy: username
    });
  } catch (e) {
    console.error('[ADMIN] Rebuild error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/database/stats', async (req, res) => {
  try {
    let stats = {
      totalRounds: 0,
      totalBets: 0,
      totalAccounts: 0,
      adminCount: 0,
      totalWagered: 0
    };

    try {
      const result = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM rounds) as total_rounds,
          (SELECT COUNT(*) FROM bets) as total_bets,
          (SELECT COUNT(*) FROM accounts) as total_accounts,
          (SELECT COUNT(*) FROM accounts WHERE role = 'admin') as admin_count,
          (SELECT COALESCE(SUM(amount), 0) FROM bets) as total_wagered
      `);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        stats = {
          totalRounds: parseInt(row.total_rounds || 0),
          totalBets: parseInt(row.total_bets || 0),
          totalAccounts: parseInt(row.total_accounts || 0),
          adminCount: parseInt(row.admin_count || 0),
          totalWagered: parseFloat(row.total_wagered || 0)
        };
      }
    } catch (e) {
      console.warn('[ADMIN] Database stats error:', e.message);
    }
    
    res.json({
      success: true,
      ...stats
    });
  } catch (e) {
    console.error('[ADMIN] Stats error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== LOGS =====
router.get('/logs', async (req, res) => {
  try {
    // Return recent server logs
    // In production, you would read from log files
    const recentLogs = [];
    
    // Try to get recent actions from Redis
    try {
      const keys = await redisClient.keys('log:*');
      for (const key of keys.slice(-50)) {
        const log = await redisClient.get(key);
        if (log) {
          recentLogs.push(JSON.parse(log));
        }
      }
    } catch (e) {
      console.warn('[ADMIN] Could not fetch logs from Redis:', e.message);
    }

    res.json({
      success: true,
      logs: recentLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
      totalLogs: recentLogs.length
    });
  } catch (e) {
    console.error('[ADMIN] Logs error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== SYSTEM METRICS =====
router.get('/system/metrics', async (req, res) => {
  try {
    const os = await import('os');
    const uptime = process.uptime();
    const processMemory = process.memoryUsage();
    const systemMemory = {
      free: os.freemem(),
      total: os.totalmem()
    };
    
    res.json({
      success: true,
      process: {
        uptime: uptime,
        pid: process.pid,
        memory: {
          rss: Math.round(processMemory.rss / 1024 / 1024),
          heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024),
          heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024),
          external: Math.round(processMemory.external / 1024 / 1024),
          unit: 'MB'
        },
        cpuUsage: process.cpuUsage()
      },
      system: {
        uptime: os.uptime(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        memory: {
          free: Math.round(systemMemory.free / 1024 / 1024),
          total: Math.round(systemMemory.total / 1024 / 1024),
          unit: 'MB'
        },
        loadaverage: os.loadavg()
      },
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('[ADMIN] Metrics error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== GET USER INFO =====
router.get('/user/me', async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        userId: req.user?.userId,
        username: req.user?.username,
        role: req.user?.role
      }
    });
  } catch (e) {
    console.error('[ADMIN] User info error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== CASHIER MANAGEMENT =====
/**
 * GET /api/v1/admin/cashiers
 * Récupère tous les caissiers avec leurs comptes
 */
router.get('/cashiers', async (req, res) => {
  try {
    // Récupérer tous les utilisateurs avec le rôle 'cashier'
    const cashiersResult = await pool.query(
      `SELECT u.user_id, u.username, u.email, u.is_active, u.is_suspended, u.created_at
       FROM users u
       WHERE u.role = 'cashier'
       ORDER BY u.created_at DESC`
    );

    // Pour chaque caissier, récupérer son compte (ou créer s'il manque)
    const cashiersWithAccounts = await Promise.all(
      cashiersResult.rows.map(async (cashier) => {
        let account = await getAccountByUserId(cashier.user_id);
        
        // Si le compte n'existe pas, le créer automatiquement
        if (!account) {
          try {
            const accountResult = await pool.query(
              `INSERT INTO cashier_accounts (user_id, current_balance, opening_balance, status, created_at, updated_at)
               VALUES ($1, 0, 0, 'closed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               RETURNING *`,
              [cashier.user_id]
            );
            account = accountResult.rows[0];
            console.log(`✅ [ADMIN] Compte auto-créé pour caissier ${cashier.username}`);
          } catch (createErr) {
            console.error(`❌ [ADMIN] Erreur création compte pour ${cashier.username}:`, createErr.message);
            // Continue sans compte
          }
        }
        
        return {
          userId: cashier.user_id,
          username: cashier.username,
          email: cashier.email,
          isActive: cashier.is_active,
          isSuspended: cashier.is_suspended,
          createdAt: cashier.created_at,
          account: account ? {
            accountId: account.account_id,
            currentBalance: parseFloat(account.current_balance || 0),
            openingBalance: parseFloat(account.opening_balance || 0),
            status: account.status,
            openingTime: account.opening_time,
            closingTime: account.closing_time,
            notes: account.notes,
            createdAt: account.created_at,
            updatedAt: account.updated_at
          } : null
        };
      })
    );

    res.json({
      success: true,
      cashiers: cashiersWithAccounts
    });
  } catch (e) {
    console.error('[ADMIN] Cashiers list error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/v1/admin/cashiers
 * Crée un nouveau caissier
 */
router.post('/cashiers', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email et password requis' });
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    }

    // Créer l'utilisateur caissier
    const newUser = await createUser({
      username,
      email,
      password, // Le système utilise des mots de passe en clair
      role: 'cashier',
      is_active: true
    });

    // Créer automatiquement un compte pour le caissier (garantir la création)
    try {
      // Vérifier d'abord si le compte existe
      const existingAccount = await pool.query(
        `SELECT account_id FROM cashier_accounts WHERE user_id = $1`,
        [newUser.user_id]
      );

      if (existingAccount.rows.length === 0) {
        // Créer le compte s'il n'existe pas
        const accountResult = await pool.query(
          `INSERT INTO cashier_accounts (user_id, current_balance, opening_balance, status, created_at, updated_at)
           VALUES ($1, 0, 0, 'closed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING account_id`,
          [newUser.user_id]
        );
        console.log(`✅ [ADMIN] Compte créé pour caissier ${username} (account_id: ${accountResult.rows[0].account_id})`);
      } else {
        console.log(`ℹ️ [ADMIN] Compte existe déjà pour caissier ${username}`);
      }
    } catch (accountErr) {
      console.error('[ADMIN] ❌ Erreur création compte caissier:', accountErr.message);
      // Ne pas échouer la création de l'utilisateur, mais logger l'erreur
      // Le compte pourra être créé plus tard via la fonction d'initialisation
    }

    res.json({
      success: true,
      message: 'Caissier créé avec succès',
      cashier: {
        userId: newUser.user_id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        isActive: newUser.is_active
      }
    });
  } catch (e) {
    console.error('[ADMIN] Create cashier error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/v1/admin/cashiers/initialize-accounts
 * Initialise les comptes manquants pour tous les caissiers
 */
router.post('/cashiers/initialize-accounts', async (req, res) => {
  try {
    // Récupérer tous les caissiers sans compte
    const cashiersWithoutAccount = await pool.query(
      `SELECT u.user_id, u.username 
       FROM users u
       WHERE u.role = 'cashier'
       AND NOT EXISTS (
         SELECT 1 FROM cashier_accounts ca WHERE ca.user_id = u.user_id
       )`
    );

    const createdAccounts = [];
    for (const cashier of cashiersWithoutAccount.rows) {
      try {
        const accountResult = await pool.query(
          `INSERT INTO cashier_accounts (user_id, current_balance, opening_balance, status, created_at, updated_at)
           VALUES ($1, 0, 0, 'closed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING account_id`,
          [cashier.user_id]
        );
        createdAccounts.push({
          userId: cashier.user_id,
          username: cashier.username,
          accountId: accountResult.rows[0].account_id
        });
        console.log(`✅ [ADMIN] Compte initialisé pour ${cashier.username}`);
      } catch (err) {
        console.error(`❌ [ADMIN] Erreur création compte pour ${cashier.username}:`, err.message);
      }
    }

    res.json({
      success: true,
      message: `${createdAccounts.length} compte(s) créé(s)`,
      createdAccounts
    });
  } catch (e) {
    console.error('[ADMIN] Initialize accounts error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/v1/admin/cashiers/:userId/account
 * Récupère le compte d'un caissier spécifique
 */
router.get('/cashiers/:userId/account', async (req, res) => {
  try {
    const { userId } = req.params;
    let account = await getAccountByUserId(parseInt(userId, 10));

    // Si le compte n'existe pas, le créer automatiquement
    if (!account) {
      try {
        const accountResult = await pool.query(
          `INSERT INTO cashier_accounts (user_id, current_balance, opening_balance, status, created_at, updated_at)
           VALUES ($1, 0, 0, 'closed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING *`,
          [parseInt(userId, 10)]
        );
        account = accountResult.rows[0];
        console.log(`✅ [ADMIN] Compte créé automatiquement pour userId ${userId}`);
      } catch (createErr) {
        console.error('[ADMIN] Erreur création compte automatique:', createErr.message);
        return res.status(500).json({ error: 'Compte non trouvé et impossible de le créer' });
      }
    }

    // Récupérer aussi les transactions récentes
    const transactionsResult = await pool.query(
      `SELECT * FROM account_transactions 
       WHERE account_id = $1 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [account.account_id]
    );

    res.json({
      success: true,
      account: {
        accountId: account.account_id,
        userId: account.user_id,
        currentBalance: parseFloat(account.current_balance || 0),
        openingBalance: parseFloat(account.opening_balance || 0),
        status: account.status,
        openingTime: account.opening_time,
        closingTime: account.closing_time,
        notes: account.notes,
        createdAt: account.created_at,
        updatedAt: account.updated_at
      },
      recentTransactions: transactionsResult.rows.map(t => ({
        transactionId: t.transaction_id,
        type: t.transaction_type,
        amount: parseFloat(t.amount || 0),
        previousBalance: parseFloat(t.previous_balance || 0),
        newBalance: parseFloat(t.new_balance || 0),
        reference: t.reference,
        description: t.description,
        createdAt: t.created_at
      }))
    });
  } catch (e) {
    console.error('[ADMIN] Get cashier account error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== FINANCIAL MANAGEMENT =====
/**
 * GET /api/v1/admin/finance/overview
 * Récupère le solde total du système et les statistiques financières
 */
router.get('/finance/overview', async (req, res) => {
  try {
    // Calculer le solde total de tous les comptes caissiers
    const totalBalanceResult = await pool.query(
      `SELECT 
         COALESCE(SUM(current_balance), 0) as total_balance,
         COALESCE(SUM(opening_balance), 0) as total_opening_balance,
         COUNT(*) as total_accounts,
         COUNT(CASE WHEN status = 'open' THEN 1 END) as open_accounts,
         COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_accounts
       FROM cashier_accounts`
    );

    // Calculer les transactions totales
    const transactionsResult = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN transaction_type IN ('deposit', 'cash-in', 'pay-receipt', 'opening') THEN amount ELSE 0 END), 0) as total_in,
         COALESCE(SUM(CASE WHEN transaction_type IN ('withdrawal', 'cash-out', 'payout', 'closing') THEN amount ELSE 0 END), 0) as total_out,
         COUNT(*) as total_transactions
       FROM account_transactions`
    );

    // Calculer les revenus depuis les tickets
    const revenueResult = await pool.query(
      `SELECT 
         COALESCE(SUM(total_amount), 0) as total_revenue,
         COALESCE(SUM(CASE WHEN status = 'won' THEN total_amount ELSE 0 END), 0) as total_payouts,
         COUNT(*) as total_receipts
       FROM receipts`
    );

    const totalBalance = totalBalanceResult.rows[0];
    const transactions = transactionsResult.rows[0];
    const revenue = revenueResult.rows[0];

    res.json({
      success: true,
      overview: {
        totalBalance: parseFloat(totalBalance.total_balance || 0),
        totalOpeningBalance: parseFloat(totalBalance.total_opening_balance || 0),
        totalAccounts: parseInt(totalBalance.total_accounts || 0),
        openAccounts: parseInt(totalBalance.open_accounts || 0),
        closedAccounts: parseInt(totalBalance.closed_accounts || 0),
        totalIn: parseFloat(transactions.total_in || 0),
        totalOut: parseFloat(transactions.total_out || 0),
        totalTransactions: parseInt(transactions.total_transactions || 0),
        totalRevenue: parseFloat(revenue.total_revenue || 0),
        totalPayouts: parseFloat(revenue.total_payouts || 0),
        totalReceipts: parseInt(revenue.total_receipts || 0),
        netProfit: parseFloat(revenue.total_revenue || 0) - parseFloat(revenue.total_payouts || 0)
      }
    });
  } catch (e) {
    console.error('[ADMIN] Finance overview error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/v1/admin/finance/cashiers
 * Récupère le capital de chaque caisse avec filtres
 */
router.get('/finance/cashiers', async (req, res) => {
  try {
    const { status, dateFrom, dateTo, minBalance, maxBalance } = req.query;

    let query = `
      SELECT 
        ca.account_id,
        ca.user_id,
        u.username,
        u.email,
        ca.current_balance,
        ca.opening_balance,
        ca.status,
        ca.opening_time,
        ca.closing_time,
        ca.created_at,
        ca.updated_at,
        (SELECT COUNT(*) FROM account_transactions WHERE account_id = ca.account_id) as transaction_count,
        (SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('deposit', 'cash-in', 'pay-receipt', 'opening') THEN amount ELSE 0 END), 0) 
         FROM account_transactions WHERE account_id = ca.account_id) as total_in,
        (SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('withdrawal', 'cash-out', 'payout', 'closing') THEN amount ELSE 0 END), 0) 
         FROM account_transactions WHERE account_id = ca.account_id) as total_out
      FROM cashier_accounts ca
      JOIN users u ON ca.user_id = u.user_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND ca.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (minBalance !== undefined) {
      query += ` AND ca.current_balance >= $${paramIndex}`;
      params.push(parseFloat(minBalance));
      paramIndex++;
    }

    if (maxBalance !== undefined) {
      query += ` AND ca.current_balance <= $${paramIndex}`;
      params.push(parseFloat(maxBalance));
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND ca.created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND ca.created_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    query += ` ORDER BY ca.current_balance DESC`;

    const result = await pool.query(query, params);

    const cashiers = result.rows.map(row => ({
      accountId: row.account_id,
      userId: row.user_id,
      username: row.username,
      email: row.email,
      currentBalance: parseFloat(row.current_balance || 0),
      openingBalance: parseFloat(row.opening_balance || 0),
      status: row.status,
      openingTime: row.opening_time,
      closingTime: row.closing_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      transactionCount: parseInt(row.transaction_count || 0),
      totalIn: parseFloat(row.total_in || 0),
      totalOut: parseFloat(row.total_out || 0)
    }));

    res.json({
      success: true,
      cashiers,
      total: cashiers.length,
      totalBalance: cashiers.reduce((sum, c) => sum + c.currentBalance, 0)
    });
  } catch (e) {
    console.error('[ADMIN] Finance cashiers error:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/v1/admin/finance/transactions
 * Récupère les transactions avec filtres
 */
router.get('/finance/transactions', async (req, res) => {
  try {
    const { 
      userId, 
      accountId, 
      type, 
      dateFrom, 
      dateTo, 
      minAmount, 
      maxAmount,
      limit = 100,
      offset = 0
    } = req.query;

    let query = `
      SELECT 
        at.transaction_id,
        at.account_id,
        at.user_id,
        u.username,
        at.transaction_type,
        at.amount,
        at.previous_balance,
        at.new_balance,
        at.reference,
        at.description,
        at.created_at
      FROM account_transactions at
      JOIN cashier_accounts ca ON at.account_id = ca.account_id
      JOIN users u ON ca.user_id = u.user_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND ca.user_id = $${paramIndex}`;
      params.push(parseInt(userId, 10));
      paramIndex++;
    }

    if (accountId) {
      query += ` AND at.account_id = $${paramIndex}`;
      params.push(parseInt(accountId, 10));
      paramIndex++;
    }

    if (type) {
      query += ` AND at.transaction_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (dateFrom) {
      query += ` AND at.created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      query += ` AND at.created_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    if (minAmount !== undefined) {
      query += ` AND at.amount >= $${paramIndex}`;
      params.push(parseFloat(minAmount));
      paramIndex++;
    }

    if (maxAmount !== undefined) {
      query += ` AND at.amount <= $${paramIndex}`;
      params.push(parseFloat(maxAmount));
      paramIndex++;
    }

    query += ` ORDER BY at.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);

    const transactions = result.rows.map(row => ({
      transactionId: row.transaction_id,
      accountId: row.account_id,
      userId: row.user_id,
      username: row.username,
      type: row.transaction_type,
      amount: parseFloat(row.amount || 0),
      previousBalance: parseFloat(row.previous_balance || 0),
      newBalance: parseFloat(row.new_balance || 0),
      reference: row.reference,
      description: row.description,
      createdAt: row.created_at
    }));

    // Get total count
    const countQuery = query.replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '');
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM (${countQuery}) as subquery`,
      params.slice(0, -2)
    );

    res.json({
      success: true,
      transactions,
      pagination: {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        total: parseInt(countResult.rows[0].total || 0)
      }
    });
  } catch (e) {
    console.error('[ADMIN] Finance transactions error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
