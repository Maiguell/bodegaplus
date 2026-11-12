/**
 * @file lib/inventario.js
 * @description HT04 — Motor transaccional de movimientos de inventario.
 *
 * Todo cambio de stock pasa por `moverStock`, que dentro de una transacción:
 *   1. Actualiza el saldo de la variante en la sede. Las restas usan un UPDATE condicional
 *      (`cantidad >= n`), que bloquea la fila: si dos ventas compiten por la última unidad,
 *      la segunda espera el bloqueo, ya no encuentra stock y recibe "Stock insuficiente".
 *   2. Escribe una fila en `kardex` con la cantidad (con signo) y el saldo resultante.
 *
 * El kardex, los movimientos y su detalle son de solo inserción: los triggers creados en
 * db/index.js rechazan cualquier UPDATE o DELETE (RNF-04).
 */

'use strict';

const { getPool } = require('../db');
const { HttpError } = require('./http');
const { evaluarAlerta } = require('./alertas');

/** Ejecuta `fn(conn)` dentro de una transacción; revierte si lanza. */
async function enTransaccion(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Sedes activas con al menos `cantidad` pares de la variante, excluyendo `excluirId`. */
async function sedesConStock(q, varianteId, cantidad = 1, excluirId = 0) {
  const [rows] = await q.query(
    `SELECT u.id, u.nombre, s.cantidad FROM stock s JOIN ubicaciones u ON u.id = s.ubicacion_id
     WHERE s.variante_id = ? AND s.cantidad >= ? AND u.activo = 1 AND u.id <> ?
     ORDER BY s.cantidad DESC`, [varianteId, cantidad, excluirId || 0]);
  return rows;
}

/**
 * Suma (delta > 0) o resta (delta < 0) pares de una variante en una sede y lo registra en el kardex.
 * @returns {Promise<number>} saldo resultante en la sede.
 * @throws {HttpError} 409 "Stock insuficiente" con las sedes que sí tienen existencia.
 */
async function moverStock(conn, movimientoId, varianteId, ubicacionId, delta) {
  if (!delta) throw new HttpError(400, 'La cantidad de un movimiento no puede ser cero.');

  if (delta > 0) {
    await conn.query(
      `INSERT INTO stock (variante_id, ubicacion_id, cantidad) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)`, [varianteId, ubicacionId, delta]);
  } else {
    const [r] = await conn.query(
      'UPDATE stock SET cantidad = cantidad + ? WHERE variante_id = ? AND ubicacion_id = ? AND cantidad >= ?',
      [delta, varianteId, ubicacionId, -delta]);
    if (!r.affectedRows) {
      const [[v]] = await conn.query(
        `SELECT v.sku, u.nombre AS sede, COALESCE(s.cantidad, 0) AS disponible
         FROM variantes v JOIN ubicaciones u ON u.id = ?
         LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = u.id WHERE v.id = ?`, [ubicacionId, varianteId]);
      const sugerencias = await sedesConStock(conn, varianteId, -delta, ubicacionId);
      const donde = sugerencias.length
        ? ` Hay existencia en: ${sugerencias.map((s) => `${s.nombre} (${s.cantidad})`).join(', ')}.`
        : ' No hay existencia suficiente en otras sedes.';
      throw new HttpError(409,
        `Stock insuficiente de ${v?.sku ?? varianteId} en ${v?.sede ?? 'la sede'}: disponible ${v?.disponible ?? 0}, solicitado ${-delta}.${donde}`,
        { codigo: 'STOCK_INSUFICIENTE', varianteId, sku: v?.sku, disponible: v?.disponible ?? 0, sugerencias });
    }
  }

  const [[{ cantidad: saldo }]] = await conn.query(
    'SELECT cantidad FROM stock WHERE variante_id = ? AND ubicacion_id = ? FOR UPDATE', [varianteId, ubicacionId]);
  await conn.query(
    'INSERT INTO kardex (movimiento_id, variante_id, ubicacion_id, cantidad, saldo) VALUES (?,?,?,?,?)',
    [movimientoId, varianteId, ubicacionId, delta, saldo]);
  await evaluarAlerta(conn, varianteId, ubicacionId); // HU15: alerta por evento
  return saldo;
}

/** Inserta la cabecera de un movimiento y devuelve su id. */
async function insertarMovimiento(conn, m) {
  const [r] = await conn.query(
    `INSERT INTO movimientos (tipo, usuario_id, proveedor_id, origen_id, destino_id, motivo, referencia, observacion,
                              orden_compra_id, traslado_id, reserva_id, ajuste_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [m.tipo, m.usuarioId, m.proveedorId ?? null, m.origenId ?? null, m.destinoId ?? null, m.motivo ?? null,
      m.referencia?.trim?.() || null, m.observacion?.trim?.() || null,
      m.ordenCompraId ?? null, m.trasladoId ?? null, m.reservaId ?? null, m.ajusteId ?? null]);
  return r.insertId;
}

const insertarDetalle = (conn, movimientoId, varianteId, cantidad) =>
  conn.query('INSERT INTO movimiento_detalle (movimiento_id, variante_id, cantidad) VALUES (?,?,?)', [movimientoId, varianteId, cantidad]);

/**
 * Normaliza `[{ varianteId, cantidad }]`: valida enteros, suma variantes repetidas y ordena por id
 * (orden fijo de bloqueo para evitar interbloqueos entre transacciones concurrentes).
 * @returns {Array<[number, number]>} pares [varianteId, cantidad].
 */
function consolidarLineas(detalle, { permitirNegativos = false, permitirCero = false } = {}) {
  if (!Array.isArray(detalle) || !detalle.length) throw new HttpError(400, 'Agrega al menos una línea.');
  const lineas = new Map();
  for (const l of detalle) {
    const id = Number(l?.varianteId), cant = Number(l?.cantidad);
    const valida = id && Number.isInteger(cant) && (permitirCero || cant !== 0) && (permitirNegativos || cant >= 0);
    if (!valida) throw new HttpError(400, 'Cada línea necesita variante y una cantidad entera válida.');
    lineas.set(id, (lineas.get(id) ?? 0) + cant);
  }
  return [...lineas].sort((a, b) => a[0] - b[0]);
}

/** Verifica que todas las variantes existan y estén activas. */
async function validarVariantes(q, ids) {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return;
  const [rows] = await q.query('SELECT id FROM variantes WHERE id IN (?) AND activo = 1', [unicos]);
  if (rows.length !== unicos.length) throw new HttpError(404, 'Alguna variante no existe.');
}

/** Devuelve la sede activa o lanza 400. */
async function sedeActiva(q, id, etiqueta = 'sede') {
  const [[u]] = await q.query('SELECT id, nombre, tipo FROM ubicaciones WHERE id = ? AND activo = 1', [Number(id) || 0]);
  if (!u) throw new HttpError(400, `Selecciona una ${etiqueta} válida.`);
  return u;
}

module.exports = {
  enTransaccion, moverStock, insertarMovimiento, insertarDetalle,
  consolidarLineas, validarVariantes, sedeActiva, sedesConStock,
};
