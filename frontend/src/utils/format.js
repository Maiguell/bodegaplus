/**
 * @module format
 * @description Helpers de formato y escape de HTML para las vistas.
 */

/** Escapa texto para insertarlo de forma segura en innerHTML. */
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Precio en pesos colombianos. */
export const moneda = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n ?? 0);

export const numero = (n) => new Intl.NumberFormat('es-CO').format(n ?? 0);

export const fechaHora = (iso) =>
  iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const fechaHoraLarga = (iso) =>
  iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Metadatos de presentación por tipo de movimiento. */
export const TIPOS_MOV = {
  ENTRADA:            { label: 'Entrada',            signo: '+', clase: 'entrada' },
  DESPACHO:           { label: 'Despacho',           signo: '→', clase: 'despacho' },
  DEVOLUCION:         { label: 'Devolución',         signo: '←', clase: 'devolucion' },
  AJUSTE:             { label: 'Ajuste',             signo: '±', clase: 'ajuste' },
  VENTA:              { label: 'Venta',              signo: '$', clase: 'venta' },
  CAMBIO:             { label: 'Cambio de talla',    signo: '⇄', clase: 'cambio' },
  TRASLADO_ENVIO:     { label: 'Traslado enviado',   signo: '↗', clase: 'despacho' },
  TRASLADO_RECEPCION: { label: 'Traslado recibido',  signo: '↘', clase: 'entrada' },
  RESERVA:            { label: 'Reserva',            signo: '◷', clase: 'reserva' },
  LIBERACION_RESERVA: { label: 'Reserva liberada',   signo: '↺', clase: 'ajuste' },
  SALDO_INICIAL:      { label: 'Saldo inicial',      signo: '=', clase: 'ajuste' },
};

const codigoTraslado = (id) => `TR-${String(id).padStart(4, '0')}`;

/** Texto origen → destino de un movimiento del historial, según su tipo. */
export const rutaMovimiento = (m) => {
  switch (m.tipo) {
    case 'ENTRADA': return `${m.proveedor ?? 'Sin proveedor'} → ${m.destino}${m.ordenCompra ? ` (${m.ordenCompra})` : ''}`;
    case 'AJUSTE': case 'LIBERACION_RESERVA': return m.destino;
    case 'VENTA': return `${m.origen} → Cliente`;
    case 'CAMBIO': case 'RESERVA': return m.origen;
    case 'TRASLADO_ENVIO': return `${m.origen} → en tránsito a ${m.destino} (${codigoTraslado(m.trasladoId)})`;
    case 'TRASLADO_RECEPCION': return `${m.origen} → ${m.destino} (${codigoTraslado(m.trasladoId)})`;
    default: return `${m.origen} → ${m.destino}`;
  }
};

/** Etiqueta y estilo de badge para los estados de OC, traslados y reservas. */
export const ESTADOS = {
  PENDIENTE:            { label: 'Pendiente',           badge: 'badge-warning' },
  RECIBIDA_PARCIAL:     { label: 'Recibida parcial',    badge: 'badge-info' },
  RECIBIDA:             { label: 'Recibida',            badge: 'badge-success' },
  ANULADA:              { label: 'Anulada',             badge: 'badge-danger' },
  EN_TRANSITO:          { label: 'En tránsito',         badge: 'badge-warning' },
  RECIBIDO:             { label: 'Recibido',            badge: 'badge-success' },
  RECIBIDO_CON_NOVEDAD: { label: 'Recibido con novedad', badge: 'badge-danger' },
  ACTIVA:               { label: 'Activa',              badge: 'badge-info' },
  VENDIDA:              { label: 'Vendida',             badge: 'badge-success' },
  VENCIDA:              { label: 'Vencida',             badge: 'badge-warning' },
  CANCELADA:            { label: 'Cancelada',           badge: 'badge-danger' },
};

export const badgeEstado = (estado) => {
  const e = ESTADOS[estado] ?? { label: estado, badge: 'badge-info' };
  return `<span class="badge ${e.badge}">${esc(e.label)}</span>`;
};

/**
 * Descarga filas como CSV que Excel abre directamente (separador ";" y BOM UTF-8).
 * @param {string} nombre - Nombre del archivo sin extensión.
 * @param {string[]} encabezados
 * @param {Array<Array<string|number>>} filas
 */
export const descargarCSV = (nombre, encabezados, filas) => {
  const celda = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [encabezados, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${nombre}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const MOTIVOS = {
  TALLA_INCORRECTA: 'Talla incorrecta', DEFECTO: 'Defecto de fábrica', SOBRANTE: 'Sobrante',
  CONTEO: 'Conteo físico', MERMA: 'Merma / daño', OTRO: 'Otro',
};

/** Etiqueta corta de talla: "EU 42 · US 9" */
export const tallaLabel = (t) => `EU ${t.eu} · US ${t.us}`;
