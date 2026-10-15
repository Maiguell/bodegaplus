/**
 * @file db/index.js
 * @description Pool MySQL e inicialización: crea la base y las tablas desde schema.sql
 * y carga datos de ejemplo la primera vez (si no hay usuarios).
 */

'use strict';

require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const mysql  = require('mysql2/promise');
const { seed } = require('./seed');

const cfg = {
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? '',
};
const DB_NAME = process.env.DB_NAME || 'bodega_sneakers';

let pool;

/** Crea base y tablas (idempotente), abre el pool y siembra datos si está vacío. */
async function init() {
  const boot = await mysql.createConnection({ ...cfg, multipleStatements: true });
  let sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  sql = sql.replace(/bodega_sneakers/g, DB_NAME);
  await boot.query(sql);
  await boot.end();

  pool = mysql.createPool({ ...cfg, database: DB_NAME, waitForConnections: true, connectionLimit: 10, decimalNumbers: true });

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios');
  if (n === 0) {
    await seed(pool);
    console.log('🌱 Datos de ejemplo cargados.');
  }
  return pool;
}

const getPool = () => pool;

module.exports = { init, getPool };
