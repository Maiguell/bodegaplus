/**
 * @file routes/informes.js
 * @description Informes gerenciales y procesos:
 *   HU16 — Rotación por talla (unidades vendidas, existencia promedio e índice de rotación).
 *   HU17 — Inventario valorizado a costo a una fecha de corte, por sede, categoría y referencia.
 *   HU18 — Mercancía sin movimiento (días sin movimiento, sede y valor inmovilizado).
 *   HT06 / HT08 — Registro de procesos programados y ejecución manual (admin).
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware, soloAdmin } = require('../lib/auth');
const tareas = require('../lib/tareas');
const { listarRespaldos } = require('../lib/respaldo');

const router = express.Router();
const db = () => getPool();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoy = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD local

const DESC = `v.sku, m.id AS modeloId, m.nombre AS modelo, ma.nombre AS marca, c.nombre AS categoria, co.nombre AS color, t.eu`;
const JOIN_DESC = `JOIN variantes v ON v.id = x.variante_id JOIN modelos m ON m.id = v.modelo_id JOIN marcas ma ON ma.id = m.marca_id
  JOIN categorias c ON c.id = m.categoria_id JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id`;

/** Agrupa filas sumando campos numéricos. */
const agrupar = (filas, clave, campos) => {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (!m.has(k.id)) m.set(k.id, { ...k, ...Object.fromEntries(campos.map((c) => [c, 0])) });
    const g = m.get(k.id);
    for (const c of campos) g[c] += f[c] ?? 0;
  }
  return [...m.values()];
};

// ── HU17: Inventario valorizado ───────────────────────────────────────────────

/**
 * GET /api/informes/valorizado?corte=AAAA-MM-DD&ubicacionId=
 * La cantidad a la fecha de corte sale del kardex (saldo al final de ese día); el valor usa el costo vigente.
 */
router.get('/valorizado', authMiddleware, h(async (req, res) => {
  const corte = req.query.corte || hoy();
  if (!FECHA.test(corte)) throw new HttpError(400, 'Fecha de corte con formato AAAA-MM-DD.');
  const params = [corte];
  let filtro = '';
  if (req.query.ubicacionId) { filtro = 'AND k.ubicacion_id = ?'; params.push(Number(req.query.ubicacionId)); }

  const [[{ apertura }]] = await db().query('SELECT MIN(fecha) AS apertura FROM kardex');
  const [filas] = await db().query(`
    SELECT x.variante_id AS varianteId, x.ubicacion_id AS ubicacionId, u.nombre AS ubicacion, x.cantidad,
           v.costo, CAST(x.cantidad * COALESCE(v.costo, 0) AS DECIMAL(16,2)) AS valor, ${DESC}
    FROM (
      SELECT k.variante_id, k.ubicacion_id, CAST(SUM(k.cantidad) AS SIGNED) AS cantidad
      FROM kardex k WHERE k.fecha < DATE_ADD(?, INTERVAL 1 DAY) ${filtro}
      GROUP BY k.variante_id, k.ubicacion_id HAVING cantidad <> 0
    ) x
    JOIN ubicaciones u ON u.id = x.ubicacion_id
    ${JOIN_DESC}
    ORDER BY u.tipo, u.id, c.nombre, ma.nombre, m.nombre, co.nombre, t.eu`, params);

  const campos = ['cantidad', 'valor'];
  const porSede = agrupar(filas, (f) => ({ id: f.ubicacionId, ubicacion: f.ubicacion }), campos);
  const porCategoria = agrupar(filas, (f) => ({ id: f.categoria, categoria: f.categoria }), campos);
  const porReferencia = agrupar(filas, (f) => ({ id: `${f.ubicacionId}-${f.modeloId}`, ubicacionId: f.ubicacionId, ubicacion: f.ubicacion,
    modeloId: f.modeloId, categoria: f.categoria, marca: f.marca, modelo: f.modelo }), campos);
  const sinCosto = agrupar(filas.filter((f) => f.costo === null), (f) => ({ id: f.modeloId, modeloId: f.modeloId, marca: f.marca, modelo: f.modelo }), ['cantidad']);

  res.json({
    corte,
    aperturaKardex: apertura,
    advertencia: apertura && corte < new Date(apertura).toLocaleDateString('en-CA')
      ? 'La fecha de corte es anterior a la apertura del kardex: no hay movimientos registrados antes de esa fecha.' : null,
    totales: { cantidad: filas.reduce((a, f) => a + f.cantidad, 0), valor: filas.reduce((a, f) => a + f.valor, 0) },
    porSede, porCategoria, porReferencia, sinCosto, filas,
  });
}));

