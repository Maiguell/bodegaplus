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
