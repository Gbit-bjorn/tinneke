'use strict';

const express = require('express');
const router  = express.Router();

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/klassen');
  }
  res.render('auth/login', { error: null, lastUsername: '' });
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const expectedUser = process.env.APP_USERNAME;
  const expectedPass = process.env.APP_PASSWORD;

  if (!expectedUser || !expectedPass) {
    console.error('[auth] APP_USERNAME of APP_PASSWORD niet ingesteld in .env');
    return res.render('auth/login', {
      error:        'Serverconfiguratie ontbreekt. Contacteer de beheerder.',
      lastUsername: username || '',
    });
  }

  if (username === expectedUser && password === expectedPass) {
    req.session.loggedIn  = true;
    req.session.username  = username;
    return res.redirect('/klassen');
  }

  res.render('auth/login', {
    error:        'Ongeldige gebruikersnaam of wachtwoord.',
    lastUsername: username || '',
  });
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
