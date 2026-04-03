'use strict';

/**
 * Database module voor BK/DPK/LPD attestatie tracking
 * Gebruikt mysql2/promise (async API)
 */

const path = require('path');
const fs   = require('fs');

class Database {
  /**
   * @param {import('mysql2/promise').Pool} pool
   */
  constructor(pool) {
    this.pool = pool;
  }

  // ── Schema initialisatie ────────────────────────────────────────────────

  async initTables() {
    const conn = await this.pool.getConnection();
    try {
      await conn.query(`ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS klassen (
          id           INT          PRIMARY KEY AUTO_INCREMENT,
          naam         VARCHAR(255) NOT NULL,
          richting     VARCHAR(255) NOT NULL DEFAULT '',
          schooljaar   INT          NOT NULL,
          laatste_sync DATETIME     DEFAULT NULL,
          UNIQUE KEY uq_klas (naam(100), schooljaar)
        ) CHARACTER SET utf8mb4
      `);

      // Voeg laatste_sync toe aan bestaande tabellen die de kolom nog niet hebben
      await conn.execute(`
        ALTER TABLE klassen ADD COLUMN IF NOT EXISTS laatste_sync DATETIME DEFAULT NULL
      `).catch(() => {}); // Negeer fout als kolom al bestaat of IF NOT EXISTS niet ondersteund wordt

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS leerlingen (
          id       INT          PRIMARY KEY AUTO_INCREMENT,
          naam     VARCHAR(255) NOT NULL,
          voornaam VARCHAR(255) NOT NULL,
          klas_id  INT          NOT NULL,
          FOREIGN KEY (klas_id) REFERENCES klassen(id)
        ) CHARACTER SET utf8mb4
      `);

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS lpd_resultaten (
          id              INT          PRIMARY KEY AUTO_INCREMENT,
          leerling_id     INT          NOT NULL,
          lpd_uuid        VARCHAR(36)  NOT NULL,
          behaald         TINYINT      NOT NULL DEFAULT 0,
          datum_gewijzigd DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (leerling_id) REFERENCES leerlingen(id),
          UNIQUE KEY uq_lpd (leerling_id, lpd_uuid)
        ) CHARACTER SET utf8mb4
      `);

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS klas_leerplan_mapping (
          klas_id       INT         PRIMARY KEY,
          leerplan_uuid VARCHAR(36) NOT NULL,
          FOREIGN KEY (klas_id) REFERENCES klassen(id)
        ) CHARACTER SET utf8mb4
      `);

      await conn.execute(`
        CREATE INDEX IF NOT EXISTS idx_leerlingen_klas ON leerlingen(klas_id)
      `).catch(() => {}); // Negeer fout als index al bestaat

      await conn.execute(`
        CREATE INDEX IF NOT EXISTS idx_resultaten_leerling ON lpd_resultaten(leerling_id)
      `).catch(() => {});

      await conn.execute(`
        CREATE INDEX IF NOT EXISTS idx_resultaten_lpd_uuid ON lpd_resultaten(lpd_uuid)
      `).catch(() => {});

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS richting_leerplan (
          id            INT          PRIMARY KEY AUTO_INCREMENT,
          richting      VARCHAR(255) NOT NULL UNIQUE,
          leerplan_uuid VARCHAR(36)  NOT NULL,
          identifier    VARCHAR(50)  NOT NULL DEFAULT '',
          graad         INT          NOT NULL DEFAULT 0
        ) CHARACTER SET utf8mb4
      `);

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id         INT          PRIMARY KEY AUTO_INCREMENT,
          username   VARCHAR(100) NOT NULL UNIQUE,
          password   VARCHAR(255) NOT NULL,
          naam       VARCHAR(255) NOT NULL DEFAULT '',
          rol        ENUM('superadmin', 'admin', 'leerkracht') NOT NULL DEFAULT 'leerkracht',
          actief     TINYINT      NOT NULL DEFAULT 1,
          aangemaakt DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4
      `);

      // ── BK-integratie tabellen (optioneel, additief) ──────────────────

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

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS deelberoepskwalificaties (
          id    INT          PRIMARY KEY AUTO_INCREMENT,
          code  VARCHAR(50)  NOT NULL UNIQUE,
          naam  VARCHAR(500) NOT NULL,
          bk_id INT          NOT NULL,
          FOREIGN KEY (bk_id) REFERENCES beroepskwalificaties(id) ON DELETE CASCADE
        ) CHARACTER SET utf8mb4
      `);

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS bk_competentiecomponenten (
          id           INT          PRIMARY KEY AUTO_INCREMENT,
          code         VARCHAR(50)  NOT NULL UNIQUE,
          omschrijving TEXT         NOT NULL,
          type         ENUM('kennis','vaardigheid','context','attitude','anders') NOT NULL DEFAULT 'anders',
          dbk_id       INT          DEFAULT NULL,
          bk_id        INT          NOT NULL,
          FOREIGN KEY (dbk_id) REFERENCES deelberoepskwalificaties(id) ON DELETE CASCADE,
          FOREIGN KEY (bk_id)  REFERENCES beroepskwalificaties(id) ON DELETE CASCADE
        ) CHARACTER SET utf8mb4
      `);

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

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS lpd_competentie_mapping (
          id              INT          PRIMARY KEY AUTO_INCREMENT,
          lpd_uuid        VARCHAR(36)  NOT NULL,
          competentie_id  INT          NOT NULL,
          gewicht         DECIMAL(3,2) NOT NULL DEFAULT 1.00,
          FOREIGN KEY (competentie_id) REFERENCES bk_competentiecomponenten(id) ON DELETE CASCADE,
          UNIQUE KEY uq_lpd_cc (lpd_uuid, competentie_id)
        ) CHARACTER SET utf8mb4
      `);

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS bk_attestering (
          id              INT          PRIMARY KEY AUTO_INCREMENT,
          leerling_id     INT          NOT NULL,
          bk_id           INT          NOT NULL,
          percentage      INT          NOT NULL DEFAULT 0,
          status          ENUM('niet_gestart','bezig','behaald','overschreven') NOT NULL DEFAULT 'niet_gestart',
          handmatig       TINYINT      NOT NULL DEFAULT 0,
          opmerking       TEXT         DEFAULT NULL,
          datum_gewijzigd DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (leerling_id) REFERENCES leerlingen(id) ON DELETE CASCADE,
          FOREIGN KEY (bk_id)       REFERENCES beroepskwalificaties(id) ON DELETE CASCADE,
          UNIQUE KEY uq_ll_bk (leerling_id, bk_id)
        ) CHARACTER SET utf8mb4
      `);

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS dbk_attestering (
          id              INT          PRIMARY KEY AUTO_INCREMENT,
          leerling_id     INT          NOT NULL,
          dbk_id          INT          NOT NULL,
          percentage      INT          NOT NULL DEFAULT 0,
          status          ENUM('niet_gestart','bezig','behaald','overschreven') NOT NULL DEFAULT 'niet_gestart',
          handmatig       TINYINT      NOT NULL DEFAULT 0,
          opmerking       TEXT         DEFAULT NULL,
          datum_gewijzigd DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (leerling_id) REFERENCES leerlingen(id) ON DELETE CASCADE,
          FOREIGN KEY (dbk_id)      REFERENCES deelberoepskwalificaties(id) ON DELETE CASCADE,
          UNIQUE KEY uq_ll_dbk (leerling_id, dbk_id)
        ) CHARACTER SET utf8mb4
      `);

    } finally {
      conn.release();
    }
  }

  /**
   * Seed de richting_leerplan tabel vanuit een mapping-object (bv. uit JSON).
   * Slaat bestaande richtingen over (INSERT IGNORE).
   */
  async seedRichtingLeerplan(mapping) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [richting, data] of Object.entries(mapping)) {
        if (richting.startsWith('_')) continue;
        await conn.execute(`
          INSERT IGNORE INTO richting_leerplan (richting, leerplan_uuid, identifier, graad)
          VALUES (?, ?, ?, ?)
        `, [richting, data.uuid, data.identifier || '', data.graad || 0]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Seed de BK-tabellen vanuit richting_bk_mapping.json.
   * Wordt alleen uitgevoerd als de beroepskwalificaties-tabel leeg is.
   */
  async seedBkData() {
    // Controleer of er al BK-data bestaat
    const [countRows] = await this.pool.execute(
      'SELECT COUNT(*) AS n FROM beroepskwalificaties'
    );
    if (Number(countRows[0].n) > 0) return;

    // Lees mapping-bestand (zoek in projectroot)
    const mappingPad = path.resolve(__dirname, '..', 'richting_bk_mapping.json');
    if (!fs.existsSync(mappingPad)) {
      console.warn('[BK-seed] richting_bk_mapping.json niet gevonden op', mappingPad);
      return;
    }

    const mapping = JSON.parse(fs.readFileSync(mappingPad, 'utf8'));
    const conn = await this.pool.getConnection();

    try {
      await conn.beginTransaction();

      // Houd bij welke BK-codes al zijn ingevoegd (om duplicaten te voorkomen)
      const bkCache = new Map();   // code → id
      const dbkCache = new Map();  // code → id

      for (const [richting, data] of Object.entries(mapping)) {
        if (richting.startsWith('_')) continue;
        if (!data.bks || !Array.isArray(data.bks)) continue;

        for (const bk of data.bks) {
          // Upsert beroepskwalificatie
          let bkId = bkCache.get(bk.code);
          if (!bkId) {
            await conn.execute(`
              INSERT IGNORE INTO beroepskwalificaties (code, naam, niveau)
              VALUES (?, ?, ?)
            `, [bk.code, bk.naam, bk.niveau || 0]);

            const [bkRows] = await conn.execute(
              'SELECT id FROM beroepskwalificaties WHERE code = ?', [bk.code]
            );
            bkId = bkRows[0].id;
            bkCache.set(bk.code, bkId);
          }

          // Upsert deelberoepskwalificaties
          if (bk.dbks && Array.isArray(bk.dbks)) {
            for (const dbk of bk.dbks) {
              if (!dbkCache.has(dbk.code)) {
                await conn.execute(`
                  INSERT IGNORE INTO deelberoepskwalificaties (code, naam, bk_id)
                  VALUES (?, ?, ?)
                `, [dbk.code, dbk.naam, bkId]);

                const [dbkRows] = await conn.execute(
                  'SELECT id FROM deelberoepskwalificaties WHERE code = ?', [dbk.code]
                );
                dbkCache.set(dbk.code, dbkRows[0].id);
              }
            }
          }

          // Koppel richting aan BK
          await conn.execute(`
            INSERT IGNORE INTO richting_bk (richting, bk_id, verplicht)
            VALUES (?, ?, 1)
          `, [richting, bkId]);
        }
      }

      await conn.commit();
      console.log(`[BK-seed] ${bkCache.size} BK's, ${dbkCache.size} DBK's, en richting-koppelingen geladen`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Zoek een leerplan UUID op basis van een WISA admin groep omschrijving.
   * Matcht de richtingsnaam als substring in de omschrijving.
   */
  async vindLeerplanVoorOmschrijving(omschrijving) {
    const [rows] = await this.pool.execute(
      'SELECT richting, leerplan_uuid FROM richting_leerplan'
    );
    const lower = omschrijving.toLowerCase();
    for (const row of rows) {
      if (lower.includes(row.richting.toLowerCase())) {
        return row.leerplan_uuid;
      }
    }
    return null;
  }

  /**
   * Koppel leerplannen aan alle klassen die er nog geen hebben.
   * Draait bij opstart en na sync, zodat bestaande klassen ook gekoppeld worden.
   */
  async koppelOntbrekendeLeerplannen() {
    const [klassen] = await this.pool.execute(`
      SELECT k.id, k.richting FROM klassen k
      LEFT JOIN klas_leerplan_mapping m ON m.klas_id = k.id
      WHERE m.klas_id IS NULL AND k.richting != ''
    `);
    let gekoppeld = 0;
    for (const klas of klassen) {
      const uuid = await this.vindLeerplanVoorOmschrijving(klas.richting);
      if (uuid) {
        await this.setKlasLeerplan(klas.id, uuid);
        gekoppeld++;
      }
    }
    return gekoppeld;
  }

  // ── Klassen ─────────────────────────────────────────────────────────────

  async getKlassen() {
    const [rows] = await this.pool.execute(`
      SELECT k.*, COUNT(l.id) AS aantal_leerlingen
      FROM klassen k
      LEFT JOIN leerlingen l ON l.klas_id = k.id
      GROUP BY k.id
      ORDER BY k.schooljaar DESC, k.naam
    `);
    return rows;
  }

  async getKlas(klasId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM klassen WHERE id = ?', [klasId]
    );
    return rows[0];
  }

  async createKlas(naam, richting, schooljaar) {
    const [result] = await this.pool.execute(
      'INSERT INTO klassen (naam, richting, schooljaar) VALUES (?, ?, ?)',
      [naam, richting ?? '', schooljaar]
    );
    return result.insertId;
  }

  async setKlasLeerplan(klasId, leerplanUuid) {
    await this.pool.execute(`
      INSERT INTO klas_leerplan_mapping (klas_id, leerplan_uuid)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE leerplan_uuid = VALUES(leerplan_uuid)
    `, [klasId, leerplanUuid]);
  }

  async getKlasLeerplan(klasId) {
    const [rows] = await this.pool.execute(
      'SELECT leerplan_uuid FROM klas_leerplan_mapping WHERE klas_id = ?', [klasId]
    );
    return rows[0] ? rows[0].leerplan_uuid : null;
  }

  // ── Leerlingen ──────────────────────────────────────────────────────────

  async getLeerlingen(klasId) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM leerlingen WHERE klas_id = ? ORDER BY naam, voornaam
    `, [klasId]);
    return rows;
  }

  async getLeerling(leerlingId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM leerlingen WHERE id = ?', [leerlingId]
    );
    return rows[0];
  }

  /**
   * Zoek leerlingen op naam of voornaam (case-insensitieve substring match).
   * Geeft max. 8 resultaten terug, inclusief de naam van hun klas.
   *
   * @param {string} zoekterm - Zoekstring (minimaal 1 karakter)
   * @returns {{ id, naam, voornaam, klas_naam }[]}
   */
  async zoekLeerlingen(zoekterm) {
    const patroon = `%${zoekterm}%`;
    const [rows] = await this.pool.execute(`
      SELECT l.id, l.naam, l.voornaam, k.naam AS klas_naam
      FROM leerlingen l
      JOIN klassen k ON k.id = l.klas_id
      WHERE l.naam LIKE ? OR l.voornaam LIKE ?
      ORDER BY l.naam, l.voornaam
      LIMIT 8
    `, [patroon, patroon]);
    return rows;
  }

  async createLeerling(naam, voornaam, klasId) {
    const [result] = await this.pool.execute(
      'INSERT INTO leerlingen (naam, voornaam, klas_id) VALUES (?, ?, ?)',
      [naam, voornaam, klasId]
    );
    return result.insertId;
  }

  async deleteLeerlingen(klasId) {
    await this.pool.execute(`
      DELETE FROM lpd_resultaten
      WHERE leerling_id IN (SELECT id FROM leerlingen WHERE klas_id = ?)
    `, [klasId]);
    await this.pool.execute('DELETE FROM leerlingen WHERE klas_id = ?', [klasId]);
  }

  async bulkInsertLeerlingen(klasId, leerlingen) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const l of leerlingen) {
        await conn.execute(
          'INSERT INTO leerlingen (naam, voornaam, klas_id) VALUES (?, ?, ?)',
          [l.naam, l.voornaam, klasId]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return leerlingen.length;
  }

  // ── LPD resultaten ──────────────────────────────────────────────────────

  async getLpdResultaten(leerlingId) {
    const [rows] = await this.pool.execute(
      'SELECT lpd_uuid, behaald FROM lpd_resultaten WHERE leerling_id = ?',
      [leerlingId]
    );
    const resultaat = {};
    for (const rij of rows) {
      resultaat[rij.lpd_uuid] = rij.behaald === 1;
    }
    return resultaat;
  }

  async toggleLpd(leerlingId, lpdUuid, behaald) {
    await this.pool.execute(`
      INSERT INTO lpd_resultaten (leerling_id, lpd_uuid, behaald, datum_gewijzigd)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        behaald         = VALUES(behaald),
        datum_gewijzigd = NOW()
    `, [leerlingId, lpdUuid, behaald ? 1 : 0]);
  }

  async bulkSaveLpd(leerlingId, resultaten) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [lpdUuid, behaald] of Object.entries(resultaten)) {
        await conn.execute(`
          INSERT INTO lpd_resultaten (leerling_id, lpd_uuid, behaald, datum_gewijzigd)
          VALUES (?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            behaald         = VALUES(behaald),
            datum_gewijzigd = NOW()
        `, [leerlingId, lpdUuid, behaald ? 1 : 0]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // ── Stats ───────────────────────────────────────────────────────────────

  async berekenLpdStats(leerlingId, lpdUuids) {
    if (!lpdUuids || lpdUuids.length === 0) {
      return { totaal: 0, behaald: 0, percentage: 0 };
    }
    const placeholders = lpdUuids.map(() => '?').join(', ');
    const [rows] = await this.pool.execute(`
      SELECT
        SUM(CASE WHEN behaald = 1 THEN 1 ELSE 0 END) AS behaald
      FROM lpd_resultaten
      WHERE leerling_id = ? AND lpd_uuid IN (${placeholders})
    `, [leerlingId, ...lpdUuids]);

    const totaal     = lpdUuids.length;
    const behaald    = Number(rows[0].behaald ?? 0);
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
    return { totaal, behaald, percentage };
  }

  // ── WISA synchronisatie ─────────────────────────────────────────────────

  /**
   * Synchroniseert klassen en leerlingen vanuit WISA CSV-rijen naar de database.
   * Bestaande leerlingen van gedetecteerde klassen worden eerst verwijderd.
   *
   * @param {object[]} rijen     - Rijen uit de WISA CSV (kolomnamen onbekend op voorhand)
   * @param {number}   schooljaar - Schooljaar als integer (bv. 2025)
   * @returns {{ klassen: number, leerlingen: number }}
   */
  async syncWisaKlassenLeerlingen(rijen, schooljaar) {
    // Hulpfunctie: zoek kolomnaam case-insensitief op basis van kandidatenlijst
    function vindKolom(headers, kandidaten) {
      const lower = headers.map(h => h.toLowerCase().trim());
      for (const k of kandidaten) {
        const idx = lower.indexOf(k.toLowerCase());
        if (idx !== -1) return headers[idx];
      }
      return null;
    }

    if (!rijen || rijen.length === 0) {
      return { klassen: 0, leerlingen: 0 };
    }

    // Bepaal kolomnamen uit de keys van het eerste object
    const headers = Object.keys(rijen[0]);

    const kolNaam     = vindKolom(headers, ['naam', 'familienaam', 'achternaam', 'last_name', 'LL_NAAM']);
    const kolVoornaam = vindKolom(headers, ['voornaam', 'first_name', 'firstname', 'LL_VOORNAAM']);
    const kolKlas     = vindKolom(headers, ['klas_naam', 'klas', 'klasnaam', 'admin_groep_naam', 'groep', 'klsnm', 'KL_CODE', 'AG_CODE']);
    const kolRichting = vindKolom(headers, ['richting', 'studierichting', 'studierichting_naam', 'opleiding', 'AG_OMSCHRIJVING', 'KL_OMSCHRIJVING']);

    // Groepeer rijen per unieke klas_naam
    const klassenMap = new Map();
    for (const rij of rijen) {
      const klasNaam = kolKlas ? (rij[kolKlas] ?? '').trim() : '';
      if (!klassenMap.has(klasNaam)) {
        klassenMap.set(klasNaam, {
          richting:   kolRichting ? (rij[kolRichting] ?? '').trim() : '',
          leerlingen: [],
        });
      }
      klassenMap.get(klasNaam).leerlingen.push({
        naam:     kolNaam     ? (rij[kolNaam]     ?? '').trim() : '',
        voornaam: kolVoornaam ? (rij[kolVoornaam] ?? '').trim() : '',
      });
    }

    let aantalKlassen    = 0;
    let aantalLeerlingen = 0;
    let aantalGekoppeld  = 0;

    for (const [klasNaam, data] of klassenMap) {
      // Upsert klas: voeg in of update richting en laatste_sync bij bestaande klas
      const [result] = await this.pool.execute(`
        INSERT INTO klassen (naam, richting, schooljaar, laatste_sync)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE richting = VALUES(richting), laatste_sync = NOW(), id = LAST_INSERT_ID(id)
      `, [klasNaam, data.richting, schooljaar]);

      const klasId = result.insertId;

      // Auto-koppel leerplan op basis van richting-omschrijving
      const leerplanUuid = await this.vindLeerplanVoorOmschrijving(data.richting);
      if (leerplanUuid) {
        await this.setKlasLeerplan(klasId, leerplanUuid);
        aantalGekoppeld++;
      }

      // Verwijder bestaande leerlingen (en hun LPD-resultaten) van deze klas
      await this.deleteLeerlingen(klasId);

      // Bulk-insert alle leerlingen van deze klas
      if (data.leerlingen.length > 0) {
        await this.bulkInsertLeerlingen(klasId, data.leerlingen);
        aantalLeerlingen += data.leerlingen.length;
      }

      aantalKlassen++;
    }

    return { klassen: aantalKlassen, leerlingen: aantalLeerlingen, gekoppeld: aantalGekoppeld };
  }

  // ── Users ───────────────────────────────────────────────────────────────

  async getUsers() {
    const [rows] = await this.pool.execute(
      'SELECT id, username, naam, rol, actief, aangemaakt FROM users ORDER BY id'
    );
    return rows;
  }

  async getUserByUsername(username) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM users WHERE username = ?', [username]
    );
    return rows[0] || null;
  }

  async getUserById(id) {
    const [rows] = await this.pool.execute(
      'SELECT id, username, naam, rol, actief FROM users WHERE id = ?', [id]
    );
    return rows[0] || null;
  }

  async aantalUsers() {
    const [rows] = await this.pool.execute('SELECT COUNT(*) AS n FROM users');
    return Number(rows[0].n);
  }

  async createUser(username, passwordHash, naam, rol) {
    const [result] = await this.pool.execute(
      'INSERT INTO users (username, password, naam, rol) VALUES (?, ?, ?, ?)',
      [username, passwordHash, naam, rol]
    );
    return result.insertId;
  }

  async updateUserRol(userId, rol) {
    await this.pool.execute('UPDATE users SET rol = ? WHERE id = ?', [rol, userId]);
  }

  async updateUserActief(userId, actief) {
    await this.pool.execute('UPDATE users SET actief = ? WHERE id = ?', [actief ? 1 : 0, userId]);
  }

  async updateUserPassword(userId, passwordHash) {
    await this.pool.execute('UPDATE users SET password = ? WHERE id = ?', [passwordHash, userId]);
  }

  // ── Beroepskwalificaties (BK) ──────────────────────────────────────────

  /** Haal alle beroepskwalificaties op */
  async getBeroepskwalificaties() {
    const [rows] = await this.pool.execute(
      'SELECT * FROM beroepskwalificaties ORDER BY code'
    );
    return rows;
  }

  /** Haal één BK op met bijhorende DBK's */
  async getBeroepskwalificatie(id) {
    const [bkRows] = await this.pool.execute(
      'SELECT * FROM beroepskwalificaties WHERE id = ?', [id]
    );
    if (!bkRows[0]) return null;

    const bk = bkRows[0];
    bk.dbks = await this.getDeelberoepskwalificaties(id);
    return bk;
  }

  /** Zoek een BK op code */
  async getBkByCode(code) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM beroepskwalificaties WHERE code = ?', [code]
    );
    return rows[0] || null;
  }

  /** Insert of update een beroepskwalificatie op basis van code */
  async upsertBeroepskwalificatie(code, naam, niveau, versieCode = null) {
    const [result] = await this.pool.execute(`
      INSERT INTO beroepskwalificaties (code, naam, niveau, versie_code)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        naam        = VALUES(naam),
        niveau      = VALUES(niveau),
        versie_code = VALUES(versie_code),
        id          = LAST_INSERT_ID(id)
    `, [code, naam, niveau, versieCode]);
    return result.insertId;
  }

  /** Verwijder een BK (cascade verwijdert DBK's, competenties, koppelingen) */
  async deleteBeroepskwalificatie(id) {
    await this.pool.execute('DELETE FROM beroepskwalificaties WHERE id = ?', [id]);
  }

  // ── Deelberoepskwalificaties (DBK) ─────────────────────────────────────

  /** Haal alle DBK's op voor een BK */
  async getDeelberoepskwalificaties(bkId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM deelberoepskwalificaties WHERE bk_id = ? ORDER BY code', [bkId]
    );
    return rows;
  }

  /** Insert of update een deelberoepskwalificatie op basis van code */
  async upsertDeelberoepskwalificatie(code, naam, bkId) {
    const [result] = await this.pool.execute(`
      INSERT INTO deelberoepskwalificaties (code, naam, bk_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        naam  = VALUES(naam),
        bk_id = VALUES(bk_id),
        id    = LAST_INSERT_ID(id)
    `, [code, naam, bkId]);
    return result.insertId;
  }

  // ── Competentiecomponenten ─────────────────────────────────────────────

  /** Haal alle competenties op voor een BK */
  async getCompetenties(bkId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM bk_competentiecomponenten WHERE bk_id = ? ORDER BY code', [bkId]
    );
    return rows;
  }

  /** Haal competenties op voor een specifieke DBK */
  async getCompetentiesVoorDbk(dbkId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM bk_competentiecomponenten WHERE dbk_id = ? ORDER BY code', [dbkId]
    );
    return rows;
  }

  /** Insert of update een competentiecomponent op basis van code */
  async upsertCompetentie(code, omschrijving, type, bkId, dbkId = null) {
    const [result] = await this.pool.execute(`
      INSERT INTO bk_competentiecomponenten (code, omschrijving, type, bk_id, dbk_id)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        omschrijving = VALUES(omschrijving),
        type         = VALUES(type),
        bk_id        = VALUES(bk_id),
        dbk_id       = VALUES(dbk_id),
        id           = LAST_INSERT_ID(id)
    `, [code, omschrijving, type, bkId, dbkId]);
    return result.insertId;
  }

  // ── Richting-BK mapping ────────────────────────────────────────────────

  /** Haal BK's op voor een studierichting (geeft lege array als er geen zijn) */
  async getBksVoorRichting(richting) {
    const [rows] = await this.pool.execute(`
      SELECT bk.*, rb.verplicht
      FROM beroepskwalificaties bk
      JOIN richting_bk rb ON rb.bk_id = bk.id
      WHERE rb.richting = ?
      ORDER BY bk.code
    `, [richting]);
    return rows;
  }

  /** Haal BK's op via klas → richting → BK mapping */
  async getBksVoorKlas(klasId) {
    const klas = await this.getKlas(klasId);
    if (!klas || !klas.richting) return [];

    // Zoek op exacte match of substring-match (zoals bij leerplankoppeling)
    const [rows] = await this.pool.execute(`
      SELECT DISTINCT bk.*, rb.verplicht
      FROM beroepskwalificaties bk
      JOIN richting_bk rb ON rb.bk_id = bk.id
      WHERE ? LIKE CONCAT('%', rb.richting, '%')
         OR rb.richting LIKE CONCAT('%', ?, '%')
      ORDER BY bk.code
    `, [klas.richting, klas.richting]);
    return rows;
  }

  /** Koppel een richting aan een BK */
  async koppelRichtingBk(richting, bkId, verplicht = true) {
    await this.pool.execute(`
      INSERT INTO richting_bk (richting, bk_id, verplicht)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE verplicht = VALUES(verplicht)
    `, [richting, bkId, verplicht ? 1 : 0]);
  }

  /** Ontkoppel een richting van een BK */
  async ontkoppelRichtingBk(richting, bkId) {
    await this.pool.execute(
      'DELETE FROM richting_bk WHERE richting = ? AND bk_id = ?',
      [richting, bkId]
    );
  }

  // ── LPD-Competentie mapping ────────────────────────────────────────────

  /** Haal alle LPD→competentie-mappings op voor een BK */
  async getLpdCompetentieMapping(bkId) {
    const [rows] = await this.pool.execute(`
      SELECT lcm.*, cc.code AS competentie_code, cc.omschrijving
      FROM lpd_competentie_mapping lcm
      JOIN bk_competentiecomponenten cc ON cc.id = lcm.competentie_id
      WHERE cc.bk_id = ?
      ORDER BY lcm.lpd_uuid, cc.code
    `, [bkId]);
    return rows;
  }

  /** Koppel een LPD aan een competentiecomponent */
  async koppelLpdCompetentie(lpdUuid, competentieId, gewicht = 1.0) {
    await this.pool.execute(`
      INSERT INTO lpd_competentie_mapping (lpd_uuid, competentie_id, gewicht)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE gewicht = VALUES(gewicht)
    `, [lpdUuid, competentieId, gewicht]);
  }

  /** Ontkoppel een LPD van een competentiecomponent */
  async ontkoppelLpdCompetentie(lpdUuid, competentieId) {
    await this.pool.execute(
      'DELETE FROM lpd_competentie_mapping WHERE lpd_uuid = ? AND competentie_id = ?',
      [lpdUuid, competentieId]
    );
  }

  // ── BK Attestering ─────────────────────────────────────────────────────

  /** Haal alle BK-attesteringen op voor een leerling */
  async getBkAttestering(leerlingId) {
    const [rows] = await this.pool.execute(`
      SELECT ba.*, bk.code, bk.naam AS bk_naam
      FROM bk_attestering ba
      JOIN beroepskwalificaties bk ON bk.id = ba.bk_id
      WHERE ba.leerling_id = ?
      ORDER BY bk.code
    `, [leerlingId]);
    return rows;
  }

  /** Haal DBK-attesteringen op voor een leerling binnen een BK */
  async getDbkAttestering(leerlingId, bkId) {
    const [rows] = await this.pool.execute(`
      SELECT da.*, dbk.code, dbk.naam AS dbk_naam
      FROM dbk_attestering da
      JOIN deelberoepskwalificaties dbk ON dbk.id = da.dbk_id
      WHERE da.leerling_id = ? AND dbk.bk_id = ?
      ORDER BY dbk.code
    `, [leerlingId, bkId]);
    return rows;
  }

  /** Update of insert BK-attestering voor een leerling */
  async updateBkAttestering(leerlingId, bkId, percentage, status, handmatig = false, opmerking = null) {
    await this.pool.execute(`
      INSERT INTO bk_attestering (leerling_id, bk_id, percentage, status, handmatig, opmerking)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        percentage      = VALUES(percentage),
        status          = VALUES(status),
        handmatig       = VALUES(handmatig),
        opmerking       = VALUES(opmerking),
        datum_gewijzigd = NOW()
    `, [leerlingId, bkId, percentage, status, handmatig ? 1 : 0, opmerking]);
  }

  /** Update of insert DBK-attestering voor een leerling */
  async updateDbkAttestering(leerlingId, dbkId, percentage, status, handmatig = false, opmerking = null) {
    await this.pool.execute(`
      INSERT INTO dbk_attestering (leerling_id, dbk_id, percentage, status, handmatig, opmerking)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        percentage      = VALUES(percentage),
        status          = VALUES(status),
        handmatig       = VALUES(handmatig),
        opmerking       = VALUES(opmerking),
        datum_gewijzigd = NOW()
    `, [leerlingId, dbkId, percentage, status, handmatig ? 1 : 0, opmerking]);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async close() {
    await this.pool.end();
  }
}

module.exports = { Database };
