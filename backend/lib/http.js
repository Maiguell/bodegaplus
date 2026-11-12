/**
 * @file lib/http.js
 * @description Utilidades HTTP compartidas: error controlado y envoltorio de handlers async.
 */

'use strict';

/** Error HTTP controlado. `extra` se agrega al cuerpo JSON de la respuesta. */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Envuelve handlers async para delegar errores al middleware final. */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, h };
