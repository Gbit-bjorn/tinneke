'use strict';

const path   = require('path');
const fs     = require('fs');
const router = require('express').Router();
const { loginRequired } = require('../middleware/auth');
const { db, llinkid } = require('../lib');
const { berekenStats, flattenBkHierarchy } = require('../lib/stats');
const {
  genereerHtmlAttest,
  genereerExcelAttest,
  genereerExcelKlas,
  genereerBkHtmlAttest,
  genereerBkExcelAttest,
  genereerBkExcelKlas,
} = require('../lib/export');

// Pad naar richting→BK-mapping (zelfde bestand als routes/bk.js gebruikt)
const MAPPING_PAD = path.join(__dirname, '..', 'richting_bk_mapping.json');

function laadBkMapping() {
  try {
    return JSON.parse(fs.readFileSync(MAPPING_PAD, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Geeft de BK-metadata array terug voor een richting, of null als geen mapping bestaat.
 * @param {string} richting
 * @returns {Array|null} [{ code, naam, niveau, dbks }] of null
 */
function getBkMetaVoorRichting(richting) {
  if (!richting) return null;
  const mapping = laadBkMapping();
  // Zoek exacte match eerst, daarna substring
  const data = mapping[richting]
    || Object.entries(mapping).find(([k]) => k !== '_info' && richting.toLowerCase().includes(k.toLowerCase()))?.[1];
  if (!data || !data.bks || data.bks.length === 0) return null;
  return data.bks;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /export/klas/:klasId/excel  (MOET BOVEN wildcard-routes staan!)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/klas/:klasId/excel', loginRequired, async (req, res) => {
  try {
    const klasId = parseInt(req.params.klasId, 10);
    if (isNaN(klasId)) return res.status(400).send('Ongeldig klas-id');

    const klas = await db.getKlas(klasId);
    if (!klas) return res.status(404).send('Klas niet gevonden');

    const leerplanUuid = await db.getKlasLeerplan(klasId);
    if (!leerplanUuid) return res.status(400).send('Geen leerplan gekoppeld aan deze klas');

    const doelen     = await llinkid.getDoelen(leerplanUuid);
    const leerlingen = await db.getLeerlingen(klasId);

    const bkStructuur = berekenStats(doelen, {});

    const leerlingenMetStats = [];
    for (const leerling of leerlingen) {
      const resultaten = await db.getLpdResultaten(leerling.id);
      const bkSecties  = berekenStats(doelen, resultaten);
      const bkStats    = {};
      for (const bk of bkSecties) {
        bkStats[bk.titel] = bk.stats.percentage;
      }
      leerlingenMetStats.push({ ...leerling, bkStats });
    }

    const buffer = await genereerExcelKlas(klas, leerlingenMetStats, bkStructuur);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="klasoverzicht_${klas.naam}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export klas Excel error:', error);
    res.status(500).send(`Fout bij genereren Excel: ${error.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /export/:leerlingId/html
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:leerlingId/html', loginRequired, async (req, res) => {
  try {
    const leerlingId = parseInt(req.params.leerlingId, 10);
    if (isNaN(leerlingId)) return res.status(400).send('Ongeldig leerling-id');

    const leerling = await db.getLeerling(leerlingId);
    if (!leerling) return res.status(404).send('Leerling niet gevonden');

    const klas = await db.getKlas(leerling.klas_id);
    if (!klas)  return res.status(404).send('Klas niet gevonden');

    const leerplanUuid = await db.getKlasLeerplan(leerling.klas_id);
    if (!leerplanUuid) return res.status(400).send('Geen leerplan gekoppeld aan deze klas');

    const doelen     = await llinkid.getDoelen(leerplanUuid);
    const resultaten = await db.getLpdResultaten(leerlingId);
    const bkSecties  = berekenStats(doelen, resultaten);
    const flatLpds   = flattenBkHierarchy(bkSecties);
    const schoolNaam = process.env.SCHOOL_NAAM || 'Damiaaninstituut Aarschot';
    const html       = genereerHtmlAttest(leerling, klas, flatLpds, resultaten, schoolNaam);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attest_${leerling.voornaam}_${leerling.naam}.html"`);
    res.send(html);
  } catch (error) {
    console.error('Export HTML error:', error);
    res.status(500).send(`Fout bij genereren HTML: ${error.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /export/:leerlingId/excel
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:leerlingId/excel', loginRequired, async (req, res) => {
  try {
    const leerlingId = parseInt(req.params.leerlingId, 10);
    if (isNaN(leerlingId)) return res.status(400).send('Ongeldig leerling-id');

    const leerling = await db.getLeerling(leerlingId);
    if (!leerling) return res.status(404).send('Leerling niet gevonden');

    const klas = await db.getKlas(leerling.klas_id);
    if (!klas)  return res.status(404).send('Klas niet gevonden');

    const leerplanUuid = await db.getKlasLeerplan(leerling.klas_id);
    if (!leerplanUuid) return res.status(400).send('Geen leerplan gekoppeld aan deze klas');

    const doelen     = await llinkid.getDoelen(leerplanUuid);
    const resultaten = await db.getLpdResultaten(leerlingId);
    const bkSecties  = berekenStats(doelen, resultaten);
    const flatLpds   = flattenBkHierarchy(bkSecties);
    const buffer     = await genereerExcelAttest(leerling, klas, flatLpds);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attest_${leerling.voornaam}_${leerling.naam}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).send(`Fout bij genereren Excel: ${error.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /export/klas/:klasId/bk/excel  (MOET boven wildcard-routes staan!)
// BK klasoverzicht: rijen = leerlingen, kolommen = BK's met % behaald
// ─────────────────────────────────────────────────────────────────────────────

router.get('/klas/:klasId/bk/excel', loginRequired, async (req, res) => {
  try {
    const klasId = parseInt(req.params.klasId, 10);
    if (isNaN(klasId)) return res.status(400).send('Ongeldig klas-id');

    const klas = await db.getKlas(klasId);
    if (!klas) return res.status(404).send('Klas niet gevonden');

    const bkMeta = getBkMetaVoorRichting(klas.richting);
    if (!bkMeta) return res.status(404).send('Geen beroepskwalificaties gekoppeld aan deze richting.');

    const leerplanUuid = await db.getKlasLeerplan(klasId);
    if (!leerplanUuid) return res.status(400).send('Geen leerplan gekoppeld aan deze klas');

    const doelen     = await llinkid.getDoelen(leerplanUuid);
    const leerlingen = await db.getLeerlingen(klasId);

    const allBkStats = [];
    for (const leerling of leerlingen) {
      const resultaten = await db.getLpdResultaten(leerling.id);
      const bkStats    = berekenStats(doelen, resultaten);
      allBkStats.push({ leerlingId: leerling.id, bkStats });
    }

    const buffer = await genereerBkExcelKlas(klas, leerlingen, allBkStats);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bk_klasoverzicht_${klas.naam}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export BK klas Excel error:', error);
    res.status(500).send(`Fout bij genereren BK klasoverzicht: ${error.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /export/:leerlingId/bk/html  — BK HTML-attest per leerling
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:leerlingId/bk/html', loginRequired, async (req, res) => {
  try {
    const leerlingId = parseInt(req.params.leerlingId, 10);
    if (isNaN(leerlingId)) return res.status(400).send('Ongeldig leerling-id');

    const leerling = await db.getLeerling(leerlingId);
    if (!leerling) return res.status(404).send('Leerling niet gevonden');

    const klas = await db.getKlas(leerling.klas_id);
    if (!klas)  return res.status(404).send('Klas niet gevonden');

    const bkMeta = getBkMetaVoorRichting(klas.richting);
    if (!bkMeta) return res.status(404).send('Geen beroepskwalificaties gekoppeld aan deze richting.');

    const leerplanUuid = await db.getKlasLeerplan(leerling.klas_id);
    if (!leerplanUuid) return res.status(400).send('Geen leerplan gekoppeld aan deze klas');

    const doelen     = await llinkid.getDoelen(leerplanUuid);
    const resultaten = await db.getLpdResultaten(leerlingId);
    const bkStats    = berekenStats(doelen, resultaten);
    const html       = genereerBkHtmlAttest(leerling, klas, bkStats, bkMeta);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bk_attest_${leerling.voornaam}_${leerling.naam}.html"`);
    res.send(html);
  } catch (error) {
    console.error('Export BK HTML error:', error);
    res.status(500).send(`Fout bij genereren BK HTML-attest: ${error.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /export/:leerlingId/bk/excel  — BK Excel-attest per leerling
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:leerlingId/bk/excel', loginRequired, async (req, res) => {
  try {
    const leerlingId = parseInt(req.params.leerlingId, 10);
    if (isNaN(leerlingId)) return res.status(400).send('Ongeldig leerling-id');

    const leerling = await db.getLeerling(leerlingId);
    if (!leerling) return res.status(404).send('Leerling niet gevonden');

    const klas = await db.getKlas(leerling.klas_id);
    if (!klas)  return res.status(404).send('Klas niet gevonden');

    const bkMeta = getBkMetaVoorRichting(klas.richting);
    if (!bkMeta) return res.status(404).send('Geen beroepskwalificaties gekoppeld aan deze richting.');

    const leerplanUuid = await db.getKlasLeerplan(leerling.klas_id);
    if (!leerplanUuid) return res.status(400).send('Geen leerplan gekoppeld aan deze klas');

    const doelen     = await llinkid.getDoelen(leerplanUuid);
    const resultaten = await db.getLpdResultaten(leerlingId);
    const bkStats    = berekenStats(doelen, resultaten);
    const buffer     = await genereerBkExcelAttest(leerling, klas, bkStats, bkMeta);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bk_attest_${leerling.voornaam}_${leerling.naam}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export BK Excel error:', error);
    res.status(500).send(`Fout bij genereren BK Excel-attest: ${error.message}`);
  }
});

module.exports = router;
