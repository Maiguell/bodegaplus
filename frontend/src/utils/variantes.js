/**
 * @module variantes
 * @description Helpers para elegir variantes por SKU o código de barras (lector) en los formularios.
 */

import { esc } from './format.js';

export const descVariante = (v) => `${v.marca} ${v.modelo} · ${v.color} · EU ${v.eu}`;

/** Busca una variante por SKU o código de barras (sin distinguir mayúsculas). */
export const buscarVariante = (variantes, codigo) => {
  const c = String(codigo ?? '').trim().toUpperCase();
  if (!c) return undefined;
  return variantes.find((v) => v.sku.toUpperCase() === c || (v.codigoBarras && v.codigoBarras.toUpperCase() === c));
};

/** `<datalist>` con todas las variantes, para autocompletar el SKU. */
export const datalistVariantes = (id, variantes) =>
  `<datalist id="${id}">${variantes.map((v) => `<option value="${esc(v.sku)}">${esc(descVariante(v))}</option>`).join('')}</datalist>`;

/** Texto para el usuario cuando el backend responde "stock insuficiente" con sugerencias de sedes. */
export const mensajeSugerencias = (err) => {
  const s = err?.data?.sugerencias;
  if (!Array.isArray(s)) return err?.message ?? 'Error.';
  return s.length
    ? `${err.data.sku ?? 'La variante'} no alcanza en esta sede. Disponible en: ${s.map((x) => `${x.nombre} (${x.cantidad})`).join(', ')}.`
    : `${err.data.sku ?? 'La variante'} no tiene existencia suficiente en ninguna sede.`;
};
