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
};

export const pool = new Pool(poolConfig);

export const testConnection = async () => {
  try {
    await pool.query("SELECT NOW()");
    console.log("✅ Connexion PostgreSQL établie");
    return true;
  } catch (err) {
    console.error("❌ Erreur de connexion PostgreSQL:", err.message);
    return false;
  }
};

export const initializeDatabase = async () => {
  if (!(await testConnection())) return;

  try {
    // Drop and recreate tables to ensure schema is correct (dev/test only)
    // In production, use proper migrations instead
    await dropTablesIfExist();
    
    await createTables();
    console.log("✅ Initialisation de la base de données réussie");
    
    // Verify participants were seeded
    const verifyRes = await pool.query("SELECT COUNT(*) as cnt FROM participants");
    const participantCount = parseInt(verifyRes.rows[0]?.cnt || 0, 10);
    console.log(`🔍 Vérification: ${participantCount} participants en base`);
    
    if (participantCount > 0) {
      const listRes = await pool.query("SELECT participant_id, number, name FROM participants ORDER BY number");
      console.log("📋 Participants disponibles:");
      listRes.rows.forEach(p => {
        console.log(`   #${p.number}: ${p.name} (ID: ${p.participant_id})`);
      });
    }
  } catch (err) {
    console.error("❌ Erreur lors de l'initialisation:", err);
    throw err;
  }
};

const dropTablesIfExist = async () => {
  const client = await pool.connect();
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
    await client.query("DROP TABLE IF EXISTS participants CASCADE");
    await client.query("DROP TABLE IF EXISTS user_profiles CASCADE");
    await client.query("DROP TABLE IF EXISTS users CASCADE");
    await client.query("DROP TABLE IF EXISTS app_settings CASCADE");

    await client.query("COMMIT");
    console.log("🗑️ Anciennes tables supprimées");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erreur lors de la suppression des tables:", err);
    throw err;  // Re-throw to propagate the error
  } finally {
    client.release();
  }
};

const createTables = async () => {
  const client = await pool.connect();

  try {
    console.log("📋 Création des tables...");
    await client.query("BEGIN");

    // ==========================================
    // === UTILISATEURS & CAISSIERS ===
    // ==========================================

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS rounds (
        round_id BIGINT PRIMARY KEY,
        round_number INT UNIQUE NOT NULL,
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
        round_id BIGINT,
        user_id INT,
        status VARCHAR(20) CHECK (status IN ('pending', 'won', 'lost', 'paid', 'cancelled')) DEFAULT 'pending',
        total_amount DECIMAL(15,2) NOT NULL,
        prize DECIMAL(15,2) DEFAULT 0,
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE SET NULL,
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

    // ==========================================
    // === CRÉER LES INDICES ===
    // ==========================================

    // Indices pour les performances
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_receipts_round_id ON receipts(round_id);
      CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
      CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
      CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_bets_receipt_id ON bets(receipt_id);
      CREATE INDEX IF NOT EXISTS idx_bets_participant_id ON bets(participant_id);
      
      CREATE INDEX IF NOT EXISTS idx_payments_receipt_id ON payments(receipt_id);
      CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
      
      CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);
      CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds(created_at);
      
      CREATE INDEX IF NOT EXISTS idx_transaction_logs_user_id ON transaction_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_transaction_logs_entity ON transaction_logs(entity_type, entity_id);
      
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    `);
    // ==========================================
    // === INDEXES POUR PERFORMANCE ===
    // ==========================================
    // Indexes sur receipts pour recherches rapides
    await client.query("CREATE INDEX IF NOT EXISTS idx_receipts_round_id ON receipts(round_id)");
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
        VALUES ('caissier', 'cashier@horseracing.local', 'caissier123', 'cashier', true, true)
      `);
      console.log("👤 Utilisateur caissier créé (username: caissier, password: caissier123)");
    } else {
      console.log("✅ Cashier user already exists");
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
    await client.query("ROLLBACK");
    console.error("❌ Erreur lors de la création des tables:", err);
    throw err;
  } finally {
    client.release();
  }
};

// Fermer la connexion à la sortie du processus
process.on("exit", async () => {
  try {
    await pool.end();
    console.log("🔌 Pool PostgreSQL fermé");
  } catch (err) {
    console.error("Erreur lors de la fermeture du pool:", err);
  }
});
