/**
 * @module movimientosService
 * @description Movimientos de la bodega: entradas, despachos a locales, devoluciones y ajustes.
 */

import * as api from './api.js';

/** Historial de movimientos (más recientes primero), con sus líneas. */
export const getMovimientos = (limit = 100) => api.get(`/movimientos?limit=${limit}`);

/**
 * Registra un movimiento con varias líneas.
 * @param {object} mov
 * @param {'ENTRADA'|'DESPACHO'|'DEVOLUCION'|'AJUSTE'} mov.tipo
 * @param {number} [mov.localId] - Local destino (DESPACHO) u origen (DEVOLUCION).
 * @param {number} [mov.ubicacionId] - Ubicación a ajustar (AJUSTE).
 * @param {number} [mov.proveedorId] - Proveedor (ENTRADA).
 * @param {string} [mov.motivo] - Motivo (DEVOLUCION / AJUSTE).
 * @param {string} [mov.referencia] - Factura / guía.
 * @param {string} [mov.observacion]
 * @param {Array<{varianteId: number, cantidad: number}>} mov.detalle - Pares por variante.
 */
export const registrarMovimiento = (mov) => api.post('/movimientos', mov);

/** Métricas del dashboard: pares por ubicación, valor, alertas de bajo stock y actividad de hoy. */
export const getDashboardMetrics = () => api.get('/dashboard/metrics');
