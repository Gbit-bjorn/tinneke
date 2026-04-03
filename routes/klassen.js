'use strict';

const path   = require('path');
const fs     = require('fs');
const express = require('express');
const router  = express.Router();

const { loginRequired, adminRequired } = require('../middleware/auth');
const { db }            = require('../lib');
const { huidigSchooljaar } = require('../lib/schooljaar');

const BK_MAPPING_PAD = path.join(__dirname, '..', 'richting_bk_mapping.json');

function laadBkMapping() {
  try {
    return JSON.parse(fs.readFileSync(BK_MAPPING_PAD, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Geeft de BK's terug voor een richting (of [] als er geen zijn).
 * @param {object} mapping  - de volledige richting_bk_mapping
 * @param {string} richting - richtingsnaam van de klas
 */
function bksVoorRichting(mapping, richting) {
  if (!richting) return [];
  const data = mapping[richting];
  return data ? (data.bks || []) : [];
}

function flash(req, type, message) {
  req.session.flash = { [type]: message };
}

function consumeFlash(req) {
  const f = req.session.flash || {};
  delete req.session.flash;
  return f;
}

// ── GET /klassen ──────────────────────────────────────────────────────────────
router.get('/', loginRequired, async (req, res) => {
  try {
    const klassen    = await db.getKlassen();
    const bkMapping  = laadBkMapping();

    // Bouw een { klasId: aantalBks } object — één keer de mapping laden, geen N+1
    const bkCounts = {};
    for (const klas of klassen) {
      const bks = bksVoorRichting(bkMapping, klas.richting);
      if (bks.length > 0) bkCounts[klas.id] = bks.length;
    }

    res.render('dashboard', {
      title:      'Dashboard',
      activePage: 'klassen',
      klassen,
      bkCounts,
      schooljaar: huidigSchooljaar(),
      flash:      consumeFlash(req),
    });
  } catch (err) {
    console.error('Klassen ophalen mislukt:', err.message);
    res.status(500).send('Databasefout. Probeer opnieuw.');
  }
});

// ── GET /klassen/api/suggesties?q=... ────────────────────────────────────────
// JSON autocomplete-endpoint: geeft matching klassen terug
router.get('/api/suggesties', loginRequired, async (req, res) => {
  const zoekterm = (req.query.q || '').trim().toLowerCase();
  if (zoekterm.length < 1) return res.json([]);
  try {
    const alle = await db.getKlassen();
    const matches = alle
      .filter(k =>
        k.naam.toLowerCase().includes(zoekterm) ||
        (k.richting || '').toLowerCase().includes(zoekterm)
      )
      .slice(0, 6)
      .map(k => ({
        id:       k.id,
        naam:     k.naam,
        richting: k.richting || '',
        schooljaar: k.schooljaar,
      }));
    res.json(matches);
  } catch (err) {
    console.error('[Klassen] suggesties fout:', err.message);
    res.json([]);
  }
});

// ── GET /klassen/api/leerlingen?q=... ────────────────────────────────────────
// JSON autocomplete-endpoint: geeft matching leerlingen terug
router.get('/api/leerlingen', loginRequired, async (req, res) => {
  const zoekterm = (req.query.q || '').trim();
  if (zoekterm.length < 1) return res.json([]);
  try {
    const matches = await db.zoekLeerlingen(zoekterm);
    res.json(matches);
  } catch (err) {
    console.error('[Leerlingen] zoek fout:', err.message);
    res.json([]);
  }
});

// ── GET /klassen/nieuw ────────────────────────────────────────────────────────
router.get('/nieuw', loginRequired, (req, res) => {
  res.render('klassen/nieuw', {
    title:      'Nieuwe klas',
    activePage: 'klassen',
    error:      null,
    formData:   {},
    huidigSchooljaar: huidigSchooljaar(),
    flash:      consumeFlash(req),
  });
});

// ── POST /klassen/nieuw ───────────────────────────────────────────────────────
router.post('/nieuw', loginRequired, async (req, res) => {
  const { naam, richting, schooljaar } = req.body;

  if (!naam || !naam.trim()) {
    return res.render('klassen/nieuw', {
      title:            'Nieuwe klas',
      activePage:       'klassen',
      error:            'Klasnaam is verplicht.',
      formData:         req.body,
      huidigSchooljaar: huidigSchooljaar(),
      flash:            {},
    });
  }

  const jaar = parseInt(schooljaar, 10);
  if (!jaar || jaar < 2020 || jaar > 2040) {
    return res.render('klassen/nieuw', {
      title:            'Nieuwe klas',
      activePage:       'klassen',
      error:            'Voer een geldig schooljaar in (bijv. 2024).',
      formData:         req.body,
      huidigSchooljaar: huidigSchooljaar(),
      flash:            {},
    });
  }

  try {
    const id = await db.createKlas(naam.trim(), (richting || '').trim(), jaar);
    flash(req, 'success', `Klas "${naam.trim()}" aangemaakt.`);
    res.redirect(`/klassen/${id}`);
  } catch (err) {
    const boodschap = err.code === 'ER_DUP_ENTRY'
      ? `Er bestaat al een klas "${naam.trim()}" voor schooljaar ${jaar}–${jaar + 1}.`
      : 'Er is iets misgegaan bij het aanmaken van de klas.';

    res.render('klassen/nieuw', {
      title:            'Nieuwe klas',
      activePage:       'klassen',
      error:            boodschap,
      formData:         req.body,
      huidigSchooljaar: huidigSchooljaar(),
      flash:            {},
    });
  }
});

// ── GET /klassen/:id ──────────────────────────────────────────────────────────
router.get('/:id', loginRequired, async (req, res) => {
  try {
    const klasId = parseInt(req.params.id, 10);
    const klas   = await db.getKlas(klasId);

    if (!klas) return res.status(404).send('Klas niet gevonden.');

    const leerlingen   = await db.getLeerlingen(klasId);
    const leerplanUuid = await db.getKlasLeerplan(klasId);

    // BK's voor de richting van deze klas (leeg array als er geen zijn)
    const bkMapping = laadBkMapping();
    const klasBks   = bksVoorRichting(bkMapping, klas.richting);

    res.render('klassen/detail', {
      title:      klas.naam,
      activePage: 'klassen',
      klas,
      leerlingen,
      leerplanUuid,
      klasBks,
      flash:      consumeFlash(req),
    });
  } catch (err) {
    console.error('Klas detail fout:', err.message);
    res.status(500).send('Databasefout.');
  }
});

// ── POST /klassen/:id/leerplan ────────────────────────────────────────────────
router.post('/:id/leerplan', loginRequired, adminRequired, async (req, res) => {
  try {
    const klasId = parseInt(req.params.id, 10);
    const klas   = await db.getKlas(klasId);

    if (!klas) return res.status(404).send('Klas niet gevonden.');

    const { leerplan_uuid } = req.body;
    const uuid = (leerplan_uuid || '').trim();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid || !uuidRegex.test(uuid)) {
      flash(req, 'error', 'Ongeldig UUID-formaat. Verwacht: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      return res.redirect(`/klassen/${klasId}`);
    }

    await db.setKlasLeerplan(klasId, uuid);
    flash(req, 'success', 'Leerplan succesvol gekoppeld.');
  } catch (err) {
    flash(req, 'error', 'Kon leerplan niet koppelen.');
  }

  res.redirect(`/klassen/${req.params.id}`);
});

module.exports = router;
