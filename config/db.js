import { Pool } from "pg";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

console.log("🔐 Certificat SSL:", process.env.SSL_CERTIFICATE);

// Créer la base de données si elle n'existe pas
const createDatabaseIfNotExists = async () => {
  // Connexion au serveur PostgreSQL par défaut
const adminPool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: process.env.SSL_CERTIFICATE
        ? {
                rejectUnauthorized: true,
                ca: fs.readFileSync(process.env.SSL_CERTIFICATE).toString(),
            }
        : false,
});

  try {
    const databaseName = "hitbet";
    const checkDb = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName]
    );

    if (checkDb.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${databaseName}`);
      console.log(`✅ Base de données '${databaseName}' créée`);
    } else {
      console.log(`✅ Base de données '${databaseName}' existe déjà`);
    }
  } catch (err) {
    console.error("❌ Erreur lors de la création de la base de données:", err.message);
  } finally {
    await adminPool.end();
  }
};

// Appeler la création au démarrage
await createDatabaseIfNotExists();

const poolConfig = {
  connectionString: process.env.DB_URL || "postgres://postgres@localhost:5432/hitbet",
  ssl: process.env.SSL_CERTIFICATE
    ? {
        rejectUnauthorized: true,
        ca: fs.readFileSync(process.env.SSL_CERTIFICATE).toString(),
      }
    : false, // Désactiver SSL si pas de certificat
  // ✅ NOUVEAU: Configuration du pool pour résilience
  max: 20, // Nombre maximum de connexions dans le pool
  min: 2, // Nombre minimum de connexions maintenues
  idleTimeoutMillis: 30000, // Fermer les connexions inactives après 30s
  connectionTimeoutMillis: 10000, // Timeout de connexion de 10s
  // ✅ NOUVEAU: Retry automatique pour les connexions perdues
  allowExitOnIdle: false, // Ne pas fermer le pool automatiquement
  // ✅ CORRECTION: Timeout pour les requêtes longues (création de tables)
  query_timeout: 60000, // 60 secondes pour les requêtes de création de tables
};

export const pool = new Pool(poolConfig);

// ✅ NOUVEAU: Gestionnaire d'erreurs pour le pool de connexions
pool.on('error', (err, client) => {
  console.error('❌ [DB-POOL] Erreur inattendue sur le client PostgreSQL:', err.message);
  console.error('   Stack:', err.stack);
  // Ne pas faire crash le serveur - juste logger l'erreur
  // Le pool gérera automatiquement la reconnexion
});

pool.on('connect', (client) => {
  console.log('✅ [DB-POOL] Nouvelle connexion PostgreSQL établie');
});

pool.on('acquire', (client) => {
  // Connexion acquise du pool
});

pool.on('remove', (client) => {
  console.log('⚠️ [DB-POOL] Connexion PostgreSQL retirée du pool');
});

// ✅ NOUVEAU: Fonction de retry avec backoff exponentiel
const retryWithBackoff = async (fn, maxRetries = 5, initialDelay = 1000) => {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const delay = initialDelay * Math.pow(2, attempt);
      console.warn(`⚠️ [DB-RETRY] Tentative ${attempt + 1}/${maxRetries} échouée, retry dans ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

// ✅ NOUVEAU: Test de connexion avec retry automatique
export const testConnection = async (maxRetries = 5) => {
  try {
    await retryWithBackoff(async () => {
      const result = await pool.query("SELECT NOW()");
      console.log("✅ Connexion PostgreSQL établie");
      return result;
    }, maxRetries);
    return true;
  } catch (err) {
    console.error("❌ Erreur de connexion PostgreSQL après", maxRetries, "tentatives:", err.message);
    console.error("   Le serveur continuera de fonctionner mais certaines fonctionnalités DB seront indisponibles");
    return false;
  }
};

// ✅ NOUVEAU: Fonction wrapper pour les requêtes DB avec gestion d'erreur gracieuse
export const safeQuery = async (queryText, params = [], options = {}) => {
  const { maxRetries = 3, retryDelay = 1000, fallback = null } = options;
  
  try {
    return await retryWithBackoff(async () => {
      return await pool.query(queryText, params);
    }, maxRetries, retryDelay);
  } catch (err) {
    console.error(`❌ [DB-QUERY] Erreur lors de l'exécution de la requête:`, err.message);
    console.error(`   Query: ${queryText.substring(0, 100)}...`);
    
    // Si un fallback est fourni, le retourner au lieu de faire crash
    if (fallback !== null) {
      console.warn(`⚠️ [DB-QUERY] Utilisation du fallback pour la requête`);
      return fallback;
    }
    
    // Sinon, propager l'erreur mais ne pas faire crash le serveur
    throw err;
  }
};

export const initializeDatabase = async () => {
  const connectionOk = await testConnection();
  if (!connectionOk) {
    console.warn("⚠️ [DB-INIT] Connexion DB non disponible, initialisation reportée");
    console.warn("   Le serveur continuera de fonctionner mais certaines fonctionnalités seront limitées");
    return false;
  }

  try {
    // Drop and recreate tables only in development
    // In production, use proper migrations instead
    if (process.env.NODE_ENV !== 'production') {
      try {
        await dropTablesIfExist();
      } catch (dropErr) {
        console.warn("⚠️ [DB-INIT] Erreur lors de la suppression des tables (non bloquant):", dropErr.message);
      }
    }
    
    try {
      await createTables();
      console.log("✅ Initialisation de la base de données réussie");
      
      // ✅ CORRECTION: Vérifier que les tables critiques existent vraiment
      const criticalTables = ['users', 'participants', 'rounds', 'receipts', 'bets'];
      const missingTables = [];
      
      for (const tableName of criticalTables) {
        try {
          const checkRes = await pool.query(
            `SELECT EXISTS (
              SELECT FROM information_schema.tables 
              WHERE table_schema = 'public' 
              AND table_name = $1
            )`,
            [tableName]
          );
          
          if (!checkRes.rows[0].exists) {
            missingTables.push(tableName);
            console.error(`❌ [DB-INIT] Table critique manquante: ${tableName}`);
          } else {
            console.log(`✅ [DB-INIT] Table '${tableName}' vérifiée`);
          }
        } catch (checkErr) {
          console.warn(`⚠️ [DB-INIT] Impossible de vérifier la table '${tableName}':`, checkErr.message);
        }
      }
      
      if (missingTables.length > 0) {
        console.error(`❌ [DB-INIT] ${missingTables.length} table(s) critique(s) manquante(s): ${missingTables.join(', ')}`);
        console.error("   Le serveur continuera mais certaines fonctionnalités seront indisponibles");
        console.error("   Solution: Redémarrer le serveur pour réessayer la création des tables");
        return false;
      }
      
    } catch (createErr) {
      console.error("❌ [DB-INIT] Erreur lors de la création des tables:", createErr.message);
      console.error("   Stack:", createErr.stack);
      // Ne pas faire crash - peut-être que les tables existent déjà
      console.warn("   Tentative de continuer avec les tables existantes...");
      
      // Vérifier si les tables existent quand même
      try {
        const checkRes = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'");
        const tableCount = parseInt(checkRes.rows[0].count || 0, 10);
        console.log(`   Nombre de tables trouvées: ${tableCount}`);
        
        if (tableCount === 0) {
          console.error("   ❌ Aucune table trouvée - la création a échoué complètement");
          return false;
        }
      } catch (checkErr) {
        console.warn("   ⚠️ Impossible de vérifier les tables:", checkErr.message);
      }
    }
    
    // Verify participants were seeded (avec gestion d'erreur)
    try {
      const verifyRes = await safeQuery("SELECT COUNT(*) as cnt FROM participants", [], {
        fallback: { rows: [{ cnt: '0' }] }
      });
      const participantCount = parseInt(verifyRes.rows[0]?.cnt || 0, 10);
      console.log(`🔍 Vérification: ${participantCount} participants en base`);
      
      if (participantCount > 0) {
        const listRes = await safeQuery("SELECT participant_id, number, name FROM participants ORDER BY number", [], {
          fallback: { rows: [] }
        });
        console.log("📋 Participants disponibles:");
        listRes.rows.forEach(p => {
          console.log(`   #${p.number}: ${p.name} (ID: ${p.participant_id})`);
        });
      }
    } catch (verifyErr) {
      console.warn("⚠️ [DB-INIT] Erreur lors de la vérification des participants (non bloquant):", verifyErr.message);
    }
    
    return true;
  } catch (err) {
    console.error("❌ [DB-INIT] Erreur lors de l'initialisation:", err.message);
    console.warn("   Le serveur continuera de fonctionner mais certaines fonctionnalités DB seront indisponibles");
    // Ne pas faire crash le serveur - retourner false au lieu de throw
    return false;
  }
};

const dropTablesIfExist = async () => {
  let client;
  try {
    client = await pool.connect();
  } catch (connectErr) {
    console.error("❌ [DB-DROP] Impossible d'acquérir une connexion:", connectErr.message);
    throw connectErr;
  }
  
  try {
    console.log("🗑️ Suppression des anciennes tables...");
    await client.query("BEGIN");

    // Drop in reverse dependency order
    await client.query("DROP TABLE IF EXISTS notifications CASCADE");
    await client.query("DROP TABLE IF EXISTS reports CASCADE");
    await client.query("DROP TABLE IF EXISTS game_statistics CASCADE");
    await client.query("DROP TABLE IF EXISTS transaction_logs CASCADE");
    await client.query("DROP TABLE IF EXISTS payments CASCADE");
    await client.query("DROP TABLE IF EXISTS bets CASCADE");
    await client.query("DROP TABLE IF EXISTS receipts CASCADE");
    await client.query("DROP TABLE IF EXISTS round_participants CASCADE");
    await client.query("DROP TABLE IF EXISTS rounds CASCADE");
    await client.query("DROP SEQUENCE IF EXISTS rounds_round_number_seq CASCADE");
    await client.query("DROP TABLE IF EXISTS participants CASCADE");
    await client.query("DROP TABLE IF EXISTS user_profiles CASCADE");
    await client.query("DROP TABLE IF EXISTS users CASCADE");
    await client.query("DROP TABLE IF EXISTS app_settings CASCADE");
    
    // Drop custom types/enums if they exist
    await client.query("DROP TYPE IF EXISTS user_role CASCADE");
    await client.query("DROP TYPE IF EXISTS role_type CASCADE");
    await client.query("DROP TYPE IF EXISTS status_type CASCADE");
    await client.query("DROP TYPE IF EXISTS bet_status CASCADE");

    await client.query("COMMIT");
    console.log("🗑️ Anciennes tables supprimées");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.warn("⚠️ [DB-DROP] Erreur lors du rollback:", rollbackErr.message);
    }
    console.error("❌ [DB-DROP] Erreur lors de la suppression des tables:", err.message);
    throw err;
  } finally {
    if (client) {
      try {
        client.release();
      } catch (releaseErr) {
        console.warn("⚠️ [DB-DROP] Erreur lors de la libération du client:", releaseErr.message);
      }
    }
  }
};

