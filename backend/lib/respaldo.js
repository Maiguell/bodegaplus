/**
 * @file lib/respaldo.js
 * @description HT08 — Copias de seguridad de la base (mysqldump comprimido) con retención,
 * y restauración en una base de destino (RNF-09).
 *
 * La contraseña se pasa por la variable MYSQL_PWD del proceso hijo, nunca por línea de comandos.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const config = require('./config');

const PREFIJO = 'respaldo_';

const argsConexion = (db) => [`--host=${db.host}`, `--port=${db.port}`, `--user=${db.user}`, ...(db.ssl ? ['--ssl-mode=REQUIRED'] : [])];
const entorno = (db) => ({ ...process.env, MYSQL_PWD: db.password ?? '' });

/** Espera a que termine un proceso hijo; rechaza con su stderr si falla. */
const esperar = (hijo, nombre) => new Promise((resolve, reject) => {
  let err = '';
  hijo.stderr.on('data', (d) => { err += d; });
  hijo.on('error', (e) => reject(new Error(`No se pudo ejecutar ${nombre}: ${e.message}. Configura ${nombre === 'mysqldump' ? 'MYSQLDUMP_PATH' : 'MYSQL_PATH'}.`)));
  hijo.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${nombre} terminó con código ${code}: ${err.trim().slice(0, 300)}`))));
});

/**
 * Genera `<dir>/respaldo_<base>_<AAAAMMDD-HHMMSS>.sql.gz` y borra los respaldos más viejos que la retención.
 * @returns {Promise<{archivo: string, bytes: number, eliminados: string[]}>}
 */
async function crearRespaldo({ db = config.db, dir = config.respaldo.dir, retencionDias = config.respaldo.retencionDias } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), p = (n) => String(n).padStart(2, '0'); // hora local del servidor
  const sello = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const archivo = path.join(dir, `${PREFIJO}${db.database}_${sello}.sql.gz`);
  const tmp = `${archivo}.parcial`;

  const hijo = spawn(config.respaldo.mysqldump, [
    ...argsConexion(db), '--single-transaction', '--routines', '--triggers', '--set-gtid-purged=OFF',
    '--default-character-set=utf8mb4', db.database,
  ], { env: entorno(db) });
  try {
    await Promise.all([pipeline(hijo.stdout, zlib.createGzip(), fs.createWriteStream(tmp)), esperar(hijo, 'mysqldump')]);
    fs.renameSync(tmp, archivo);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return { archivo, bytes: fs.statSync(archivo).size, eliminados: aplicarRetencion(dir, retencionDias) };
}

/** Elimina los respaldos con más de `dias` días. */
function aplicarRetencion(dir, dias) {
  const limite = Date.now() - dias * 864e5;
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(PREFIJO) && f.endsWith('.sql.gz'))
    .filter((f) => fs.statSync(path.join(dir, f)).mtimeMs < limite)
    .map((f) => { fs.rmSync(path.join(dir, f)); return f; });
}

/** Lista los respaldos disponibles (más reciente primero). */
function listarRespaldos(dir = config.respaldo.dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(PREFIJO) && f.endsWith('.sql.gz'))
    .map((f) => { const s = fs.statSync(path.join(dir, f)); return { archivo: f, bytes: s.size, fecha: s.mtime }; })
    .sort((a, b) => b.fecha - a.fecha);
}

/**
 * Restaura un respaldo en la base `destino` (se crea si no existe).
 * Por seguridad no permite restaurar sobre la base configurada salvo `forzar: true`.
 */
async function restaurarRespaldo(archivo, destino, { db = config.db, forzar = false } = {}) {
  if (!/^[A-Za-z0-9_]+$/.test(destino)) throw new Error('Nombre de base de destino inválido.');
  if (destino === db.database && !forzar) throw new Error(`Restaurar sobre "${destino}" reemplaza los datos actuales: usa --forzar si es lo que quieres.`);
  if (!fs.existsSync(archivo)) throw new Error(`No existe el archivo ${archivo}.`);

  const crear = spawn(config.respaldo.mysql, [...argsConexion(db), '-e',
    `CREATE DATABASE IF NOT EXISTS \`${destino}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`], { env: entorno(db) });
  await esperar(crear, 'mysql');

  const hijo = spawn(config.respaldo.mysql, [...argsConexion(db), '--default-character-set=utf8mb4', destino], { env: entorno(db) });
  await Promise.all([pipeline(fs.createReadStream(archivo), zlib.createGunzip(), hijo.stdin), esperar(hijo, 'mysql')]);
}

module.exports = { crearRespaldo, restaurarRespaldo, listarRespaldos, aplicarRetencion };
