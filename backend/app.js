/**
 * @file app.js
 * @description Aplicación Express (sin abrir puerto) para que las pruebas de integración (HT10)
 * la usen con Supertest. `server.js` la inicia contra la base de datos y programa las tareas.
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const config  = require('./lib/config'); // HT08: carga .env.<NODE_ENV> y valida secretos
const express = require('express');
const cors    = require('cors');
const { getPool } = require('./db');
const { h } = require('./lib/http');
const tienda = require('./routes/tienda');

const app = express();

app.set('trust proxy', 1); // detrás del proxy HTTPS del hosting
app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '5mb' })); // la importación de catálogo envía el CSV completo

/** GET /api/salud — comprobación de vida para el hosting y el monitoreo (RNF-03). */
app.get('/api/salud', h(async (req, res) => {
  await getPool().query('SELECT 1');
  res.json({ ok: true, ambiente: config.env, hora: new Date().toISOString() });
}));

app.use('/api/auth', require('./routes/auth').router);           // HU20 / HT02 / RNF-05
app.use('/api/usuarios', require('./routes/usuarios'));          // HU19
app.use('/api', require('./routes/catalogo'));                   // HU01–HU03, HT05, RNF-08
app.use('/api', require('./routes/movimientos'));                // inventario, HU06, dashboard
app.use('/api/ordenes-compra', require('./routes/compras'));     // HU05
app.use('/api/kardex', require('./routes/kardex'));              // HU07 / HT04
app.use('/api/traslados', require('./routes/traslados'));        // HU08 / HU09
app.use('/api', tienda.router);                                  // HU10 / HU13 / HU14
app.use('/api', require('./routes/control'));                    // HU11 / HU12 / HU15
app.use('/api/informes', require('./routes/informes'));          // HU16–HU18, HT06 / HT08

app.use('/api', (req, res) => res.status(404).json({ message: 'Ruta no encontrada.' }));

// ── Frontend (HT07): en producción el backend sirve el build de Vite en el mismo dominio ──
if (fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
  app.use(express.static(config.frontendDist, { maxAge: '1h', index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
}

// ── Errores ───────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'El archivo es demasiado grande (máx. 5 MB).' });
  if (err.status) return res.status(err.status).json({ message: err.message, ...err.extra });
  if (err.sqlState === '45000') return res.status(409).json({ message: err.sqlMessage });
  if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
    return res.status(409).json({ message: 'Otra operación estaba usando ese inventario. Intenta de nuevo.' });
  }
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ya existe un registro con esos datos.' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ message: 'Referencia inválida (algún dato relacionado no existe).' });
  console.error(err);
  res.status(500).json({ message: 'Error interno del servidor.' });
});

module.exports = { app, tienda };
