'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { db }  = require('../lib');

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/klassen');
  }
  res.render('auth/login', { error: null, lastUsername: '' });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Probeer eerst de database
    const user = await db.getUserByUsername(username);

    if (user) {
      // Gebruiker gevonden in DB
      if (!user.actief) {
        return res.render('auth/login', {
          error:        'Je account is gedeactiveerd. Contacteer de beheerder.',
          lastUsername: username || '',
        });
      }

      const correct = await bcrypt.compare(password, user.password);
      if (!correct) {
        return res.render('auth/login', {
          error:        'Ongeldige gebruikersnaam of wachtwoord.',
          lastUsername: username || '',
        });
      }

      // Sessie aanmaken
      req.session.loggedIn = true;
      req.session.user = {
        id:       user.id,
        username: user.username,
        naam:     user.naam,
        rol:      user.rol,
      };
      return res.redirect('/klassen');
    }

    // Niets gevonden
    res.render('auth/login', {
      error:        'Ongeldige gebruikersnaam of wachtwoord.',
      lastUsername: username || '',
    });

  } catch (err) {
    console.error('[auth] Login fout:', err.message);
    res.render('auth/login', {
      error:        'Er is een fout opgetreden. Probeer opnieuw.',
      lastUsername: username || '',
    });
  }
});

// POST /auth/logout  (ook GET voor gemak)
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;
