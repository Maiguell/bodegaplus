/**
 * @file routes/kardex.js
 * @description HU07 — Kardex por variante y verificación kardex ↔ stock (HT04).
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();
const db = () => getPool();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/kardex?varianteId=|sku=&ubicacionId=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Movimientos en orden cronológico con tipo, documento, usuario, cantidad y saldo.
 * Sin sede, el saldo es el total de la variante en todas las sedes.
 */
router.get('/', authMiddleware, h(async (req, res) => {
  const { sku, ubicacionId, desde, hasta } = req.query;
  let varianteId = Number(req.query.varianteId) || null;
  if (!varianteId && sku) {
    const [[v]] = await db().query('SELECT id FROM variantes WHERE sku = ? OR codigo_barras = ?', [sku, sku]);
    varianteId = v?.id ?? null;
  }
  if (!varianteId) throw new HttpError(400, 'Indica la variante (SKU) a consultar.');
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) throw new HttpError(400, 'Fechas con formato AAAA-MM-DD.');

  const [[variante]] = await db().query(`
    SELECT v.id, v.sku, m.nombre AS modelo, ma.nombre AS marca, co.nombre AS color, t.eu, t.us
    FROM variantes v JOIN modelos m ON m.id = v.modelo_id JOIN marcas ma ON ma.id = m.marca_id
    JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id WHERE v.id = ?`, [varianteId]);
  if (!variante) throw new HttpError(404, 'Variante no encontrada.');

  const filtros = [], params = [varianteId];
  if (ubicacionId) { filtros.push('x.ubicacionId = ?'); params.push(Number(ubicacionId)); }
  if (desde) { filtros.push('x.fecha >= ?'); params.push(desde); }
  if (hasta) { filtros.push('x.fecha < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(hasta); }

  // Los saldos se calculan sobre toda la historia y luego se filtra, para que el saldo de cada fila sea real.
  const [rows] = await db().query(`
    SELECT x.* FROM (
      SELECT k.id, k.fecha, k.cantidad, k.ubicacion_id AS ubicacionId, u.nombre AS ubicacion,
             k.saldo AS saldoSede,
             CAST(SUM(k.cantidad) OVER (ORDER BY k.id) AS SIGNED) AS saldoTotal,
             mv.id AS movimientoId, COALESCE(mv.tipo, 'SALDO_INICIAL') AS tipo, us.nombre AS usuario,
             COALESCE(oc.codigo,
                      IF(mv.traslado_id, CONCAT('TR-', LPAD(mv.traslado_id, 4, '0')), NULL),
                      IF(mv.reserva_id, CONCAT('RES-', LPAD(mv.reserva_id, 4, '0')), NULL),
                      mv.referencia,
                      IF(mv.id, CONCAT('MOV-', mv.id), 'Apertura')) AS documento,
             mv.referencia, mv.observacion
      FROM kardex k
      JOIN ubicaciones u ON u.id = k.ubicacion_id
      LEFT JOIN movimientos mv ON mv.id = k.movimiento_id
      LEFT JOIN usuarios us ON us.id = mv.usuario_id
      LEFT JOIN ordenes_compra oc ON oc.id = mv.orden_compra_id
      WHERE k.variante_id = ?
    ) x
    ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
    ORDER BY x.id`, params);

  const [stock] = await db().query(
    'SELECT ubicacion_id AS ubicacionId, cantidad FROM stock WHERE variante_id = ?', [varianteId]);
  res.json({ variante, stock, movimientos: rows.map((r) => ({ ...r, saldo: ubicacionId ? r.saldoSede : r.saldoTotal })) });
}));

/** GET /api/kardex/verificacion - Compara el saldo calculado desde el kardex con el stock almacenado. */
router.get('/verificacion', authMiddleware, h(async (req, res) => {
  const [diferencias] = await db().query(`
    SELECT x.varianteId, v.sku, x.ubicacionId, u.nombre AS ubicacion,
           CAST(SUM(x.almacenado) AS SIGNED) AS almacenado, CAST(SUM(x.calculado) AS SIGNED) AS calculado
    FROM (
      SELECT variante_id AS varianteId, ubicacion_id AS ubicacionId, cantidad AS almacenado, 0 AS calculado FROM stock
      UNION ALL
      SELECT variante_id, ubicacion_id, 0, cantidad FROM kardex
    ) x
    JOIN variantes v ON v.id = x.varianteId JOIN ubicaciones u ON u.id = x.ubicacionId
    GROUP BY x.varianteId, x.ubicacionId
    HAVING almacenado <> calculado`);
  const [[{ revisados }]] = await db().query('SELECT COUNT(*) AS revisados FROM stock');
  res.json({ ok: diferencias.length === 0, revisados, diferencias });
}));

module.exports = router;
