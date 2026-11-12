/**
 * @file routes/traslados.js
 * @description HU08 — Enviar un traslado a otra sede · HU09 — Confirmar su recepción.
 * Al enviar, los pares salen de la sede origen y quedan "en tránsito" (no suman en ninguna sede)
 * hasta que la sede destino confirma lo recibido. Las diferencias quedan como novedad.
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware, soloAdmin } = require('../lib/auth');
const inv = require('../lib/inventario');

const router = express.Router();
const db = () => getPool();

const SELECT_TRASLADOS = `
  SELECT t.id, CONCAT('TR-', LPAD(t.id, 4, '0')) AS codigo, t.estado, t.fecha_envio AS fechaEnvio,
         t.fecha_recepcion AS fechaRecepcion, t.observacion, t.novedad, t.novedad_estado AS novedadEstado,
         t.novedad_comentario AS novedadComentario,
         t.origen_id AS origenId, uo.nombre AS origen, t.destino_id AS destinoId, ud.nombre AS destino,
         ue.nombre AS enviadoPor, ur.nombre AS recibidoPor, un.nombre AS novedadRevisadaPor,
         (SELECT CAST(COALESCE(SUM(d.cantidad_enviada), 0) AS SIGNED) FROM traslado_detalle d WHERE d.traslado_id = t.id) AS enviados,
         (SELECT CAST(SUM(d.cantidad_recibida) AS SIGNED) FROM traslado_detalle d WHERE d.traslado_id = t.id) AS recibidos,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('varianteId', d.variante_id, 'sku', v.sku, 'modelo', m.nombre, 'marca', ma.nombre,
                                           'color', co.nombre, 'talla', ta.eu, 'enviada', d.cantidad_enviada, 'recibida', d.cantidad_recibida))
            FROM traslado_detalle d JOIN variantes v ON v.id = d.variante_id JOIN modelos m ON m.id = v.modelo_id
            JOIN marcas ma ON ma.id = m.marca_id JOIN colores co ON co.id = v.color_id JOIN tallas ta ON ta.id = v.talla_id
           WHERE d.traslado_id = t.id) AS lineas
  FROM traslados t
  JOIN ubicaciones uo ON uo.id = t.origen_id
  JOIN ubicaciones ud ON ud.id = t.destino_id
  JOIN usuarios ue ON ue.id = t.usuario_envia_id
  LEFT JOIN usuarios ur ON ur.id = t.usuario_recibe_id
  LEFT JOIN usuarios un ON un.id = t.novedad_revisada_por`;

const leerTraslado = async (q, id) => {
  const [[t]] = await q.query(`${SELECT_TRASLADOS} WHERE t.id = ?`, [id]);
  if (!t) throw new HttpError(404, 'Traslado no encontrado.');
  return t;
};

/** GET /api/traslados?estado=&destinoId=&novedad=PENDIENTE */
router.get('/', authMiddleware, h(async (req, res) => {
  const filtros = [], params = [];
  if (req.query.estado) { filtros.push('t.estado = ?'); params.push(req.query.estado); }
  if (req.query.destinoId) { filtros.push('t.destino_id = ?'); params.push(Number(req.query.destinoId)); }
  if (req.query.novedad) { filtros.push('t.novedad_estado = ?'); params.push(req.query.novedad); }
  const [rows] = await db().query(
    `${SELECT_TRASLADOS} ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''} ORDER BY t.fecha_envio DESC, t.id DESC LIMIT 200`, params);
  res.json(rows);
}));

router.get('/:id', authMiddleware, h(async (req, res) => res.json(await leerTraslado(db(), req.params.id))));

/** POST /api/traslados { origenId, destinoId, observacion?, lineas: [{ varianteId, cantidad }] } */
router.post('/', authMiddleware, h(async (req, res) => {
  const { origenId, destinoId, observacion } = req.body ?? {};
  const lineas = inv.consolidarLineas(req.body?.lineas);
  const origen = await inv.sedeActiva(db(), origenId, 'sede de origen');
  const destino = await inv.sedeActiva(db(), destinoId, 'sede de destino');
  if (origen.id === destino.id) throw new HttpError(400, 'La sede destino debe ser distinta a la de origen.');
  await inv.validarVariantes(db(), lineas.map(([id]) => id));

  const id = await inv.enTransaccion(async (conn) => {
    const [t] = await conn.query(
      'INSERT INTO traslados (origen_id, destino_id, usuario_envia_id, observacion) VALUES (?,?,?,?)',
      [origen.id, destino.id, req.user.id, observacion?.trim() || null]);
    await conn.query('INSERT INTO traslado_detalle (traslado_id, variante_id, cantidad_enviada) VALUES ?',
      [lineas.map(([v, c]) => [t.insertId, v, c])]);
    const movId = await inv.insertarMovimiento(conn, {
      tipo: 'TRASLADO_ENVIO', usuarioId: req.user.id, origenId: origen.id, destinoId: destino.id,
      trasladoId: t.insertId, observacion,
    });
    for (const [varianteId, cant] of lineas) {
      await inv.insertarDetalle(conn, movId, varianteId, cant);
      await inv.moverStock(conn, movId, varianteId, origen.id, -cant);
    }
    return t.insertId;
  });
  res.status(201).json(await leerTraslado(db(), id));
}));

