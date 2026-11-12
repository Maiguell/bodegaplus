/**
 * @file lib/tareas.js
 * @description HT06 — Procesos programados.
 *   - Cada minuto: libera reservas vencidas (HU14).
 *   - Cada 5 minutos: barrido de alertas de stock mínimo (HU15; la evaluación principal es por evento).
 *   - Cada noche (INDICADORES_HOUR, 2 a. m. por defecto): precalcula indicadores de rotación y
 *     días sin movimiento (HU16 / HU18).
 *   - Cada noche (BACKUP_HOUR) si BACKUP_ENABLED=true: copia de seguridad con retención (HT08).
 * Cada ejecución de los procesos nocturnos (o manual) queda registrada en `ejecuciones_proceso`.
 */

'use strict';

const { getPool } = require('../db');
const config = require('./config');
const { evaluarTodas } = require('./alertas');
const { crearRespaldo } = require('./respaldo');

const db = () => getPool();

/** Tipos de movimiento que cuentan como "movimiento" para la mercancía quieta (ventas y traslados). */
const TIPOS_ROTACION = ['VENTA', 'CAMBIO', 'TRASLADO_ENVIO', 'TRASLADO_RECEPCION', 'DESPACHO', 'DEVOLUCION'];

/** Ejecuta `fn` y registra inicio, fin, estado, filas y mensaje. */
async function registrar(proceso, origen, fn) {
  const [r] = await db().query('INSERT INTO ejecuciones_proceso (proceso, origen) VALUES (?, ?)', [proceso, origen]);
  try {
    const { filas = null, mensaje = null } = (await fn()) ?? {};
    await db().query("UPDATE ejecuciones_proceso SET fin = NOW(), estado = 'OK', filas = ?, mensaje = ? WHERE id = ?",
      [filas, mensaje?.slice(0, 500) ?? null, r.insertId]);
    return { id: r.insertId, estado: 'OK', filas, mensaje };
  } catch (err) {
    await db().query("UPDATE ejecuciones_proceso SET fin = NOW(), estado = 'ERROR', mensaje = ? WHERE id = ?",
      [err.message.slice(0, 500), r.insertId]);
    throw err;
  }
}

/** Recalcula `indicadores_variante` para todas las existencias. */
async function calcularIndicadores() {
  const tipos = TIPOS_ROTACION.map((t) => `'${t}'`).join(',');
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM indicadores_variante');
    const [r] = await conn.query(`
      INSERT INTO indicadores_variante
        (variante_id, ubicacion_id, stock, ultimo_movimiento, dias_sin_movimiento, vendidas_30d, vendidas_90d, calculado_en)
      SELECT s.variante_id, s.ubicacion_id, s.cantidad, um.ultimo,
             DATEDIFF(NOW(), COALESCE(um.ultimo, ap.apertura, NOW())),
             COALESCE(v.v30, 0), COALESCE(v.v90, 0), NOW()
      FROM stock s
      LEFT JOIN (
        SELECT k.variante_id, k.ubicacion_id, MAX(k.fecha) AS ultimo
        FROM kardex k JOIN movimientos mv ON mv.id = k.movimiento_id
        WHERE mv.tipo IN (${tipos}) GROUP BY k.variante_id, k.ubicacion_id
      ) um ON um.variante_id = s.variante_id AND um.ubicacion_id = s.ubicacion_id
      LEFT JOIN (
        SELECT variante_id, ubicacion_id, MIN(fecha) AS apertura FROM kardex GROUP BY variante_id, ubicacion_id
      ) ap ON ap.variante_id = s.variante_id AND ap.ubicacion_id = s.ubicacion_id
      LEFT JOIN (
        SELECT d.variante_id, mv.origen_id AS ubicacion_id,
               SUM(IF(mv.fecha >= NOW() - INTERVAL 30 DAY, d.cantidad, 0)) AS v30, SUM(d.cantidad) AS v90
        FROM movimiento_detalle d JOIN movimientos mv ON mv.id = d.movimiento_id
        WHERE mv.tipo = 'VENTA' AND mv.fecha >= NOW() - INTERVAL 90 DAY
        GROUP BY d.variante_id, mv.origen_id
      ) v ON v.variante_id = s.variante_id AND v.ubicacion_id = s.ubicacion_id`);
    await conn.commit();
    return { filas: r.affectedRows, mensaje: `Indicadores de ${r.affectedRows} existencias recalculados.` };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Procesos que se pueden lanzar a mano desde la API (admin). */
const PROCESOS = {
  INDICADORES: () => calcularIndicadores(),
  ALERTAS: async () => { const r = await evaluarTodas(db()); return { filas: r.activas + r.resueltas, mensaje: `${r.activas} alerta(s) creada(s)/actualizada(s), ${r.resueltas} resuelta(s).` }; },
  RESPALDO: async () => {
    const r = await crearRespaldo();
    return { filas: 1, mensaje: `${r.archivo.split(/[\\/]/).pop()} (${Math.round(r.bytes / 1024)} KB). Eliminados por retención: ${r.eliminados.length}.` };
  },
};

const ejecutar = (proceso, origen = 'MANUAL') => {
  if (!PROCESOS[proceso]) throw new Error(`Proceso desconocido: ${proceso}`);
  return registrar(proceso, origen, PROCESOS[proceso]);
};

/** ¿Ya hubo una ejecución exitosa hoy (hora local del servidor)? */
async function corrioHoy(proceso) {
  const [[r]] = await db().query(
    "SELECT COUNT(*) AS n FROM ejecuciones_proceso WHERE proceso = ? AND estado = 'OK' AND inicio >= CURDATE()", [proceso]);
  return r.n > 0;
}

/** Lanza los procesos nocturnos si ya pasó su hora y no corrieron hoy. También cubre el primer arranque. */
async function revisarNocturnos() {
  const hora = new Date().getHours();
  const [[{ nunca }]] = await db().query("SELECT COUNT(*) = 0 AS nunca FROM ejecuciones_proceso WHERE proceso = 'INDICADORES' AND estado = 'OK'");
  if ((hora >= config.horaIndicadores || nunca) && !(await corrioHoy('INDICADORES'))) await ejecutar('INDICADORES', 'PROGRAMADO');
  if (config.respaldo.habilitado && hora >= config.respaldo.hora && !(await corrioHoy('RESPALDO'))) await ejecutar('RESPALDO', 'PROGRAMADO');
}

/**
 * Programa todas las tareas. `liberarReservas` llega desde routes/tienda para no crear dependencias circulares.
 * @param {{liberarReservas: () => Promise<number>}} deps
 */
function iniciar({ liberarReservas }) {
  const seguro = (nombre, fn) => () => Promise.resolve().then(fn).catch((err) => console.error(`Tarea ${nombre}:`, err.message));
  const reservas = seguro('reservas', async () => { const n = await liberarReservas(); if (n) console.log(`🔓 ${n} reserva(s) vencida(s) liberada(s).`); });
  const alertas = seguro('alertas', () => evaluarTodas(db()));
  const nocturnos = seguro('nocturnos', revisarNocturnos);

  reservas(); alertas(); nocturnos();
  setInterval(reservas, 60_000).unref();
  setInterval(alertas, 5 * 60_000).unref();
  setInterval(nocturnos, 10 * 60_000).unref();
}

module.exports = { iniciar, ejecutar, calcularIndicadores, PROCESOS: Object.keys(PROCESOS), TIPOS_ROTACION };
