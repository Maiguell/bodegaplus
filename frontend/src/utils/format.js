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

/** Metadatos de presentación por tipo de movimiento. */
export const TIPOS_MOV = {
  ENTRADA:    { label: 'Entrada',    icon: '📥', signo: '+', clase: 'entrada' },
  DESPACHO:   { label: 'Despacho',   icon: '🚚', signo: '→', clase: 'despacho' },
  DEVOLUCION: { label: 'Devolución', icon: '↩️', signo: '←', clase: 'devolucion' },
  AJUSTE:     { label: 'Ajuste',     icon: '🛠️', signo: '±', clase: 'ajuste' },
};

export const MOTIVOS = {
  TALLA_INCORRECTA: 'Talla incorrecta', DEFECTO: 'Defecto de fábrica', SOBRANTE: 'Sobrante',
  CONTEO: 'Conteo físico', MERMA: 'Merma / daño', OTRO: 'Otro',
};

/** Etiqueta corta de talla: "EU 42 · US 9" */
export const tallaLabel = (t) => `EU ${t.eu} · US ${t.us}`;
