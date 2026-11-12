/**
 * @file routes/compras.js
 * @description HU05 — Órdenes de compra y recepción de mercancía contra la orden.
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { requiere, exigirSede } = require('../lib/permisos');
const inv = require('../lib/inventario');

const router = express.Router();
const db = () => getPool();

const SELECT_ORDENES = `
  SELECT oc.id, oc.codigo, oc.estado, oc.fecha, oc.observacion,
         oc.proveedor_id AS proveedorId, p.nombre AS proveedor, oc.destino_id AS destinoId, u.nombre AS destino,
         us.nombre AS usuario,
         CAST(COALESCE(SUM(d.cantidad_pedida), 0) AS SIGNED) AS pedidos,
         CAST(COALESCE(SUM(d.cantidad_recibida), 0) AS SIGNED) AS recibidos,
         COUNT(d.id) AS lineas
  FROM ordenes_compra oc
  JOIN proveedores p ON p.id = oc.proveedor_id
  JOIN ubicaciones u ON u.id = oc.destino_id
  JOIN usuarios us ON us.id = oc.usuario_id
  LEFT JOIN orden_compra_detalle d ON d.orden_id = oc.id`;

const leerOrden = async (q, id) => {
  const [[orden]] = await q.query(`${SELECT_ORDENES} WHERE oc.id = ? GROUP BY oc.id`, [id]);
  if (!orden) throw new HttpError(404, 'Orden de compra no encontrada.');
  const [lineas] = await q.query(`
    SELECT d.variante_id AS varianteId, d.cantidad_pedida AS pedida, d.cantidad_recibida AS recibida,
           v.sku, m.nombre AS modelo, ma.nombre AS marca, co.nombre AS color, t.eu
    FROM orden_compra_detalle d JOIN variantes v ON v.id = d.variante_id JOIN modelos m ON m.id = v.modelo_id
    JOIN marcas ma ON ma.id = m.marca_id JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id
    WHERE d.orden_id = ? ORDER BY m.nombre, co.nombre, t.eu`, [id]);
  return { ...orden, detalle: lineas };
};

/** GET /api/ordenes-compra?estado= */
router.get('/', authMiddleware, h(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.estado) { where = 'WHERE oc.estado = ?'; params.push(req.query.estado); }
  const [rows] = await db().query(`${SELECT_ORDENES} ${where} GROUP BY oc.id ORDER BY oc.fecha DESC, oc.id DESC`, params);
  res.json(rows);
}));

router.get('/:id', authMiddleware, h(async (req, res) => res.json(await leerOrden(db(), req.params.id))));

/** POST /api/ordenes-compra { proveedorId, destinoId?, observacion?, lineas: [{ varianteId, cantidad }] } (admin) */
router.post('/', authMiddleware, requiere('compras.crear'), h(async (req, res) => {
  const { proveedorId, destinoId, observacion } = req.body ?? {};
  const lineas = inv.consolidarLineas(req.body?.lineas);
  const [[prov]] = await db().query('SELECT id FROM proveedores WHERE id = ?', [Number(proveedorId) || 0]);
  if (!prov) throw new HttpError(400, 'Selecciona un proveedor válido.');
  const destino = destinoId
    ? await inv.sedeActiva(db(), destinoId)
    : (await db().query("SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' AND activo = 1 LIMIT 1"))[0][0];
  await inv.validarVariantes(db(), lineas.map(([id]) => id));

  const id = await inv.enTransaccion(async (conn) => {
    const [[{ ultimo }]] = await conn.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(codigo, 4) AS UNSIGNED)), 0) AS ultimo FROM ordenes_compra FOR UPDATE");
    const codigo = `OC-${String(ultimo + 1).padStart(4, '0')}`;
    const [r] = await conn.query(
      'INSERT INTO ordenes_compra (codigo, proveedor_id, destino_id, usuario_id, observacion) VALUES (?,?,?,?,?)',
      [codigo, prov.id, destino.id, req.user.id, observacion?.trim() || null]);
    await conn.query('INSERT INTO orden_compra_detalle (orden_id, variante_id, cantidad_pedida) VALUES ?',
      [lineas.map(([v, c]) => [r.insertId, v, c])]);
    return r.insertId;
  });
  res.status(201).json(await leerOrden(db(), id));
}));

