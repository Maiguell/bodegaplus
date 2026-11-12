/**
 * @file lib/config.js
 * @description HT08 — Configuración por ambiente (development | test | production).
 *
 * Carga primero `backend/.env.<NODE_ENV>` y luego `backend/.env` (sin sobrescribir lo que ya
 * exista en el entorno del proceso, que es lo que usan los servicios de hosting).
 * Ninguna credencial vive en el código: en producción, si falta un secreto, el servidor no arranca.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

const ENV = process.env.NODE_ENV || 'development';
const RAIZ = path.join(__dirname, '..');
for (const archivo of [`.env.${ENV}`, '.env']) {
  const ruta = path.join(RAIZ, archivo);
  if (fs.existsSync(ruta)) dotenv.config({ path: ruta, quiet: true });
}

const e = process.env;
const produccion = ENV === 'production';
const errores = [];

if (produccion) {
  if (!e.JWT_SECRET || e.JWT_SECRET.length < 32) errores.push('JWT_SECRET (mínimo 32 caracteres)');
  if (!e.DB_HOST) errores.push('DB_HOST');
  if (!e.DB_USER) errores.push('DB_USER');
  if (!e.DB_PASSWORD) errores.push('DB_PASSWORD');
}
if (errores.length) {
  throw new Error(`Faltan variables de entorno para producción: ${errores.join(', ')}. Revisa backend/.env.production.example.`);
}

let jwtSecret = e.JWT_SECRET;
if (!jwtSecret) {
  // Solo fuera de producción: secreto aleatorio por proceso (las sesiones se pierden al reiniciar).
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  JWT_SECRET no está definido: se usa uno aleatorio. Defínelo en backend/.env.');
}

const config = {
  env: ENV,
  produccion,
  port: Number(e.PORT) || 8080,
  jwtSecret,
  /** Orígenes permitidos por CORS (lista separada por comas). */
  corsOrigins: (e.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  /** Ruta del build del frontend que el backend sirve en producción (mismo dominio, sin CORS). */
  frontendDist: e.FRONTEND_DIST || path.join(RAIZ, '..', 'frontend', 'dist'),
  db: {
    host: e.DB_HOST || '127.0.0.1',
    port: Number(e.DB_PORT) || 3306,
    user: e.DB_USER || 'root',
    password: e.DB_PASSWORD ?? '',
    database: e.DB_NAME || 'bodega_sneakers',
    /** Bases en la nube suelen exigir TLS: DB_SSL=true */
    ssl: e.DB_SSL === 'true' ? { rejectUnauthorized: e.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  },
  /** Datos de ejemplo al crear una base vacía. En producción la clave del admin debe venir del entorno. */
  seed: {
    habilitado: e.SEED_DEMO !== 'false',
    adminPassword: e.SEED_ADMIN_PASSWORD || (produccion ? null : 'admin123'),
    operadorPassword: e.SEED_OPERADOR_PASSWORD || (produccion ? null : 'bodega123'),
    /** Usuarios de demostración por rol (jefe, vendedor, tienda, auditor). Sin clave no se crean. */
    demoPassword: e.SEED_DEMO_PASSWORD || (produccion ? null : 'demo1234'),
  },
  respaldo: {
    habilitado: e.BACKUP_ENABLED === 'true',
    dir: e.BACKUP_DIR || path.join(RAIZ, 'backups'),
    retencionDias: Number(e.BACKUP_RETENTION_DAYS) || 30,
    hora: Number(e.BACKUP_HOUR ?? 3),
    mysqldump: e.MYSQLDUMP_PATH || 'mysqldump',
    mysql: e.MYSQL_PATH || 'mysql',
  },
  /** Hora local del proceso nocturno de indicadores (HT06). */
  horaIndicadores: Number(e.INDICADORES_HOUR ?? 2),
};

module.exports = config;
