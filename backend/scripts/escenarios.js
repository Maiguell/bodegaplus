#!/usr/bin/env node
/**
 * HT13 — Carga (si no existen) los productos y la orden de los escenarios de la prueba de usabilidad.
 *   npm run escenarios          → sobre la base configurada (DB_NAME)
 */

'use strict';

const config = require('../lib/config');
const { init, getPool, cerrar } = require('../db');
const { cargarEscenarios } = require('../db/escenarios');

(async () => {
  await init();
  const hecho = await cargarEscenarios(getPool());
  console.log(hecho.length ? `✅ ${config.db.database}: ${hecho.join(' · ')}` : `ℹ️  ${config.db.database}: los escenarios ya estaban cargados.`);
  await cerrar();
})().catch((err) => { console.error('❌', err.message); process.exit(1); });
