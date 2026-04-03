'use strict';

const path   = require('path');
const fs     = require('fs');
const router = require('express').Router();

const { adminRequired } = require('../middleware/auth');
const { db }            = require('../lib');

// Pad naar de richting→BK-mapping op schijf
const MAPPING_PAD = path.join(__dirname, '..', 'richting_bk_mapping.json');

// ---------------------------------------------------------------------------
// Hulpfunctie: laad de mapping uit JSON (synchroon, klein bestand)
// ---------------------------------------------------------------------------
function laadMapping() {
  try {
    const inhoud = fs.readFileSync(MAPPING_PAD, 'utf8');
    return JSON.parse(inhoud);
  } catch (err) {
    console.error('[BK] Mapping laden mislukt:', err.message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Hulpfuncties voor flash-berichten
// ---------------------------------------------------------------------------
function flash(req, type, bericht) {
  req.session.flash = { [type]: bericht };
}

function consumeFlash(req) {
  const f = req.session.flash || {};
  delete req.session.flash;
  return f;
}

// ---------------------------------------------------------------------------
// GET /bk
// Overzichtspagina van alle BK's in het systeem met gekoppelde richtingen
// ---------------------------------------------------------------------------
router.get('/', adminRequired, async (req, res) => {
  try {
    const mapping = laadMapping();

    // Bouw een gededupliceerde lijst van unieke BK's met hun richtingen
    const bkMap = new Map();

    for (const [richting, data] of Object.entries(mapping)) {
      if (richting === '_info') continue;
      for (const bk of (data.bks || [])) {
        if (!bkMap.has(bk.code)) {
          bkMap.set(bk.code, {
            code:      bk.code,
            naam:      bk.naam,
            niveau:    bk.niveau,
            dbks:      bk.dbks || [],
            richtingen: [],
          });
        }
        bkMap.get(bk.code).richtingen.push(richting);
      }
    }

    const bks = Array.from(bkMap.values())
      .sort((a, b) => a.code.localeCompare(b.code));

    res.render('bk/index', {
      title:      'Beroepskwalificaties',
      activePage: 'bk',
      bks,
      flash:      consumeFlash(req),
    });
  } catch (err) {
    console.error('[BK] Overzicht fout:', err.message);
    res.status(500).send('Fout bij laden van beroepskwalificaties.');
  }
});

// ---------------------------------------------------------------------------
// POST /bk/sync
// Herlaad de richting_bk_mapping.json en sla de BK-gegevens opnieuw op
// Admin only — stuurt terug met een flash-bericht
// ---------------------------------------------------------------------------
router.post('/sync', adminRequired, async (req, res) => {
  try {
    const mapping = laadMapping();
    let aantalBks = 0;

    for (const [richting, data] of Object.entries(mapping)) {
      if (richting === '_info') continue;
      for (const bk of (data.bks || [])) {
        // 1. Sla de BK zelf op en haal het numerieke ID terug
        const bkId = await db.upsertBeroepskwalificatie(
          bk.code,
          bk.naam,
          bk.niveau ?? null,
          null   // versieCode — niet aanwezig in de JSON-mapping
        );

        // 2. Sla elke DBK op, gekoppeld aan het BK-ID
        for (const dbk of (bk.dbks || [])) {
          await db.upsertDeelberoepskwalificatie(dbk.code, dbk.naam, bkId);
        }

        // 3. Koppel de richting aan de BK
        await db.koppelRichtingBk(richting, bkId, true);

        aantalBks++;
      }
    }

    flash(req, 'success', `Sync voltooid: ${aantalBks} beroepskwalificatie(s) bijgewerkt.`);
  } catch (err) {
    console.error('[BK] Sync fout:', err.message);
    flash(req, 'error', `Sync mislukt: ${err.message}`);
  }

  res.redirect('/bk');
});

// ---------------------------------------------------------------------------
// GET /bk/richting/:richting
// JSON API: geeft de BK's terug voor een specifieke richting
// Geeft { bks: [] } als er geen mapping bestaat
// ---------------------------------------------------------------------------
router.get('/richting/:richting', adminRequired, (req, res) => {
  try {
    const richting = decodeURIComponent(req.params.richting).trim();
    const mapping  = laadMapping();
    const data     = mapping[richting];

    if (!data) {
      return res.json({ bks: [] });
    }

    res.json({ bks: data.bks || [] });
  } catch (err) {
    console.error('[BK] Richting API fout:', err.message);
    res.status(500).json({ bks: [], error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /bk/:bkId/mapping/:leerplanUuid
// Mapping-UI: LPD-doelen (links) tegenover competentiecomponenten (rechts)
// Admin kan via drag-and-drop of checkboxes koppelingen aanmaken
// ---------------------------------------------------------------------------
router.get('/:bkId/mapping/:leerplanUuid', adminRequired, async (req, res) => {
  const { bkId, leerplanUuid } = req.params;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(leerplanUuid)) {
    return res.status(400).send('Ongeldig leerplan-UUID formaat.');
  }

  try {
    // Haal BK-details op uit de mapping (of eventueel later uit de database)
    const mapping = laadMapping();
    let gevondenBk = null;

    for (const data of Object.values(mapping)) {
      if (!data.bks) continue;
      const treffer = data.bks.find(b => b.code === bkId);
      if (treffer) { gevondenBk = treffer; break; }
    }

    if (!gevondenBk) {
      return res.status(404).send(`BK "${bkId}" niet gevonden in de mapping.`);
    }

    // Zet de BK-code om naar een numeriek database-ID
    const bkRecord = await db.getBkByCode(bkId);

    // Haal bestaande LPD→competentie-koppelingen op uit de database
    // Als de BK nog niet gesynct is, geef een lege lijst terug
    const bestaandeMappings = bkRecord
      ? await db.getLpdCompetentieMapping(bkRecord.id)
      : [];

    res.render('bk/mapping', {
      title:            `Mapping: ${gevondenBk.naam}`,
      activePage:       'bk',
      bk:               gevondenBk,
      leerplanUuid,
      bestaandeMappings,
      flash:            consumeFlash(req),
    });
  } catch (err) {
    console.error('[BK] Mapping UI fout:', err.message);
    res.status(500).send('Fout bij laden van de mapping-pagina.');
  }
});

// ---------------------------------------------------------------------------
// GET /bk/:id
// Detailpagina van één BK: toont DBK's en competentiecomponenten
// ---------------------------------------------------------------------------
router.get('/:id', adminRequired, async (req, res) => {
  const bkCode = req.params.id;

  try {
    const mapping = laadMapping();
    let gevondenBk  = null;
    let richting    = null;

    for (const [richt, data] of Object.entries(mapping)) {
      if (richt === '_info') continue;
      const treffer = (data.bks || []).find(b => b.code === bkCode);
      if (treffer) {
        gevondenBk = treffer;
        richting   = richt;
        break;
      }
    }

    if (!gevondenBk) {
      return res.status(404).send(`BK "${bkCode}" niet gevonden.`);
    }

    // Zet de BK-code om naar een numeriek database-ID en haal competenties op
    let competenties = [];
    try {
      const bkRecord = await db.getBkByCode(bkCode);
      if (bkRecord) {
        competenties = await db.getCompetenties(bkRecord.id);
      }
    } catch (_) {
      // Valt terug op lege array als tabel nog niet bestaat
    }

    res.render('bk/detail', {
      title:       `${gevondenBk.naam} (${gevondenBk.code})`,
      activePage:  'bk',
      bk:          gevondenBk,
      richting,
      competenties,
      flash:       consumeFlash(req),
    });
  } catch (err) {
    console.error('[BK] Detail fout:', err.message);
    res.status(500).send('Fout bij laden van BK-details.');
  }
});

// ---------------------------------------------------------------------------
// POST /bk/:bkId/mapping
// Sla LPD→competentie-koppelingen op in de database
// Body: { mappings: [{ lpdUuid, competentieId }], verwijderd?: [{ lpdUuid, competentieId }] }
// Admin only
// ---------------------------------------------------------------------------
router.post('/:bkId/mapping', adminRequired, async (req, res) => {
  const { bkId } = req.params;
  const { mappings, verwijderd = [] } = req.body;

  if (!Array.isArray(mappings)) {
    return res.status(400).json({ ok: false, error: '"mappings" moet een array zijn.' });
  }

  // Valideer elke mapping-entry
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const entry of mappings) {
    if (!entry.lpdUuid || !uuidRegex.test(entry.lpdUuid)) {
      return res.status(400).json({ ok: false, error: `Ongeldig lpdUuid: ${entry.lpdUuid}` });
    }
    if (!entry.competentieId) {
      return res.status(400).json({ ok: false, error: 'competentieId ontbreekt.' });
    }
  }

  // Controleer ook de te verwijderen entries
  if (!Array.isArray(verwijderd)) {
    return res.status(400).json({ ok: false, error: '"verwijderd" moet een array zijn.' });
  }

  try {
    // Zet de BK-code om naar een numeriek database-ID (vereist voor context,
    // de koppelingen zelf gebruiken alleen lpdUuid en competentieId)
    const bkRecord = await db.getBkByCode(bkId);
    if (!bkRecord) {
      return res.status(404).json({ ok: false, error: `BK "${bkId}" niet gevonden in de database. Voer eerst een sync uit.` });
    }

    // Verwijder de aangegeven koppelingen
    for (const entry of verwijderd) {
      if (entry.lpdUuid && entry.competentieId) {
        await db.ontkoppelLpdCompetentie(entry.lpdUuid, entry.competentieId);
      }
    }

    // Sla elke nieuwe/bijgewerkte koppeling op
    for (const entry of mappings) {
      await db.koppelLpdCompetentie(
        entry.lpdUuid,
        entry.competentieId,
        entry.gewicht ?? 1.0
      );
    }

    res.json({ ok: true, opgeslagen: mappings.length, verwijderd: verwijderd.length });
  } catch (err) {
    console.error('[BK] Mapping opslaan fout:', err.message);
    res.status(500).json({ ok: false, error: 'Opslaan mislukt.' });
  }
});

module.exports = router;
