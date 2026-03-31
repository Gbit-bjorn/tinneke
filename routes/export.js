'use strict';

const router = require('express').Router();
const { loginRequired } = require('../middleware/auth');
const { db } = require('../lib');
const { LLinkidClient } = require('../lib/llinkid');
const { genereerHtmlAttest, genereerExcelAttest, genereerExcelKlas } = require('../lib/export');

const client = new LLinkidClient();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function berekenStats(doelen, resultaten) {
  const bkNodes = doelen.filter(d => d.is_section && d.depth === 0);

  function kinderen(parentKey) {
    return doelen.filter(d => d.parentKey === parentKey);
  }

  return bkNodes.map(bk => {
    const dpkNodes   = kinderen(bk.key).filter(d => d.is_section);
    const dpkSecties = dpkNodes.map(dpk => {
      const lpdsRaw = alleGoalsOnder(dpk.key, doelen);
      const lpds    = lpdsRaw.map(lpd => ({
        key:     lpd.key,
        titel:   lpd.titel,
        nr:      lpd.nr,
        behaald: resultaten[lpd.key] === true,
      }));
      const totaal     = lpds.length;
      const behaald    = lpds.filter(l => l.behaald).length;
      const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
      return { key: dpk.key, titel: dpk.titel, stats: { totaal, behaald, percentage }, lpds };
    });

    const totaal     = dpkSecties.reduce((s, d) => s + d.stats.totaal, 0);
    const behaald    = dpkSecties.reduce((s, d) => s + d.stats.behaald, 0);
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
    return { key: bk.key, titel: bk.titel, stats: { totaal, behaald, percentage }, dpkSecties };
  });
}

function alleGoalsOnder(rootKey, doelen) {
  const resultaten = [];
  for (const d of doelen) {
    if (d.parentKey === rootKey) {
      if (d.is_goal)         resultaten.push(d);
      else if (d.is_section) resultaten.push(...alleGoalsOnder(d.key, doelen));
    }
  }
  return resultaten;
}

function flattenBkHierarchy(bkSecties) {
  const lpds = [];
  for (const bk of bkSecties) {
    for (const dpk of bk.dpkSecties) {
      for (const lpd of dpk.lpds) {
        lpds.push({ bk: bk.titel, dpk: dpk.titel, lpd: lpd.titel, key: lpd.key, behaald: lpd.behaald });
      }
    }
  }
  return lpds;
}

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

    const doelen     = await client.getDoelen(leerplanUuid);
    const resultaten = await db.getLpdResultaten(leerlingId);
    const bkSecties  = berekenStats(doelen, resultaten);
    const flatLpds   = flattenBkHierarchy(bkSecties);
    const html       = genereerHtmlAttest(leerling, klas, flatLpds, resultaten);

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

    const doelen     = await client.getDoelen(leerplanUuid);
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
// GET /export/klas/:klasId/excel
// ─────────────────────────────────────────────────────────────────────────────

router.get('/klas/:klasId/excel', loginRequired, async (req, res) => {
  try {
    const klasId = parseInt(req.params.klasId, 10);
    if (isNaN(klasId)) return res.status(400).send('Ongeldig klas-id');

    const klas = await db.getKlas(klasId);
    if (!klas) return res.status(404).send('Klas niet gevonden');

    const leerplanUuid = await db.getKlasLeerplan(klasId);
    if (!leerplanUuid) return res.status(400).send('Geen leerplan gekoppeld aan deze klas');

    const doelen    = await client.getDoelen(leerplanUuid);
    const bkNodes   = doelen.filter(d => d.is_section && d.depth === 0);
    const leerlingen = await db.getLeerlingen(klasId);

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

    const buffer = await genereerExcelKlas(klas, leerlingenMetStats, bkNodes);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="klasoverzicht_${klas.naam}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export klas Excel error:', error);
    res.status(500).send(`Fout bij genereren Excel: ${error.message}`);
  }
});

module.exports = router;
