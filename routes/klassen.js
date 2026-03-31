'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const multer  = require('multer');

const { loginRequired } = require('../middleware/auth');
const { db }            = require('../lib');

// Multer — bewaar upload tijdelijk in geheugen (max 2 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.txt' || file.mimetype === 'text/csv' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Alleen .csv of .txt bestanden zijn toegestaan.'));
    }
  },
});

// Helper: flash-melding via sessie doorgeven
function flash(req, type, message) {
  req.session.flash = { [type]: message };
}

// Helper: haal en verwijder flash-melding uit sessie
function consumeFlash(req) {
  const f = req.session.flash || {};
  delete req.session.flash;
  return f;
}

// ── GET / → dashboard (redirect naar /klassen) ──────────────────────────────
// Afgehandeld in app.js: app.get('/', ...) → redirect /klassen

// ── GET /klassen → dashboard ─────────────────────────────────────────────────
router.get('/', loginRequired, (req, res) => {
  
  const klassen = db.getKlassen();
  const huidigJaar = new Date().getFullYear();

  res.render('dashboard', {
    title:     'Dashboard',
    activePage:'klassen',
    klassen,
    schooljaar: huidigJaar,
    flash:     consumeFlash(req),
  });
});

// ── GET /klassen/nieuw ────────────────────────────────────────────────────────
router.get('/nieuw', loginRequired, (req, res) => {
  res.render('klassen/nieuw', {
    title:     'Nieuwe klas',
    activePage:'klassen',
    error:     null,
    formData:  {},
    flash:     consumeFlash(req),
  });
});

// ── POST /klassen/nieuw ───────────────────────────────────────────────────────
router.post('/nieuw', loginRequired, (req, res) => {
  
  const { naam, richting, schooljaar } = req.body;

  // Validatie
  if (!naam || !naam.trim()) {
    return res.render('klassen/nieuw', {
      title:     'Nieuwe klas',
      activePage:'klassen',
      error:     'Klasnaam is verplicht.',
      formData:  req.body,
      flash:     {},
    });
  }

  const jaar = parseInt(schooljaar, 10);
  if (!jaar || jaar < 2020 || jaar > 2040) {
    return res.render('klassen/nieuw', {
      title:     'Nieuwe klas',
      activePage:'klassen',
      error:     'Voer een geldig schooljaar in (bijv. 2024).',
      formData:  req.body,
      flash:     {},
    });
  }

  try {
    const id = db.createKlas(naam.trim(), (richting || '').trim(), jaar);
    flash(req, 'success', `Klas "${naam.trim()}" aangemaakt.`);
    res.redirect(`/klassen/${id}`);
  } catch (err) {
    // UNIQUE constraint → klas bestaat al
    const boodschap = err.message && err.message.includes('UNIQUE')
      ? `Er bestaat al een klas "${naam.trim()}" voor schooljaar ${jaar}–${jaar + 1}.`
      : 'Er is iets misgegaan bij het aanmaken van de klas.';

    res.render('klassen/nieuw', {
      title:     'Nieuwe klas',
      activePage:'klassen',
      error:     boodschap,
      formData:  req.body,
      flash:     {},
    });
  }
});

// ── GET /klassen/:id ──────────────────────────────────────────────────────────
router.get('/:id', loginRequired, (req, res) => {
  
  const klasId = parseInt(req.params.id, 10);
  const klas  = db.getKlas(klasId);

  if (!klas) {
    return res.status(404).send('Klas niet gevonden.');
  }

  const leerlingen  = db.getLeerlingen(klasId);
  const leerplanUuid = db.getKlasLeerplan(klasId);

  res.render('klassen/detail', {
    title:      klas.naam,
    activePage: 'klassen',
    klas,
    leerlingen,
    leerplanUuid,
    flash:      consumeFlash(req),
  });
});

// ── GET /klassen/:id/importeer ────────────────────────────────────────────────
router.get('/:id/importeer', loginRequired, (req, res) => {
  
  const klasId = parseInt(req.params.id, 10);
  const klas  = db.getKlas(klasId);

  if (!klas) {
    return res.status(404).send('Klas niet gevonden.');
  }

  res.render('klassen/import_csv', {
    title:     `CSV importeren — ${klas.naam}`,
    activePage:'klassen',
    klas,
    error:     null,
    flash:     consumeFlash(req),
  });
});

// ── POST /klassen/:id/importeer ───────────────────────────────────────────────
router.post('/:id/importeer', loginRequired, (req, res, next) => {
  // Multer middleware inline aanroepen zodat we de fout netjes kunnen tonen
  upload.single('csv_file')(req, res, (multerErr) => {
    
    const klasId = parseInt(req.params.id, 10);
    const klas   = db.getKlas(klasId);

    if (!klas) {
      return res.status(404).send('Klas niet gevonden.');
    }

    const renderError = (msg) => res.render('klassen/import_csv', {
      title:     `CSV importeren — ${klas.naam}`,
      activePage:'klassen',
      klas,
      error:     msg,
      flash:     {},
    });

    if (multerErr) {
      return renderError(multerErr.message);
    }

    // Bepaal bron: bestand of textarea
    let csvContent = '';
    if (req.file && req.file.buffer.length > 0) {
      csvContent = req.file.buffer.toString('utf-8');
    } else if (req.body.csv_text && req.body.csv_text.trim()) {
      csvContent = req.body.csv_text;
    } else {
      return renderError('Kies een bestand of plak CSV-tekst.');
    }

    try {
      // Verwijder eerst bestaande leerlingen
      db.deleteLeerlingen(klasId);
      const aantal = db.importLeerlingenCsv(csvContent, klasId);
      flash(req, 'success', `${aantal} leerling${aantal !== 1 ? 'en' : ''} succesvol geïmporteerd.`);
      res.redirect(`/klassen/${klasId}`);
    } catch (err) {
      renderError(err.message || 'Fout bij het verwerken van de CSV.');
    }
  });
});

// ── POST /klassen/:id/leerplan ────────────────────────────────────────────────
router.post('/:id/leerplan', loginRequired, (req, res) => {
  
  const klasId = parseInt(req.params.id, 10);
  const klas   = db.getKlas(klasId);

  if (!klas) {
    return res.status(404).send('Klas niet gevonden.');
  }

  const { leerplan_uuid } = req.body;
  const uuid = (leerplan_uuid || '').trim();

  // Eenvoudige UUID-validatie
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid || !uuidRegex.test(uuid)) {
    flash(req, 'error', 'Ongeldig UUID-formaat. Verwacht: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    return res.redirect(`/klassen/${klasId}`);
  }

  try {
    db.setKlasLeerplan(klasId, uuid);
    flash(req, 'success', 'Leerplan succesvol gekoppeld.');
  } catch (err) {
    flash(req, 'error', 'Kon leerplan niet koppelen.');
  }

  res.redirect(`/klassen/${klasId}`);
});

module.exports = router;
