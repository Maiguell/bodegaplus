/**
 * @file server.js
 * @description Punto de entrada: inicializa la base (esquema, migraciones, datos de ejemplo),
 * abre el puerto y programa las tareas (HT06). La aplicación Express vive en app.js.
 */

'use strict';

const config = require('./lib/config');
const { init } = require('./db');
const { app, tienda } = require('./app');
const tareas = require('./lib/tareas');

init()
  .then(() => app.listen(config.port, () => {
    tareas.iniciar({ liberarReservas: tienda.liberarReservasVencidas });
    console.log(`\n👟 Backend Bodega Sneakers (${config.env}) en http://localhost:${config.port} · base ${config.db.database}`);
    if (!config.produccion) console.log('   Usuarios de ejemplo: admin, bodega, jefe, tienda, vendedor, auditor\n');
  }))
  .catch((err) => { console.error('❌ No se pudo iniciar la base de datos:', err.message); process.exit(1); });
