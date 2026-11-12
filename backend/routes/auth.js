/**
 * @file routes/auth.js
 * @description HU20 / HT02 / RNF-05 — Inicio de sesión con bloqueo tras intentos fallidos,
 * renovación del token y cambio de contraseña con política.
 */

'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getPool } = require('../db');
const { HttpError, h } = require('../lib/http');
const { generarToken, authMiddleware } = require('../lib/auth');
const { permisosDe, ROLES } = require('../lib/permisos');
const { validarPassword, estaBloqueado, registrarIntentoFallido } = require('../lib/reglas');
const parametros = require('../lib/parametros');

const router = express.Router();
const db = () => getPool();

/** Datos públicos del usuario para el frontend. */
async function perfil(id) {
  const [[u]] = await db().query(
    `SELECT u.id, u.usuario, u.nombre, u.rol, u.sede_id AS sedeId, s.nombre AS sede
     FROM usuarios u LEFT JOIN ubicaciones s ON s.id = u.sede_id WHERE u.id = ?`, [id]);
  return u && { ...u, rolNombre: ROLES[u.rol] ?? u.rol, permisos: permisosDe(u.rol) };
}

/** POST /api/auth/login — tras N intentos fallidos (5 por defecto) la cuenta se bloquea M minutos (15). */
router.post('/login', h(async (req, res) => {
  const { usuario, password } = req.body ?? {};
  if (!usuario || !password) throw new HttpError(400, 'Usuario y contraseña son requeridos.');

  const [[user]] = await db().query('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1', [usuario]);
  if (!user) throw new HttpError(401, 'Credenciales incorrectas.');
  if (estaBloqueado(user.bloqueado_hasta)) {
    const min = Math.ceil((new Date(user.bloqueado_hasta) - Date.now()) / 60_000);
    throw new HttpError(423, `Cuenta bloqueada por intentos fallidos. Intenta de nuevo en ${min} minuto(s) o pide al administrador que la desbloquee.`);
  }
  // bcrypt asíncrono: no bloquea el hilo de Node mientras calcula el hash (hallazgo de HT12)
  if (!(await bcrypt.compare(password, user.password_hash))) {
    const r = registrarIntentoFallido(user.intentos_fallidos, {
      maxIntentos: await parametros.obtener('LOGIN_MAX_INTENTOS'), minutos: await parametros.obtener('LOGIN_BLOQUEO_MINUTOS'),
    });
    await db().query('UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?', [r.intentos, r.bloqueadoHasta, user.id]);
    if (r.bloqueadoHasta) throw new HttpError(423, `Cuenta bloqueada por ${await parametros.obtener('LOGIN_BLOQUEO_MINUTOS')} minutos tras demasiados intentos fallidos.`);
    const restantes = (await parametros.obtener('LOGIN_MAX_INTENTOS')) - r.intentos;
    throw new HttpError(401, `Credenciales incorrectas. Te queda(n) ${restantes} intento(s) antes del bloqueo.`);
  }

  await db().query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = NOW() WHERE id = ?', [user.id]);
  const datos = await perfil(user.id);
  res.json({ token: generarToken(datos), user: datos });
}));

/** POST /api/auth/renovar — emite un token nuevo antes de que expire el actual (HT02). */
router.post('/renovar', authMiddleware, h(async (req, res) => {
  const datos = await perfil(req.user.id);
  if (!datos) throw new HttpError(401, 'La cuenta ya no está activa.');
  res.json({ token: generarToken(datos), user: datos });
}));

router.get('/yo', authMiddleware, h(async (req, res) => res.json(await perfil(req.user.id))));

/** POST /api/auth/cambiar-password { actual, nueva } — aplica la política de contraseñas (RNF-05). */
router.post('/cambiar-password', authMiddleware, h(async (req, res) => {
  const { actual, nueva } = req.body ?? {};
  const [[u]] = await db().query('SELECT password_hash FROM usuarios WHERE id = ?', [req.user.id]);
  if (!u || !(await bcrypt.compare(String(actual ?? ''), u.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta.');
  const politica = validarPassword(nueva, { min: await parametros.obtener('PASSWORD_MIN') });
  if (!politica.ok) throw new HttpError(400, politica.errores.join(' '), { errores: politica.errores });
  await db().query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(nueva, 10), req.user.id]);
  res.json({ ok: true });
}));

module.exports = { router, perfil };
