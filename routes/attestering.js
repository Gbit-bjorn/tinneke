'use strict';

const router = require('express').Router();
const { loginRequired } = require('../middleware/auth');
const { db } = require('../lib');
const { LLinkidClient } = require('../lib/llinkid');

const client = new LLinkidClient();

// ---------------------------------------------------------------------------
// Helper: bouw BK/DPK/LPD stats op uit LLinkid-doelen + DB-resultaten
// ---------------------------------------------------------------------------

function _berekenStats(doelen, resultaten) {
  const bkNodes = doelen.filter(d => d.is_section && d.depth === 0);

  function kinderen(parentKey) {
    return doelen.filter(d => d.parentKey === parentKey);
  }

  const bkSecties = bkNodes.map(bk => {
    const dpkNodes = kinderen(bk.key).filter(d => d.is_section);

    const dpkSecties = dpkNodes.map(dpk => {
      const lpdsRaw = _alleGoalsOnder(dpk.key, doelen);

      const lpds = lpdsRaw.map(lpd => ({
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

  return bkSecties;
}

function _alleGoalsOnder(rootKey, doelen) {
  const resultaten = [];
  for (const d of doelen) {
    if (d.parentKey === rootKey) {
      if (d.is_goal)         resultaten.push(d);
      else if (d.is_section) resultaten.push(..._alleGoalsOnder(d.key, doelen));
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

  const leerling = await db.getLeerling(leerlingId);
  if (!leerling) return res.status(404).send('Leerling niet gevonden');

  const klas         = await db.getKlas(leerling.klas_id);
  const leerplanUuid = await db.getKlasLeerplan(leerling.klas_id);

  let bkSecties = [];

  if (leerplanUuid) {
    try {
      const doelen     = await client.getDoelen(leerplanUuid);
      const resultaten = await db.getLpdResultaten(leerlingId);
      bkSecties = _berekenStats(doelen, resultaten);
    } catch (err) {
      console.error('LLinkid fout bij getDoelen:', err.message);
    }
  }

  res.render('attestering/detail', {
    leerling:     { id: leerling.id, naam: leerling.naam, voornaam: leerling.voornaam },
    klas:         { naam: klas?.naam ?? '—', richting: klas?.richting ?? '' },
    bkSecties,
    leerplanUuid: leerplanUuid ?? null,
  });
});

// ---------------------------------------------------------------------------
// POST /attestering/:leerlingId/toggle  (JSON AJAX)
// ---------------------------------------------------------------------------

router.post('/:leerlingId/toggle', loginRequired, async (req, res) => {
  const leerlingId = parseInt(req.params.leerlingId, 10);
  if (isNaN(leerlingId)) return res.status(400).json({ success: false, error: 'Ongeldig id' });

  const { lpdUuid, behaald } = req.body;
  if (!lpdUuid || typeof behaald === 'undefined') {
    return res.status(400).json({ success: false, error: 'Ontbrekende velden' });
  }

  try {
    await db.toggleLpd(leerlingId, lpdUuid, Boolean(behaald));
    const resultaten = await db.getLpdResultaten(leerlingId);
    res.json({ success: true, resultaten });
  } catch (err) {
    console.error('Toggle fout:', err.message);
    res.status(500).json({ success: false, error: 'Opslaan mislukt' });
  }
});

// ---------------------------------------------------------------------------
// POST /attestering/:leerlingId/opslaan  (formulier bulk-save)
// ---------------------------------------------------------------------------

router.post('/:leerlingId/opslaan', loginRequired, async (req, res) => {
  const leerlingId = parseInt(req.params.leerlingId, 10);
  if (isNaN(leerlingId)) return res.status(400).send('Ongeldig leerling-id');

  const body     = req.body || {};
  const alleUuids = Object.keys(body)
    .filter(k => k.startsWith('lpd_'))
    .map(k => k.replace(/^lpd_/, ''));

  const resultaten = {};
  for (const uuid of alleUuids) {
    resultaten[uuid] = body[`lpd_${uuid}`] === 'on';
  }

  try {
    await db.bulkSaveLpd(leerlingId, resultaten);
  } catch (err) {
    console.error('Bulk save fout:', err.message);
  }

  res.redirect(`/attestering/${leerlingId}`);
});

// ---------------------------------------------------------------------------
// GET /attestering/:leerlingId/status  (JSON)
// ---------------------------------------------------------------------------

router.get('/:leerlingId/status', loginRequired, async (req, res) => {
  const leerlingId = parseInt(req.params.leerlingId, 10);
  if (isNaN(leerlingId)) return res.status(400).json({ error: 'Ongeldig id' });

  try {
    const resultaten = await db.getLpdResultaten(leerlingId);
    res.json({ success: true, resultaten });
  } catch (err) {
    console.error('Status fout:', err.message);
    res.status(500).json({ success: false, error: 'Ophalen mislukt' });
  }
});

module.exports = router;
