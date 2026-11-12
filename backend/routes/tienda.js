/**
 * @file routes/tienda.js
 * @description Operación de tienda:
 *   HU13 — Disponibilidad por talla en todas las sedes
 *   HU10 — Cambio de talla del cliente
 *   HU14 — Reservas con vencimiento automático
 * (HU06, la venta, se registra en POST /api/movimientos con tipo VENTA.)
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const inv = require('../lib/inventario');

const router = express.Router();
const db = () => getPool();

// ── HU14: Reservas ────────────────────────────────────────────────────────────

/**
 * Devuelve al disponible las unidades de una reserva activa y la cierra con `estado`.
 * Debe llamarse dentro de una transacción con la reserva ya bloqueada.
 */
async function liberarReserva(conn, r, estado, usuarioId, observacion) {
  const movId = await inv.insertarMovimiento(conn, {
    tipo: 'LIBERACION_RESERVA', usuarioId, destinoId: r.ubicacion_id, reservaId: r.id, observacion,
  });
  await inv.insertarDetalle(conn, movId, r.variante_id, r.cantidad);
  await inv.moverStock(conn, movId, r.variante_id, r.ubicacion_id, r.cantidad);
  await conn.query('UPDATE reservas SET estado = ?, cerrada_en = NOW() WHERE id = ?', [estado, r.id]);
}

/** Libera automáticamente las reservas vencidas. Devuelve cuántas liberó. */
async function liberarReservasVencidas() {
  const [vencidas] = await db().query("SELECT id FROM reservas WHERE estado = 'ACTIVA' AND vence_en <= NOW()");
  let n = 0;
  for (const { id } of vencidas) {
    n += await inv.enTransaccion(async (conn) => {
      const [[r]] = await conn.query("SELECT * FROM reservas WHERE id = ? AND estado = 'ACTIVA' AND vence_en <= NOW() FOR UPDATE", [id]);
      if (!r) return 0;
      await liberarReserva(conn, r, 'VENCIDA', r.usuario_id, 'Vencimiento automático de la reserva');
      return 1;
    });
  }
  return n;
}

const SELECT_RESERVAS = `
  SELECT r.id, CONCAT('RES-', LPAD(r.id, 4, '0')) AS codigo, r.estado, r.cantidad, r.cliente_nombre AS clienteNombre,
         r.cliente_telefono AS clienteTelefono, r.creada_en AS creadaEn, r.vence_en AS venceEn, r.cerrada_en AS cerradaEn,
         r.variante_id AS varianteId, v.sku, m.nombre AS modelo, ma.nombre AS marca, co.nombre AS color, t.eu,
         r.ubicacion_id AS ubicacionId, u.nombre AS ubicacion, us.nombre AS usuario
  FROM reservas r
  JOIN variantes v ON v.id = r.variante_id JOIN modelos m ON m.id = v.modelo_id JOIN marcas ma ON ma.id = m.marca_id
  JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id
  JOIN ubicaciones u ON u.id = r.ubicacion_id JOIN usuarios us ON us.id = r.usuario_id`;

const leerReserva = async (id) => (await db().query(`${SELECT_RESERVAS} WHERE r.id = ?`, [id]))[0][0];

/** GET /api/reservas?estado=ACTIVA */
router.get('/reservas', authMiddleware, h(async (req, res) => {
  await liberarReservasVencidas();
  const params = [];
  let where = '';
  if (req.query.estado) { where = 'WHERE r.estado = ?'; params.push(req.query.estado); }
  const [rows] = await db().query(`${SELECT_RESERVAS} ${where} ORDER BY r.estado = 'ACTIVA' DESC, r.creada_en DESC LIMIT 200`, params);
  res.json(rows);
}));

