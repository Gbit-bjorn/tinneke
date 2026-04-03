'use strict';

/**
 * seed-bk-from-api.js
 *
 * Haalt officiële BK-detaildata op via de Onderwijs Vlaanderen API
 * en slaat competentiecomponenten op in de database.
 *
 * Vereist:
 *   - BK_API_KEY in .env (of als omgevingsvariabele)
 *   - Tabellen aangemaakt door seed-bk-data.js (of de app)
 *
 * Idempotent: veilig om meerdere keren uit te voeren.
 * Gebruik: node scripts/seed-bk-from-api.js
 */

require('dotenv').config();

const path  = require('node:path');
const mysql = require('mysql2/promise');
const { BkApiClient } = require('../lib/bk-api');

// ── Controleer API-sleutel vroeg ───────────────────────────────────────────

if (!process.env.BK_API_KEY) {
  console.error('Fout: BK_API_KEY is niet ingesteld in .env');
  process.exit(1);
}

// ── Verbindingsinstellingen ────────────────────────────────────────────────

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

const apiClient = new BkApiClient();

// ── Schema helpers ─────────────────────────────────────────────────────────

/**
 * Maak de tabel competentiecomponenten aan als die nog niet bestaat.
 * Elk component is gekoppeld aan een BK via de BK-code.
 */
async function initTabel(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS competentiecomponenten (
      id          INT           PRIMARY KEY AUTO_INCREMENT,
      bk_code     VARCHAR(50)   NOT NULL,
      component   TEXT          NOT NULL,
      volgorde    SMALLINT      NOT NULL DEFAULT 0,
      UNIQUE KEY uq_comp (bk_code(50), volgorde),
      INDEX idx_bk_code (bk_code)
    ) CHARACTER SET utf8mb4
  `);
}

// ── Extractie van competentiecomponenten uit API-respons ───────────────────

/**
 * Haal een platte lijst van competentiecomponenten uit een BK-detailobject.
 *
 * De API-structuur kan variëren; we proberen de meest voorkomende paden:
 *   data.competenties[].componenten[].omschrijving
 *   data.competenties[].omschrijving
 *   data.componenten[].omschrijving
 *
 * @param {object} detail   API-detailrespons voor één BK
 * @returns {string[]}
 */
function extractComponenten(detail) {
  const componenten = [];

  // Pad 1: competenties → componenten
  if (Array.isArray(detail.competenties)) {
    for (const competentie of detail.competenties) {
      if (Array.isArray(competentie.componenten)) {
        for (const comp of competentie.componenten) {
          const tekst = comp.omschrijving || comp.titel || comp.naam || '';
          if (tekst) componenten.push(tekst.trim());
        }
      } else {
        // Competentie zonder sub-componenten: gebruik omschrijving van competentie zelf
        const tekst = competentie.omschrijving || competentie.titel || competentie.naam || '';
        if (tekst) componenten.push(tekst.trim());
      }
    }
  }

  // Pad 2: top-level componenten (fallback)
  if (componenten.length === 0 && Array.isArray(detail.componenten)) {
    for (const comp of detail.componenten) {
      const tekst = comp.omschrijving || comp.titel || comp.naam || '';
      if (tekst) componenten.push(tekst.trim());
    }
  }

  return componenten;
}

// ── Upsert competentiecomponenten ──────────────────────────────────────────

/**
 * Sla competentiecomponenten op voor één BK.
 * Bestaande componenten worden overschreven (ON DUPLICATE KEY UPDATE).
 *
 * @param {import('mysql2/promise').Connection} conn
 * @param {string}   bkCode
 * @param {string[]} componenten
 * @returns {Promise<number>}  Aantal verwerkte componenten
 */
async function upsertComponenten(conn, bkCode, componenten) {
  for (let i = 0; i < componenten.length; i++) {
    await conn.execute(`
      INSERT INTO competentiecomponenten (bk_code, component, volgorde)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE component = VALUES(component)
    `, [bkCode, componenten[i], i + 1]);
  }
  return componenten.length;
}

// ── Ophalen unieke BK-codes uit de mapping ─────────────────────────────────

/**
 * Geeft een gesorteerde lijst van unieke BK-codes terug vanuit de mapping.
 *
 * @param {object} mapping   Inhoud van richting_bk_mapping.json
 * @returns {string[]}
 */
function haalUniekeBkCodes(mapping) {
  const codes = new Set();
  for (const [richting, data] of Object.entries(mapping)) {
    if (richting.startsWith('_')) continue;
    for (const bk of data.bks || []) {
      if (bk.code) codes.add(bk.code);
    }
  }
  return [...codes].sort();
}

// ── Hoofdlogica ────────────────────────────────────────────────────────────

async function main() {
  const mapping  = require(path.join(__dirname, '..', 'richting_bk_mapping.json'));
  const bkCodes  = haalUniekeBkCodes(mapping);

  console.log(`Gevonden BK-codes in mapping: ${bkCodes.length}`);
  console.log(bkCodes.join(', '));
  console.log();

  const conn = await pool.getConnection();
  try {
    console.log('Tabel controleren/aanmaken...');
    await initTabel(conn);

    // Tellers voor de samenvatting
    let aantalVerwerkt    = 0;
    let aantalComponenten = 0;
    let aantalFouten      = 0;

    for (const code of bkCodes) {
      process.stdout.write(`  Ophalen ${code}... `);

      try {
        // Haal volledige detaildata op via de API
        const detail = await apiClient.getBk(code);

        // Extraheer competentiecomponenten uit de API-respons
        const componenten = extractComponenten(detail);
        process.stdout.write(`${componenten.length} componenten gevonden. `);

        if (componenten.length > 0) {
          await conn.beginTransaction();
          try {
            await upsertComponenten(conn, code, componenten);
            await conn.commit();
            aantalComponenten += componenten.length;
            process.stdout.write('Opgeslagen.\n');
          } catch (dbErr) {
            await conn.rollback();
            throw dbErr;
          }
        } else {
          process.stdout.write('Overgeslagen (geen componenten).\n');
        }

        aantalVerwerkt++;
      } catch (err) {
        process.stdout.write(`FOUT: ${err.message}\n`);
        aantalFouten++;
      }
    }

    // ── Samenvatting ────────────────────────────────────────────────────────
    console.log('\n── Samenvatting ──────────────────────────────');
    console.log(`  BK-codes verwerkt:              ${aantalVerwerkt} / ${bkCodes.length}`);
    console.log(`  Competentiecomponenten opgeslagen: ${aantalComponenten}`);
    if (aantalFouten > 0) {
      console.log(`  Fouten:                         ${aantalFouten}`);
    }
    console.log('──────────────────────────────────────────────');
    console.log('Klaar.');

    if (aantalFouten > 0) process.exitCode = 1;
  } catch (err) {
    console.error('Onverwachte fout:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
