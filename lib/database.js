'use strict';

/**
 * Database module voor BK/DPK/LPD attestatie tracking
 * Gebruikt mysql2/promise (async API)
 */

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
          id         INT          PRIMARY KEY AUTO_INCREMENT,
          naam       VARCHAR(255) NOT NULL,
          richting   VARCHAR(255) NOT NULL DEFAULT '',
          schooljaar INT          NOT NULL,
          UNIQUE KEY uq_klas (naam(100), schooljaar)
        ) CHARACTER SET utf8mb4
      `);

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

  async importLeerlingenCsv(csvContent, klasId) {
    const regels = csvContent
      .split(/\r?\n/)
      .map(r => r.trim())
      .filter(r => r.length > 0);

    if (regels.length < 2) return 0;

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
      // Upsert klas: voeg in of update richting bij bestaande klas
      const [result] = await this.pool.execute(`
        INSERT INTO klassen (naam, richting, schooljaar)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE richting = VALUES(richting), id = LAST_INSERT_ID(id)
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

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async close() {
    await this.pool.end();
  }
}

module.exports = { Database };