/** POST /api/reservas { varianteId, ubicacionId, cantidad=1, clienteNombre, clienteTelefono?, horas=48 } */
router.post('/reservas', authMiddleware, h(async (req, res) => {
  const { varianteId, ubicacionId, clienteNombre, clienteTelefono } = req.body ?? {};
  const cantidad = Number(req.body?.cantidad ?? 1);
  const horas = Number(req.body?.horas ?? 48);
  const nombre = String(clienteNombre ?? '').trim();
  if (!nombre) throw new HttpError(400, 'El nombre del cliente es requerido.');
  if (!Number.isInteger(cantidad) || cantidad < 1) throw new HttpError(400, 'Cantidad inválida.');
  if (!Number.isInteger(horas) || horas < 1 || horas > 168) throw new HttpError(400, 'La vigencia debe estar entre 1 y 168 horas.');
  const sede = await inv.sedeActiva(db(), ubicacionId);
  await inv.validarVariantes(db(), [Number(varianteId)]);

  const id = await inv.enTransaccion(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO reservas (variante_id, ubicacion_id, cantidad, cliente_nombre, cliente_telefono, vence_en, usuario_id)
       VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)`,
      [Number(varianteId), sede.id, cantidad, nombre.slice(0, 100), String(clienteTelefono ?? '').trim().slice(0, 30) || null, horas, req.user.id]);
    const movId = await inv.insertarMovimiento(conn, {
      tipo: 'RESERVA', usuarioId: req.user.id, origenId: sede.id, reservaId: r.insertId,
      observacion: `Reserva para ${nombre} por ${horas} h`,
    });
    await inv.insertarDetalle(conn, movId, Number(varianteId), cantidad);
    await inv.moverStock(conn, movId, Number(varianteId), sede.id, -cantidad);
    return r.insertId;
  });
  res.status(201).json(await leerReserva(id));
}));

/** POST /api/reservas/:id/vender { referencia? } - Convierte la reserva en venta. */
router.post('/reservas/:id/vender', authMiddleware, h(async (req, res) => {
  const vencida = await inv.enTransaccion(async (conn) => {
    const [[r]] = await conn.query('SELECT *, vence_en <= NOW() AS vencida FROM reservas WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!r) throw new HttpError(404, 'Reserva no encontrada.');
    if (r.estado !== 'ACTIVA') throw new HttpError(409, `La reserva ya está ${r.estado.toLowerCase()}.`);
    if (r.vencida) {
      await liberarReserva(conn, r, 'VENCIDA', r.usuario_id, 'Vencimiento automático de la reserva');
      return true;
    }
    // La unidad vuelve un instante al disponible y sale como venta: el kardex refleja la salida real.
    const movId = await inv.insertarMovimiento(conn, {
      tipo: 'VENTA', usuarioId: req.user.id, origenId: r.ubicacion_id, reservaId: r.id,
      referencia: req.body?.referencia, observacion: `Venta de la reserva de ${r.cliente_nombre}`,
    });
    await inv.insertarDetalle(conn, movId, r.variante_id, r.cantidad);
    await inv.moverStock(conn, movId, r.variante_id, r.ubicacion_id, r.cantidad);
    await inv.moverStock(conn, movId, r.variante_id, r.ubicacion_id, -r.cantidad);
    await conn.query("UPDATE reservas SET estado = 'VENDIDA', cerrada_en = NOW() WHERE id = ?", [r.id]);
    return false;
  });
  if (vencida) throw new HttpError(409, 'La reserva venció y la unidad se liberó. Verifica la disponibilidad.');
  res.json(await leerReserva(req.params.id));
}));

/** POST /api/reservas/:id/cancelar */
router.post('/reservas/:id/cancelar', authMiddleware, h(async (req, res) => {
  await inv.enTransaccion(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM reservas WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!r) throw new HttpError(404, 'Reserva no encontrada.');
    if (r.estado !== 'ACTIVA') throw new HttpError(409, `La reserva ya está ${r.estado.toLowerCase()}.`);
    await liberarReserva(conn, r, 'CANCELADA', req.user.id, 'Reserva cancelada');
  });
  res.json(await leerReserva(req.params.id));
}));

// ── HU13: Disponibilidad multisede ────────────────────────────────────────────

/**
 * GET /api/disponibilidad?q= - Busca por SKU, código de barras, código de estilo, modelo o marca.
 * Devuelve, por modelo y color, una matriz talla × sede con las unidades disponibles
 * y las reservadas (que ya no cuentan como disponibles).
 */
router.get('/disponibilidad', authMiddleware, h(async (req, res) => {
  const inicio = Date.now();
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) throw new HttpError(400, 'Escribe al menos 2 caracteres o escanea un código.');
  await liberarReservasVencidas();

  const like = `%${q}%`;
  const [variantes] = await db().query(`
    SELECT v.id AS varianteId, v.sku, v.codigo_barras AS codigoBarras, m.id AS modeloId, m.nombre AS modelo,
           m.codigo_estilo AS codigoEstilo, ma.nombre AS marca, co.id AS colorId, co.nombre AS color, co.hex AS colorHex,
           t.eu, t.us, v.precio
    FROM variantes v
    JOIN modelos m ON m.id = v.modelo_id AND m.activo = 1
    JOIN marcas ma ON ma.id = m.marca_id
    JOIN colores co ON co.id = v.color_id
    JOIN tallas t ON t.id = v.talla_id
    WHERE v.activo = 1 AND (
      v.modelo_id IN (SELECT modelo_id FROM variantes WHERE sku = ? OR codigo_barras = ?)
      OR m.nombre LIKE ? OR m.codigo_estilo LIKE ? OR ma.nombre LIKE ? OR CONCAT(ma.nombre, ' ', m.nombre) LIKE ?)
    ORDER BY ma.nombre, m.nombre, co.nombre, t.eu
    LIMIT 400`, [q, q, like, like, like, like]);

  const [ubicaciones] = await db().query('SELECT id, nombre, tipo FROM ubicaciones WHERE activo = 1 ORDER BY tipo, id');
  const ids = variantes.map((v) => v.varianteId);
  const [stock] = ids.length
    ? await db().query('SELECT variante_id, ubicacion_id, cantidad FROM stock WHERE variante_id IN (?)', [ids]) : [[]];
  const [reservado] = ids.length
    ? await db().query(`SELECT variante_id, ubicacion_id, CAST(SUM(cantidad) AS SIGNED) AS cantidad FROM reservas
                        WHERE estado = 'ACTIVA' AND variante_id IN (?) GROUP BY variante_id, ubicacion_id`, [ids]) : [[]];
  const mapa = (filas) => {
    const m = new Map();
    for (const f of filas) { if (!m.has(f.variante_id)) m.set(f.variante_id, {}); m.get(f.variante_id)[f.ubicacion_id] = f.cantidad; }
    return m;
  };
  const stockPor = mapa(stock), reservaPor = mapa(reservado);

  const grupos = new Map();
  for (const v of variantes) {
    const clave = `${v.modeloId}-${v.colorId}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { modeloId: v.modeloId, modelo: v.modelo, marca: v.marca, codigoEstilo: v.codigoEstilo,
        color: v.color, colorHex: v.colorHex, precio: v.precio, tallas: [] });
    }
    const disponible = stockPor.get(v.varianteId) ?? {};
    grupos.get(clave).tallas.push({
      varianteId: v.varianteId, sku: v.sku, eu: v.eu, us: v.us,
      exacta: v.sku.toUpperCase() === q.toUpperCase() || v.codigoBarras === q,
      disponible, reservado: reservaPor.get(v.varianteId) ?? {},
      total: Object.values(disponible).reduce((a, b) => a + b, 0),
    });
  }
  res.json({ q, ubicaciones, resultados: [...grupos.values()], ms: Date.now() - inicio });
}));

