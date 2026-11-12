/**
 * @file lib/alertas.js
 * @description HU15 — Alertas de stock mínimo por talla y sede.
 *
 * El mínimo de una variante en una sede es `stock_minimos.minimo` si existe, o `variantes.stock_minimo`.
 * Hay alerta cuando la existencia queda POR DEBAJO del mínimo (mínimo 3, existencia 2 → alerta).
 *   - Por evento: `evaluarAlerta` se llama desde el motor de inventario en cada cambio de stock,
 *     dentro de la misma transacción, así que la alerta aparece en cuanto se confirma el movimiento.
 *   - Programado (HT06): `evaluarTodas` recorre todo, por si cambian mínimos o variantes.
 */

'use strict';

const MINIMO = 'COALESCE(sm.minimo, v.stock_minimo)';

/** Crea, actualiza o resuelve la alerta de una variante en una sede según su saldo actual. */
async function evaluarAlerta(q, varianteId, ubicacionId) {
  const [[r]] = await q.query(`
    SELECT ${MINIMO} AS minimo, COALESCE(s.cantidad, 0) AS stock, v.activo AND u.activo AS activa
    FROM variantes v
    JOIN ubicaciones u ON u.id = ?
    LEFT JOIN stock_minimos sm ON sm.variante_id = v.id AND sm.ubicacion_id = u.id
    LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = u.id
    WHERE v.id = ?`, [ubicacionId, varianteId]);
  if (r && r.activa && r.stock < r.minimo) {
    await q.query(
      `INSERT INTO alertas (variante_id, ubicacion_id, stock, minimo, abierta) VALUES (?,?,?,?,1)
       ON DUPLICATE KEY UPDATE stock = VALUES(stock), minimo = VALUES(minimo)`,
      [varianteId, ubicacionId, r.stock, r.minimo]);
  } else {
    await q.query(
      `UPDATE alertas SET estado = 'RESUELTA', abierta = NULL, resuelta_en = NOW(), stock = ?
       WHERE variante_id = ? AND ubicacion_id = ? AND abierta = 1`, [r?.stock ?? 0, varianteId, ubicacionId]);
  }
}

/** Reevalúa todas las variantes activas en todas las sedes activas. */
async function evaluarTodas(q) {
  const [ins] = await q.query(`
    INSERT INTO alertas (variante_id, ubicacion_id, stock, minimo, abierta)
    SELECT v.id, u.id, COALESCE(s.cantidad, 0), ${MINIMO}, 1
    FROM variantes v
    JOIN modelos m ON m.id = v.modelo_id AND m.activo = 1
    CROSS JOIN ubicaciones u
    LEFT JOIN stock_minimos sm ON sm.variante_id = v.id AND sm.ubicacion_id = u.id
    LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = u.id
    WHERE v.activo = 1 AND u.activo = 1 AND COALESCE(s.cantidad, 0) < ${MINIMO}
    ON DUPLICATE KEY UPDATE stock = VALUES(stock), minimo = VALUES(minimo)`);
  const [res] = await q.query(`
    UPDATE alertas a
    JOIN variantes v ON v.id = a.variante_id
    JOIN modelos m ON m.id = v.modelo_id
    JOIN ubicaciones u ON u.id = a.ubicacion_id
    LEFT JOIN stock_minimos sm ON sm.variante_id = v.id AND sm.ubicacion_id = u.id
    LEFT JOIN stock s ON s.variante_id = v.id AND s.ubicacion_id = u.id
    SET a.estado = 'RESUELTA', a.abierta = NULL, a.resuelta_en = NOW(), a.stock = COALESCE(s.cantidad, 0)
    WHERE a.abierta = 1 AND (v.activo = 0 OR m.activo = 0 OR u.activo = 0 OR COALESCE(s.cantidad, 0) >= ${MINIMO})`);
  return { activas: ins.affectedRows, resueltas: res.affectedRows };
}

module.exports = { evaluarAlerta, evaluarTodas };
