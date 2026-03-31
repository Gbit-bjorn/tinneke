require('dotenv').config();

const { db } = require('./lib');
const app    = require('./app');
const PORT   = process.env.PORT || 3000;

db.initTables()
  .then(() => {
    app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));
  })
  .catch(err => {
    console.error('Database initialisatie mislukt:', err.message);
    process.exit(1);
  });