/**
 * POST /api/traslados/:id/recepcion { lineas: [{ varianteId, cantidad }], observacion? }
 * Suma lo recibido a la sede destino y cierra el traslado. Faltantes → novedad pendiente de revisión.
 */
router.post('/:id/recepcion', authMiddleware, h(async (req, res) => {
  const recibido = new Map(inv.consolidarLineas(req.body?.lineas, { permitirCero: true }));
  const observacion = req.body?.observacion?.trim() || null;

  await inv.enTransaccion(async (conn) => {
    const [[t]] = await conn.query('SELECT * FROM traslados WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!t) throw new HttpError(404, 'Traslado no encontrado.');
    if (t.estado !== 'EN_TRANSITO') throw new HttpError(409, 'Este traslado ya fue recibido.');

    const [detalle] = await conn.query(
      `SELECT d.variante_id, d.cantidad_enviada, v.sku FROM traslado_detalle d
       JOIN variantes v ON v.id = d.variante_id WHERE d.traslado_id = ? ORDER BY d.variante_id`, [t.id]);
    for (const varianteId of recibido.keys()) {
      if (!detalle.some((d) => d.variante_id === varianteId)) throw new HttpError(400, `La variante ${varianteId} no viene en este traslado.`);
    }

    const diferencias = [];
    for (const d of detalle) {
      if (!recibido.has(d.variante_id)) throw new HttpError(400, `Indica cuántos pares de ${d.sku} llegaron (puede ser 0).`);
      const cant = recibido.get(d.variante_id);
      if (cant > d.cantidad_enviada) throw new HttpError(400, `De ${d.sku} se enviaron ${d.cantidad_enviada}; no puedes recibir ${cant}.`);
      if (cant !== d.cantidad_enviada) diferencias.push(`${d.sku}: enviados ${d.cantidad_enviada}, recibidos ${cant}`);
    }

    const movId = await inv.insertarMovimiento(conn, {
      tipo: 'TRASLADO_RECEPCION', usuarioId: req.user.id, origenId: t.origen_id, destinoId: t.destino_id,
      trasladoId: t.id, observacion,
    });
    for (const d of detalle) {
      const cant = recibido.get(d.variante_id);
      await conn.query('UPDATE traslado_detalle SET cantidad_recibida = ? WHERE traslado_id = ? AND variante_id = ?', [cant, t.id, d.variante_id]);
      if (cant > 0) {
        await inv.insertarDetalle(conn, movId, d.variante_id, cant);
        await inv.moverStock(conn, movId, d.variante_id, t.destino_id, cant);
      }
    }

    const novedad = diferencias.length
      ? `Faltantes al recibir. ${diferencias.join('; ')}.${observacion ? ` Nota: ${observacion}` : ''}`.slice(0, 500)
      : null;
    await conn.query(
      `UPDATE traslados SET estado = ?, usuario_recibe_id = ?, fecha_recepcion = NOW(), novedad = ?, novedad_estado = ?
       WHERE id = ?`,
      [novedad ? 'RECIBIDO_CON_NOVEDAD' : 'RECIBIDO', req.user.id, novedad, novedad ? 'PENDIENTE' : null, t.id]);
  });
  res.json(await leerTraslado(db(), req.params.id));
}));

/** POST /api/traslados/:id/novedad/revisar { comentario } - El jefe de bodega cierra la novedad (admin). */
router.post('/:id/novedad/revisar', authMiddleware, soloAdmin, h(async (req, res) => {
  const comentario = String(req.body?.comentario ?? '').trim();
  if (!comentario) throw new HttpError(400, 'Escribe qué se hizo con la novedad.');
  const [r] = await db().query(
    `UPDATE traslados SET novedad_estado = 'REVISADA', novedad_comentario = ?, novedad_revisada_por = ?
     WHERE id = ? AND novedad_estado = 'PENDIENTE'`, [comentario.slice(0, 255), req.user.id, req.params.id]);
  if (!r.affectedRows) throw new HttpError(409, 'Este traslado no tiene una novedad pendiente.');
  res.json(await leerTraslado(db(), req.params.id));
}));

module.exports = router;
