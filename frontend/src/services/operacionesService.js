/**
 * @module operacionesService
 * @description Sprint 3 y 4: kardex, órdenes de compra, traslados, disponibilidad, cambios y reservas.
 */

import * as api from './api.js';

const qs = (params) => {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${new URLSearchParams(p)}` : '';
};

// ── Kardex (HU07 / HT04) ──────────────────────────────────────────────────────
/** @param {{varianteId?: number, sku?: string, ubicacionId?: number, desde?: string, hasta?: string}} filtros */
export const getKardex = (filtros) => api.get(`/kardex${qs(filtros)}`);
export const verificarKardex = () => api.get('/kardex/verificacion');

// ── Órdenes de compra (HU05) ──────────────────────────────────────────────────
export const getOrdenesCompra = (estado) => api.get(`/ordenes-compra${qs({ estado })}`);
export const getOrdenCompra = (id) => api.get(`/ordenes-compra/${id}`);
/** @param {{proveedorId: number, destinoId?: number, observacion?: string, lineas: Array<{varianteId: number, cantidad: number}>}} oc */
export const crearOrdenCompra = (oc) => api.post('/ordenes-compra', oc);
/** @param {{lineas: Array<{varianteId: number, cantidad: number}>, observacion?: string, referencia?: string}} datos */
export const recibirOrdenCompra = (id, datos) => api.post(`/ordenes-compra/${id}/recepcion`, datos);
export const anularOrdenCompra = (id) => api.post(`/ordenes-compra/${id}/anular`, {});

// ── Traslados (HU08 / HU09) ───────────────────────────────────────────────────
export const getTraslados = (filtros = {}) => api.get(`/traslados${qs(filtros)}`);
/** @param {{origenId: number, destinoId: number, observacion?: string, lineas: Array<{varianteId: number, cantidad: number}>}} t */
export const enviarTraslado = (t) => api.post('/traslados', t);
export const recibirTraslado = (id, datos) => api.post(`/traslados/${id}/recepcion`, datos);
export const revisarNovedad = (id, comentario) => api.post(`/traslados/${id}/novedad/revisar`, { comentario });

// ── Tienda (HU13 / HU10 / HU14) ───────────────────────────────────────────────
export const getDisponibilidad = (q) => api.get(`/disponibilidad${qs({ q })}`);
export const registrarCambio = (cambio) => api.post('/cambios', cambio);
export const getReservas = (estado) => api.get(`/reservas${qs({ estado })}`);
export const crearReserva = (reserva) => api.post('/reservas', reserva);
export const venderReserva = (id, referencia) => api.post(`/reservas/${id}/vender`, { referencia });
export const cancelarReserva = (id) => api.post(`/reservas/${id}/cancelar`, {});

// ── Ajustes (HU11) ────────────────────────────────────────────────────────────
export const getAjustes = (estado) => api.get(`/ajustes${qs({ estado })}`);
/** @param {{ubicacionId: number, causal: string, observacion: string, lineas: Array<{varianteId: number, cantidad: number}>}} a */
export const crearAjuste = (a) => api.post('/ajustes', a);
export const aprobarAjuste = (id, comentario) => api.post(`/ajustes/${id}/aprobar`, { comentario });
export const rechazarAjuste = (id, comentario) => api.post(`/ajustes/${id}/rechazar`, { comentario });

// ── Conteos físicos (HU12) ────────────────────────────────────────────────────
export const getConteos = () => api.get('/conteos');
export const getConteo = (id) => api.get(`/conteos/${id}`);
export const iniciarConteo = (ubicacionId, observacion) => api.post('/conteos', { ubicacionId, observacion });
/** @param {Array<{varianteId?: number, codigo?: string, cantidad: number, modo: 'sumar'|'fijar'}>} lineas */
export const capturarConteo = (id, lineas) => api.post(`/conteos/${id}/capturas`, { lineas });
export const cerrarConteo = (id, noContadasEnCero) => api.post(`/conteos/${id}/cerrar`, { noContadasEnCero });
export const cancelarConteo = (id) => api.post(`/conteos/${id}/cancelar`, {});

// ── Alertas de stock mínimo (HU15) ────────────────────────────────────────────
export const getAlertas = (filtros = {}) => api.get(`/alertas${qs(filtros)}`);
export const fijarMinimo = (varianteId, ubicacionId, minimo) => api.put('/stock-minimos', { varianteId, ubicacionId, minimo });

// ── Informes (HU16 / HU17 / HU18) y procesos (HT06 / HT08) ────────────────────
export const getRotacion = (filtros) => api.get(`/informes/rotacion${qs(filtros)}`);
export const getValorizado = (filtros) => api.get(`/informes/valorizado${qs(filtros)}`);
export const getSinMovimiento = (filtros) => api.get(`/informes/sin-movimiento${qs(filtros)}`);
export const getProcesos = () => api.get('/informes/procesos');
export const ejecutarProceso = (proceso) => api.post(`/informes/procesos/${proceso.toLowerCase()}/ejecutar`, {});
export const fijarCostoModelo = (modeloId, costo) => api.put(`/modelos/${modeloId}/costo`, { costo });
