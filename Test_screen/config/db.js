const { Pool } = require('pg');
const env = require('../env');

const dbUrl = `postgresql://${env.DB_USER}:${env.DB_PASSWORD}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}?sslmode=verify-full&sslrootcert=${env.DB_ROOT_CERT}&sslcert=${env.DB_CERT}&sslkey=${env.DB_KEY}`;

const db = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = db;

