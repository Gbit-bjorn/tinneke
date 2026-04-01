'use strict';

const express  = require('express');
const bcrypt   = require('bcrypt');
const router   = express.Router();
const { db }   = require('../lib');
const { loginRequired, superadminRequired } = require('../middleware/auth');

// Alle /admin routes vereisen login + superadmin
router.use(loginRequired, superadminRequired);

// GET /admin/gebruikers — overzicht van alle gebruikers
router.get('/gebruikers', async (req, res) => {
  try {
    const users = await db.getUsers();
    res.render('admin/gebruikers', {
      title:  'Gebruikersbeheer',
      users,
      flash:  res.locals.flash,
    });
  } catch (err) {
    console.error('[admin] Fout bij ophalen users:', err.message);
    res.status(500).send('Fout bij ophalen gebruikers.');
  }
});

// POST /admin/gebruikers/nieuw — nieuwe gebruiker aanmaken
router.post('/gebruikers/nieuw', async (req, res) => {
  const { username, naam, rol, wachtwoord } = req.body;
  const geldigeRollen = ['superadmin', 'admin', 'leerkracht'];

  if (!username || !naam || !wachtwoord || !geldigeRollen.includes(rol)) {
    req.session.flash = { error: 'Alle velden zijn verplicht en de rol moet geldig zijn.' };
    return res.redirect('/admin/gebruikers');
  }

  try {
    const bestaand = await db.getUserByUsername(username);
    if (bestaand) {
      req.session.flash = { error: `Gebruikersnaam '${username}' bestaat al.` };
      return res.redirect('/admin/gebruikers');
    }

    const hash = await bcrypt.hash(wachtwoord, 12);
    await db.createUser(username, hash, naam, rol);
    req.session.flash = { success: `Gebruiker '${naam}' aangemaakt.` };
    res.redirect('/admin/gebruikers');
  } catch (err) {
    console.error('[admin] Fout bij aanmaken user:', err.message);
    req.session.flash = { error: 'Fout bij aanmaken gebruiker.' };
    res.redirect('/admin/gebruikers');
  }
});

// POST /admin/gebruikers/:id/rol — rol wijzigen
router.post('/gebruikers/:id/rol', async (req, res) => {
  const { id } = req.params;
  const { rol } = req.body;
  const geldigeRollen = ['superadmin', 'admin', 'leerkracht'];

  if (!geldigeRollen.includes(rol)) {
    req.session.flash = { error: 'Ongeldige rol.' };
    return res.redirect('/admin/gebruikers');
  }

  // Voorkom dat de enige superadmin zichzelf degradeert
  if (String(req.user?.id) === String(id) && rol !== 'superadmin') {
    const superadmins = (await db.getUsers()).filter(u => u.rol === 'superadmin' && u.actief);
    if (superadmins.length <= 1) {
      req.session.flash = { error: 'Je kunt jezelf niet degraderen — er moet minstens één superadmin actief blijven.' };
      return res.redirect('/admin/gebruikers');
    }
  }

  try {
    await db.updateUserRol(id, rol);
    req.session.flash = { success: 'Rol bijgewerkt.' };
    res.redirect('/admin/gebruikers');
  } catch (err) {
    console.error('[admin] Fout bij wijzigen rol:', err.message);
    req.session.flash = { error: 'Fout bij wijzigen rol.' };
    res.redirect('/admin/gebruikers');
  }
});

// POST /admin/gebruikers/:id/actief — actief/inactief toggling
router.post('/gebruikers/:id/actief', async (req, res) => {
  const { id } = req.params;
  const actief = req.body.actief === '1';

  // Voorkom dat superadmin zichzelf deactiveert
  if (String(req.user?.id) === String(id) && !actief) {
    req.session.flash = { error: 'Je kunt je eigen account niet deactiveren.' };
    return res.redirect('/admin/gebruikers');
  }

  try {
    await db.updateUserActief(id, actief);
    req.session.flash = { success: actief ? 'Gebruiker geactiveerd.' : 'Gebruiker gedeactiveerd.' };
    res.redirect('/admin/gebruikers');
  } catch (err) {
    console.error('[admin] Fout bij wijzigen actief-status:', err.message);
    req.session.flash = { error: 'Fout bij wijzigen status.' };
    res.redirect('/admin/gebruikers');
  }
});

// POST /admin/gebruikers/:id/wachtwoord — wachtwoord resetten
router.post('/gebruikers/:id/wachtwoord', async (req, res) => {
  const { id }        = req.params;
  const { wachtwoord } = req.body;

  if (!wachtwoord || wachtwoord.length < 4) {
    req.session.flash = { error: 'Wachtwoord moet minstens 4 tekens bevatten.' };
    return res.redirect('/admin/gebruikers');
  }

  try {
    const hash = await bcrypt.hash(wachtwoord, 12);
    await db.updateUserPassword(id, hash);
    req.session.flash = { success: 'Wachtwoord bijgewerkt.' };
    res.redirect('/admin/gebruikers');
  } catch (err) {
    console.error('[admin] Fout bij reset wachtwoord:', err.message);
    req.session.flash = { error: 'Fout bij bijwerken wachtwoord.' };
    res.redirect('/admin/gebruikers');
  }
});

module.exports = router;
