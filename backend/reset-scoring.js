// Remise à zéro du scoring des opportunités (test Option 2 / C1).
// Jetable — à supprimer après le test.
// Usage : depuis backend/  ->  node reset-scoring.js
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'v_tech',
  };
  console.log(`Connexion à ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);

  const conn = await mysql.createConnection(cfg);
  try {
    const [before] = await conn.query('SELECT COUNT(*) AS total FROM opportunities');
    console.log('Avant :', before[0]);

    // Vide la table (équivaut à un TRUNCATE, mais sans exiger le privilège DROP).
    const [res] = await conn.query('DELETE FROM opportunities');
    console.log(`Vidage : ${res.affectedRows} ligne(s) supprimée(s).`);

    const [after] = await conn.query('SELECT COUNT(*) AS total FROM opportunities');
    console.log('Après :', after[0]);
  } finally {
    await conn.end();
  }
})().catch((e) => {
  console.error('Échec :', e.message);
  process.exit(1);
});