/**
 * POST /api/ordenes-compra/:id/recepcion { lineas: [{ varianteId, cantidad }], observacion?, referencia? }
 * Aumenta el inventario de la sede destino con lo recibido, genera el movimiento ENTRADA y deja la orden
 * "RECIBIDA" o "RECIBIDA_PARCIAL". Si lo recibido supera lo pedido, exige una observación.
 */
router.post('/:id/recepcion', authMiddleware, requiere('compras.recibir'), h(async (req, res) => {
  const { observacion, referencia } = req.body ?? {};
  const lineas = inv.consolidarLineas(req.body?.lineas, { permitirCero: true }).filter(([, c]) => c > 0);
  if (!lineas.length) throw new HttpError(400, 'Registra al menos una cantidad recibida.');

  const resultado = await inv.enTransaccion(async (conn) => {
    const [[orden]] = await conn.query('SELECT * FROM ordenes_compra WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!orden) throw new HttpError(404, 'Orden de compra no encontrada.');
    exigirSede(req.user, orden.destino_id, 'recibir mercancía');
    if (!['PENDIENTE', 'RECIBIDA_PARCIAL'].includes(orden.estado)) {
      throw new HttpError(409, `La orden ${orden.codigo} está ${orden.estado.toLowerCase().replace('_', ' ')}; no admite más recepciones.`);
    }
    const [detalle] = await conn.query(
      `SELECT d.variante_id, d.cantidad_pedida, d.cantidad_recibida, v.sku FROM orden_compra_detalle d
       JOIN variantes v ON v.id = d.variante_id WHERE d.orden_id = ?`, [orden.id]);
    const porVariante = new Map(detalle.map((d) => [d.variante_id, d]));

    const excesos = [];
    for (const [varianteId, cant] of lineas) {
      const d = porVariante.get(varianteId);
      if (!d) throw new HttpError(400, `La variante ${varianteId} no está en la orden ${orden.codigo}.`);
      const exceso = d.cantidad_recibida + cant - d.cantidad_pedida;
      if (exceso > 0) excesos.push({ sku: d.sku, exceso });
    }
    if (excesos.length && !observacion?.trim()) {
      throw new HttpError(400,
        `Lo recibido supera lo pedido (${excesos.map((e) => `${e.sku} +${e.exceso}`).join(', ')}). Agrega una observación antes de guardar.`,
        { codigo: 'OBSERVACION_REQUERIDA', excesos });
    }

    const movId = await inv.insertarMovimiento(conn, {
      tipo: 'ENTRADA', usuarioId: req.user.id, proveedorId: orden.proveedor_id, destinoId: orden.destino_id,
      ordenCompraId: orden.id, referencia: referencia || orden.codigo, observacion,
    });
    for (const [varianteId, cant] of lineas) {
      await inv.insertarDetalle(conn, movId, varianteId, cant);
      await inv.moverStock(conn, movId, varianteId, orden.destino_id, cant);
      await conn.query('UPDATE orden_compra_detalle SET cantidad_recibida = cantidad_recibida + ? WHERE orden_id = ? AND variante_id = ?',
        [cant, orden.id, varianteId]);
      porVariante.get(varianteId).cantidad_recibida += cant;
    }
    const completa = [...porVariante.values()].every((d) => d.cantidad_recibida >= d.cantidad_pedida);
    const estado = completa ? 'RECIBIDA' : 'RECIBIDA_PARCIAL';
    await conn.query('UPDATE ordenes_compra SET estado = ? WHERE id = ?', [estado, orden.id]);
    return { movimientoId: movId, estado, pares: lineas.reduce((a, [, c]) => a + c, 0) };
  });

  res.status(201).json({ ...resultado, orden: await leerOrden(db(), req.params.id) });
}));

/** POST /api/ordenes-compra/:id/anular - Solo órdenes sin recepciones (admin). */
router.post('/:id/anular', authMiddleware, requiere('compras.crear'), h(async (req, res) => {
  const [r] = await db().query("UPDATE ordenes_compra SET estado = 'ANULADA' WHERE id = ? AND estado = 'PENDIENTE'", [req.params.id]);
  if (!r.affectedRows) throw new HttpError(409, 'Solo se puede anular una orden pendiente sin recepciones.');
  res.json(await leerOrden(db(), req.params.id));
}));

module.exports = router;
