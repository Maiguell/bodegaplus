/**
 * @file routes/control.js
 * @description Control de diferencias de inventario:
 *   HU11 — Ajustes con causal sujetos a aprobación del jefe de bodega (rol ADMIN).
 *   HU12 — Conteo físico por sede: congela saldos, captura con lector o a mano, compara y propone ajustes.
 *   HU15 — Alertas de stock mínimo por talla y sede, con sugeridos de reposición.
 */

'use strict';

const express = require('express');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { authMiddleware, soloAdmin } = require('../lib/auth');
const inv = require('../lib/inventario');
const { evaluarAlerta } = require('../lib/alertas');

const router = express.Router();
const db = () => getPool();

const CAUSALES = ['AVERIA', 'PERDIDA', 'ERROR_CONTEO', 'OTRO'];
const codigo = (prefijo, id) => `${prefijo}-${String(id).padStart(4, '0')}`;

const DESC_VARIANTE = `v.sku, m.nombre AS modelo, ma.nombre AS marca, co.nombre AS color, t.eu`;
const JOIN_VARIANTE = `JOIN variantes v ON v.id = d.variante_id JOIN modelos m ON m.id = v.modelo_id
  JOIN marcas ma ON ma.id = m.marca_id JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id`;

// ── HU11: Ajustes ─────────────────────────────────────────────────────────────

const SELECT_AJUSTES = `
  SELECT a.id, CONCAT('AJ-', LPAD(a.id, 4, '0')) AS codigo, a.estado, a.causal, a.observacion, a.fecha,
         a.fecha_resolucion AS fechaResolucion, a.comentario_resolucion AS comentarioResolucion,
         a.ubicacion_id AS ubicacionId, u.nombre AS ubicacion, us.nombre AS usuario, ur.nombre AS resueltoPor,
         a.conteo_id AS conteoId, a.movimiento_id AS movimientoId,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('varianteId', d.variante_id, 'cantidad', d.cantidad, 'sku', v.sku, 'modelo', m.nombre,
                                           'marca', ma.nombre, 'color', co.nombre, 'talla', t.eu))
            FROM ajuste_detalle d ${JOIN_VARIANTE} WHERE d.ajuste_id = a.id) AS lineas,
         (SELECT CAST(COALESCE(SUM(d.cantidad), 0) AS SIGNED) FROM ajuste_detalle d WHERE d.ajuste_id = a.id) AS neto
  FROM ajustes a
  JOIN ubicaciones u ON u.id = a.ubicacion_id
  JOIN usuarios us ON us.id = a.usuario_id
  LEFT JOIN usuarios ur ON ur.id = a.resuelto_por`;

const leerAjuste = async (q, id) => {
  const [[a]] = await q.query(`${SELECT_AJUSTES} WHERE a.id = ?`, [id]);
  if (!a) throw new HttpError(404, 'Ajuste no encontrado.');
  return a;
};

/** Crea un ajuste PENDIENTE (no toca stock). `lineas` = pares [varianteId, diferencia]. */
async function crearAjuste(conn, { ubicacionId, causal, observacion, usuarioId, conteoId = null, lineas }) {
  const [r] = await conn.query(
    'INSERT INTO ajustes (ubicacion_id, causal, observacion, usuario_id, conteo_id) VALUES (?,?,?,?,?)',
    [ubicacionId, causal, observacion.slice(0, 255), usuarioId, conteoId]);
  await conn.query('INSERT INTO ajuste_detalle (ajuste_id, variante_id, cantidad) VALUES ?', [lineas.map(([v, c]) => [r.insertId, v, c])]);
  return r.insertId;
}

/** GET /api/ajustes?estado= */
router.get('/ajustes', authMiddleware, h(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.estado) { where = 'WHERE a.estado = ?'; params.push(req.query.estado); }
  const [rows] = await db().query(`${SELECT_AJUSTES} ${where} ORDER BY a.estado = 'PENDIENTE' DESC, a.fecha DESC, a.id DESC LIMIT 200`, params);
  res.json(rows);
}));