// ── HU16: Rotación por talla ──────────────────────────────────────────────────

/**
 * GET /api/informes/rotacion?desde=&hasta=&ubicacionId=
 * Por referencia y talla: unidades vendidas en el periodo, existencia promedio diaria (desde el kardex)
 * e índice de rotación = vendidas / existencia promedio.
 */
router.get('/rotacion', authMiddleware, h(async (req, res) => {
  const hasta = req.query.hasta || hoy();
  const desde = req.query.desde || new Date(Date.now() - 29 * 864e5).toLocaleDateString('en-CA');
  if (!FECHA.test(desde) || !FECHA.test(hasta)) throw new HttpError(400, 'Fechas con formato AAAA-MM-DD.');
  if (desde > hasta) throw new HttpError(400, 'La fecha inicial es posterior a la final.');
  const dias = Math.round((new Date(hasta) - new Date(desde)) / 864e5) + 1;
  if (dias > 366) throw new HttpError(400, 'El rango máximo es de un año.');

  const ubic = Number(req.query.ubicacionId) || null;
  const fU = (col) => (ubic ? `AND ${col} = ${ubic}` : '');

  const [ventas] = await db().query(`
    SELECT d.variante_id, CAST(SUM(d.cantidad) AS SIGNED) AS vendidas
    FROM movimiento_detalle d JOIN movimientos mv ON mv.id = d.movimiento_id
    WHERE mv.tipo = 'VENTA' AND mv.fecha >= ? AND mv.fecha < DATE_ADD(?, INTERVAL 1 DAY) ${fU('mv.origen_id')}
    GROUP BY d.variante_id`, [desde, hasta]);
  const [inicial] = await db().query(`
    SELECT variante_id, CAST(SUM(cantidad) AS SIGNED) AS saldo FROM kardex
    WHERE fecha < ? ${fU('ubicacion_id')} GROUP BY variante_id`, [desde]);
  const [cambios] = await db().query(`
    SELECT variante_id, DATEDIFF(DATE(fecha), ?) AS dia, CAST(SUM(cantidad) AS SIGNED) AS delta FROM kardex
    WHERE fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 DAY) ${fU('ubicacion_id')}
    GROUP BY variante_id, dia`, [desde, desde, hasta]);

  // Antes de la apertura del kardex no hay saldos conocidos: el promedio se toma desde ese día
  const [[{ apertura }]] = await db().query("SELECT DATE_FORMAT(MIN(fecha), '%Y-%m-%d') AS apertura FROM kardex");
  const inicioEfectivo = apertura && apertura > desde ? apertura : desde;
  const offset = Math.min(dias - 1, Math.round((new Date(inicioEfectivo) - new Date(desde)) / 864e5));
  const diasEfectivos = dias - offset;

  // Existencia promedio: promedio del saldo al cierre de cada día del periodo efectivo
  const saldo0 = new Map(inicial.map((r) => [r.variante_id, r.saldo]));
  const deltas = new Map();
  for (const c of cambios) {
    if (!deltas.has(c.variante_id)) deltas.set(c.variante_id, new Array(dias).fill(0));
    deltas.get(c.variante_id)[c.dia] += c.delta;
  }
  const vendidas = new Map(ventas.map((v) => [v.variante_id, v.vendidas]));
  const ids = [...new Set([...saldo0.keys(), ...deltas.keys(), ...vendidas.keys()])];
  const porVariante = new Map();
  for (const id of ids) {
    let s = saldo0.get(id) ?? 0, acum = 0;
    const d = deltas.get(id);
    for (let i = 0; i < dias; i++) { s += d ? d[i] : 0; if (i >= offset) acum += s; }
    porVariante.set(id, { promedio: acum / diasEfectivos, final: s, vendidas: vendidas.get(id) ?? 0 });
  }

  let filas = [];
  if (ids.length) {
    const [desc] = await db().query(`SELECT x.id AS variante_id, ${DESC} FROM variantes x JOIN variantes v ON v.id = x.id
      JOIN modelos m ON m.id = v.modelo_id JOIN marcas ma ON ma.id = m.marca_id JOIN categorias c ON c.id = m.categoria_id
      JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id WHERE x.id IN (?)`, [ids]);
    // Por referencia (modelo) y talla, sumando colores
    const grupos = new Map();
    for (const d of desc) {
      const k = `${d.modeloId}-${d.eu}`;
      if (!grupos.has(k)) grupos.set(k, { modeloId: d.modeloId, marca: d.marca, modelo: d.modelo, categoria: d.categoria, eu: d.eu, vendidas: 0, existenciaPromedio: 0, existenciaFinal: 0 });
      const g = grupos.get(k), p = porVariante.get(d.variante_id);
      g.vendidas += p.vendidas; g.existenciaPromedio += p.promedio; g.existenciaFinal += p.final;
    }
    filas = [...grupos.values()]
      .filter((g) => g.vendidas > 0 || g.existenciaPromedio > 0)
      .map((g) => ({ ...g, existenciaPromedio: Math.round(g.existenciaPromedio * 100) / 100,
        rotacion: g.existenciaPromedio > 0 ? Math.round((g.vendidas / g.existenciaPromedio) * 1000) / 1000 : null }))
      .sort((a, b) => a.marca.localeCompare(b.marca) || a.modelo.localeCompare(b.modelo) || a.eu - b.eu);
  }
  res.json({
    desde, hasta, dias, diasEfectivos, ubicacionId: ubic, totalVendidas: filas.reduce((a, f) => a + f.vendidas, 0), filas,
    nota: offset > 0 ? `El kardex se abrió el ${inicioEfectivo}: la existencia promedio se calcula desde ese día (${diasEfectivos} día(s)).` : null,
  });
}));

