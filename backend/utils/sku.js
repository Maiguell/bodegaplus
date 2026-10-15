/**
 * @file utils/sku.js
 * @description Genera el SKU de una variante: MARCA-MODELO-COLOR-TALLA (talla EU). Ej: NIK-AIRFORCE1-BLA-42.5
 */

'use strict';

const limpiar = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const buildSku = (marca, modelo, color, tallaEu) =>
  [limpiar(marca).slice(0, 3), limpiar(modelo).slice(0, 10), limpiar(color).slice(0, 3), String(tallaEu)].join('-');

module.exports = { buildSku };