// ── HU10: Cambio de talla ─────────────────────────────────────────────────────

/**
 * POST /api/cambios { ubicacionId, facturaOriginal, devuelveVarianteId, llevaVarianteId, cantidad=1, observacion? }
 * Un solo movimiento CAMBIO: suma la talla devuelta y descuenta la nueva en la misma sede.
 * Si la talla nueva no alcanza, responde 409 con las sedes que sí la tienen.
 */
router.post('/cambios', authMiddleware, h(async (req, res) => {
  const { ubicacionId, facturaOriginal, observacion } = req.body ?? {};
  const devuelve = Number(req.body?.devuelveVarianteId), lleva = Number(req.body?.llevaVarianteId);
  const cantidad = Number(req.body?.cantidad ?? 1);
  const factura = String(facturaOriginal ?? '').trim();
  if (!factura) throw new HttpError(400, 'Indica la factura original de la venta.');
  if (!devuelve || !lleva) throw new HttpError(400, 'Indica la talla que devuelve y la que se lleva.');
  if (devuelve === lleva) throw new HttpError(400, 'La talla nueva debe ser distinta a la devuelta.');
  if (!Number.isInteger(cantidad) || cantidad < 1) throw new HttpError(400, 'Cantidad inválida.');
  const sede = await inv.sedeActiva(db(), ubicacionId);

  const [vs] = await db().query(
    'SELECT v.id, v.modelo_id, v.sku, t.eu FROM variantes v JOIN tallas t ON t.id = v.talla_id WHERE v.id IN (?) AND v.activo = 1', [[devuelve, lleva]]);
  if (vs.length !== 2) throw new HttpError(404, 'Alguna variante no existe.');
  if (vs[0].modelo_id !== vs[1].modelo_id) throw new HttpError(400, 'El cambio de talla debe ser sobre la misma referencia.');
  const vDev = vs.find((v) => v.id === devuelve), vLleva = vs.find((v) => v.id === lleva);

  const id = await inv.enTransaccion(async (conn) => {
    const movId = await inv.insertarMovimiento(conn, {
      tipo: 'CAMBIO', usuarioId: req.user.id, origenId: sede.id, destinoId: sede.id, motivo: 'TALLA_INCORRECTA',
      referencia: factura.slice(0, 60), observacion: observacion || `Cambio EU ${vDev.eu} → EU ${vLleva.eu}`,
    });
    await inv.insertarDetalle(conn, movId, devuelve, cantidad);
    await inv.insertarDetalle(conn, movId, lleva, -cantidad);
    // Orden de bloqueo por id de variante para evitar interbloqueos
    for (const [vid, delta] of [[devuelve, cantidad], [lleva, -cantidad]].sort((a, b) => a[0] - b[0])) {
      await inv.moverStock(conn, movId, vid, sede.id, delta);
    }
    return movId;
  });
  res.status(201).json({ id, tipo: 'CAMBIO', sede: sede.nombre, devuelta: vDev.sku, entregada: vLleva.sku, cantidad });
}));

module.exports = { router, liberarReservasVencidas };