/** POST /api/ajustes { ubicacionId, causal, observacion, lineas: [{ varianteId, cantidad(±) }] } — cualquier usuario */
router.post('/ajustes', authMiddleware, h(async (req, res) => {
  const { ubicacionId, causal } = req.body ?? {};
  const observacion = String(req.body?.observacion ?? '').trim();
  if (!CAUSALES.includes(causal)) throw new HttpError(400, 'Indica la causal: avería, pérdida, error de conteo u otra.');
  if (!observacion) throw new HttpError(400, 'La observación es obligatoria.');
  const lineas = inv.consolidarLineas(req.body?.lineas, { permitirNegativos: true });
  if (lineas.some(([, c]) => c === 0)) throw new HttpError(400, 'Las diferencias no pueden ser cero.');
  const sede = await inv.sedeActiva(db(), ubicacionId);
  await inv.validarVariantes(db(), lineas.map(([id]) => id));
  // No se puede restar más de lo que hay: ese ajuste nunca podría aprobarse
  const [saldos] = await db().query(
    `SELECT v.id, v.sku, COALESCE(s.cantidad, 0) AS stock FROM variantes v
     LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = ? WHERE v.id IN (?)`, [sede.id, lineas.map(([id]) => id)]);
  const imposibles = lineas.filter(([vid, c]) => c < 0 && (saldos.find((s) => s.id === vid)?.stock ?? 0) + c < 0)
    .map(([vid, c]) => { const s = saldos.find((x) => x.id === vid); return `${s.sku} (hay ${s.stock}, ajuste ${c})`; });
  if (imposibles.length) throw new HttpError(400, `No puedes restar más de lo que hay en ${sede.nombre}: ${imposibles.join(', ')}.`);
  const id = await inv.enTransaccion((conn) => crearAjuste(conn, { ubicacionId: sede.id, causal, observacion, usuarioId: req.user.id, lineas }));
  res.status(201).json(await leerAjuste(db(), id));
}));

