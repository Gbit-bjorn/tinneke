'use strict';

/**
 * seed-bk-data.js
 *
 * Laadt BK/DBK-data vanuit richting_bk_mapping.json in de database.
 * Maakt of updatet:
 *   - beroepskwalificaties  (code, naam, niveau)
 *   - deelberoepskwalificaties  (code, naam, gekoppeld aan BK)
 *   - richting_bk  (koppeling richting → BK)
 *
 * Idempotent: veilig om meerdere keren uit te voeren.
 * Gebruik: node scripts/seed-bk-data.js
 */

require('dotenv').config();

const path  = require('node:path');
const mysql = require('mysql2/promise');

// ── Verbindingsinstellingen (zelfde patroon als lib/index.js) ──────────────

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    5,
  charset:            'utf8mb4',
});

// ── Schema helpers ─────────────────────────────────────────────────────────

/**
 * Zorg dat de benodigde tabellen bestaan.
 * Gooit geen fout als ze al aanwezig zijn.
 */
async function initTables(conn) {
  // Beroepskwalificaties (BK)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS beroepskwalificaties (
      id           INT          PRIMARY KEY AUTO_INCREMENT,
      code         VARCHAR(20)  NOT NULL UNIQUE,
      naam         VARCHAR(500) NOT NULL,
      niveau       INT          NOT NULL DEFAULT 0,
      versie_code  VARCHAR(20)  DEFAULT NULL,
      bron         VARCHAR(50)  NOT NULL DEFAULT 'onderwijs_vlaanderen',
      datum_import DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4
  `);

  // Deelberoepskwalificaties (DBK) — gekoppeld aan een BK
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS deelberoepskwalificaties (
      id    INT          PRIMARY KEY AUTO_INCREMENT,
      code  VARCHAR(50)  NOT NULL UNIQUE,
      naam  VARCHAR(500) NOT NULL,
      bk_id INT          NOT NULL,
      FOREIGN KEY (bk_id) REFERENCES beroepskwalificaties(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4
  `);

  // Koppeling richting → BK (één richting kan meerdere BK's hebben)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS richting_bk (
      id        INT          PRIMARY KEY AUTO_INCREMENT,
      richting  VARCHAR(255) NOT NULL,
      bk_id     INT          NOT NULL,
      verplicht TINYINT      NOT NULL DEFAULT 1,
      FOREIGN KEY (bk_id) REFERENCES beroepskwalificaties(id) ON DELETE CASCADE,
      UNIQUE KEY uq_richting_bk (richting, bk_id)
    ) CHARACTER SET utf8mb4
  `);
}

// ── Hulpfuncties voor upsert ───────────────────────────────────────────────

/**
 * Voeg een BK in of update de naam en het niveau.
 * Geeft het bestaande of nieuwe id terug.
 *
 * @param {import('mysql2/promise').Connection} conn
 * @param {string} code
 * @param {string} naam
 * @param {number} niveau
 * @returns {Promise<number>}
 */
async function upsertBk(conn, code, naam, niveau) {
  await conn.execute(`
    INSERT INTO beroepskwalificaties (code, naam, niveau)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE naam = VALUES(naam), niveau = VALUES(niveau)
  `, [code, naam, niveau]);

  const [[rij]] = await conn.execute(
    'SELECT id FROM beroepskwalificaties WHERE code = ?', [code]
  );
  return rij.id;
}

/**
 * Voeg een DBK in of update de naam (bk_id blijft vast bij eerste insert).
 *
 * @param {import('mysql2/promise').Connection} conn
 * @param {string} code
 * @param {string} naam
 * @param {number} bkId
 */
async function upsertDbk(conn, code, naam, bkId) {
  await conn.execute(`
    INSERT INTO deelberoepskwalificaties (code, naam, bk_id)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE naam = VALUES(naam)
  `, [code, naam, bkId]);
}

/**
 * Voeg een richting–BK koppeling in.
 * INSERT IGNORE: slaat stille duplicaten over.
 *
 * @param {import('mysql2/promise').Connection} conn
 * @param {string} richting
 * @param {number} bkId
 */
async function insertRichtingBk(conn, richting, bkId) {
  await conn.execute(`
    INSERT IGNORE INTO richting_bk (richting, bk_id)
    VALUES (?, ?)
  `, [richting, bkId]);
}

// ── Hoofdlogica ────────────────────────────────────────────────────────────

async function main() {
  const mapping = require(path.join(__dirname, '..', 'richting_bk_mapping.json'));

  const conn = await pool.getConnection();
  try {
    console.log('Tabellen aanmaken/controleren...');
    await initTables(conn);

    // Tellers voor de samenvatting
    let aantalBks       = 0;
    let aantalDbks      = 0;
    let aantalKoppelingen = 0;

    // Bijhouden welke BK-codes al verwerkt zijn om dubbele tellers te vermijden
    const verwerkteBks = new Set();

    await conn.beginTransaction();

    for (const [richting, data] of Object.entries(mapping)) {
      // Sla metadata-sleutels die beginnen met '_' over
      if (richting.startsWith('_')) continue;

      for (const bk of data.bks) {
        const isNieuweBk = !verwerkteBks.has(bk.code);

        // Voeg BK in of update
        const bkId = await upsertBk(conn, bk.code, bk.naam, bk.niveau);
        if (isNieuweBk) {
          aantalBks++;
          verwerkteBks.add(bk.code);
        }

        // Voeg DBK's in of update
        for (const dbk of bk.dbks || []) {
          await upsertDbk(conn, dbk.code, dbk.naam, bkId);
          if (isNieuweBk) aantalDbks++; // tel DBK's alleen bij eerste BK-verwerking
        }

        // Koppel richting aan BK
        await insertRichtingBk(conn, richting, bkId);
        aantalKoppelingen++;
      }
    }

    await conn.commit();

    // ── Samenvatting ────────────────────────────────────────────────────────
    console.log('\n── Samenvatting ──────────────────────────────');
    console.log(`  Beroepskwalificaties (BK):        ${aantalBks}`);
    console.log(`  Deelberoepskwalificaties (DBK):   ${aantalDbks}`);
    console.log(`  Richting–BK koppelingen:          ${aantalKoppelingen}`);
    console.log('──────────────────────────────────────────────');
    console.log('Klaar.');
  } catch (err) {
    await conn.rollback();
    console.error('Fout tijdens seeden:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
