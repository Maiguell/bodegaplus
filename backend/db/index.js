/**
 * @file db/index.js
 * @description Pool MySQL e inicialización: crea la base y las tablas desde schema.sql
 * y carga datos de ejemplo la primera vez (si no hay usuarios).
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
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
  await migrate(pool);
  return pool;
}

const TIPOS_MOVIMIENTO = ['ENTRADA', 'DESPACHO', 'DEVOLUCION', 'AJUSTE', 'VENTA', 'CAMBIO',
  'TRASLADO_ENVIO', 'TRASLADO_RECEPCION', 'RESERVA', 'LIBERACION_RESERVA'];

/**
 * Lleva una base creada con un esquema anterior al esquema actual (idempotente):
 * amplía los tipos de movimiento, agrega columnas de documento, abre el kardex con el
 * saldo actual y crea los triggers que hacen inmutable la bitácora (RNF-04).
 */
async function migrate(pool) {
  await pool.query(`ALTER TABLE movimientos MODIFY tipo ENUM(${TIPOS_MOVIMIENTO.map((t) => `'${t}'`).join(',')}) NOT NULL`);

  const [cols] = await pool.query(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movimientos'");
  const existentes = new Set(cols.map((r) => r.c));
  for (const col of ['orden_compra_id', 'traslado_id', 'reserva_id']) {
    if (!existentes.has(col)) await pool.query(`ALTER TABLE movimientos ADD COLUMN ${col} INT NULL`);
  }

  // Saldo inicial: el kardex arranca con el stock que haya al activarlo
  const [[{ k }]] = await pool.query('SELECT COUNT(*) AS k FROM kardex');
  if (k === 0) {
    await pool.query(`INSERT INTO kardex (movimiento_id, variante_id, ubicacion_id, cantidad, saldo)
                      SELECT NULL, variante_id, ubicacion_id, cantidad, cantidad FROM stock WHERE cantidad <> 0
                      ORDER BY variante_id, ubicacion_id`);
  }

  // Bitácora de solo inserción
  const inmutables = { kardex: 'El kardex', movimientos: 'Un movimiento', movimiento_detalle: 'El detalle de un movimiento' };
  try {
    for (const [tabla, nombre] of Object.entries(inmutables)) {
      for (const op of ['UPDATE', 'DELETE']) {
        const trg = `trg_${tabla}_no_${op.toLowerCase()}`;
        await pool.query(`DROP TRIGGER IF EXISTS ${trg}`);
        await pool.query(`CREATE TRIGGER ${trg} BEFORE ${op} ON ${tabla} FOR EACH ROW
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${nombre} no se puede modificar ni eliminar.'`);
      }
    }
  } catch (err) {
    console.warn('⚠️  No se pudieron crear los triggers de inmutabilidad:', err.message);
  }
}

const getPool = () => pool;

module.exports = { init, getPool };
