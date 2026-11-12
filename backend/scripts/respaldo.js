#!/usr/bin/env node
/**
 * HT08 — Copia de seguridad manual o desde un programador de tareas (cron / Programador de tareas de Windows).
 *   npm run respaldo                       → respalda la base configurada y aplica la retención
 *   NODE_ENV=production npm run respaldo   → usa backend/.env.production
 */

'use strict';

const { crearRespaldo } = require('../lib/respaldo');
const config = require('../lib/config');

crearRespaldo()
  .then((r) => {
    console.log(`✅ Respaldo de "${config.db.database}" creado: ${r.archivo} (${Math.round(r.bytes / 1024)} KB)`);
    if (r.eliminados.length) console.log(`🧹 Eliminados por retención (${config.respaldo.retencionDias} días): ${r.eliminados.join(', ')}`);
  })
  .catch((err) => { console.error('❌', err.message); process.exit(1); });
