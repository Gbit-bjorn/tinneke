require('dotenv').config();

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

    app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));
  })
  .catch(err => {
    console.error('Database initialisatie mislukt:', err.message);
    process.exit(1);
  });
