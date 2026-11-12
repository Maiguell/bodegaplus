/**
 * @file routes/movimientos.js
 * @description Inventario por variante, movimientos del formulario general (entrada, despacho,
 * devolución y venta — HU06) y métricas del dashboard.
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { puede, exigirSede } = require('../lib/permisos');
const inv = require('../lib/inventario');

const router = express.Router();
const db = () => getPool();

/**
 * Tipos que se registran desde el formulario general (los demás tienen su propio endpoint).
 * Los ajustes van por /api/ajustes: quedan pendientes y solo mueven stock al aprobarse (HU11).
 */
const TIPOS = ['ENTRADA', 'DESPACHO', 'DEVOLUCION', 'VENTA'];
const MOTIVOS_DEVOLUCION = ['TALLA_INCORRECTA', 'DEFECTO', 'SOBRANTE', 'OTRO'];

/** GET /api/inventario?modeloId= — una fila por variante con el stock en cada ubicación. */
router.get('/inventario', authMiddleware, h(async (req, res) => {
  const params = [];
  let where = 'v.activo = 1 AND m.activo = 1';
  if (req.query.modeloId) { where += ' AND v.modelo_id = ?'; params.push(req.query.modeloId); }

  const [rows] = await db().query(`
    SELECT v.id, v.sku, v.codigo_barras AS codigoBarras, v.precio, v.costo, v.stock_minimo AS stockMinimo,
           m.id AS modeloId, m.nombre AS modelo, ma.nombre AS marca, c.nombre AS categoria,
           co.nombre AS color, co.hex AS colorHex, t.genero, t.us, t.eu
    FROM variantes v
    JOIN modelos m ON m.id = v.modelo_id
    JOIN marcas ma ON ma.id = m.marca_id
    JOIN categorias c ON c.id = m.categoria_id
    JOIN colores co ON co.id = v.color_id
    JOIN tallas t ON t.id = v.talla_id
    WHERE ${where}
    ORDER BY ma.nombre, m.nombre, co.nombre, t.eu`, params);

  if (rows.length) {
    const [stocks] = await db().query('SELECT variante_id, ubicacion_id, cantidad FROM stock WHERE variante_id IN (?)', [rows.map((r) => r.id)]);
    const porVariante = new Map();
    for (const s of stocks) {
      if (!porVariante.has(s.variante_id)) porVariante.set(s.variante_id, {});
      porVariante.get(s.variante_id)[s.ubicacion_id] = s.cantidad;
    }
    for (const r of rows) {
      r.stock = porVariante.get(r.id) ?? {};
      r.total = Object.values(r.stock).reduce((a, b) => a + b, 0);
    }
  }
  res.json(rows);
}));

router.get('/movimientos', authMiddleware, h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const [rows] = await db().query(`
    SELECT mv.id, mv.tipo, mv.fecha, mv.motivo, mv.referencia, mv.observacion,
           u.nombre AS usuario, p.nombre AS proveedor, uo.nombre AS origen, ud.nombre AS destino,
           oc.codigo AS ordenCompra, mv.traslado_id AS trasladoId, mv.reserva_id AS reservaId, mv.ajuste_id AS ajusteId,
           (SELECT CAST(COALESCE(IF(mv.tipo = 'CAMBIO', SUM(GREATEST(d.cantidad, 0)), SUM(d.cantidad)), 0) AS SIGNED)
              FROM movimiento_detalle d WHERE d.movimiento_id = mv.id) AS pares,
           (SELECT JSON_ARRAYAGG(JSON_OBJECT('sku', v.sku, 'modelo', m.nombre, 'color', co.nombre, 'talla', t.eu, 'cantidad', d.cantidad))
              FROM movimiento_detalle d JOIN variantes v ON v.id = d.variante_id JOIN modelos m ON m.id = v.modelo_id
              JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id
             WHERE d.movimiento_id = mv.id) AS lineas
    FROM movimientos mv
    JOIN usuarios u ON u.id = mv.usuario_id
    LEFT JOIN proveedores p ON p.id = mv.proveedor_id
    LEFT JOIN ubicaciones uo ON uo.id = mv.origen_id
    LEFT JOIN ubicaciones ud ON ud.id = mv.destino_id
    LEFT JOIN ordenes_compra oc ON oc.id = mv.orden_compra_id
    ORDER BY mv.fecha DESC, mv.id DESC LIMIT ?`, [limit]);
  res.json(rows);
}));

/**
 * POST /api/movimientos
 * Body: { tipo, localId?, ubicacionId?, proveedorId?, motivo?, referencia?, observacion?, detalle: [{ varianteId, cantidad }] }
 *   ENTRADA    → proveedor → bodega (entrada directa; contra OC usar /api/ordenes-compra/:id/recepcion)
 *   DESPACHO   → bodega → localId
 *   DEVOLUCION → localId → bodega (motivo requerido)
 *   VENTA      → ubicacionId → cliente (HU06). Sin stock: 409 con las sedes que sí tienen.
 * Permisos: VENTA exige "ventas" (y la sede propia para vendedores); los demás, "movimientos.bodega".
 */
