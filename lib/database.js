'use strict';

/**
 * Database module voor BK/DPK/LPD attestatie tracking
 * Gebruikt better-sqlite3 (synchrone API — geen async/await nodig)
 */

const { Database: BetterSqlite3 } = require('node-sqlite3-wasm');

class Database {
  /**
   * @param {string} dbPath - Pad naar het SQLite bestand
   */
  constructor(dbPath) {
    this.db = new BetterSqlite3(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this._initTables();
  }

  // ── Schema initialisatie ────────────────────────────────────────────────

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS klassen (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        naam        TEXT    NOT NULL,
        richting    TEXT    NOT NULL DEFAULT '',
        schooljaar  INTEGER NOT NULL,
        UNIQUE(naam, schooljaar)
      );

      CREATE TABLE IF NOT EXISTS leerlingen (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        naam      TEXT    NOT NULL,
        voornaam  TEXT    NOT NULL,
        klas_id   INTEGER NOT NULL,
        FOREIGN KEY (klas_id) REFERENCES klassen(id)
      );

      CREATE TABLE IF NOT EXISTS lpd_resultaten (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        leerling_id      INTEGER NOT NULL,
        lpd_uuid         TEXT    NOT NULL,
        behaald          INTEGER NOT NULL DEFAULT 0,
        datum_gewijzigd  TEXT    NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (leerling_id) REFERENCES leerlingen(id),
        UNIQUE(leerling_id, lpd_uuid)
      );

      CREATE TABLE IF NOT EXISTS klas_leerplan_mapping (
        klas_id       INTEGER PRIMARY KEY,
        leerplan_uuid TEXT    NOT NULL,
        FOREIGN KEY (klas_id) REFERENCES klassen(id)
      );

      CREATE INDEX IF NOT EXISTS idx_leerlingen_klas
        ON leerlingen(klas_id);
      CREATE INDEX IF NOT EXISTS idx_resultaten_leerling
        ON lpd_resultaten(leerling_id);
      CREATE INDEX IF NOT EXISTS idx_resultaten_lpd_uuid
        ON lpd_resultaten(lpd_uuid);
    `);
  }

  // ── Klassen ─────────────────────────────────────────────────────────────

  /**
   * Alle klassen met het aantal leerlingen per klas.
   * @returns {Array<Object>}
   */
  getKlassen() {
    return this.db.prepare(`
      SELECT k.*, COUNT(l.id) AS aantal_leerlingen
      FROM klassen k
      LEFT JOIN leerlingen l ON l.klas_id = k.id
      GROUP BY k.id
      ORDER BY k.schooljaar DESC, k.naam
    `).all();
  }

  /**
   * Één klas op id.
   * @param {number} klasId
   * @returns {Object|undefined}
   */
  getKlas(klasId) {
    return this.db.prepare(
      'SELECT * FROM klassen WHERE id = ?'
    ).get(klasId);
  }

  /**
   * Maak een nieuwe klas aan. Geeft het nieuwe id terug.
   * @param {string} naam
   * @param {string} richting
   * @param {number} schooljaar
   * @returns {number} id van de aangemaakte klas
   */
  createKlas(naam, richting, schooljaar) {
    const result = this.db.prepare(`
      INSERT INTO klassen (naam, richting, schooljaar)
      VALUES (?, ?, ?)
    `).run(naam, richting ?? '', schooljaar);
    return result.lastInsertRowid;
  }

  /**
   * Koppel een leerplan UUID aan een klas (UPSERT).
   * @param {number} klasId
   * @param {string} leerplanUuid
   */
  setKlasLeerplan(klasId, leerplanUuid) {
    this.db.prepare(`
      INSERT INTO klas_leerplan_mapping (klas_id, leerplan_uuid)
      VALUES (?, ?)
      ON CONFLICT(klas_id) DO UPDATE SET leerplan_uuid = excluded.leerplan_uuid
    `).run(klasId, leerplanUuid);
  }

  /**
   * Geef het leerplan UUID voor een klas, of null als er geen is.
   * @param {number} klasId
   * @returns {string|null}
   */
  getKlasLeerplan(klasId) {
    const row = this.db.prepare(
      'SELECT leerplan_uuid FROM klas_leerplan_mapping WHERE klas_id = ?'
    ).get(klasId);
    return row ? row.leerplan_uuid : null;
  }

  // ── Leerlingen ──────────────────────────────────────────────────────────

  /**
   * Alle leerlingen van een klas, gesorteerd op naam.
   * @param {number} klasId
   * @returns {Array<Object>}
   */
  getLeerlingen(klasId) {
    return this.db.prepare(`
      SELECT * FROM leerlingen
      WHERE klas_id = ?
      ORDER BY naam, voornaam
    `).all(klasId);
  }

  /**
   * Één leerling op id.
   * @param {number} leerlingId
   * @returns {Object|undefined}
   */
  getLeerling(leerlingId) {
    return this.db.prepare(
      'SELECT * FROM leerlingen WHERE id = ?'
    ).get(leerlingId);
  }

  /**
   * Maak een nieuwe leerling aan.
   * @param {string} naam
   * @param {string} voornaam
   * @param {number} klasId
   * @returns {number} id van de aangemaakte leerling
   */
  createLeerling(naam, voornaam, klasId) {
    const result = this.db.prepare(`
      INSERT INTO leerlingen (naam, voornaam, klas_id)
      VALUES (?, ?, ?)
    `).run(naam, voornaam, klasId);
    return result.lastInsertRowid;
  }

  /**
   * Verwijder alle leerlingen van een klas én hun LPD-resultaten (cascade).
   * @param {number} klasId
   */
  deleteLeerlingen(klasId) {
    // Verwijder eerst de LPD-resultaten (FK constraint)
    this.db.prepare(`
      DELETE FROM lpd_resultaten
      WHERE leerling_id IN (
        SELECT id FROM leerlingen WHERE klas_id = ?
      )
    `).run(klasId);

    this.db.prepare(
      'DELETE FROM leerlingen WHERE klas_id = ?'
    ).run(klasId);
  }

  /**
   * Voeg meerdere leerlingen in één transactie toe aan een klas.
   * @param {number} klasId
   * @param {Array<{naam: string, voornaam: string}>} leerlingen
   * @returns {number} aantal ingevoegde leerlingen
   */
  bulkInsertLeerlingen(klasId, leerlingen) {
    const insert = this.db.prepare(`
      INSERT INTO leerlingen (naam, voornaam, klas_id)
      VALUES (@naam, @voornaam, @klasId)
    `);

    const insertMany = this.db.transaction((rijen) => {
      for (const l of rijen) {
        insert.run({ naam: l.naam, voornaam: l.voornaam, klasId });
      }
    });

    insertMany(leerlingen);
    return leerlingen.length;
  }

  /**
   * Parseer CSV-inhoud (puntkomma-gescheiden) en voeg leerlingen toe.
   * Verwachte kolommen: naam;voornaam  (hoofdletters/kleine letters OK)
   * Eerste rij wordt als header beschouwd.
   * @param {string} csvContent
   * @param {number} klasId
   * @returns {number} aantal ingevoegde leerlingen
   */
  importLeerlingenCsv(csvContent, klasId) {
    const regels = csvContent
      .split(/\r?\n/)
      .map(r => r.trim())
      .filter(r => r.length > 0);

    if (regels.length < 2) return 0;

    // Header analyseren (case-insensitief)
    const header = regels[0].split(';').map(h => h.trim().toLowerCase());
    const naamIdx     = header.indexOf('naam');
    const voornaamIdx = header.indexOf('voornaam');

    if (naamIdx === -1 || voornaamIdx === -1) {
      throw new Error(
        `CSV header moet 'naam' en 'voornaam' bevatten (gevonden: ${regels[0]})`
      );
    }

    const leerlingen = regels.slice(1).map(regel => {
      const kolommen = regel.split(';');
      return {
        naam:     (kolommen[naamIdx]     ?? '').trim(),
        voornaam: (kolommen[voornaamIdx] ?? '').trim(),
      };
    }).filter(l => l.naam || l.voornaam);

    return this.bulkInsertLeerlingen(klasId, leerlingen);
  }

  // ── LPD resultaten ──────────────────────────────────────────────────────

  /**
   * Geef alle LPD-resultaten voor een leerling als plat object.
   * @param {number} leerlingId
   * @returns {Object} { [lpd_uuid]: boolean }
   */
  getLpdResultaten(leerlingId) {
    const rijen = this.db.prepare(`
      SELECT lpd_uuid, behaald
      FROM lpd_resultaten
      WHERE leerling_id = ?
    `).all(leerlingId);

    const resultaat = {};
    for (const rij of rijen) {
      resultaat[rij.lpd_uuid] = rij.behaald === 1;
    }
    return resultaat;
  }

  /**
   * Zet of update één LPD-resultaat (UPSERT).
   * @param {number} leerlingId
   * @param {string} lpdUuid
   * @param {boolean} behaald
   */
  toggleLpd(leerlingId, lpdUuid, behaald) {
    this.db.prepare(`
      INSERT INTO lpd_resultaten (leerling_id, lpd_uuid, behaald, datum_gewijzigd)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(leerling_id, lpd_uuid)
      DO UPDATE SET
        behaald         = excluded.behaald,
        datum_gewijzigd = excluded.datum_gewijzigd
    `).run(leerlingId, lpdUuid, behaald ? 1 : 0);
  }

  /**
   * Sla meerdere LPD-resultaten op in één transactie (UPSERT).
   * @param {number} leerlingId
   * @param {Object} resultaten - { [lpd_uuid]: boolean }
   */
  bulkSaveLpd(leerlingId, resultaten) {
    const upsert = this.db.prepare(`
      INSERT INTO lpd_resultaten (leerling_id, lpd_uuid, behaald, datum_gewijzigd)
      VALUES (@leerlingId, @lpdUuid, @behaald, datetime('now'))
      ON CONFLICT(leerling_id, lpd_uuid)
      DO UPDATE SET
        behaald         = excluded.behaald,
        datum_gewijzigd = excluded.datum_gewijzigd
    `);

    const saveAll = this.db.transaction((rijen) => {
      for (const [lpdUuid, behaald] of rijen) {
        upsert.run({ leerlingId, lpdUuid, behaald: behaald ? 1 : 0 });
      }
    });

    saveAll(Object.entries(resultaten));
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  /**
   * Bereken statistieken voor een leerling over een lijst van LPD UUIDs.
   * @param {number} leerlingId
   * @param {string[]} lpdUuids
   * @returns {{ totaal: number, behaald: number, percentage: number }}
   */
  berekenLpdStats(leerlingId, lpdUuids) {
    if (!lpdUuids || lpdUuids.length === 0) {
      return { totaal: 0, behaald: 0, percentage: 0 };
    }

    const placeholders = lpdUuids.map(() => '?').join(', ');
    const row = this.db.prepare(`
      SELECT
        COUNT(*)                                      AS totaal,
        SUM(CASE WHEN behaald = 1 THEN 1 ELSE 0 END) AS behaald
      FROM lpd_resultaten
      WHERE leerling_id = ?
        AND lpd_uuid IN (${placeholders})
    `).get(leerlingId, ...lpdUuids);

    const totaal  = lpdUuids.length;
    const behaald = row.behaald ?? 0;
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

    return { totaal, behaald, percentage };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Sluit de databaseverbinding.
   */
  close() {
    if (this.db && this.db.open) {
      this.db.close();
    }
  }
}

module.exports = { Database };
