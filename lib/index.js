'use strict';

/**
 * Singleton database instantie voor de hele applicatie.
 * Importeer altijd via deze module, niet rechtstreeks via database.js.
 *
 * Gebruik:
 *   const { db } = require('./lib');
 */

const { Database } = require('./database');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, '..', 'tinneke.db');

// Zorg dat de map bestaat voordat SQLite het bestand aanmaakt
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Sluit de verbinding netjes bij afsluiten van het proces
process.on('exit',    () => db.close());
process.on('SIGINT',  () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

module.exports = { db };
