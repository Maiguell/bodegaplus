#!/usr/bin/env node
/**
 * HT08 / RNF-09 — Restaura un respaldo en una base de destino.
 *   npm run restaurar -- <archivo.sql.gz> <base_destino> [--forzar]
 * Por seguridad, restaurar sobre la base configurada exige --forzar.
 * Recomendado: restaurar primero en una base de prueba, verificar y luego cambiar DB_NAME.
 */

'use strict';

const path = require('path');
const { restaurarRespaldo } = require('../lib/respaldo');

const [archivo, destino] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const forzar = process.argv.includes('--forzar');
if (!archivo || !destino) {
  console.error('Uso: npm run restaurar -- <archivo.sql.gz> <base_destino> [--forzar]');
  process.exit(1);
}

restaurarRespaldo(path.resolve(archivo), destino, { forzar })
  .then(() => console.log(`✅ Respaldo restaurado en la base "${destino}".`))
  .catch((err) => { console.error('❌', err.message); process.exit(1); });
