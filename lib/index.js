'use strict';

/**
 * Singleton database instantie voor de hele applicatie.
 * Importeer altijd via deze module, niet rechtstreeks via database.js.
 */

const mysql    = require('mysql2/promise');
const { Database }     = require('./database');
const { LLinkidClient } = require('./llinkid');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    10,
  charset:            'utf8mb4',
});

const db      = new Database(pool);
const llinkid = new LLinkidClient();

process.on('SIGINT',  () => { pool.end(); process.exit(0); });
process.on('SIGTERM', () => { pool.end(); process.exit(0); });

module.exports = { db, llinkid };
