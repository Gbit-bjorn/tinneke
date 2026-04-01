require('dotenv').config();

const bcrypt = require('bcrypt');
const { db } = require('./lib');
const app    = require('./app');
const PORT   = process.env.PORT || 3000;

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
    console.error('Database initialisatie mislukt:', err.message);
    process.exit(1);
  });
