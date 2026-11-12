/**
 * @file lib/permisos.js
 * @description HU19 / HT02 — Roles, permisos y restricción por sede.
 *
 * Cada endpoint protegido exige un permiso (`requiere('ventas')`). Los roles de tienda
 * (VENDEDOR y ADMIN_TIENDA) solo operan sobre la sede asignada (`exigirSede`).
 * Sin token → 401 (authMiddleware). Rol sin permiso o sede ajena → 403.
 */

'use strict';

const { HttpError } = require('./http');

const ROLES = {
  ADMIN:        'Administrador',
  JEFE_BODEGA:  'Jefe de bodega',
  OPERADOR:     'Auxiliar de bodega',
  ADMIN_TIENDA: 'Administrador de tienda',
  VENDEDOR:     'Vendedor',
  AUDITOR:      'Auditor',
};

/** Roles limitados a su sede. */
const ROLES_CON_SEDE = ['ADMIN_TIENDA', 'VENDEDOR'];

/** Permiso → roles que lo tienen (ADMIN tiene todos). */
const PERMISOS = {
  'catalogo.editar':     ['JEFE_BODEGA'],
  'movimientos.bodega':  ['JEFE_BODEGA', 'OPERADOR', 'ADMIN_TIENDA'],
  'ventas':              ['JEFE_BODEGA', 'ADMIN_TIENDA', 'VENDEDOR'],
  'compras.crear':       ['JEFE_BODEGA'],
  'compras.recibir':     ['JEFE_BODEGA', 'OPERADOR'],
  'traslados.enviar':    ['JEFE_BODEGA', 'OPERADOR', 'ADMIN_TIENDA'],
  'traslados.recibir':   ['JEFE_BODEGA', 'OPERADOR', 'ADMIN_TIENDA'],
  'traslados.novedad':   ['JEFE_BODEGA'],
  'ajustes.registrar':   ['JEFE_BODEGA', 'OPERADOR', 'ADMIN_TIENDA'],
  'ajustes.aprobar':     ['JEFE_BODEGA'],
  'conteos.gestionar':   ['JEFE_BODEGA'],
  'conteos.capturar':    ['JEFE_BODEGA', 'OPERADOR', 'ADMIN_TIENDA'],
  'alertas.minimos':     ['JEFE_BODEGA', 'ADMIN_TIENDA'],
  'kardex.ver':          ['JEFE_BODEGA', 'OPERADOR', 'ADMIN_TIENDA', 'AUDITOR'],
  'informes.ver':        ['JEFE_BODEGA', 'ADMIN_TIENDA', 'AUDITOR'],
  'etiquetas':           ['JEFE_BODEGA', 'OPERADOR', 'ADMIN_TIENDA'],
  'procesos':            [],
  'usuarios':            [],
  'parametros':          [],
};

const puede = (rol, permiso) => rol === 'ADMIN' || (PERMISOS[permiso] ?? []).includes(rol);
const permisosDe = (rol) => Object.keys(PERMISOS).filter((p) => puede(rol, p));

/** Middleware: exige el permiso (después de authMiddleware). */
const requiere = (permiso) => (req, res, next) =>
  puede(req.user?.rol, permiso) ? next() : res.status(403).json({ message: 'No tienes permiso para realizar esta acción.' });

const restringidoASede = (user) => ROLES_CON_SEDE.includes(user?.rol) && !!user?.sedeId;

/** Lanza 403 si el usuario está limitado a su sede y la operación es sobre otra. */
function exigirSede(user, sedeId, accion = 'operar') {
  if (restringidoASede(user) && Number(sedeId) !== Number(user.sedeId)) {
    throw new HttpError(403, `Solo puedes ${accion} en tu sede.`);
  }
}

module.exports = { ROLES, ROLES_CON_SEDE, PERMISOS, puede, permisosDe, requiere, restringidoASede, exigirSede };