router.post('/movimientos', authMiddleware, h(async (req, res) => {
  const { tipo, localId, ubicacionId, proveedorId, motivo, referencia, observacion, detalle } = req.body ?? {};
  if (tipo === 'AJUSTE') throw new HttpError(400, 'Los ajustes se registran en Ajustes y requieren aprobación del jefe de bodega.');
  if (!TIPOS.includes(tipo)) throw new HttpError(400, 'Tipo de movimiento inválido.');
  if (!puede(req.user.rol, tipo === 'VENTA' ? 'ventas' : 'movimientos.bodega')) throw new HttpError(403, 'No tienes permiso para registrar este movimiento.');
  const lineas = inv.consolidarLineas(detalle);

  const [[bodega]] = await db().query("SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' AND activo = 1 LIMIT 1");
  let origenId = null, destinoId = null;

  if (tipo === 'ENTRADA') {
    destinoId = bodega.id;
  } else if (tipo === 'VENTA') {
    origenId = (await inv.sedeActiva(db(), ubicacionId)).id;
  } else {
    const [[local]] = await db().query("SELECT id FROM ubicaciones WHERE id = ? AND tipo = 'LOCAL' AND activo = 1", [localId ?? 0]);
    if (!local) throw new HttpError(400, 'Selecciona un local válido.');
    if (tipo === 'DESPACHO') { origenId = bodega.id; destinoId = local.id; }
    else {
      if (!MOTIVOS_DEVOLUCION.includes(motivo)) throw new HttpError(400, 'Motivo de devolución inválido.');
      origenId = local.id; destinoId = bodega.id;
    }
  }
  exigirSede(req.user, tipo === 'VENTA' ? origenId : (tipo === 'DEVOLUCION' ? origenId : destinoId), 'registrar movimientos');
  await inv.validarVariantes(db(), lineas.map(([id]) => id));

  const id = await inv.enTransaccion(async (conn) => {
    const movId = await inv.insertarMovimiento(conn, {
      tipo, usuarioId: req.user.id, proveedorId: tipo === 'ENTRADA' ? proveedorId || null : null, origenId, destinoId,
      motivo: tipo === 'DEVOLUCION' ? motivo : null, referencia, observacion,
    });
    for (const [varianteId, cant] of lineas) {
      await inv.insertarDetalle(conn, movId, varianteId, cant);
      if (origenId) await inv.moverStock(conn, movId, varianteId, origenId, -cant);
      if (destinoId) await inv.moverStock(conn, movId, varianteId, destinoId, cant);
    }
    return movId;
  });
  res.status(201).json({ id, tipo, lineas: lineas.length, pares: lineas.reduce((a, [, c]) => a + c, 0) });
}));

router.get('/dashboard/metrics', authMiddleware, h(async (req, res) => {
  const [[tot]] = await db().query(`
    SELECT (SELECT COUNT(*) FROM modelos WHERE activo = 1) AS totalModelos,
           (SELECT COUNT(*) FROM variantes WHERE activo = 1) AS totalVariantes,
           COALESCE(SUM(s.cantidad * v.precio), 0) AS valorInventario
    FROM stock s JOIN variantes v ON v.id = s.variante_id WHERE v.activo = 1`);

  const [porUbicacion] = await db().query(`
    SELECT u.id, u.nombre, u.tipo, COALESCE(SUM(s.cantidad), 0) AS pares
    FROM ubicaciones u LEFT JOIN stock s ON s.ubicacion_id = u.id
    LEFT JOIN variantes v ON v.id = s.variante_id AND v.activo = 1
    WHERE u.activo = 1 GROUP BY u.id ORDER BY u.tipo, u.id`);

  // Variantes de la bodega central en o por debajo de su mínimo (incluye agotadas)
  const [bajoStock] = await db().query(`
    SELECT v.id, v.sku, m.nombre AS modelo, ma.nombre AS marca, co.nombre AS color, t.eu,
           v.stock_minimo AS stockMinimo, COALESCE(s.cantidad, 0) AS stock
    FROM variantes v
    JOIN modelos m ON m.id = v.modelo_id AND m.activo = 1
    JOIN marcas ma ON ma.id = m.marca_id
    JOIN colores co ON co.id = v.color_id
    JOIN tallas t ON t.id = v.talla_id
    LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = (SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' LIMIT 1)
    WHERE v.activo = 1 AND COALESCE(s.cantidad, 0) <= v.stock_minimo
    ORDER BY stock, m.nombre LIMIT 100`);

  const [[hoy]] = await db().query(`
    SELECT COUNT(*) AS movimientosHoy,
           CAST(COALESCE(SUM(tipo = 'ENTRADA'), 0) AS SIGNED) AS entradasHoy,
           CAST(COALESCE(SUM(tipo = 'DESPACHO'), 0) AS SIGNED) AS despachosHoy,
           CAST(COALESCE(SUM(tipo = 'VENTA'), 0) AS SIGNED) AS ventasHoy
    FROM movimientos WHERE fecha >= CURDATE()`);

  const [[pend]] = await db().query(`
    SELECT (SELECT COUNT(*) FROM traslados WHERE estado = 'EN_TRANSITO') AS trasladosEnTransito,
           (SELECT COUNT(*) FROM traslados WHERE novedad_estado = 'PENDIENTE') AS novedadesPendientes,
           (SELECT COUNT(*) FROM ordenes_compra WHERE estado IN ('PENDIENTE','RECIBIDA_PARCIAL')) AS ordenesAbiertas,
           (SELECT COUNT(*) FROM reservas WHERE estado = 'ACTIVA') AS reservasActivas,
           (SELECT COUNT(*) FROM alertas WHERE estado = 'ACTIVA') AS alertasActivas,
           (SELECT COUNT(*) FROM ajustes WHERE estado = 'PENDIENTE') AS ajustesPendientes,
           (SELECT COUNT(*) FROM conteos WHERE estado = 'ABIERTO') AS conteosAbiertos`);

  res.json({ ...tot, ...hoy, ...pend, porUbicacion, bajoStock });
}));

module.exports = router;
