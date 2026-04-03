require('dotenv').config();

const fs   = require('fs');
const path = require('path');

// Schrijf fouten naar een logbestand dat je via Plesk File Manager kunt lezen
const logFile = path.join(__dirname, 'startup-error.log');

function logError(label, err) {
  const msg = `[${new Date().toISOString()}] ${label}: ${err.stack || err.message || err}\n`;
  fs.appendFileSync(logFile, msg);
  console.error(msg);
}

let bcrypt, db, app;

try {
  bcrypt     = require('bcrypt');
  ({ db }    = require('./lib'));
  app        = require('./app');
} catch (err) {
  logError('REQUIRE FOUT', err);
  // Toon de fout in de browser via een nood-express
  const express = require('express');
  app = express();
  app.use((req, res) => res.status(500).send(`<pre>Startup fout:\n${err.stack}</pre>`));
  const PORT = process.env.PORT || 3000;
  app.listen(PORT);
  throw err; // ook naar Passenger logs
}

const PORT = process.env.PORT || 3000;

db.initTables()
  .then(async () => {
    // Seed richting → leerplan mapping vanuit JSON (INSERT IGNORE, dus veilig bij herstart)
    try {
      const mapping = require('./richting_leerplan_mapping.json');
      await db.seedRichtingLeerplan(mapping);
    } catch { /* JSON niet aanwezig of al geseeded */ }

    // Koppel leerplannen aan klassen die er nog geen hebben
    const gekoppeld = await db.koppelOntbrekendeLeerplannen();
    if (gekoppeld > 0) console.log(`${gekoppeld} klassen alsnog aan leerplan gekoppeld`);

    // Seed standaard users als tabel nog leeg is
    const aantalUsers = await db.aantalUsers();
    if (aantalUsers === 0) {
      const hash = await bcrypt.hash('admin', 12);
      await db.createUser('bjorn',   hash, 'Bjorn',   'superadmin');
      await db.createUser('tinneke', hash, 'Tinneke', 'admin');
      console.log('[users] Standaard users aangemaakt (bjorn/tinneke, wachtwoord: admin)');
    }

    app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));
  })
  .catch(err => {
    logError('DATABASE INIT FOUT', err);
    // Start nood-server zodat je de fout in de browser kunt zien
    const express = require('express');
    const noodApp = express();
    noodApp.use((req, res) => res.status(500).send(`<pre>Database fout:\n${err.stack}</pre>`));
    noodApp.listen(PORT);
  });
