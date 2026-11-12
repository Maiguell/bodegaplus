/**
 * @file lib/parametros.js
 * @description RNF-08 — Parámetros de negocio configurables desde la aplicación (tabla `parametros`),
 * con caché en memoria que se invalida al actualizar.
 */

'use strict';

const { getPool } = require('../db');

/** Clave → { valor por defecto, descripción, mínimo, máximo }. */
const DEFINICION = {
  RESERVA_HORAS_DEFECTO: { defecto: 48, descripcion: 'Vigencia por defecto de una reserva (horas)', min: 1, max: 168 },
  REPOSICION_FACTOR:     { defecto: 2,  descripcion: 'Sugerido de reposición: llegar a este múltiplo del mínimo', min: 1, max: 10 },
  SIN_MOVIMIENTO_DIAS:   { defecto: 90, descripcion: 'Días para considerar mercancía sin movimiento', min: 1, max: 730 },
  STOCK_MINIMO_DEFECTO:  { defecto: 3,  descripcion: 'Stock mínimo por defecto de las variantes nuevas', min: 0, max: 1000 },
  LOGIN_MAX_INTENTOS:    { defecto: 5,  descripcion: 'Intentos fallidos antes de bloquear la cuenta', min: 3, max: 20 },
  LOGIN_BLOQUEO_MINUTOS: { defecto: 15, descripcion: 'Minutos de bloqueo tras los intentos fallidos', min: 1, max: 1440 },
  PASSWORD_MIN:          { defecto: 8,  descripcion: 'Longitud mínima de contraseña', min: 8, max: 64 },
};

let cache = null;

async function todos() {
  if (!cache) {
    const [rows] = await getPool().query('SELECT clave, valor FROM parametros');
    const guardados = Object.fromEntries(rows.map((r) => [r.clave, Number(r.valor)]));
    cache = Object.fromEntries(Object.entries(DEFINICION).map(([k, d]) => [k, guardados[k] ?? d.defecto]));
  }
  return cache;
}

const obtener = async (clave) => (await todos())[clave];

async function actualizar(clave, valor) {
  const d = DEFINICION[clave];
  if (!d) throw Object.assign(new Error('Parámetro desconocido.'), { status: 404 });
  const n = Number(valor);
  if (!Number.isFinite(n) || n < d.min || n > d.max) {
    throw Object.assign(new Error(`El valor debe estar entre ${d.min} y ${d.max}.`), { status: 400 });
  }
  await getPool().query('INSERT INTO parametros (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [clave, String(n)]);
  cache = null;
  return n;
}

const listar = async () => {
  const v = await todos();
  return Object.entries(DEFINICION).map(([clave, d]) => ({ clave, valor: v[clave], defecto: d.defecto, descripcion: d.descripcion, min: d.min, max: d.max }));
};

module.exports = { obtener, actualizar, listar, DEFINICION };
