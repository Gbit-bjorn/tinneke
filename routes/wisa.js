'use strict';

/**
 * Routes voor WISA-synchronisatie van klassen en leerlingen.
 *
 * GET  /wisa/sync  — toon synchronisatiepagina
 * POST /wisa/sync  — voer synchronisatie uit vanuit WISA
 */

const express = require('express');
const router  = express.Router();

const { loginRequired } = require('../middleware/auth');
const { WisaClient }    = require('../lib/wisa');
const { db }            = require('../lib');

// ── Hulpfunctie: flash-bericht instellen ─────────────────────────────────────

function flash(req, type, message) {
  req.session.flash = { [type]: message };
}

// ── GET /wisa/sync ────────────────────────────────────────────────────────────

router.get('/sync', loginRequired, async (req, res) => {
  const flashData = req.session.flash || {};
  delete req.session.flash;

  res.render('wisa/sync', {
    title:      'WISA synchronisatie',
    activePage: 'klassen',
    lastSync:   null,
    error:      null,
    flash:      flashData,
  });
});

// ── POST /wisa/sync ───────────────────────────────────────────────────────────

router.post('/sync', loginRequired, async (req, res) => {
  try {
    // Haal werkdatum op uit formulier, of gebruik vandaag
    let werkdatum = null;
    if (req.body.werkdatum && req.body.werkdatum.trim() !== '') {
      // Verwacht formaat: YYYY-MM-DD (HTML date input)
      const parsed = new Date(req.body.werkdatum.trim());
      if (!isNaN(parsed.getTime())) {
        werkdatum = parsed;
      }
    }

    // Haal data op vanuit WISA
    const client = new WisaClient();
    const rijen  = await client.queryKlassenLeerlingen(werkdatum);

    // Geen data ontvangen → waarschuwing tonen
    if (!rijen || rijen.length === 0) {
      flash(req, 'warning', 'WISA gaf geen data terug. Controleer de verbinding en probeer opnieuw.');
      return res.redirect('/wisa/sync');
    }

    // Bepaal schooljaar: gebruik huidig jaar als fallback
    const schooljaar = new Date().getFullYear();

    // Synchroniseer naar de database
    const resultaat = await db.syncWisaKlassenLeerlingen(rijen, schooljaar);

    flash(
      req,
      'success',
      `Synchronisatie geslaagd: ${resultaat.klassen} klassen en ${resultaat.leerlingen} leerlingen geïmporteerd.`
    );
    return res.redirect('/klassen');

  } catch (fout) {
    flash(req, 'error', `Synchronisatie mislukt: ${fout.message}`);
    return res.redirect('/wisa/sync');
  }
});

module.exports = router;
