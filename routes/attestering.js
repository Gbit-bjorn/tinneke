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
  function kinderen(parentKey) {
    return doelen.filter(d => d.parentKey === parentKey);
  }

  // Zoek secties die direct of indirect goals bevatten (ongeacht depth)
  function heeftGoals(sectionKey) {
    const kids = kinderen(sectionKey);
    return kids.some(k => k.is_goal || (k.is_section && heeftGoals(k.key)));
  }

  // Zoek de hoogste secties die goals bevatten als BK-niveau
  const bkNodes = doelen.filter(d => d.is_section && heeftGoals(d.key) &&
    // Alleen secties waarvan de parent GEEN sectie-met-goals is (= topniveau)
    (!d.parentKey || !doelen.find(p => p.key === d.parentKey && p.is_section && heeftGoals(p.key)))
  );

  // Als er geen BK-secties zijn, maak één virtuele sectie met alle goals
  if (bkNodes.length === 0) {
    const alleGoals = doelen.filter(d => d.is_goal && d.nr);
    const lpds = alleGoals.map(g => ({
      key: g.key, titel: g.titel, nr: g.nr, behaald: resultaten[g.key] === true,
    }));
    const totaal = lpds.length, behaald = lpds.filter(l => l.behaald).length;
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
    return [{ key: '_all', titel: 'Doelen', stats: { totaal, behaald, percentage },
      dpkSecties: [{ key: '_all_dpk', titel: 'Alle doelen', stats: { totaal, behaald, percentage }, lpds }] }];
  }

  const bkSecties = bkNodes.map(bk => {
    const dpkNodes = kinderen(bk.key).filter(d => d.is_section);

    // Als de BK-sectie direct goals heeft (zonder DPK-tussenlaag)
    if (dpkNodes.length === 0) {
      const lpdsRaw = _alleGoalsOnder(bk.key, doelen);
      const lpds = lpdsRaw.map(lpd => ({
        key: lpd.key, titel: lpd.titel, nr: lpd.nr, behaald: resultaten[lpd.key] === true,
      }));
      const totaal = lpds.length, behaald = lpds.filter(l => l.behaald).length;
      const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
      return { key: bk.key, titel: bk.titel, stats: { totaal, behaald, percentage },
        dpkSecties: [{ key: bk.key + '_lpd', titel: bk.titel, stats: { totaal, behaald, percentage }, lpds }] };
    }

    const dpkSecties = dpkNodes.map(dpk => {
      const lpdsRaw = _alleGoalsOnder(dpk.key, doelen);
      const lpds = lpdsRaw.map(lpd => ({
        key: lpd.key, titel: lpd.titel, nr: lpd.nr, behaald: resultaten[lpd.key] === true,
      }));
      const totaal = lpds.length, behaald = lpds.filter(l => l.behaald).length;
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
    klasId:       leerling.klas_id,
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
