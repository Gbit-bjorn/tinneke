'use strict';

const router = require('express').Router();
const { loginRequired } = require('../middleware/auth');
const { db, llinkid } = require('../lib');
const { berekenStats } = require('../lib/stats');

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

  // Vorige/volgende leerling in dezelfde klas
  const klasgenoten      = await db.getLeerlingen(leerling.klas_id);
  const huidigeIndex     = klasgenoten.findIndex(l => l.id === leerlingId);
  const vorigeLeerling   = huidigeIndex > 0
    ? { id: klasgenoten[huidigeIndex - 1].id, naam: klasgenoten[huidigeIndex - 1].voornaam + ' ' + klasgenoten[huidigeIndex - 1].naam }
    : null;
  const volgendeLeerling = huidigeIndex < klasgenoten.length - 1
    ? { id: klasgenoten[huidigeIndex + 1].id, naam: klasgenoten[huidigeIndex + 1].voornaam + ' ' + klasgenoten[huidigeIndex + 1].naam }
    : null;

  let bkSecties = [];
  let llinkidFout = null;

  if (leerplanUuid) {
    try {
      const doelen     = await llinkid.getDoelen(leerplanUuid);
      const resultaten = await db.getLpdResultaten(leerlingId);
      bkSecties = berekenStats(doelen, resultaten);
    } catch (err) {
      console.error('LLinkid fout bij getDoelen:', err.message);
      llinkidFout = err.message;
    }
  }

  res.render('attestering/detail', {
    leerling:     { id: leerling.id, naam: leerling.naam, voornaam: leerling.voornaam },
    klas:         { naam: klas?.naam ?? '—', richting: klas?.richting ?? '' },
    klasId:       leerling.klas_id,
    bkSecties,
    leerplanUuid: leerplanUuid ?? null,
    llinkidFout,
    vorigeLeerling,
    volgendeLeerling,
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

