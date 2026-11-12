/**
 * @file db/index.js
 * @description Pool MySQL e inicialización: crea la base y las tablas desde schema.sql,
 * carga datos de ejemplo la primera vez (si no hay usuarios) y aplica migraciones idempotentes.
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const mysql  = require('mysql2/promise');
const config = require('../lib/config');
const { seed } = require('./seed');

const { database: DB_NAME, ...cfg } = config.db;

let pool;

/** Crea base y tablas (idempotente), abre el pool y siembra datos si está vacío. */
async function init() {
  const boot = await mysql.createConnection({ ...cfg, multipleStatements: true });
  let sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  sql = sql.replace(/bodega_sneakers/g, DB_NAME);
  await boot.query(sql);
  await boot.end();

  pool = mysql.createPool({ ...cfg, database: DB_NAME, waitForConnections: true, connectionLimit: 10, decimalNumbers: true });

  await migrate(pool);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios');
  if (n === 0 && config.seed.habilitado) {
    await seed(pool, config.seed);
    await abrirKardex(pool);
    console.log('🌱 Datos de ejemplo cargados.');
  }
  return pool;
}

const getPool = () => pool;

const TIPOS_MOVIMIENTO = ['ENTRADA', 'DESPACHO', 'DEVOLUCION', 'AJUSTE', 'VENTA', 'CAMBIO',
  'TRASLADO_ENVIO', 'TRASLADO_RECEPCION', 'RESERVA', 'LIBERACION_RESERVA'];
const MOTIVOS = ['TALLA_INCORRECTA', 'DEFECTO', 'SOBRANTE', 'CONTEO', 'MERMA', 'OTRO', 'AVERIA', 'PERDIDA', 'ERROR_CONTEO'];
const lista = (vals) => vals.map((v) => `'${v}'`).join(',');

/** Agrega una columna si no existe. */
async function agregarColumna(pool, tabla, columna, definicion) {
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [tabla, columna]);
  if (!n) await pool.query(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}

/** Saldo inicial: el kardex arranca con el stock que haya al activarlo. */
async function abrirKardex(pool) {
  const [[{ k }]] = await pool.query('SELECT COUNT(*) AS k FROM kardex');
  if (k === 0) {
    await pool.query(`INSERT INTO kardex (movimiento_id, variante_id, ubicacion_id, cantidad, saldo)
                      SELECT NULL, variante_id, ubicacion_id, cantidad, cantidad FROM stock WHERE cantidad <> 0
                      ORDER BY variante_id, ubicacion_id`);
  }
}

/**
 * Lleva una base creada con un esquema anterior al esquema actual (idempotente):
 * amplía tipos y motivos de movimiento, agrega columnas nuevas, abre el kardex con el
 * saldo actual y crea los triggers que hacen inmutable la bitácora (RNF-04).
 */
async function migrate(pool) {
  await pool.query(`ALTER TABLE movimientos MODIFY tipo ENUM(${lista(TIPOS_MOVIMIENTO)}) NOT NULL`);
  await pool.query(`ALTER TABLE movimientos MODIFY motivo ENUM(${lista(MOTIVOS)}) NULL`);
  for (const col of ['orden_compra_id', 'traslado_id', 'reserva_id', 'ajuste_id']) {
    await agregarColumna(pool, 'movimientos', col, 'INT NULL');
  }
  await agregarColumna(pool, 'variantes', 'costo', 'DECIMAL(12,2) NULL');

  await abrirKardex(pool);

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

module.exports = { init, getPool };