const createTables = async () => {
  let client;
  try {
    console.log("📋 [DB-CREATE] Acquisition d'une connexion...");
    client = await pool.connect();
    console.log("✅ [DB-CREATE] Connexion acquise");
  } catch (connectErr) {
    console.error("❌ [DB-CREATE] Impossible d'acquérir une connexion:", connectErr.message);
    throw connectErr;
  }

  try {
    console.log("📋 Création des tables...");
    console.log("   [1/10] Début de la transaction...");
    await client.query("BEGIN");
    console.log("   [2/10] Transaction démarrée");

    // ==========================================
    // === UTILISATEURS & CAISSIERS ===
    // ==========================================

    console.log("   [3/10] Création table 'users'...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'cashier',
        is_active BOOLEAN DEFAULT TRUE,
        is_suspended BOOLEAN DEFAULT FALSE,
        is_blocked BOOLEAN DEFAULT FALSE,
        email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("   ✓ Table 'users' créée");

    // Profils d'utilisateurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        profile_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        phone VARCHAR(20),
        bio TEXT,
        address VARCHAR(255),
        date_of_birth DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);

    // ==========================================
    // === PARTICIPANTS (CHEVAUX/SPORTIFS) ===
    // ==========================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        participant_id SERIAL PRIMARY KEY,
        number INT UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        coeff DECIMAL(10,2) NOT NULL,
        family INT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ==========================================
    // === ROUNDS (COURSES) ===
    // ==========================================

    // Create the sequence for round_number
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS rounds_round_number_seq START 1 INCREMENT 1
    `);

    // ✅ NOUVEAU: Create the sequence for round_id (8-digit sequential IDs)
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS rounds_round_id_seq START 10000000 INCREMENT 1
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rounds (
        round_id BIGINT PRIMARY KEY DEFAULT nextval('rounds_round_id_seq'),
        round_number INT UNIQUE NOT NULL DEFAULT nextval('rounds_round_number_seq'),
        status VARCHAR(20) CHECK (status IN ('waiting', 'running', 'finished')) DEFAULT 'waiting',
        winner_id INT,
        total_prize DECIMAL(15,2) DEFAULT 0,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        next_start_time TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (winner_id) REFERENCES participants(participant_id)
      )
    `);

    // Round participants (positions dans une course)
    await client.query(`
      CREATE TABLE IF NOT EXISTS round_participants (
        round_participant_id SERIAL PRIMARY KEY,
        round_id BIGINT NOT NULL,
        participant_id INT NOT NULL,
        place INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
        UNIQUE(round_id, participant_id)
      )
    `);

    // ==========================================
    // === TICKETS & PARIS ===
    // ==========================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        receipt_id BIGINT PRIMARY KEY,
        round_id BIGINT NOT NULL,
        user_id INT,
        status VARCHAR(20) CHECK (status IN ('pending', 'won', 'lost', 'paid', 'cancelled')) DEFAULT 'pending',
        total_amount DECIMAL(15,2) NOT NULL,
        prize DECIMAL(15,2) DEFAULT 0,
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE RESTRICT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
      )
    `);

    // Bets individuels dans un ticket
    await client.query(`
      CREATE TABLE IF NOT EXISTS bets (
        bet_id SERIAL PRIMARY KEY,
        receipt_id BIGINT NOT NULL,
        participant_id INT,
        participant_number INT,
        participant_name VARCHAR(100),
        coefficient DECIMAL(10,2),
        value DECIMAL(15,2) NOT NULL,
        prize DECIMAL(15,2) DEFAULT 0,
        status VARCHAR(20) CHECK (status IN ('pending', 'won', 'lost')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (receipt_id) REFERENCES receipts(receipt_id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE SET NULL
      )
    `);

    // ==========================================
    // === PAIEMENTS & TRANSACTIONS ===
    // ==========================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id SERIAL PRIMARY KEY,
        receipt_id BIGINT,
        user_id INT,
        amount DECIMAL(15,2) NOT NULL,
        method VARCHAR(50) DEFAULT 'cash',
        status VARCHAR(20) CHECK (status IN ('pending', 'completed', 'failed', 'refunded')) DEFAULT 'completed',
        transaction_ref VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (receipt_id) REFERENCES receipts(receipt_id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
      )
    `);

    // ==========================================
    // === JOURNAUX & AUDIT ===
    // ==========================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS transaction_logs (
        log_id SERIAL PRIMARY KEY,
        user_id INT,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id VARCHAR(100),
        old_value TEXT,
        new_value TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
      )
    `);

    // ==========================================
    // === STATISTIQUES & RAPPORTS ===
    // ==========================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS game_statistics (
        stat_id SERIAL PRIMARY KEY,
        round_id INT,
        total_receipts INT DEFAULT 0,
        total_bets INT DEFAULT 0,
        total_stakes DECIMAL(15,2) DEFAULT 0,
        total_prize_pool DECIMAL(15,2) DEFAULT 0,
        total_paid DECIMAL(15,2) DEFAULT 0,
        house_balance DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE CASCADE
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        report_id SERIAL PRIMARY KEY,
        created_by INT,
        report_name VARCHAR(150) NOT NULL,
        report_type VARCHAR(50) CHECK (report_type IN ('daily', 'weekly', 'monthly', 'yearly', 'custom')) DEFAULT 'custom',
        period_start DATE,
        period_end DATE,
        file_path TEXT,
        status VARCHAR(20) CHECK (status IN ('pending', 'generated', 'failed')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
      )
    `);

    // ==========================================
    // === NOTIFICATIONS ===
    // ==========================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id SERIAL PRIMARY KEY,
        user_id INT,
        receipt_id BIGINT,
        title VARCHAR(255),
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'info',
        status VARCHAR(20) CHECK (status IN ('unread', 'read')) DEFAULT 'unread',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (receipt_id) REFERENCES receipts(receipt_id) ON DELETE CASCADE
      )
    `);

    // ==========================================
    // === CONFIGURATION ===
    // ==========================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_id SERIAL PRIMARY KEY,
        app_name VARCHAR(150) DEFAULT 'Horse Racing',
        company_name VARCHAR(150) DEFAULT 'Racing Organization',
        contact_email VARCHAR(255),
        phone VARCHAR(20),
        address TEXT,
        timezone VARCHAR(50) DEFAULT 'Europe/Paris',
        currency VARCHAR(10) DEFAULT 'HTG',
        round_duration_ms INT DEFAULT 60000,
        race_duration_ms INT DEFAULT 25000,
        updated_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
      )
    `);

    // ✅ NOUVEAU: Table pour stocker l'historique des gagnants
    // Permet la persistance et l'affichage après redémarrage du serveur
    await client.query(`
      CREATE TABLE IF NOT EXISTS winners (
        winner_id SERIAL PRIMARY KEY,
        round_id BIGINT NOT NULL,
        participant_id INT NOT NULL,
        participant_number INT,
        participant_name VARCHAR(255),
        family INT,
        total_prize DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE CASCADE,
        FOREIGN KEY (participant_id) REFERENCES participants(participant_id) ON DELETE CASCADE,
        UNIQUE(round_id)
      )
    `);

    // ==========================================
    // === GESTION DES CAISSES (CASHIER) ===
    // ==========================================

    // Table pour les comptes de caissiers
    await client.query(`
      CREATE TABLE IF NOT EXISTS cashier_accounts (
        account_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        current_balance DECIMAL(15,2) DEFAULT 0,
        opening_balance DECIMAL(15,2) DEFAULT 0,
        opening_time TIMESTAMP,
        closing_time TIMESTAMP,
        status VARCHAR(20) CHECK (status IN ('open', 'closed', 'suspended')) DEFAULT 'open',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);

    // Table pour les transactions de caisse
    await client.query(`
      CREATE TABLE IF NOT EXISTS account_transactions (
        transaction_id SERIAL PRIMARY KEY,
        account_id INT NOT NULL,
        user_id INT NOT NULL,
        transaction_type VARCHAR(50) CHECK (transaction_type IN ('deposit', 'withdrawal', 'payout', 'pay-receipt', 'cash-in', 'cash-out', 'opening', 'closing')) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        previous_balance DECIMAL(15,2) NOT NULL,
        new_balance DECIMAL(15,2) NOT NULL,
        reference VARCHAR(100),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES cashier_accounts(account_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
      )
    `);

    // ==========================================
    // === CRÉER LES INDICES ===
    // ==========================================

    // ==========================================
    // === INDEXES POUR PERFORMANCE ===
    // ==========================================
    // Indexes sur receipts pour recherches rapides
    await client.query("CREATE INDEX IF NOT EXISTS idx_receipts_round_id ON receipts(round_id)");
    
    // ✅ MIGRATION: Mettre à jour le schéma pour rendre round_id NOT NULL
    // 1. Corriger les receipts existants avec round_id = null (les associer au round actuel ou les supprimer)
    try {
      const nullRoundReceipts = await client.query(
        "SELECT receipt_id FROM receipts WHERE round_id IS NULL LIMIT 100"
      );
      if (nullRoundReceipts.rows.length > 0) {
        console.warn(`⚠️ [MIGRATION] ${nullRoundReceipts.rows.length} receipts avec round_id=NULL trouvés. Tentative de correction...`);
        // Essayer de trouver le round le plus récent pour ces receipts
        const latestRound = await client.query(
          "SELECT round_id FROM rounds ORDER BY created_at DESC LIMIT 1"
        );
        if (latestRound.rows.length > 0) {
          const defaultRoundId = latestRound.rows[0].round_id;
          await client.query(
            `UPDATE receipts SET round_id = $1 WHERE round_id IS NULL`,
            [defaultRoundId]
          );
          console.log(`✅ [MIGRATION] ${nullRoundReceipts.rows.length} receipts corrigés avec round_id=${defaultRoundId}`);
        } else {
          console.warn(`⚠️ [MIGRATION] Aucun round trouvé, suppression des receipts orphelins...`);
          await client.query("DELETE FROM receipts WHERE round_id IS NULL");
        }
      }
    } catch (migErr) {
      console.warn(`⚠️ [MIGRATION] Erreur correction receipts orphelins:`, migErr.message);
    }
    
    // 2. Appliquer la contrainte NOT NULL sur round_id
    try {
      await client.query(`
        ALTER TABLE receipts 
        ALTER COLUMN round_id SET NOT NULL
      `);
      console.log("✅ [MIGRATION] Contrainte NOT NULL appliquée sur receipts.round_id");
    } catch (alterErr) {
      // Si la contrainte existe déjà ou si la colonne est déjà NOT NULL, ignorer
      if (alterErr.code !== '42710' && !alterErr.message.includes('already')) {
        console.warn(`⚠️ [MIGRATION] Erreur application NOT NULL sur round_id:`, alterErr.message);
      }
    }
    
    // 3. Changer ON DELETE SET NULL en ON DELETE RESTRICT pour round_id
    try {
      // Supprimer l'ancienne FK
      await client.query(`
        ALTER TABLE receipts 
        DROP CONSTRAINT IF EXISTS receipts_round_id_fkey
      `);
      // Recréer avec RESTRICT
      await client.query(`
        ALTER TABLE receipts 
        ADD CONSTRAINT receipts_round_id_fkey 
        FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE RESTRICT
      `);
      console.log("✅ [MIGRATION] FK receipts.round_id mise à jour avec ON DELETE RESTRICT");
    } catch (fkErr) {
      if (fkErr.code !== '42710' && !fkErr.message.includes('already')) {
        console.warn(`⚠️ [MIGRATION] Erreur mise à jour FK round_id:`, fkErr.message);
      }
    }
    await client.query("CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at DESC)");
    
    // Indexes sur bets pour recherches rapides
    await client.query("CREATE INDEX IF NOT EXISTS idx_bets_receipt_id ON bets(receipt_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_bets_participant_id ON bets(participant_id)");
    
    // Indexes sur rounds
    await client.query("CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds(created_at DESC)");
    
    // Indexes sur participants
    await client.query("CREATE INDEX IF NOT EXISTS idx_participants_number ON participants(number)");
    
    // Indexes sur users
    await client.query("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)");
    
    // ✅ NOUVEAU: Indexes sur winners pour recherches rapides
    await client.query("CREATE INDEX IF NOT EXISTS idx_winners_round_id ON winners(round_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_winners_participant_id ON winners(participant_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_winners_created_at ON winners(created_at DESC)");

    // ✅ NOUVEAU: Indexes sur cashier_accounts et account_transactions
    await client.query("CREATE INDEX IF NOT EXISTS idx_cashier_accounts_user_id ON cashier_accounts(user_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_cashier_accounts_status ON cashier_accounts(status)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_account_transactions_account_id ON account_transactions(account_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_account_transactions_user_id ON account_transactions(user_id)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_account_transactions_type ON account_transactions(transaction_type)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_account_transactions_created_at ON account_transactions(created_at DESC)");

    // ==========================================
    // === INSERTION DES DONNÉES PAR DÉFAUT ===
    // ==========================================

    // Vérifier et créer l'utilisateur admin par défaut
    const adminCheck = await client.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
    );
    console.log("🔍 Admin check result:", adminCheck.rows[0]);
    const adminCount = parseInt(adminCheck.rows[0].count, 10);
    if (adminCount === 0) {
      await client.query(`
        INSERT INTO users (username, email, password, role, email_verified)
        VALUES ('admin', 'admin@horseracing.local', 'admin123', 'admin', true)
      `);
      console.log("👤 Utilisateur admin créé (username: admin, password: admin123)");
    } else {
      console.log("✅ Admin user already exists");
    }

    // Vérifier et créer l'utilisateur caissier par défaut
    const cashierCheck = await client.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'cashier'"
    );
    console.log("🔍 Cashier check result:", cashierCheck.rows[0]);
    const cashierCount = parseInt(cashierCheck.rows[0].count, 10);
    if (cashierCount === 0) {
      await client.query(`
        INSERT INTO users (username, email, password, role, email_verified, is_active)
        VALUES ('caissier', 'cashier@horseracing.local', 'caissier123', 'cashier', true, true),
               ('caissier2', 'cashier2@horseracing.local', 'caissier123', 'cashier', true, true)
      `);
      console.log("👤 Utilisateur caissier créé (username: caissier, password: caissier123)");
    } else {
      console.log("✅ Cashier user already exists");
    }

    // ✅ NOUVEAU: Créer les comptes de caisse pour chaque caissier
    const cashierUsers = await client.query(
      "SELECT user_id, username FROM users WHERE role = 'cashier'"
    );
    
    for (const cashier of cashierUsers.rows) {
      const accountExists = await client.query(
        "SELECT account_id FROM cashier_accounts WHERE user_id = $1",
        [cashier.user_id]
      );
      
      if (accountExists.rows.length === 0) {
        await client.query(`
          INSERT INTO cashier_accounts (user_id, current_balance, opening_balance, status)
          VALUES ($1, 0, 0, 'closed')
        `, [cashier.user_id]);
        console.log(`💰 Compte de caisse créé pour ${cashier.username}`);
      }
    }

    // Insérer les participants (chevaux/sportifs)
    const participantsCheck = await client.query("SELECT COUNT(*) as count FROM participants");
    const participantCount = parseInt(participantsCheck.rows[0].count || 0, 10);
    console.log(`📊 Nombre de participants existants: ${participantCount}`);
    
    if (participantCount === 0) {
      const participants = [
        { number: 6, name: 'De Bruyne', coeff: 5.5, family: 0 },
        { number: 7, name: 'Ronaldo', coeff: 4.7, family: 1 },
        { number: 8, name: 'Mbappe', coeff: 7.2, family: 2 },
        { number: 9, name: 'Halland', coeff: 5.8, family: 3 },
        { number: 10, name: 'Messi', coeff: 8.1, family: 4 },
        { number: 54, name: 'Vinicius', coeff: 4.5, family: 5 }
      ];
      
      for (const p of participants) {
        await client.query(
          "INSERT INTO participants (number, name, coeff, family) VALUES ($1, $2, $3, $4)",
          [p.number, p.name, p.coeff, p.family]
        );
        console.log(`  ✓ Participant #${p.number} ${p.name} inséré`);
      }
      console.log("🏇 Tous les participants insérés avec succès");
    } else {
      console.log(`✅ Participants déjà en base (${participantCount}), pas de re-seeding`);
    }

    // Insérer les paramètres par défaut
    const settingsCheck = await client.query("SELECT COUNT(*) as count FROM app_settings");
    if (settingsCheck.rows[0].count === 0) {
      await client.query(`
        INSERT INTO app_settings (app_name, company_name, contact_email, phone, address, timezone, currency)
        VALUES (
          'Horse Racing Betting',
          'Racing Management Inc.',
          'contact@horseracing.local',
          '+33 1 23 45 67 89',
          'Port-au-Prince, Haiti',
          'America/Port-au-Prince',
          'HTG'
        )
      `);
      console.log("⚙️ Paramètres par défaut créés");
    }

    await client.query("COMMIT");
    console.log("✅ Toutes les tables créées avec succès");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.warn("⚠️ [DB-CREATE] Erreur lors du rollback:", rollbackErr.message);
    }
    console.error("❌ [DB-CREATE] Erreur lors de la création des tables:", err.message);
    throw err;
  } finally {
    if (client) {
      try {
        client.release();
      } catch (releaseErr) {
        console.warn("⚠️ [DB-CREATE] Erreur lors de la libération du client:", releaseErr.message);
      }
    }
  }
};