// ── HU18: Sin movimiento ──────────────────────────────────────────────────────

/** GET /api/informes/sin-movimiento?dias=90&ubicacionId= — lee los indicadores del proceso nocturno (HT06). */
router.get('/sin-movimiento', authMiddleware, h(async (req, res) => {
  const dias = req.query.dias === undefined ? 90 : Number(req.query.dias);
  if (!Number.isInteger(dias) || dias < 0) throw new HttpError(400, 'Días inválidos.');
  const params = [dias];
  let filtro = '';
  if (req.query.ubicacionId) { filtro = 'AND x.ubicacion_id = ?'; params.push(Number(req.query.ubicacionId)); }
  const [filas] = await db().query(`
    SELECT x.variante_id AS varianteId, x.ubicacion_id AS ubicacionId, u.nombre AS ubicacion, x.stock,
           x.ultimo_movimiento AS ultimoMovimiento, x.dias_sin_movimiento AS diasSinMovimiento,
           v.costo, CAST(x.stock * COALESCE(v.costo, 0) AS DECIMAL(16,2)) AS valorInmovilizado, ${DESC}
    FROM indicadores_variante x
    JOIN ubicaciones u ON u.id = x.ubicacion_id
    ${JOIN_DESC}
    WHERE x.stock > 0 AND x.dias_sin_movimiento >= ? AND v.activo = 1 ${filtro}
    ORDER BY x.dias_sin_movimiento DESC, valorInmovilizado DESC
    LIMIT 1000`, params);
  const [[{ calculadoEn }]] = await db().query('SELECT MAX(calculado_en) AS calculadoEn FROM indicadores_variante');
  res.json({
    dias, calculadoEn, filas,
    totales: { variantes: filas.length, pares: filas.reduce((a, f) => a + f.stock, 0), valor: filas.reduce((a, f) => a + f.valorInmovilizado, 0) },
  });
}));

// ── HT06 / HT08: Procesos ─────────────────────────────────────────────────────

router.get('/procesos', authMiddleware, soloAdmin, h(async (req, res) => {
  const [ejecuciones] = await db().query('SELECT * FROM ejecuciones_proceso ORDER BY id DESC LIMIT 50');
  res.json({ procesos: tareas.PROCESOS, ejecuciones, respaldos: listarRespaldos().slice(0, 30) });
}));

router.post('/procesos/:proceso/ejecutar', authMiddleware, soloAdmin, h(async (req, res) => {
  const proceso = String(req.params.proceso).toUpperCase();
  if (!tareas.PROCESOS.includes(proceso)) throw new HttpError(404, 'Proceso desconocido.');
  try {
    res.json(await tareas.ejecutar(proceso, 'MANUAL'));
  } catch (err) {
    throw new HttpError(500, `El proceso ${proceso} falló: ${err.message}`);
  }
}));

module.exports = router;
