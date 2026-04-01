'use strict';

const router = require('express').Router();
const { loginRequired } = require('../middleware/auth');
const { llinkid: client } = require('../lib');

// ---------------------------------------------------------------------------
// GET /llinkid/
// Leerplannen-browser met optionele zoekbalk
// ---------------------------------------------------------------------------
router.get('/', loginRequired, async (req, res) => {
  const zoekterm = req.query.q || '';
  try {
    const leerplannen = await client.getLeerplannen(zoekterm || null);
    res.render('llinkid/index', {
      title: 'LLinkid Leerplannen',
      leerplannen,
      zoekterm,
      error: null,
    });
  } catch (err) {
    console.error('[LLinkid] getLeerplannen fout:', err.message);
    res.render('llinkid/index', {
      title: 'LLinkid Leerplannen',
      leerplannen: [],
      zoekterm,
      error: 'Kon leerplannen niet ophalen. Probeer opnieuw.',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /llinkid/api/suggesties?q=...
// JSON autocomplete-endpoint: geeft tot 8 matching leerplannen terug
// ---------------------------------------------------------------------------
router.get('/api/suggesties', loginRequired, async (req, res) => {
  const zoekterm = (req.query.q || '').trim();
  if (zoekterm.length < 2) return res.json([]);
  try {
    const alle = await client.getLeerplannen(zoekterm);
    const suggesties = alle.slice(0, 8).map(lp => ({
      uuid:  lp.uuid,
      titel: lp.titel || 'Naamloos leerplan',
      identifier: lp.identifier || '',
    }));
    res.json(suggesties);
  } catch (err) {
    console.error('[LLinkid] suggesties fout:', err.message);
    res.json([]);
  }
});

// ---------------------------------------------------------------------------
// GET /llinkid/api/doelen/:uuid
// JSON endpoint voor AJAX (geen loginRequired-check nodig voor dezelfde sessie,
// maar we houden login-check aan voor consistentie)
// ---------------------------------------------------------------------------
router.get('/api/doelen/:uuid', loginRequired, async (req, res) => {
  const { uuid } = req.params;
  try {
    const doelen = await client.getDoelen(uuid);
    res.json({ ok: true, doelen });
  } catch (err) {
    console.error('[LLinkid] getDoelen API fout:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /llinkid/:uuid
// Detailpagina van één leerplan (metadata + preview)
// ---------------------------------------------------------------------------
router.get('/:uuid', loginRequired, async (req, res) => {
  const { uuid } = req.params;
  try {
    const [detail, doelen] = await Promise.all([
      client.getLeerplanDetail(uuid),
      client.getDoelen(uuid),
    ]);
    res.render('llinkid/detail', {
      title: detail.titel || 'Leerplan detail',
      detail,
      doelen,
      error: null,
    });
  } catch (err) {
    console.error('[LLinkid] detail fout:', err.message);
    res.status(500).render('llinkid/detail', {
      title: 'Leerplan detail',
      detail: null,
      doelen: [],
      error: 'Kon het leerplan niet laden.',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /llinkid/:uuid/doelen
// Volledige hiërarchische doelen-pagina
// ---------------------------------------------------------------------------
router.get('/:uuid/doelen', loginRequired, async (req, res) => {
  const { uuid } = req.params;
  try {
    const [detail, doelen] = await Promise.all([
      client.getLeerplanDetail(uuid),
      client.getDoelen(uuid),
    ]);
    res.render('llinkid/doelen', {
      title: `Doelen — ${detail.titel || uuid}`,
      detail,
      doelen,
      error: null,
    });
  } catch (err) {
    console.error('[LLinkid] doelen fout:', err.message);
    res.status(500).render('llinkid/doelen', {
      title: 'Doelen',
      detail: null,
      doelen: [],
      error: 'Kon de doelen niet laden.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /llinkid/:uuid/koppel
// Koppel een leerplan aan een klas
// Body: { klasId }
// ---------------------------------------------------------------------------
router.post('/:uuid/koppel', loginRequired, async (req, res) => {
  const { uuid } = req.params;
  const { klasId } = req.body;

  if (!klasId) {
    return res.status(400).json({ ok: false, error: 'klasId ontbreekt' });
  }

  // TODO: koppeling opslaan in database (wanneer het datamodel beschikbaar is)
  // Tijdelijk: stuur JSON-bevestiging terug zodat de front-end al werkt
  console.log(`[LLinkid] Koppel leerplan ${uuid} aan klas ${klasId}`);
  res.json({ ok: true, uuid, klasId, boodschap: 'Koppeling ontvangen (nog niet opgeslagen).' });
});

module.exports = router;