// ✅ NOUVEAU: Fonction de réparation pour créer les tables manuellement
export const repairDatabase = async () => {
  console.log("🔧 [DB-REPAIR] Démarrage de la réparation de la base de données...");
  try {
    await createTables();
    console.log("✅ [DB-REPAIR] Tables créées avec succès");
    return true;
  } catch (err) {
    console.error("❌ [DB-REPAIR] Erreur lors de la réparation:", err.message);
    return false;
  }
};

// ✅ CORRECTION: Fermer la connexion à la sortie du processus avec gestion d'erreur
process.on("exit", async () => {
  try {
    await pool.end();
    console.log("🔌 Pool PostgreSQL fermé");
  } catch (err) {
    console.error("❌ [DB-SHUTDOWN] Erreur lors de la fermeture du pool:", err.message);
    // Ne pas faire crash le processus lors de la fermeture
  }
});

// ✅ NOUVEAU: Gestion gracieuse des signaux de terminaison
process.on("SIGINT", async () => {
  console.log("\n⚠️ [DB-SHUTDOWN] Signal SIGINT reçu, fermeture gracieuse du pool...");
  try {
    await pool.end();
    console.log("✅ [DB-SHUTDOWN] Pool PostgreSQL fermé gracieusement");
  } catch (err) {
    console.error("❌ [DB-SHUTDOWN] Erreur lors de la fermeture:", err.message);
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n⚠️ [DB-SHUTDOWN] Signal SIGTERM reçu, fermeture gracieuse du pool...");
  try {
    await pool.end();
    console.log("✅ [DB-SHUTDOWN] Pool PostgreSQL fermé gracieusement");
  } catch (err) {
    console.error("❌ [DB-SHUTDOWN] Erreur lors de la fermeture:", err.message);
  }
  process.exit(0);
});
