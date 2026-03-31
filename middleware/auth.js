function loginRequired(req, res, next) {
  if (req.session.loggedIn) {
    return next();
  }
  res.redirect('/auth/login');
}

module.exports = { loginRequired };
