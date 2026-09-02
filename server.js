'use strict';

require('dotenv').config();
const app = require('./lib/app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard Souhaib disponible sur http://localhost:${PORT}`);
});