/** POST /api/ajustes/:id/aprobar { comentario? } — solo el jefe de bodega; aquí sí se mueve el stock. */
router.post('/ajustes/:id/aprobar', authMiddleware, soloAdmin, h(async (req, res) => {
  await inv.enTransaccion(async (conn) => {
    const [[a]] = await conn.query('SELECT * FROM ajustes WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!a) throw new HttpError(404, 'Ajuste no encontrado.');
    if (a.estado !== 'PENDIENTE') throw new HttpError(409, `El ajuste ya fue ${a.estado.toLowerCase()}.`);
    const [lineas] = await conn.query('SELECT variante_id, cantidad FROM ajuste_detalle WHERE ajuste_id = ? ORDER BY variante_id', [a.id]);
    const movId = await inv.insertarMovimiento(conn, {
      tipo: 'AJUSTE', usuarioId: req.user.id, destinoId: a.ubicacion_id, motivo: a.causal, ajusteId: a.id,
      referencia: codigo('AJ', a.id), observacion: a.observacion,
    });
    for (const l of lineas) {
      await inv.insertarDetalle(conn, movId, l.variante_id, l.cantidad);
      await inv.moverStock(conn, movId, l.variante_id, a.ubicacion_id, l.cantidad);
    }
    await conn.query(
      `UPDATE ajustes SET estado = 'APROBADO', resuelto_por = ?, fecha_resolucion = NOW(), comentario_resolucion = ?, movimiento_id = ?
       WHERE id = ?`, [req.user.id, String(req.body?.comentario ?? '').trim().slice(0, 255) || null, movId, a.id]);
  });
  res.json(await leerAjuste(db(), req.params.id));
}));

/** POST /api/ajustes/:id/rechazar { comentario } */
router.post('/ajustes/:id/rechazar', authMiddleware, soloAdmin, h(async (req, res) => {
  const comentario = String(req.body?.comentario ?? '').trim();
  if (!comentario) throw new HttpError(400, 'Indica el motivo del rechazo.');
  const [r] = await db().query(
    `UPDATE ajustes SET estado = 'RECHAZADO', resuelto_por = ?, fecha_resolucion = NOW(), comentario_resolucion = ?
     WHERE id = ? AND estado = 'PENDIENTE'`, [req.user.id, comentario.slice(0, 255), req.params.id]);
  if (!r.affectedRows) throw new HttpError(409, 'Solo se puede rechazar un ajuste pendiente.');
  res.json(await leerAjuste(db(), req.params.id));
}));

// ── HU12: Conteos físicos ─────────────────────────────────────────────────────

const SELECT_CONTEOS = `
  SELECT c.id, CONCAT('CF-', LPAD(c.id, 4, '0')) AS codigo, c.estado, c.fecha_inicio AS fechaInicio, c.fecha_cierre AS fechaCierre,
         c.observacion, c.ubicacion_id AS ubicacionId, u.nombre AS ubicacion, us.nombre AS usuario,
         (SELECT COUNT(*) FROM conteo_detalle d WHERE d.conteo_id = c.id) AS variantes,
         (SELECT COUNT(*) FROM conteo_detalle d WHERE d.conteo_id = c.id AND d.cantidad_contada IS NOT NULL) AS contadas,
         (SELECT COUNT(*) FROM conteo_detalle d WHERE d.conteo_id = c.id AND d.cantidad_contada IS NOT NULL
                                                   AND d.cantidad_contada <> d.saldo_sistema) AS diferencias,
         (SELECT a.id FROM ajustes a WHERE a.conteo_id = c.id LIMIT 1) AS ajusteId
  FROM conteos c JOIN ubicaciones u ON u.id = c.ubicacion_id JOIN usuarios us ON us.id = c.usuario_id`;

const leerConteo = async (q, id, conDetalle = true) => {
  const [[c]] = await q.query(`${SELECT_CONTEOS} WHERE c.id = ?`, [id]);
  if (!c) throw new HttpError(404, 'Conteo no encontrado.');
  if (conDetalle) {
    const [detalle] = await q.query(`
      SELECT d.variante_id AS varianteId, d.saldo_sistema AS sistema, d.cantidad_contada AS contada,
             IF(d.cantidad_contada IS NULL, NULL, d.cantidad_contada - d.saldo_sistema) AS diferencia,
             v.codigo_barras AS codigoBarras, ${DESC_VARIANTE}
      FROM conteo_detalle d ${JOIN_VARIANTE}
      WHERE d.conteo_id = ? ORDER BY ma.nombre, m.nombre, co.nombre, t.eu`, [id]);
    c.detalle = detalle;
  }
  return c;
};

router.get('/conteos', authMiddleware, h(async (req, res) => {
  const [rows] = await db().query(`${SELECT_CONTEOS} ORDER BY c.estado = 'ABIERTO' DESC, c.fecha_inicio DESC LIMIT 100`);
  res.json(rows);
}));

router.get('/conteos/:id', authMiddleware, h(async (req, res) => res.json(await leerConteo(db(), req.params.id))));

/** POST /api/conteos { ubicacionId, observacion? } (jefe de bodega) — congela el saldo de cada variante activa. */
router.post('/conteos', authMiddleware, soloAdmin, h(async (req, res) => {
  const sede = await inv.sedeActiva(db(), req.body?.ubicacionId);
  const id = await inv.enTransaccion(async (conn) => {
    const [[abierto]] = await conn.query("SELECT id FROM conteos WHERE ubicacion_id = ? AND estado = 'ABIERTO' FOR UPDATE", [sede.id]);
    if (abierto) throw new HttpError(409, `Ya hay un conteo abierto en ${sede.nombre} (${codigo('CF', abierto.id)}).`);
    const [r] = await conn.query('INSERT INTO conteos (ubicacion_id, usuario_id, observacion) VALUES (?,?,?)',
      [sede.id, req.user.id, String(req.body?.observacion ?? '').trim().slice(0, 255) || null]);
    await conn.query(`
      INSERT INTO conteo_detalle (conteo_id, variante_id, saldo_sistema)
      SELECT ?, v.id, COALESCE(s.cantidad, 0)
      FROM variantes v JOIN modelos m ON m.id = v.modelo_id AND m.activo = 1
      LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = ?
      WHERE v.activo = 1`, [r.insertId, sede.id]);
    return r.insertId;
  });
  res.status(201).json(await leerConteo(db(), id, false));
}));

/**
 * POST /api/conteos/:id/capturas { lineas: [{ varianteId?, codigo?, cantidad, modo: 'sumar'|'fijar' }] }
 * 'sumar' acumula (cada lectura del escáner suma 1); 'fijar' reemplaza (captura manual).
 */
router.post('/conteos/:id/capturas', authMiddleware, h(async (req, res) => {
  const lineas = req.body?.lineas;
  if (!Array.isArray(lineas) || !lineas.length) throw new HttpError(400, 'Envía al menos una captura.');
  const capturadas = await inv.enTransaccion(async (conn) => {
    const [[c]] = await conn.query('SELECT * FROM conteos WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!c) throw new HttpError(404, 'Conteo no encontrado.');
    if (c.estado !== 'ABIERTO') throw new HttpError(409, 'El conteo ya está cerrado.');
    const out = [];
    for (const l of lineas) {
      let varianteId = Number(l.varianteId) || null;
      if (!varianteId && l.codigo) {
        const [[v]] = await conn.query('SELECT id FROM variantes WHERE (sku = ? OR codigo_barras = ?) AND activo = 1', [l.codigo, l.codigo]);
        if (!v) throw new HttpError(404, `Código no reconocido: ${l.codigo}`);
        varianteId = v.id;
      }
      const cant = Number(l.cantidad);
      const modo = l.modo === 'fijar' ? 'fijar' : 'sumar';
      if (!varianteId || !Number.isInteger(cant) || (modo === 'fijar' ? cant < 0 : cant === 0)) {
        throw new HttpError(400, 'Cada captura necesita variante y una cantidad entera válida.');
      }
      // Variante creada después de iniciar: se agrega con su saldo actual como saldo del sistema
      await conn.query(
        `INSERT IGNORE INTO conteo_detalle (conteo_id, variante_id, saldo_sistema)
         SELECT ?, ?, COALESCE((SELECT cantidad FROM stock WHERE variante_id = ? AND ubicacion_id = ?), 0)`,
        [c.id, varianteId, varianteId, c.ubicacion_id]);
      await conn.query(
        modo === 'fijar'
          ? 'UPDATE conteo_detalle SET cantidad_contada = ? WHERE conteo_id = ? AND variante_id = ?'
          : 'UPDATE conteo_detalle SET cantidad_contada = GREATEST(0, COALESCE(cantidad_contada, 0) + ?) WHERE conteo_id = ? AND variante_id = ?',
        [cant, c.id, varianteId]);
      const [[d]] = await conn.query(
        `SELECT d.variante_id AS varianteId, d.saldo_sistema AS sistema, d.cantidad_contada AS contada, ${DESC_VARIANTE}
         FROM conteo_detalle d ${JOIN_VARIANTE} WHERE d.conteo_id = ? AND d.variante_id = ?`, [c.id, varianteId]);
      out.push(d);
    }
    return out;
  });
  res.json({ capturadas });
}));

/**
 * POST /api/conteos/:id/cerrar { noContadasEnCero?: boolean }
 * Calcula las diferencias contra el saldo congelado y genera un ajuste PENDIENTE de aprobación
 * (causal ERROR_CONTEO). Al aprobarlo, cada diferencia se aplica sobre el saldo de ese momento.
 */
router.post('/conteos/:id/cerrar', authMiddleware, soloAdmin, h(async (req, res) => {
  const noContadasEnCero = req.body?.noContadasEnCero === true;
  const ajusteId = await inv.enTransaccion(async (conn) => {
    const [[c]] = await conn.query('SELECT * FROM conteos WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!c) throw new HttpError(404, 'Conteo no encontrado.');
    if (c.estado !== 'ABIERTO') throw new HttpError(409, 'El conteo ya está cerrado.');
    if (noContadasEnCero) {
      await conn.query('UPDATE conteo_detalle SET cantidad_contada = 0 WHERE conteo_id = ? AND cantidad_contada IS NULL', [c.id]);
    }
    const [[{ contadas }]] = await conn.query('SELECT COUNT(*) AS contadas FROM conteo_detalle WHERE conteo_id = ? AND cantidad_contada IS NOT NULL', [c.id]);
    if (!contadas) throw new HttpError(400, 'No se ha contado ninguna variante.');
    const [difs] = await conn.query(
      `SELECT variante_id, cantidad_contada - saldo_sistema AS dif FROM conteo_detalle
       WHERE conteo_id = ? AND cantidad_contada IS NOT NULL AND cantidad_contada <> saldo_sistema ORDER BY variante_id`, [c.id]);
    await conn.query("UPDATE conteos SET estado = 'CERRADO', fecha_cierre = NOW() WHERE id = ?", [c.id]);
    if (!difs.length) return null;
    return crearAjuste(conn, {
      ubicacionId: c.ubicacion_id, causal: 'ERROR_CONTEO', usuarioId: req.user.id, conteoId: c.id,
      observacion: `Ajuste propuesto por el conteo físico ${codigo('CF', c.id)}`,
      lineas: difs.map((d) => [d.variante_id, d.dif]),
    });
  });
  res.json({ conteo: await leerConteo(db(), req.params.id), ajuste: ajusteId ? await leerAjuste(db(), ajusteId) : null });
}));

router.post('/conteos/:id/cancelar', authMiddleware, soloAdmin, h(async (req, res) => {
  const [r] = await db().query("UPDATE conteos SET estado = 'CANCELADO', fecha_cierre = NOW() WHERE id = ? AND estado = 'ABIERTO'", [req.params.id]);
  if (!r.affectedRows) throw new HttpError(409, 'Solo se puede cancelar un conteo abierto.');
  res.json(await leerConteo(db(), req.params.id, false));
}));

// ── HU15: Alertas de stock mínimo y sugeridos de reposición ──────────────────

/**
 * GET /api/alertas?estado=ACTIVA&ubicacionId=
 * Cada alerta activa trae el sugerido de reposición: lo que falta para llegar a 2 × mínimo,
 * y cuánto hay en la bodega central para cubrirlo.
 */
router.get('/alertas', authMiddleware, h(async (req, res) => {
  const filtros = [], params = [];
  const estado = req.query.estado ?? 'ACTIVA';
  if (estado !== 'todas') { filtros.push('a.estado = ?'); params.push(estado); }
  if (req.query.ubicacionId) { filtros.push('a.ubicacion_id = ?'); params.push(Number(req.query.ubicacionId)); }
  const [rows] = await db().query(`
    SELECT a.id, a.estado, a.creada_en AS creadaEn, a.resuelta_en AS resueltaEn,
           a.variante_id AS varianteId, a.ubicacion_id AS ubicacionId, u.nombre AS ubicacion, u.tipo AS ubicacionTipo,
           COALESCE(s.cantidad, 0) AS stock, COALESCE(sm.minimo, v.stock_minimo) AS minimo, sm.minimo IS NOT NULL AS minimoPropio,
           GREATEST(2 * COALESCE(sm.minimo, v.stock_minimo) - COALESCE(s.cantidad, 0), 0) AS sugerido,
           IF(u.tipo = 'BODEGA', NULL, COALESCE(sb.cantidad, 0)) AS enBodega,
           v.sku, m.nombre AS modelo, ma.nombre AS marca, co.nombre AS color, t.eu
    FROM alertas a
    JOIN ubicaciones u ON u.id = a.ubicacion_id
    JOIN variantes v ON v.id = a.variante_id JOIN modelos m ON m.id = v.modelo_id JOIN marcas ma ON ma.id = m.marca_id
    JOIN colores co ON co.id = v.color_id JOIN tallas t ON t.id = v.talla_id
    LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = u.id
    LEFT JOIN stock_minimos sm ON sm.variante_id = v.id AND sm.ubicacion_id = u.id
    LEFT JOIN stock sb ON sb.variante_id = v.id AND sb.ubicacion_id = (SELECT id FROM ubicaciones WHERE tipo = 'BODEGA' AND activo = 1 LIMIT 1)
    ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
    ORDER BY a.estado, u.tipo DESC, u.id, COALESCE(s.cantidad, 0), m.nombre, t.eu
    LIMIT 500`, params);
  res.json(rows);
}));

/** PUT /api/stock-minimos { varianteId, ubicacionId, minimo } (admin) — mínimo propio de una talla en una sede. */
router.put('/stock-minimos', authMiddleware, soloAdmin, h(async (req, res) => {
  const minimo = Number(req.body?.minimo);
  if (!Number.isInteger(minimo) || minimo < 0) throw new HttpError(400, 'El mínimo debe ser un entero mayor o igual a 0.');
  const sede = await inv.sedeActiva(db(), req.body?.ubicacionId);
  const varianteId = Number(req.body?.varianteId);
  await inv.validarVariantes(db(), [varianteId]);
  await inv.enTransaccion(async (conn) => {
    await conn.query(
      'INSERT INTO stock_minimos (variante_id, ubicacion_id, minimo) VALUES (?,?,?) ON DUPLICATE KEY UPDATE minimo = VALUES(minimo)',
      [varianteId, sede.id, minimo]);
    await evaluarAlerta(conn, varianteId, sede.id);
  });
  res.json({ varianteId, ubicacionId: sede.id, minimo });
}));

module.exports = router;
