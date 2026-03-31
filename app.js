const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

app.use(session({
  secret: process.env.SECRET_KEY || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Globale flash + login status voor alle views
app.use((req, res, next) => {
  res.locals.flash = res.locals.flash || req.session.flash || {};
  res.locals.loggedIn = !!req.session.loggedIn;
  delete req.session.flash;
  next();
});

app.use('/auth', require('./routes/auth'));
app.use('/klassen', require('./routes/klassen'));
app.use('/attestering', require('./routes/attestering'));
app.use('/llinkid', require('./routes/llinkid'));
app.use('/export', require('./routes/export'));
app.use('/wisa', require('./routes/wisa'));

app.get('/', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/klassen');
  }
  res.redirect('/auth/login');
});

app.use((req, res) => {
  res.status(404).send('Pagina niet gevonden');
});

module.exports = app;
