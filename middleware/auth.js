'use strict';

/**
 * Auth middleware voor sessie- en rolcontrole.
 *
 * req.user wordt gezet door de globale middleware in app.js
 * op basis van req.session.user.
 */

function loginRequired(req, res, next) {
  if (req.session.loggedIn) {
    return next();
  }
  res.redirect('/auth/login');
}

/**
 * Vereist rol 'admin' of 'superadmin'.
 * Gebruik na loginRequired.
 */
function adminRequired(req, res, next) {
  const rol = req.session.user?.rol;
  if (rol === 'admin' || rol === 'superadmin') {
    return next();
  }
  res.status(403).render('error', {
    title:   'Geen toegang',
    bericht: 'Je hebt geen beheerdersrechten om deze pagina te bekijken.',
  });
}

/**
 * Vereist rol 'superadmin'.
 * Gebruik na loginRequired.
 */
function superadminRequired(req, res, next) {
  const rol = req.session.user?.rol;
  if (rol === 'superadmin') {
    return next();
  }
  res.status(403).render('error', {
    title:   'Geen toegang',
    bericht: 'Enkel de superadmin heeft toegang tot deze pagina.',
  });
}

module.exports = { loginRequired, adminRequired, superadminRequired };
