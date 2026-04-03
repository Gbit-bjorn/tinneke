'use strict';

const router = require('express').Router();
const { loginRequired } = require('../middleware/auth');
const { db, llinkid } = require('../lib');
const { berekenStats, flattenBkHierarchy } = require('../lib/stats');
const { genereerHtmlAttest, genereerExcelAttest, genereerExcelKlas } = require('../lib/export');

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

module.exports = router;
