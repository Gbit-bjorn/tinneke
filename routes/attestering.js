'use strict';

const router = require('express').Router();
const { loginRequired } = require('../middleware/auth');
const { db } = require('../lib');
const { LLinkidClient } = require('../lib/llinkid');

const client = new LLinkidClient();

// ---------------------------------------------------------------------------
// Helper: bouw BK/DPK/LPD stats op uit LLinkid-doelen + DB-resultaten
// ---------------------------------------------------------------------------

/**
 * Groepeer LLinkid-doelen in BK/DPK secties en bereken behaald-stats.
 *
 * Structuur van doelen (uit LLinkidClient.getDoelen):
 *   { key, type, titel, nr, depth, is_goal, is_section, parentKey }
 *
 * Aanname leerplan-hiërarchie:
 *   depth 0 → BK-sectie  (basiscompetentie)
 *   depth 1 → DPK-sectie (deelproces/component)
 *   depth 2+ → goal (LPD)
 *
 * @param {Array}  doelen     Resultaat van LLinkidClient.getDoelen(uuid)
 * @param {Object} resultaten { [lpdUuid]: boolean }  — huidige DB-status
 * @returns {Array} bkSecties
 */
function _berekenStats(doelen, resultaten) {
  // Bouw een snelle key → node map
  const nodeMap = new Map(doelen.map(d => [d.key, d]));

  // Verzamel BK-secties (depth 0, is_section)
  const bkNodes = doelen.filter(d => d.is_section && d.depth === 0);

  // Hulp: geef directe kinderen van een node-key
  function kinderen(parentKey) {
    return doelen.filter(d => d.parentKey === parentKey);
  }

  const bkSecties = bkNodes.map(bk => {
    // DPK-secties: directe kinderen die zelf section zijn
    const dpkNodes = kinderen(bk.key).filter(d => d.is_section);

    const dpkSecties = dpkNodes.map(dpk => {
      // LPDs: goals die een DPK als parent hebben (direct of via tussenlaag)
      // We verzamelen recursief alle goals onder dit DPK
      const lpdsRaw = _alleGoalsOnder(dpk.key, doelen);

      const lpds = lpdsRaw.map(lpd => ({
        key:    lpd.key,
        titel:  lpd.titel,
        nr:     lpd.nr,
        behaald: resultaten[lpd.key] === true,
      }));

      const totaal   = lpds.length;
      const behaald  = lpds.filter(l => l.behaald).length;
      const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

      return {
        key:   dpk.key,
        titel: dpk.titel,
        stats: { totaal, behaald, percentage },
        lpds,
      };
    });

    // BK-totalen = som van alle DPK-totalen
    const totaal   = dpkSecties.reduce((s, d) => s + d.stats.totaal, 0);
    const behaald  = dpkSecties.reduce((s, d) => s + d.stats.behaald, 0);
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

    return {
      key:   bk.key,
      titel: bk.titel,
      stats: { totaal, behaald, percentage },
      dpkSecties,
    };
  });

  return bkSecties;
}

/**
 * Verzamel recursief alle goals (LPDs) die onder een sectie vallen.
 * @param {string} rootKey
 * @param {Array}  doelen
 * @returns {Array}
 */
function _alleGoalsOnder(rootKey, doelen) {
  const resultaten = [];
  for (const d of doelen) {
    if (d.parentKey === rootKey) {
      if (d.is_goal) {
        resultaten.push(d);
      } else if (d.is_section) {
        resultaten.push(..._alleGoalsOnder(d.key, doelen));
      }
    }
  }
  return resultaten;
}

// ---------------------------------------------------------------------------
// GET /attestering/:leerlingId
// ---------------------------------------------------------------------------

router.get('/:leerlingId', loginRequired, async (req, res) => {
  const leerlingId = parseInt(req.params.leerlingId, 10);
  if (isNaN(leerlingId)) return res.status(400).send('Ongeldig leerling-id');

  const leerling = db.getLeerling(leerlingId);
  if (!leerling) return res.status(404).send('Leerling niet gevonden');

  const klas = db.getKlas(leerling.klas_id);
  const leerplanUuid = db.getKlasLeerplan(leerling.klas_id);

  let bkSecties = [];

  if (leerplanUuid) {
    try {
      const doelen     = await client.getDoelen(leerplanUuid);
      const resultaten = db.getLpdResultaten(leerlingId);
      bkSecties = _berekenStats(doelen, resultaten);
    } catch (err) {
      console.error('LLinkid fout bij getDoelen:', err.message);
      // Render met lege secties + foutmelding
    }
  }

  res.render('attestering/detail', {
    leerling: { id: leerling.id, naam: leerling.naam, voornaam: leerling.voornaam },
    klas:     { naam: klas?.naam ?? '—', richting: klas?.richting ?? '' },
    bkSecties,
    leerplanUuid: leerplanUuid ?? null,
  });
});

// ---------------------------------------------------------------------------
// POST /attestering/:leerlingId/toggle  (JSON AJAX)
// ---------------------------------------------------------------------------

router.post('/:leerlingId/toggle', loginRequired, (req, res) => {
  const leerlingId = parseInt(req.params.leerlingId, 10);
  if (isNaN(leerlingId)) return res.status(400).json({ success: false, error: 'Ongeldig id' });

  const { lpdUuid, behaald } = req.body;
  if (!lpdUuid || typeof behaald === 'undefined') {
    return res.status(400).json({ success: false, error: 'Ontbrekende velden' });
  }

  try {
    db.toggleLpd(leerlingId, lpdUuid, Boolean(behaald));
    const resultaten = db.getLpdResultaten(leerlingId);

    // Herbereken stats op basis van het leerplan van de klas
    const leerling     = db.getLeerling(leerlingId);
    const leerplanUuid = leerling ? db.getKlasLeerplan(leerling.klas_id) : null;

    // Stats worden synchroon opgeslagen; we sturen de bijgewerkte resultaten terug
    // zodat de frontend de voortgangsbalken kan updaten zonder de volledige doelen te kennen.
    res.json({ success: true, resultaten });
  } catch (err) {
    console.error('Toggle fout:', err.message);
    res.status(500).json({ success: false, error: 'Opslaan mislukt' });
  }
});

// ---------------------------------------------------------------------------
// POST /attestering/:leerlingId/opslaan  (formulier bulk-save)
// ---------------------------------------------------------------------------

router.post('/:leerlingId/opslaan', loginRequired, (req, res) => {
  const leerlingId = parseInt(req.params.leerlingId, 10);
  if (isNaN(leerlingId)) return res.status(400).send('Ongeldig leerling-id');

  // Het formulier stuurt: lpd_<uuid> = 'on' voor aangevinkte checkboxen
  // Niet-aangevinkte checkboxen worden niet meegestuurd → behaald = false
  const body = req.body || {};

  // Verzamel alle LPD UUIDs die in het formulier aanwezig waren
  const alleUuids = Object.keys(body)
    .filter(k => k.startsWith('lpd_'))
    .map(k => k.replace(/^lpd_/, ''));

  const resultaten = {};
  for (const uuid of alleUuids) {
    resultaten[uuid] = body[`lpd_${uuid}`] === 'on';
  }

  try {
    db.bulkSaveLpd(leerlingId, resultaten);
  } catch (err) {
    console.error('Bulk save fout:', err.message);
  }

  res.redirect(`/attestering/${leerlingId}`);
});

// ---------------------------------------------------------------------------
// GET /attestering/:leerlingId/status  (JSON)
// ---------------------------------------------------------------------------

router.get('/:leerlingId/status', loginRequired, (req, res) => {
  const leerlingId = parseInt(req.params.leerlingId, 10);
  if (isNaN(leerlingId)) return res.status(400).json({ error: 'Ongeldig id' });

  try {
    const resultaten = db.getLpdResultaten(leerlingId);
    res.json({ success: true, resultaten });
  } catch (err) {
    console.error('Status fout:', err.message);
    res.status(500).json({ success: false, error: 'Ophalen mislukt' });
  }
});

module.exports = router;
